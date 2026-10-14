#!/bin/bash
# Regenerates Resources/AppIcon.icns from scripts/make-icon.swift + Sources/VastBar/VastMark.swift.
set -euo pipefail
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
swiftc -parse-as-library -o "$work/make-icon" scripts/make-icon.swift Sources/VastBar/VastMark.swift
"$work/make-icon" "$work/AppIcon.iconset"
mkdir -p Resources
iconutil -c icns "$work/AppIcon.iconset" -o Resources/AppIcon.icns
echo "wrote Resources/AppIcon.icns"
