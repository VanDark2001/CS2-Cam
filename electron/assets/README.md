# CS2 Demo Show desktop icon

The geometric mark combines a replay triangle, angular viewfinder and timeline
blocks. It follows `docs/design/design.md`: carbon `#191a19`, off-white `#e9e7e4`,
brand yellow-green `#c6ca4c` and border `#474941`. The corners are transparent.

- `app-icon.svg`: editable vector master.
- `app-icon.png`: 512px preview.
- `app-icon.ico`: 16, 24, 32, 48, 64, 128 and 256px Windows icon.

Regenerate with `python tools/generate_app_icon.py` (Pillow required).
Electron Builder uses the ICO through `build.win.icon`; portable builds and
refreshes embed it through `electron/app-icon.cjs`. BrowserWindow also loads
the bundled ICO for its window/taskbar icon.

To update only an existing portable executable, close the app, back up the EXE,
then run `node electron/app-icon.cjs "<folder>/CS2 Demo Show.exe"`. The patcher
checks embedded icon pixels, non-resource section hashes and non-icon resources
before replacing the file. Bundle `assets/app-icon.ico` alongside `main.cjs`.
