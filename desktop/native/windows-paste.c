#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define MODIFIER_RELEASE_TIMEOUT_MS 2000
#define MODIFIER_STABLE_MS 75
#define MODIFIER_POLL_MS 10
#define CLIPBOARD_RETRY_COUNT 10
#define CLIPBOARD_RETRY_DELAY_MS 25
#define REQUESTED_INPUT_COUNT 4

typedef enum SnapshotHandleKind {
  SNAPSHOT_GLOBAL,
  SNAPSHOT_GDI,
  SNAPSHOT_ENH_METAFILE,
  SNAPSHOT_METAFILE_PICT
} SnapshotHandleKind;

typedef struct SnapshotEntry {
  UINT format;
  HANDLE handle;
  SnapshotHandleKind kind;
  HMETAFILE nested_metafile;
} SnapshotEntry;

typedef struct ClipboardSnapshot {
  SnapshotEntry *entries;
  size_t count;
  size_t capacity;
  size_t skipped;
} ClipboardSnapshot;

static const int MODIFIER_KEYS[] = {
  VK_LSHIFT,
  VK_RSHIFT,
  VK_LCONTROL,
  VK_RCONTROL,
  VK_LMENU,
  VK_RMENU,
  VK_LWIN,
  VK_RWIN
};

static void log_stage(const char *stage, const char *details) {
  fprintf(stderr, "[resonance-paste] %s: %s\n", stage, details);
  fflush(stderr);
}

static BOOL open_clipboard_retry(HWND owner_window) {
  for (int attempt = 0; attempt < CLIPBOARD_RETRY_COUNT; attempt++) {
    if (OpenClipboard(owner_window)) {
      return TRUE;
    }
    Sleep(CLIPBOARD_RETRY_DELAY_MS);
  }
  return FALSE;
}

static BOOL any_modifier_down(void) {
  const size_t count = sizeof(MODIFIER_KEYS) / sizeof(MODIFIER_KEYS[0]);
  for (size_t index = 0; index < count; index++) {
    if ((GetAsyncKeyState(MODIFIER_KEYS[index]) & 0x8000) != 0) {
      return TRUE;
    }
  }
  return FALSE;
}

static BOOL wait_for_modifiers_released(void) {
  ULONGLONG started = GetTickCount64();
  ULONGLONG released_since = 0;

  while (GetTickCount64() - started < MODIFIER_RELEASE_TIMEOUT_MS) {
    ULONGLONG now = GetTickCount64();
    if (any_modifier_down()) {
      released_since = 0;
    } else {
      if (released_since == 0) {
        released_since = now;
      }
      if (now - released_since >= MODIFIER_STABLE_MS) {
        return TRUE;
      }
    }
    Sleep(MODIFIER_POLL_MS);
  }
  return FALSE;
}

static void free_snapshot_handle(SnapshotEntry *entry) {
  if (entry->handle == NULL) {
    return;
  }

  if (entry->kind == SNAPSHOT_GDI) {
    DeleteObject(entry->handle);
  } else if (entry->kind == SNAPSHOT_ENH_METAFILE) {
    DeleteEnhMetaFile((HENHMETAFILE)entry->handle);
  } else if (entry->kind == SNAPSHOT_METAFILE_PICT) {
    if (entry->nested_metafile != NULL) {
      DeleteMetaFile(entry->nested_metafile);
    }
    GlobalFree(entry->handle);
  } else {
    GlobalFree(entry->handle);
  }
  entry->handle = NULL;
}

static void free_snapshot(ClipboardSnapshot *snapshot) {
  if (snapshot == NULL) {
    return;
  }
  for (size_t index = 0; index < snapshot->count; index++) {
    free_snapshot_handle(&snapshot->entries[index]);
  }
  free(snapshot->entries);
  memset(snapshot, 0, sizeof(*snapshot));
}

static BOOL append_snapshot_entry(
  ClipboardSnapshot *snapshot,
  UINT format,
  HANDLE handle,
  SnapshotHandleKind kind,
  HMETAFILE nested_metafile
) {
  if (snapshot->count == snapshot->capacity) {
    size_t next_capacity = snapshot->capacity == 0 ? 8 : snapshot->capacity * 2;
    SnapshotEntry *next_entries = (SnapshotEntry *)realloc(
      snapshot->entries,
      next_capacity * sizeof(SnapshotEntry)
    );
    if (next_entries == NULL) {
      SetLastError(ERROR_NOT_ENOUGH_MEMORY);
      return FALSE;
    }
    snapshot->entries = next_entries;
    snapshot->capacity = next_capacity;
  }

  snapshot->entries[snapshot->count].format = format;
  snapshot->entries[snapshot->count].handle = handle;
  snapshot->entries[snapshot->count].kind = kind;
  snapshot->entries[snapshot->count].nested_metafile = nested_metafile;
  snapshot->count++;
  return TRUE;
}

static HANDLE duplicate_global_handle(HANDLE source) {
  SIZE_T size = GlobalSize(source);
  if (size == 0) {
    SetLastError(ERROR_NOT_SUPPORTED);
    return NULL;
  }

  void *source_data = GlobalLock(source);
  if (source_data == NULL) {
    return NULL;
  }

  HGLOBAL copy = GlobalAlloc(GMEM_MOVEABLE, size);
  if (copy == NULL) {
    GlobalUnlock(source);
    return NULL;
  }

  void *copy_data = GlobalLock(copy);
  if (copy_data == NULL) {
    GlobalUnlock(source);
    GlobalFree(copy);
    return NULL;
  }

  memcpy(copy_data, source_data, size);
  GlobalUnlock(copy);
  GlobalUnlock(source);
  return copy;
}

static HANDLE duplicate_palette(HPALETTE source) {
  UINT entry_count = GetPaletteEntries(source, 0, 0, NULL);
  if (entry_count == 0) {
    return NULL;
  }

  SIZE_T bytes = sizeof(LOGPALETTE)
    + (entry_count - 1) * sizeof(PALETTEENTRY);
  LOGPALETTE *palette = (LOGPALETTE *)malloc(bytes);
  if (palette == NULL) {
    SetLastError(ERROR_NOT_ENOUGH_MEMORY);
    return NULL;
  }

  palette->palVersion = 0x300;
  palette->palNumEntries = (WORD)entry_count;
  if (GetPaletteEntries(source, 0, entry_count, palette->palPalEntry) != entry_count) {
    free(palette);
    return NULL;
  }

  HPALETTE copy = CreatePalette(palette);
  free(palette);
  return copy;
}

static HANDLE duplicate_metafile_picture(
  HGLOBAL source,
  HMETAFILE *nested_metafile
) {
  METAFILEPICT *source_picture = (METAFILEPICT *)GlobalLock(source);
  if (source_picture == NULL) {
    return NULL;
  }

  HGLOBAL copy = GlobalAlloc(GMEM_MOVEABLE, sizeof(METAFILEPICT));
  if (copy == NULL) {
    GlobalUnlock(source);
    return NULL;
  }

  METAFILEPICT *copy_picture = (METAFILEPICT *)GlobalLock(copy);
  if (copy_picture == NULL) {
    GlobalUnlock(source);
    GlobalFree(copy);
    return NULL;
  }

  *copy_picture = *source_picture;
  HMETAFILE copied_metafile = CopyMetaFileW(source_picture->hMF, NULL);
  copy_picture->hMF = copied_metafile;
  GlobalUnlock(copy);
  GlobalUnlock(source);

  if (copied_metafile == NULL) {
    GlobalFree(copy);
    return NULL;
  }
  *nested_metafile = copied_metafile;
  return copy;
}

static HANDLE duplicate_clipboard_handle(
  UINT format,
  HANDLE source,
  SnapshotHandleKind *kind,
  HMETAFILE *nested_metafile
) {
  *nested_metafile = NULL;
  if (format == CF_BITMAP) {
    *kind = SNAPSHOT_GDI;
    return CopyImage(source, IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION);
  }
  if (format == CF_PALETTE) {
    *kind = SNAPSHOT_GDI;
    return duplicate_palette((HPALETTE)source);
  }
  if (format == CF_ENHMETAFILE) {
    *kind = SNAPSHOT_ENH_METAFILE;
    return CopyEnhMetaFileW((HENHMETAFILE)source, NULL);
  }
  if (format == CF_METAFILEPICT) {
    *kind = SNAPSHOT_METAFILE_PICT;
    return duplicate_metafile_picture((HGLOBAL)source, nested_metafile);
  }

  *kind = SNAPSHOT_GLOBAL;
  return duplicate_global_handle(source);
}

static BOOL capture_clipboard(
  HWND owner_window,
  ClipboardSnapshot *snapshot,
  DWORD *native_error
) {
  memset(snapshot, 0, sizeof(*snapshot));
  if (!open_clipboard_retry(owner_window)) {
    *native_error = GetLastError();
    return FALSE;
  }

  UINT format = 0;
  DWORD enumeration_error = ERROR_SUCCESS;
  for (;;) {
    SetLastError(ERROR_SUCCESS);
    format = EnumClipboardFormats(format);
    if (format == 0) {
      enumeration_error = GetLastError();
      break;
    }

    if ((format >= CF_PRIVATEFIRST && format <= CF_PRIVATELAST)
        || (format >= CF_GDIOBJFIRST && format <= CF_GDIOBJLAST)
        || format == CF_OWNERDISPLAY
        || (format >= CF_DSPTEXT && format <= CF_DSPENHMETAFILE)) {
      snapshot->skipped++;
      continue;
    }

    HANDLE source = GetClipboardData(format);
    if (source == NULL) {
      snapshot->skipped++;
      continue;
    }

    SnapshotHandleKind kind = SNAPSHOT_GLOBAL;
    HMETAFILE nested_metafile = NULL;
    HANDLE copy = duplicate_clipboard_handle(
      format,
      source,
      &kind,
      &nested_metafile
    );
    if (copy == NULL) {
      snapshot->skipped++;
      continue;
    }

    if (!append_snapshot_entry(
      snapshot,
      format,
      copy,
      kind,
      nested_metafile
    )) {
      SnapshotEntry temporary = { format, copy, kind, nested_metafile };
      free_snapshot_handle(&temporary);
      *native_error = GetLastError();
      CloseClipboard();
      free_snapshot(snapshot);
      return FALSE;
    }
  }

  CloseClipboard();
  if (enumeration_error != ERROR_SUCCESS) {
    *native_error = enumeration_error;
    free_snapshot(snapshot);
    return FALSE;
  }
  return TRUE;
}

static BOOL write_transcript(
  HWND owner_window,
  const wchar_t *text,
  DWORD *native_error
) {
  SIZE_T bytes = (wcslen(text) + 1) * sizeof(wchar_t);
  HGLOBAL text_handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (text_handle == NULL) {
    *native_error = GetLastError();
    return FALSE;
  }

  wchar_t *target = (wchar_t *)GlobalLock(text_handle);
  if (target == NULL) {
    *native_error = GetLastError();
    GlobalFree(text_handle);
    return FALSE;
  }
  memcpy(target, text, bytes);
  GlobalUnlock(text_handle);

  if (!open_clipboard_retry(owner_window)) {
    *native_error = GetLastError();
    GlobalFree(text_handle);
    return FALSE;
  }
  if (!EmptyClipboard()) {
    *native_error = GetLastError();
    CloseClipboard();
    GlobalFree(text_handle);
    return FALSE;
  }
  if (SetClipboardData(CF_UNICODETEXT, text_handle) == NULL) {
    *native_error = GetLastError();
    CloseClipboard();
    GlobalFree(text_handle);
    return FALSE;
  }

  CloseClipboard();
  return TRUE;
}

static BOOL restore_clipboard(
  HWND owner_window,
  ClipboardSnapshot *snapshot,
  DWORD *native_error
) {
  if (!open_clipboard_retry(owner_window)) {
    *native_error = GetLastError();
    return FALSE;
  }
  if (!EmptyClipboard()) {
    *native_error = GetLastError();
    CloseClipboard();
    return FALSE;
  }

  BOOL restored = TRUE;
  for (size_t index = 0; index < snapshot->count; index++) {
    SnapshotEntry *entry = &snapshot->entries[index];
    if (SetClipboardData(entry->format, entry->handle) == NULL) {
      if (restored) {
        *native_error = GetLastError();
      }
      restored = FALSE;
      continue;
    }
    entry->handle = NULL;
    entry->nested_metafile = NULL;
  }
  CloseClipboard();
  return restored;
}

static UINT send_paste_shortcut(void) {
  INPUT inputs[REQUESTED_INPUT_COUNT];
  memset(inputs, 0, sizeof(inputs));

  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = VK_CONTROL;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = 'V';
  inputs[2].type = INPUT_KEYBOARD;
  inputs[2].ki.wVk = 'V';
  inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
  inputs[3].type = INPUT_KEYBOARD;
  inputs[3].ki.wVk = VK_CONTROL;
  inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;

  SetLastError(ERROR_SUCCESS);
  return SendInput(REQUESTED_INPUT_COUNT, inputs, sizeof(INPUT));
}

static void release_paste_keys(void) {
  INPUT inputs[2];
  memset(inputs, 0, sizeof(inputs));
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = 'V';
  inputs[0].ki.dwFlags = KEYEVENTF_KEYUP;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = VK_CONTROL;
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  SendInput(2, inputs, sizeof(INPUT));
}

static char *read_stdin_bytes(size_t *length) {
  size_t capacity = 4096;
  size_t used = 0;
  char *buffer = (char *)malloc(capacity);
  if (buffer == NULL) {
    return NULL;
  }

  for (;;) {
    if (used == capacity) {
      size_t next_capacity = capacity * 2;
      char *next = (char *)realloc(buffer, next_capacity);
      if (next == NULL) {
        free(buffer);
        return NULL;
      }
      buffer = next;
      capacity = next_capacity;
    }

    size_t read = fread(buffer + used, 1, capacity - used, stdin);
    used += read;
    if (read == 0) {
      break;
    }
  }

  *length = used;
  return buffer;
}

static wchar_t *utf8_to_wide(const char *utf8, size_t length) {
  if (length > INT_MAX) {
    SetLastError(ERROR_FILE_TOO_LARGE);
    return NULL;
  }

  int wide_length = MultiByteToWideChar(
    CP_UTF8,
    MB_ERR_INVALID_CHARS,
    utf8,
    (int)length,
    NULL,
    0
  );
  if (wide_length == 0) {
    return NULL;
  }

  wchar_t *wide = (wchar_t *)malloc(
    ((size_t)wide_length + 1) * sizeof(wchar_t)
  );
  if (wide == NULL) {
    SetLastError(ERROR_NOT_ENOUGH_MEMORY);
    return NULL;
  }

  if (MultiByteToWideChar(
    CP_UTF8,
    MB_ERR_INVALID_CHARS,
    utf8,
    (int)length,
    wide,
    wide_length
  ) != wide_length) {
    free(wide);
    return NULL;
  }
  wide[wide_length] = L'\0';
  return wide;
}

static void print_diagnostics(
  UINT sent,
  const ClipboardSnapshot *snapshot
) {
  printf(
    "|sent=%u|requested=%u|inputSize=%zu|keyboardInputSize=%zu"
    "|pointerSize=%zu|clipboardFormats=%zu|clipboardSkipped=%zu",
    sent,
    REQUESTED_INPUT_COUNT,
    sizeof(INPUT),
    sizeof(KEYBDINPUT),
    sizeof(void *),
    snapshot == NULL ? 0 : snapshot->count,
    snapshot == NULL ? 0 : snapshot->skipped
  );
}

static int run_foreground(void) {
  HWND window = GetForegroundWindow();
  DWORD process_id = 0;
  GetWindowThreadProcessId(window, &process_id);
  printf("%lld:%lu", (long long)(INT_PTR)window, (unsigned long)process_id);
  return 0;
}

static HWND create_clipboard_owner_window(void) {
  return CreateWindowExW(
    0,
    L"STATIC",
    L"ResonanceClipboardOwner",
    WS_POPUP,
    0,
    0,
    0,
    0,
    NULL,
    NULL,
    GetModuleHandleW(NULL),
    NULL
  );
}

static int run_paste(HWND expected_window, DWORD restore_delay_ms) {
  size_t utf8_length = 0;
  char *utf8 = read_stdin_bytes(&utf8_length);
  if (utf8 == NULL) {
    fprintf(stderr, "[resonance-paste] input: allocation failed\n");
    return 2;
  }

  wchar_t *text = utf8_to_wide(utf8, utf8_length);
  free(utf8);
  if (text == NULL) {
    fprintf(
      stderr,
      "[resonance-paste] input: invalid UTF-8 or allocation failed (%lu)\n",
      (unsigned long)GetLastError()
    );
    return 2;
  }

  char start_details[160];
  snprintf(
    start_details,
    sizeof(start_details),
    "target=%lld utf8Bytes=%zu inputSize=%zu pointerSize=%zu",
    (long long)(INT_PTR)expected_window,
    utf8_length,
    sizeof(INPUT),
    sizeof(void *)
  );
  log_stage("start", start_details);

  if (!wait_for_modifiers_released()) {
    printf("modifiers-held:0");
    print_diagnostics(0, NULL);
    free(text);
    return 0;
  }
  if (GetForegroundWindow() != expected_window) {
    printf("target-changed:0");
    print_diagnostics(0, NULL);
    free(text);
    return 0;
  }

  HWND owner_window = create_clipboard_owner_window();
  if (owner_window == NULL) {
    DWORD owner_error = GetLastError();
    printf("clipboard-failed:%lu", (unsigned long)owner_error);
    print_diagnostics(0, NULL);
    free(text);
    return 0;
  }

  ClipboardSnapshot snapshot;
  DWORD native_error = ERROR_SUCCESS;
  if (!capture_clipboard(owner_window, &snapshot, &native_error)) {
    printf("clipboard-failed:%lu", (unsigned long)native_error);
    print_diagnostics(0, NULL);
    DestroyWindow(owner_window);
    free(text);
    return 0;
  }

  char snapshot_details[96];
  snprintf(
    snapshot_details,
    sizeof(snapshot_details),
    "captured=%zu skipped=%zu",
    snapshot.count,
    snapshot.skipped
  );
  log_stage("clipboard-snapshot", snapshot_details);

  if (GetForegroundWindow() != expected_window) {
    printf("target-changed:0");
    print_diagnostics(0, &snapshot);
    free_snapshot(&snapshot);
    DestroyWindow(owner_window);
    free(text);
    return 0;
  }

  if (!write_transcript(owner_window, text, &native_error)) {
    DWORD restore_error = ERROR_SUCCESS;
    restore_clipboard(owner_window, &snapshot, &restore_error);
    printf("clipboard-failed:%lu", (unsigned long)native_error);
    print_diagnostics(0, &snapshot);
    free_snapshot(&snapshot);
    DestroyWindow(owner_window);
    free(text);
    return 0;
  }
  free(text);

  DWORD transcript_sequence = GetClipboardSequenceNumber();
  if (GetForegroundWindow() != expected_window) {
    if (GetClipboardSequenceNumber() == transcript_sequence) {
      restore_clipboard(owner_window, &snapshot, &native_error);
    }
    printf("target-changed:0");
    print_diagnostics(0, &snapshot);
    free_snapshot(&snapshot);
    DestroyWindow(owner_window);
    return 0;
  }

  UINT sent = send_paste_shortcut();
  DWORD send_error = GetLastError();
  char send_details[128];
  snprintf(
    send_details,
    sizeof(send_details),
    "accepted=%u requested=%u error=%lu inputSize=%zu",
    sent,
    REQUESTED_INPUT_COUNT,
    (unsigned long)send_error,
    sizeof(INPUT)
  );
  log_stage("send-input", send_details);

  if (sent != REQUESTED_INPUT_COUNT) {
    release_paste_keys();
    if (GetClipboardSequenceNumber() == transcript_sequence) {
      restore_clipboard(owner_window, &snapshot, &native_error);
    }
    printf("send-failed:%lu", (unsigned long)send_error);
    print_diagnostics(sent, &snapshot);
    free_snapshot(&snapshot);
    DestroyWindow(owner_window);
    return 0;
  }

  Sleep(restore_delay_ms);
  if (GetClipboardSequenceNumber() != transcript_sequence) {
    log_stage("clipboard-restore", "skipped because clipboard changed");
    printf("inserted:restore-skipped");
    print_diagnostics(sent, &snapshot);
    free_snapshot(&snapshot);
    DestroyWindow(owner_window);
    return 0;
  }

  if (!restore_clipboard(owner_window, &snapshot, &native_error)) {
    log_stage("clipboard-restore", "failed");
    printf("restore-failed:%lu", (unsigned long)native_error);
    print_diagnostics(sent, &snapshot);
    free_snapshot(&snapshot);
    DestroyWindow(owner_window);
    return 0;
  }

  log_stage("clipboard-restore", "restored");
  printf("inserted:restored");
  print_diagnostics(sent, &snapshot);
  free_snapshot(&snapshot);
  DestroyWindow(owner_window);
  return 0;
}

static void print_usage(void) {
  fprintf(
    stderr,
    "Usage: resonance-paste.exe --foreground | "
    "--paste --window <handle> --restore-delay <milliseconds>\n"
  );
}

int wmain(int argc, wchar_t **argv) {
  if (argc == 2 && wcscmp(argv[1], L"--foreground") == 0) {
    return run_foreground();
  }

  if (argc == 6
      && wcscmp(argv[1], L"--paste") == 0
      && wcscmp(argv[2], L"--window") == 0
      && wcscmp(argv[4], L"--restore-delay") == 0) {
    wchar_t *window_end = NULL;
    wchar_t *delay_end = NULL;
    long long raw_window = wcstoll(argv[3], &window_end, 10);
    unsigned long raw_delay = wcstoul(argv[5], &delay_end, 10);
    if (window_end == argv[3] || *window_end != L'\0'
        || delay_end == argv[5] || *delay_end != L'\0'
        || raw_delay > 10000) {
      print_usage();
      return 2;
    }
    return run_paste((HWND)(INT_PTR)raw_window, (DWORD)raw_delay);
  }

  print_usage();
  return 2;
}
