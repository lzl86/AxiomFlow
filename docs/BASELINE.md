# Local runtime baseline

Run from the project root:

```powershell
py scripts/check_syntax.py
py server.py
```

Use `python` instead of `py` where it is available. Open http://127.0.0.1:8765.

The checker uses only Python and Node.js standard libraries, writes no files, and
returns a nonzero exit code on failure. It explicitly checks native ESM from stdin
and first verifies that Node rejects a deliberately invalid snippet. This guards
against a silent or ineffective check. It does not replace browser verification.

Before a local release, use disposable sessions to verify both dark and light themes:

- Load the homepage and a PDF; check the browser console for uncaught errors.
- Add/edit a question, drag it, connect nodes, zoom and apply automatic layout.
- Select PDF text and add all five annotation statuses.
- Enter a note and immediately close the bubble; reopen and verify the note.
- Search/filter annotations and navigate back to their source page.
- Navigate to another PDF page, wait for autosave, refresh, and verify the page,
  annotations, node edits and theme are restored.
- Open the outline and settings, and switch PDF/Markdown documents.

Use disposable data and empty API credentials for automated smoke tests.
The baseline does not verify paid model calls, concurrent writers, or all
session-switching races; those need separate targeted checks.
