import ctypes
import struct
import unittest
from unittest.mock import Mock, patch

from resonance_backend import windows_insertion


class WindowsInsertionTests(unittest.TestCase):
    def test_input_structure_matches_windows_abi(self) -> None:
        expected_size = 40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28
        self.assertEqual(ctypes.sizeof(windows_insertion.INPUT), expected_size)

    def test_paste_inputs_emit_ctrl_v_down_and_up(self) -> None:
        inputs = windows_insertion._build_paste_inputs()

        self.assertEqual(len(inputs), 4)
        self.assertEqual(inputs[0].keyboard.virtual_key, windows_insertion.VK_CONTROL)
        self.assertEqual(inputs[1].keyboard.virtual_key, windows_insertion.VK_V)
        self.assertEqual(inputs[2].keyboard.flags, windows_insertion.KEYEVENTF_KEYUP)
        self.assertEqual(inputs[3].keyboard.flags, windows_insertion.KEYEVENTF_KEYUP)

    def test_advertises_delayed_text_with_clipboard_monitor_exclusion(self) -> None:
        clipboard = Mock()
        clipboard.CF_UNICODETEXT = 13
        clipboard.RegisterClipboardFormat.return_value = 49_152
        clipboard.GetClipboardSequenceNumber.return_value = 41
        user32 = Mock()
        owner = windows_insertion.DelayedClipboardOwner(
            text="transcript",
            window_handle=123,
        )

        with (
            patch.object(windows_insertion, "win32clipboard", clipboard),
            patch.object(windows_insertion, "_USER32", user32),
        ):
            sequence = windows_insertion._advertise_delayed_transcript(owner)

        self.assertEqual(sequence, 41)
        clipboard.RegisterClipboardFormat.assert_called_once_with(
            windows_insertion.EXCLUDE_CLIPBOARD_MONITORING_FORMAT
        )
        clipboard.SetClipboardData.assert_called_once_with(
            49_152,
            struct.pack("<I", 1),
        )
        user32.SetClipboardData.assert_called_once_with(13, None)
        clipboard.SetClipboardText.assert_not_called()

    def test_renders_transcript_only_when_target_requests_it(self) -> None:
        clipboard = Mock()
        clipboard.CF_UNICODETEXT = 13
        clipboard.GetClipboardSequenceNumber.return_value = 42
        owner = windows_insertion.DelayedClipboardOwner(text="transcript")

        with patch.object(windows_insertion, "win32clipboard", clipboard):
            rendered = windows_insertion._render_delayed_transcript(owner)

        self.assertTrue(rendered)
        self.assertTrue(owner.rendered)
        self.assertEqual(owner.sequence_number, 42)
        clipboard.SetClipboardText.assert_called_once_with("transcript", 13)

    @patch.object(windows_insertion, "_wait_for_modifiers_released", return_value=False)
    def test_paste_fails_closed_while_modifiers_are_held(
        self,
        wait_for_modifiers: Mock,
    ) -> None:
        result = windows_insertion.paste_text_via_clipboard("123", 456, "hello")

        self.assertEqual(result.status, "modifiers-held")
        wait_for_modifiers.assert_called_once_with()

    @patch.object(windows_insertion, "_wait_for_modifiers_released", return_value=True)
    @patch.object(windows_insertion, "_target_matches", return_value=False)
    def test_paste_revalidates_target_after_waiting_for_modifiers(
        self,
        target_matches: Mock,
        wait_for_modifiers: Mock,
    ) -> None:
        result = windows_insertion.paste_text_via_clipboard("123", 456, "hello")

        self.assertEqual(result.status, "target-changed")
        target_matches.assert_called_once_with(123, 456)
        wait_for_modifiers.assert_called_once_with()

    def _run_paste_with_mocks(
        self,
        *,
        sent: int = 4,
        consumed: bool = True,
        restore: tuple[str, int] = ("restored", 0),
    ):
        owner = windows_insertion.DelayedClipboardOwner(
            text="hello",
            window_handle=123,
            sequence_number=41,
        )
        snapshot = windows_insertion.ClipboardSnapshot(object(), False)
        patches = (
            patch.object(windows_insertion, "_wait_for_modifiers_released", return_value=True),
            patch.object(windows_insertion, "_target_matches", return_value=True),
            patch.object(windows_insertion, "_create_delayed_clipboard_owner", return_value=owner),
            patch.object(windows_insertion, "_destroy_delayed_clipboard_owner"),
            patch.object(windows_insertion, "_capture_clipboard", return_value=snapshot),
            patch.object(windows_insertion, "_advertise_delayed_transcript", return_value=41),
            patch.object(windows_insertion, "_send_paste_shortcut", return_value=(sent, 5 if sent != 4 else 0)),
            patch.object(windows_insertion, "_release_paste_keys"),
            patch.object(windows_insertion, "_wait_for_transcript_request", return_value=consumed),
            patch.object(windows_insertion, "_restore_clipboard_safely", return_value=restore),
            patch.object(windows_insertion.time, "sleep"),
        )
        entered = [item.start() for item in patches]
        self.addCleanup(lambda: [item.stop() for item in reversed(patches)])
        result = windows_insertion.paste_text_via_clipboard("123", 456, "hello")
        return result, entered

    def test_paste_restores_only_after_target_consumes_transcript(self) -> None:
        result, mocks = self._run_paste_with_mocks()
        wait_for_request = mocks[8]
        restore_clipboard = mocks[9]
        sleep = mocks[10]

        self.assertEqual(result.status, "inserted")
        self.assertEqual(result.clipboard_restore, "restored")
        wait_for_request.assert_called_once()
        sleep.assert_called_once_with(windows_insertion.PASTE_SETTLE_SECONDS)
        restore_clipboard.assert_called_once()

    def test_paste_balances_ole_initialization(self) -> None:
        with (
            patch.object(windows_insertion.pythoncom, "OleInitialize") as initialize,
            patch.object(windows_insertion._OLE32, "OleUninitialize") as uninitialize,
        ):
            result, _ = self._run_paste_with_mocks()

        self.assertEqual(result.status, "inserted")
        initialize.assert_called_once_with()
        uninitialize.assert_called_once_with()

    def test_paste_timeout_is_not_reported_as_success(self) -> None:
        result, mocks = self._run_paste_with_mocks(consumed=False)

        self.assertEqual(result.status, "paste-timeout")
        self.assertNotEqual(result.status, "inserted")
        mocks[9].assert_called_once()
        mocks[10].assert_not_called()

    def test_partial_sendinput_releases_keys_before_restoring(self) -> None:
        result, mocks = self._run_paste_with_mocks(sent=2)
        release_keys = mocks[7]
        wait_for_request = mocks[8]
        restore_clipboard = mocks[9]

        self.assertEqual(result.status, "paste-failed")
        release_keys.assert_called_once_with()
        wait_for_request.assert_not_called()
        restore_clipboard.assert_called_once()

    def test_restore_failure_is_reported(self) -> None:
        result, _ = self._run_paste_with_mocks(restore=("failed", 5))

        self.assertEqual(result.status, "restore-failed")
        self.assertEqual(result.clipboard_restore, "failed")
        self.assertEqual(result.native_error, 5)

    @patch.object(windows_insertion.win32clipboard, "GetClipboardSequenceNumber")
    def test_restore_does_not_overwrite_a_new_user_clipboard(
        self,
        get_sequence: Mock,
    ) -> None:
        get_sequence.return_value = 99
        result = windows_insertion._restore_clipboard(
            windows_insertion.ClipboardSnapshot(object(), False),
            41,
        )

        self.assertEqual(result, "skipped")


if __name__ == "__main__":
    unittest.main()
