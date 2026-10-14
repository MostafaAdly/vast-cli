#!/bin/bash
# Builds Vast Bar.app (ad-hoc signed, no Dock icon) and installs it in /Applications.
#   ./build.sh            build and install
#   ./build.sh --no-install
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release --product VastBar
BIN="$(swift build -c release --show-bin-path)/VastBar"

APP="build/Vast Bar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/VastBar"
mkdir -p "$APP/Contents/Resources"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>VastBar</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.vastgroup.vastbar</string>
  <key>CFBundleName</key><string>Vast Bar</string>
  <key>CFBundleDisplayName</key><string>Vast Bar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Vast Bar opens Terminal to run a vast command you asked for.</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "built $APP"

if [ "${1:-}" != "--no-install" ]; then
  osascript -e 'quit app "Vast Bar"' 2>/dev/null || true
  rm -rf "/Applications/Vast Bar.app"
  cp -R "$APP" /Applications/
  echo "installed /Applications/Vast Bar.app"
fi
