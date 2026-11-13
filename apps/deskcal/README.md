# DeskCal (Aura Suite rebuild)

A calendar that reminds you. Same UI as before, but now a real Windows app:
no Node.js, no Edge, no VBS launcher. One installer, installs for the current user without admin rights.

## What changed from the old version
| Old | New |
|---|---|
| Needed Node.js and Edge installed | Self-contained Tauri app (about 5 MB installer) |
| `DeskCal.vbs` started a hidden server on port 47321 | No server, no open port. Data is read and written by the app |
| Reminders only worked while the Node service ran | Reminders run while the app is open or in the tray; the window hides to the tray on close |
| Data in `DeskCal/data/` | Data in `%APPDATA%\com.auraventures.deskcal\` with a daily backup in `backups/` |
| Started by hand | Starts hidden at login (first run switches this on) |

The first launch copies `C:\Users\<you>\DeskCal\data\calendar.json` across if it exists, so your calendar carries over.

## Build the installer (no Rust needed on your machine)
1. Create a GitHub repo and push this folder as its root.
2. Actions tab, "Build DeskCal (Windows installer)", Run workflow.
3. Download `DeskCal-Windows-installer` from the finished run. It contains `DeskCal_1.0.0_x64-setup.exe`.

Local build on Windows: install Rust and Node, then `npx @tauri-apps/cli@2 icon ui/icon.svg` and `npx @tauri-apps/cli@2 build`.
Dev run: `npx @tauri-apps/cli@2 dev`.

## Not done yet
- Not compiled or run yet. The first CI run is the first real test, so expect to fix small things.
- Unsigned installer: Windows SmartScreen will warn ("More info", then "Run anyway") until we sign it or ship through the Microsoft Store.
- No auto-update yet (Tauri updater is the next step).
