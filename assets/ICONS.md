# App Icon

`icon.png` (1024×1024, rendered from `public/favicon.svg` on a rounded dark tile) is the desktop
app's icon on every platform. electron-builder generates the Windows `.ico` and macOS `.icns` from
it during `npm run electron:build`, so no other files are needed.

## Replacing it

Put a square PNG of at least 512×512 (1024×1024 is best) at `assets/icon.png`. To render one from an
SVG:

```bash
inkscape your-icon.svg --export-type=png --export-width=1024 --export-filename=assets/icon.png
```

If you want hand-tuned platform icons, add `icon.ico` and/or `icon.icns` here and point the `win.icon`
/ `mac.icon` entries in `package.json` → `build` at them.
