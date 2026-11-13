# Inkboard

A fast desktop whiteboard that is also a notebook. You can draw and handwrite anywhere, double-click to type Word-style text, and every notebook is saved as a real `.inkb` file in your folders.

## Install (Windows)

Run `Inkboard-Setup-1.0.0.exe`. It installs for your user only (no admin needed) and adds Start Menu and Desktop shortcuts. After that, double-clicking any `.inkb` file opens it in Inkboard.

The installer isn't code-signed, so SmartScreen may warn you the first time. Click **More info**, then **Run anyway**.

## Run from source

```
npm install
npm start            # run the app
npm run dist:win     # build the installer into dist/
```

## Where your work is saved

- Your library is `Documents\Inkboard`. You can change it in Settings → General or from the ⋯ menu in the sidebar.
- Each notebook is one `.inkb` file (JSON). Folders in the sidebar are real folders on disk.
- Notebooks save automatically about half a second after each change. Ctrl+S saves straight away, and Ctrl+Shift+S saves a copy anywhere you like.
- Anything you delete goes to the Recycle Bin.

## Handwriting AI

Use the **Handwriting** chip in the bottom-right to choose what happens when you pause writing:

| Mode | What it does | Needs internet |
|---|---|---|
| Off | Leaves your ink as you wrote it | No |
| Neaten (default) | Straightens each line, corrects slant, evens out letter sizes and spacing, and smooths jitter. It still looks like your handwriting. | No |
| Convert to text | Sends the handwriting to a vision model and replaces it with clean text in a neat handwriting font or a typed font. The original ink is kept, so **Original ink** brings it back. | Yes |

Convert to text needs an API key, which you add in Settings → Handwriting & AI. It works with Anthropic (default model `claude-haiku-5-5`) or any OpenAI-compatible endpoint, such as OpenAI, Groq or a local server. The key is encrypted with Windows' secure storage.

You can also select some ink and click **Neaten** or **To text** yourself.

Some other ink helpers:
- Hold the pen still at the end of a stroke and it snaps into a clean line, rectangle, ellipse, triangle or polygon.
- Strokes are smoothed and pressure-sensitive as you write.

## Speed

- Ink, text and the live stroke each get their own layer. The stroke you're drawing goes on a low-latency canvas, and predicted pointer events are used to cut lag.
- Large boards (over 350 items) are drawn from a cached bitmap, so panning costs one image copy. In testing, a frame with 6,000 strokes on screen took about 0.03 ms instead of 41 ms.
- There's no framework and no bundler. The UI is plain ES modules.

## Code map

| File | Role |
|---|---|
| `src/main.js` | Windows, file system, library folder, dialogs, export (PDF/PNG), settings, AI calls |
| `src/preload.js` | The secure bridge between the page and the OS |
| `src/renderer/board.js` | Canvas engine: camera, rendering, tools, selection, undo/redo |
| `src/renderer/ink.js` | Stroke outlines, shapes, hit testing, element rendering |
| `src/renderer/text.js` | Word-style text boxes, markdown shortcuts, checklists, tables |
| `src/renderer/format.js` | The formatting ribbon |
| `src/renderer/handwriting.js` | Shape snapping, offline neatening, AI conversion |
| `src/renderer/library.js` | Sidebar folder and notebook tree |
| `src/renderer/app.js` | Tabs, pages, toolbars, settings, find/replace, export, shortcuts |

Press **?** inside the app to see all keyboard shortcuts.
