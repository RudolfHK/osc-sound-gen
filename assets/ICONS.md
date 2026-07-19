# App Icons

electron-builder needs platform-specific icon files here before running `npm run electron:build`.

## Required files

| File | Platform | Size |
|------|----------|------|
| `icon.ico` | Windows (NSIS installer) | Multi-size: 16, 32, 48, 256 px |
| `icon.icns` | macOS (DMG) | Multi-size: 16–1024 px |
| `icon.png` | Linux (AppImage) | 512×512 px |

## Quick conversion

Start from a high-resolution PNG (512×512 or larger) — the SVG source is at `public/favicon.svg`.

### Using ImageMagick (Linux / macOS)

```bash
# Render SVG → PNG (requires librsvg or inkscape)
inkscape public/favicon.svg --export-type=png --export-width=512 --export-filename=assets/icon.png

# PNG → ICO (Windows)
magick convert assets/icon.png -define icon:auto-resize="256,128,64,48,32,16" assets/icon.ico

# PNG → ICNS (macOS) — requires iconutil
mkdir icon.iconset
for s in 16 32 64 128 256 512; do
  magick convert assets/icon.png -resize ${s}x${s} icon.iconset/icon_${s}x${s}.png
done
iconutil -c icns icon.iconset -o assets/icon.icns
rm -rf icon.iconset
```

### Using an online tool

1. Export `public/favicon.svg` to PNG at 512×512 (e.g. https://svgtopng.com)
2. Convert PNG → ICO at https://convertio.co/png-ico (select multi-size ICO)
3. Convert PNG → ICNS at https://cloudconvert.com/png-to-icns
4. Place the files in this `assets/` directory

### electron-builder fallback

If `icon.ico` / `icon.icns` are missing, electron-builder falls back to `icon.png` and
auto-generates the other formats using `nativeimage` when the build tooling supports it.
Place at minimum a 512×512 `icon.png` and the build should succeed on most systems.
