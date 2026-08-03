from __future__ import annotations

import ctypes
import struct
import sys
import threading
import time
from ctypes import wintypes
from dataclasses import dataclass, field
from typing import Any, Literal


if sys.platform == "win32":
    import pythoncom
    import pywintypes
    import win32clipboard
    import win32gui
else:  # pragma: no cover - exercised only by non-Windows deployments
    pythoncom = None
    pywintypes = None
    win32clipboard = None
    win32gui = None


INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
VK_CONTROL = 0x11
VK_V = 0x56
MODIFIER_RELEASE_TIMEOUT_SECONDS = 2.0
MODIFIER_STABLE_SECONDS = 0.075
MODIFIER_POLL_SECONDS = 0.010
CLIPBOARD_RETRY_COUNT = 10
CLIPBOARD_RETRY_SECONDS = 0.025
PASTE_SETTLE_SECONDS = 0.100
CLIPBOARD_RENDER_TIMEOUT_SECONDS = 5.0
CLIPBOARD_MESSAGE_POLL_SECONDS = 0.005
MAX_INSERTION_CODE_UNITS = 32_768
EXCLUDE_CLIPBOARD_MONITORING_FORMAT = (
    "ExcludeClipboardContentFromMonitorProcessing"
)

MODIFIER_KEYS = (
    0xA0,  # VK_LSHIFT
    0xA1,  # VK_RSHIFT
    0xA2,  # VK_LCONTROL
    0xA3,  # VK_RCONTROL
    0xA4,  # VK_LMENU
    0xA5,  # VK_RMENU
    0x5B,  # VK_LWIN
    0x5C,  # VK_RWIN
)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = (
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouse_data", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("extra_info", ctypes.c_size_t),
    )


class KEYBDINPUT(ctypes.Structure):
    _fields_ = (
        ("virtual_key", wintypes.WORD),
        ("scan_code", wintypes.WORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("extra_info", ctypes.c_size_t),
    )


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = (
        ("message", wintypes.DWORD),
        ("parameter_low", wintypes.WORD),
        ("parameter_high", wintypes.WORD),
    )


class INPUT_VALUE(ctypes.Union):
    _fields_ = (
        ("mouse", MOUSEINPUT),
        ("keyboard", KEYBDINPUT),
        ("hardware", HARDWAREINPUT),
    )


class INPUT(ctypes.Structure):
    _anonymous_ = ("value",)
    _fields_ = (
        ("type", wintypes.DWORD),
        ("value", INPUT_VALUE),
    )


@dataclass(frozen=True)
class ForegroundTarget:
    window_handle: str
    process_id: int

    def to_dict(self) -> dict[str, str | int]:
        return {
            "windowHandle": self.window_handle,
            "processId": self.process_id,
        }


InsertionStatus = Literal[
    "inserted",
    "modifiers-held",
    "target-changed",
    "clipboard-failed",
    "paste-timeout",
    "paste-failed",
    "restore-failed",
]
ClipboardRestore = Literal["restored", "empty", "skipped", "failed"]


@dataclass(frozen=True)
class InsertionResult:
    status: InsertionStatus
    clipboard_restore: ClipboardRestore = "skipped"
    native_error: int = 0
    diagnostics: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "clipboardRestore": self.clipboard_restore,
            "nativeError": self.native_error,
            "diagnostics": self.diagnostics,
        }


@dataclass(frozen=True)
class ClipboardSnapshot:
    data_object: Any | None
    was_empty: bool


@dataclass
class DelayedClipboardOwner:
    text: str
    window_handle: int = 0
    rendered: bool = False
    render_error: int = 0
    sequence_number: int = 0


class WindowsIntegrationUnavailable(RuntimeError):
    pass


class ClipboardAccessError(RuntimeError):
    def __init__(self, message: str, native_error: int = 0):
        super().__init__(message)
        self.native_error = native_error


def _load_user32():
    if sys.platform != "win32":
        return None

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.argtypes = ()
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetClipboardOwner.argtypes = ()
    user32.GetClipboardOwner.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = (
        wintypes.HWND,
        ctypes.POINTER(wintypes.DWORD),
    )
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
    user32.GetAsyncKeyState.restype = wintypes.SHORT
    user32.SendInput.argtypes = (
        wintypes.UINT,
        ctypes.POINTER(INPUT),
        ctypes.c_int,
    )
    user32.SendInput.restype = wintypes.UINT
    user32.SetClipboardData.argtypes = (wintypes.UINT, wintypes.HANDLE)
    user32.SetClipboardData.restype = wintypes.HANDLE
    return user32


def _load_ole32():
    if sys.platform != "win32":
        return None

    ole32 = ctypes.OleDLL("ole32", use_last_error=True)
    ole32.OleUninitialize.argtypes = ()
    ole32.OleUninitialize.restype = None
    return ole32


_USER32 = _load_user32()
_OLE32 = _load_ole32()
_CLIPBOARD_LOCK = threading.Lock()
_CLIPBOARD_OWNER_CLASS = "ResonancePythonClipboardOwnerWindow"
_CLIPBOARD_OWNER_STATES: dict[int, DelayedClipboardOwner] = {}
_CLIPBOARD_OWNER_CLASS_LOCK = threading.Lock()
_CLIPBOARD_OWNER_CLASS_REGISTERED = False


def _require_windows():
    if (
        _USER32 is None
        or _OLE32 is None
        or pythoncom is None
        or win32clipboard is None
    ):
        raise WindowsIntegrationUnavailable(
            "Clipboard text insertion is currently supported on Windows only."
        )
    return _USER32


def get_foreground_target() -> ForegroundTarget | None:
    user32 = _require_windows()
    window = user32.GetForegroundWindow()
    if not window:
        return None

    process_id = wintypes.DWORD()
    user32.GetWindowThreadProcessId(window, ctypes.byref(process_id))
    if process_id.value == 0:
        return None

    window_value = ctypes.cast(window, ctypes.c_void_p).value
    if not window_value:
        return None
    return ForegroundTarget(str(window_value), process_id.value)


def _any_modifier_down() -> bool:
    user32 = _require_windows()
    return any(user32.GetAsyncKeyState(key) & 0x8000 for key in MODIFIER_KEYS)


def _wait_for_modifiers_released(
    *,
    clock=time.perf_counter,
    sleep=time.sleep,
) -> bool:
    started_at = clock()
    released_at: float | None = None

    while clock() - started_at < MODIFIER_RELEASE_TIMEOUT_SECONDS:
        now = clock()
        if _any_modifier_down():
            released_at = None
        else:
            if released_at is None:
                released_at = now
            elif now - released_at >= MODIFIER_STABLE_SECONDS:
                return True
        sleep(MODIFIER_POLL_SECONDS)

    return False


def _native_error(error: BaseException) -> int:
    for attribute in ("winerror", "hresult"):
        value = getattr(error, attribute, None)
        if isinstance(value, int):
            return value
    return 0


def _retry_clipboard(operation):
    last_error: BaseException | None = None
    for attempt in range(CLIPBOARD_RETRY_COUNT):
        try:
            return operation()
        except Exception as error:
            if pywintypes is not None and not isinstance(
                error, (pywintypes.error, pywintypes.com_error)
            ):
                raise
            last_error = error
            if attempt + 1 < CLIPBOARD_RETRY_COUNT:
                time.sleep(CLIPBOARD_RETRY_SECONDS)
    assert last_error is not None
    raise ClipboardAccessError(
        "The Windows clipboard is unavailable.",
        _native_error(last_error),
    ) from last_error


def _capture_clipboard() -> ClipboardSnapshot:
    def capture() -> ClipboardSnapshot:
        was_empty = win32clipboard.CountClipboardFormats() == 0
        return ClipboardSnapshot(
            data_object=None if was_empty else pythoncom.OleGetClipboard(),
            was_empty=was_empty,
        )

    return _retry_clipboard(capture)


def _render_delayed_transcript(owner: DelayedClipboardOwner) -> bool:
    if owner.rendered:
        return True
    try:
        win32clipboard.SetClipboardText(
            owner.text,
            win32clipboard.CF_UNICODETEXT,
        )
    except Exception as error:
        owner.render_error = _native_error(error)
        return False
    owner.rendered = True
    owner.sequence_number = win32clipboard.GetClipboardSequenceNumber()
    return True


def _clipboard_owner_window_proc(
    window_handle: int,
    message: int,
    w_param: int,
    l_param: int,
) -> int:
    owner = _CLIPBOARD_OWNER_STATES.get(window_handle)
    if owner is not None and message == 0x0305:  # WM_RENDERFORMAT
        if w_param == win32clipboard.CF_UNICODETEXT:
            _render_delayed_transcript(owner)
        return 0
    if owner is not None and message == 0x0306:  # WM_RENDERALLFORMATS
        if _USER32.GetClipboardOwner() == window_handle:
            opened = False
            try:
                win32clipboard.OpenClipboard(window_handle)
                opened = True
                _render_delayed_transcript(owner)
            finally:
                if opened:
                    win32clipboard.CloseClipboard()
        return 0
    return win32gui.DefWindowProc(window_handle, message, w_param, l_param)


def _register_clipboard_owner_class() -> None:
    global _CLIPBOARD_OWNER_CLASS_REGISTERED
    with _CLIPBOARD_OWNER_CLASS_LOCK:
        if _CLIPBOARD_OWNER_CLASS_REGISTERED:
            return
        window_class = win32gui.WNDCLASS()
        window_class.lpszClassName = _CLIPBOARD_OWNER_CLASS
        window_class.lpfnWndProc = _clipboard_owner_window_proc
        try:
            win32gui.RegisterClass(window_class)
        except Exception as error:
            if _native_error(error) != 1410:  # ERROR_CLASS_ALREADY_EXISTS
                raise
        _CLIPBOARD_OWNER_CLASS_REGISTERED = True


def _create_delayed_clipboard_owner(text: str) -> DelayedClipboardOwner:
    _register_clipboard_owner_class()
    owner = DelayedClipboardOwner(text=text)
    owner.window_handle = win32gui.CreateWindow(
        _CLIPBOARD_OWNER_CLASS,
        "ResonanceClipboardOwner",
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        None,
    )
    _CLIPBOARD_OWNER_STATES[owner.window_handle] = owner
    return owner


def _destroy_delayed_clipboard_owner(owner: DelayedClipboardOwner) -> None:
    _CLIPBOARD_OWNER_STATES.pop(owner.window_handle, None)
    if owner.window_handle and win32gui.IsWindow(owner.window_handle):
        win32gui.DestroyWindow(owner.window_handle)
    owner.window_handle = 0


def _advertise_delayed_transcript(owner: DelayedClipboardOwner) -> int:
    def advertise() -> int:
        win32clipboard.OpenClipboard(owner.window_handle)
        try:
            win32clipboard.EmptyClipboard()
            exclude_monitoring = win32clipboard.RegisterClipboardFormat(
                EXCLUDE_CLIPBOARD_MONITORING_FORMAT
            )
            win32clipboard.SetClipboardData(
                exclude_monitoring,
                struct.pack("<I", 1),
            )
            ctypes.set_last_error(0)
            _USER32.SetClipboardData(win32clipboard.CF_UNICODETEXT, None)
            native_error = ctypes.get_last_error()
            if native_error:
                raise ClipboardAccessError(
                    "The transcript could not be advertised to the paste target.",
                    native_error,
                )
        finally:
            win32clipboard.CloseClipboard()
        owner.sequence_number = win32clipboard.GetClipboardSequenceNumber()
        return owner.sequence_number

    return _retry_clipboard(advertise)


def _wait_for_transcript_request(owner: DelayedClipboardOwner) -> bool:
    deadline = time.perf_counter() + CLIPBOARD_RENDER_TIMEOUT_SECONDS
    while time.perf_counter() < deadline:
        win32gui.PumpWaitingMessages()
        if owner.rendered or owner.render_error:
            return owner.rendered
        time.sleep(CLIPBOARD_MESSAGE_POLL_SECONDS)
    return False


def _apply_clipboard_snapshot(snapshot: ClipboardSnapshot) -> ClipboardRestore:
    if snapshot.was_empty:
        def restore_empty() -> None:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
            finally:
                win32clipboard.CloseClipboard()

        _retry_clipboard(restore_empty)
        return "empty"

    def restore_object() -> None:
        pythoncom.OleSetClipboard(snapshot.data_object)
        # Materialize the restored data so the source application and this
        # worker thread do not have to remain alive to serve delayed formats.
        pythoncom.OleFlushClipboard()

    _retry_clipboard(restore_object)
    return "restored"


def _restore_clipboard(
    snapshot: ClipboardSnapshot,
    transcript_sequence: int,
) -> ClipboardRestore:
    if win32clipboard.GetClipboardSequenceNumber() != transcript_sequence:
        return "skipped"
    return _apply_clipboard_snapshot(snapshot)


def _restore_clipboard_safely(
    snapshot: ClipboardSnapshot,
    transcript_sequence: int,
) -> tuple[ClipboardRestore, int]:
    try:
        return _restore_clipboard(snapshot, transcript_sequence), 0
    except ClipboardAccessError as error:
        return "failed", error.native_error


def _build_paste_inputs():
    key_down = lambda key: INPUT(
        type=INPUT_KEYBOARD,
        value=INPUT_VALUE(keyboard=KEYBDINPUT(virtual_key=key)),
    )
    key_up = lambda key: INPUT(
        type=INPUT_KEYBOARD,
        value=INPUT_VALUE(
            keyboard=KEYBDINPUT(virtual_key=key, flags=KEYEVENTF_KEYUP)
        ),
    )
    return (INPUT * 4)(
        key_down(VK_CONTROL),
        key_down(VK_V),
        key_up(VK_V),
        key_up(VK_CONTROL),
    )


def _send_paste_shortcut() -> tuple[int, int]:
    user32 = _require_windows()
    inputs = _build_paste_inputs()
    ctypes.set_last_error(0)
    sent = user32.SendInput(len(inputs), inputs, ctypes.sizeof(INPUT))
    return sent, ctypes.get_last_error()


def _release_paste_keys() -> None:
    user32 = _require_windows()
    key_up = lambda key: INPUT(
        type=INPUT_KEYBOARD,
        value=INPUT_VALUE(
            keyboard=KEYBDINPUT(virtual_key=key, flags=KEYEVENTF_KEYUP)
        ),
    )
    inputs = (INPUT * 2)(key_up(VK_V), key_up(VK_CONTROL))
    user32.SendInput(len(inputs), inputs, ctypes.sizeof(INPUT))


def _target_matches(expected_window: int, expected_process_id: int) -> bool:
    current = get_foreground_target()
    return (
        current is not None
        and current.window_handle == str(expected_window)
        and current.process_id == expected_process_id
    )


def paste_text_via_clipboard(
    expected_window_handle: str,
    expected_process_id: int,
    text: str,
) -> InsertionResult:
    _require_windows()
    if not text:
        raise ValueError("There is no transcription text to insert.")
    if len(text.encode("utf-16-le", errors="surrogatepass")) // 2 > MAX_INSERTION_CODE_UNITS:
        raise ValueError("Transcription text is too large to insert safely.")

    try:
        expected_window = int(expected_window_handle, 10)
    except ValueError as error:
        raise ValueError("The captured Windows target is invalid.") from error
    if expected_window <= 0 or expected_process_id <= 0:
        raise ValueError("The captured Windows target is invalid.")

    if not _wait_for_modifiers_released():
        return InsertionResult("modifiers-held")
    if not _target_matches(expected_window, expected_process_id):
        return InsertionResult("target-changed")

    with _CLIPBOARD_LOCK:
        # OLE clipboard functions require OleInitialize, which performs
        # additional per-apartment setup beyond base COM initialization.
        pythoncom.OleInitialize()
        snapshot: ClipboardSnapshot | None = None
        owner: DelayedClipboardOwner | None = None
        try:
            try:
                owner = _create_delayed_clipboard_owner(text)
            except Exception as error:
                return InsertionResult(
                    "clipboard-failed",
                    native_error=_native_error(error),
                )

            try:
                snapshot = _capture_clipboard()
            except ClipboardAccessError as error:
                return InsertionResult("clipboard-failed", native_error=error.native_error)

            try:
                _advertise_delayed_transcript(owner)
            except ClipboardAccessError as error:
                try:
                    _apply_clipboard_snapshot(snapshot)
                except ClipboardAccessError as restore_error:
                    return InsertionResult(
                        "restore-failed",
                        clipboard_restore="failed",
                        native_error=restore_error.native_error,
                    )
                return InsertionResult("clipboard-failed", native_error=error.native_error)

            if not _target_matches(expected_window, expected_process_id):
                clipboard_restore, restore_error = _restore_clipboard_safely(
                    snapshot,
                    owner.sequence_number,
                )
                if clipboard_restore == "failed":
                    return InsertionResult(
                        "restore-failed",
                        clipboard_restore="failed",
                        native_error=restore_error,
                    )
                return InsertionResult(
                    "target-changed",
                    clipboard_restore=clipboard_restore,
                )

            sent, native_error = _send_paste_shortcut()
            if sent != 4:
                _release_paste_keys()
                clipboard_restore, restore_error = _restore_clipboard_safely(
                    snapshot,
                    owner.sequence_number,
                )
                if clipboard_restore == "failed":
                    return InsertionResult(
                        "restore-failed",
                        clipboard_restore="failed",
                        native_error=restore_error,
                        diagnostics={"sent": sent, "requested": 4},
                    )
                return InsertionResult(
                    "paste-failed",
                    clipboard_restore=clipboard_restore,
                    native_error=native_error,
                    diagnostics={"sent": sent, "requested": 4},
                )

            if not _wait_for_transcript_request(owner):
                clipboard_restore, restore_error = _restore_clipboard_safely(
                    snapshot,
                    owner.sequence_number,
                )
                if clipboard_restore == "failed":
                    return InsertionResult(
                        "restore-failed",
                        clipboard_restore="failed",
                        native_error=restore_error,
                        diagnostics={"sent": sent, "requested": 4},
                    )
                return InsertionResult(
                    "paste-timeout",
                    clipboard_restore=clipboard_restore,
                    native_error=owner.render_error,
                    diagnostics={"sent": sent, "requested": 4},
                )

            time.sleep(PASTE_SETTLE_SECONDS)
            clipboard_restore, restore_error = _restore_clipboard_safely(
                snapshot,
                owner.sequence_number,
            )
            if clipboard_restore == "failed":
                return InsertionResult(
                    "restore-failed",
                    clipboard_restore="failed",
                    native_error=restore_error,
                    diagnostics={"sent": sent, "requested": 4},
                )

            return InsertionResult(
                "inserted",
                clipboard_restore=clipboard_restore,
                native_error=native_error,
                diagnostics={
                    "sent": sent,
                    "requested": 4,
                    "inputSize": ctypes.sizeof(INPUT),
                    "pointerSize": ctypes.sizeof(ctypes.c_void_p),
                },
            )
        finally:
            if owner is not None:
                _destroy_delayed_clipboard_owner(owner)
            _OLE32.OleUninitialize()
