# Easy launch (no typing commands)

This repo includes one-double-click launchers. They install dependencies on
the first run, then start the app every time after. You still need
[Node.js LTS](https://nodejs.org) installed once, and your A1111/WebUI running
with the API enabled.

## Windows
1. Double-click **`Start-SAA.bat`**.
2. The first run installs everything and **creates a `SAA-edit` shortcut on your Desktop**.
3. After that, just double-click the Desktop **SAA-edit** shortcut to launch.

> Tip: you can also right-click `Start-SAA.bat` → *Send to* → *Desktop (create shortcut)*,
> or pin it to Start/Taskbar.

## macOS
1. Double-click **`start-saa.command`** (first time: right-click → *Open* to bypass Gatekeeper).
2. To get a Dock/Desktop shortcut, drag `start-saa.command` to the Dock, or
   right-click it → *Make Alias* and move the alias to your Desktop.

## Linux
1. Run **`./start-saa.sh`** (or double-click it and choose *Run*).
2. For a desktop icon, copy `SAA-edit.desktop` to `~/.local/share/applications/`
   and edit the `Exec=` / `Path=` lines to point at this folder.

## Build a fully standalone app (optional, no Node needed to run)
```
npm run package        # Windows  -> release/saa-win32-x64/saa.exe
npm run package_mac    # macOS
```
Then make a shortcut to the produced `saa.exe` (or the .app).
