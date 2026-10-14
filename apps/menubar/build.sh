#!/bin/bash
# Builds Vast Bar.app (ad-hoc signed, no Dock icon) and installs it in /Applications.
#   ./build.sh                  build and install (native arch)
#   ./build.sh --no-install     build only
#   ./build.sh --universal      arm64 + x86_64 (the release build)
# The app's version is the CLI's (package.json), so app X.Y.Z pairs with CLI X.Y.Z.
set -euo pipefail
cd "$(dirname "$0")"

NO_INSTALL=0
UNIVERSAL=0
for arg in "$@"; do
  case "$arg" in
    --no-install) NO_INSTALL=1 ;;
    --universal) UNIVERSAL=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('../../package.json').version")"
ARCHS=()
if [ "$UNIVERSAL" = 1 ]; then ARCHS=(--arch arm64 --arch x86_64); fi

# ${ARCHS[@]+...}: macOS's bash 3.2 treats an empty array as unbound under set -u.
swift build -c release --product VastBar ${ARCHS[@]+"${ARCHS[@]}"}
BIN="$(swift build -c release ${ARCHS[@]+"${ARCHS[@]}"} --show-bin-path)/VastBar"

APP="build/Vast Bar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/VastBar"
mkdir -p "$APP/Contents/Resources"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
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
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Vast Bar opens Terminal to run a vast command you asked for.</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "built $APP ($VERSION)"

if [ "$NO_INSTALL" = 0 ]; then
  osascript -e 'quit app "Vast Bar"' 2>/dev/null || true
  rm -rf "/Applications/Vast Bar.app"
  cp -R "$APP" /Applications/
  echo "installed /Applications/Vast Bar.app"
fi
