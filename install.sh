#!/usr/bin/env bash
#
# Vast CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/MostafaAdly/vast-cli/main/install.sh | bash
#
# Environment overrides:
#   VAST_VERSION   install a specific release tag instead of the latest
#   VAST_BIN_DIR   where to put the `vast` shim (default ~/.local/bin)
#
# Idempotent — re-running upgrades in place, which is what `vast upgrade` does.

set -euo pipefail

REPO="MostafaAdly/vast-cli"
HOME_DIR="${VAST_CLI_HOME:-$HOME/.vast-cli}"
BIN_DIR="${VAST_BIN_DIR:-$HOME/.local/bin}"
ASSET="vast.js"

# Colour only on a terminal. Installers get piped and logged constantly.
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
else
  B=""; DIM=""; GRN=""; YLW=""; RED=""; RST=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '  %s!%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$RED" "$*" "$RST" >&2; exit 1; }

say ""
say "  ${B}Vast CLI${RST} installer"
say ""

# ---------------------------------------------------------------- prerequisites
# Checked up front and all at once: failing here with a clear message is far
# better than failing later in the middle of a release.

missing=""
command -v git >/dev/null 2>&1 || missing="$missing git"
command -v gh  >/dev/null 2>&1 || missing="$missing gh"
command -v node >/dev/null 2>&1 || missing="$missing node"
command -v curl >/dev/null 2>&1 || missing="$missing curl"

if [ -n "$missing" ]; then
  die "Missing required tools:$missing

  git   https://git-scm.com
  gh    https://cli.github.com
  node  https://nodejs.org  (v18 or newer)"
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
  die "Node $(node -v) is too old. Vast CLI needs v18 or newer."
fi
ok "node $(node -v), git, gh, curl"

if ! gh auth status >/dev/null 2>&1; then
  die "GitHub CLI is not authenticated.

  Run:  gh auth login

  Every Vast CLI command talks to GitHub through gh — without this,
  nothing will work."
fi
ok "gh authenticated"

# ------------------------------------------------------------------- resolve
if [ -n "${VAST_VERSION:-}" ]; then
  TAG="$VAST_VERSION"
else
  # `|| true` matters: with no releases yet the API 404s, and under `set -e`
  # plus pipefail that would kill the script before the helpful message below.
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).tag_name;if(t)process.stdout.write(t)}catch{}})' \
    || true)"
fi

[ -n "$TAG" ] || die "Could not find a release to install.

  Check https://github.com/$REPO/releases — if there are none yet,
  install from source instead:

    gh repo clone $REPO ~/tools/vast-cli
    cd ~/tools/vast-cli && npm install && npm run build && npm link"

ok "release $TAG"

# ------------------------------------------------------------------ download
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
mkdir -p "$HOME_DIR" "$BIN_DIR"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL "$URL" -o "$TMP" || die "Download failed: $URL"

# Sanity-check before overwriting a working install: a 404 body or a truncated
# transfer would otherwise land as a broken `vast`.
if [ ! -s "$TMP" ] || ! node --check "$TMP" >/dev/null 2>&1; then
  die "Downloaded file is not valid JavaScript. Aborting rather than
  installing something broken. Try again, or report this."
fi

mv "$TMP" "$HOME_DIR/$ASSET"
trap - EXIT
ok "installed $HOME_DIR/$ASSET"

cat > "$BIN_DIR/vast" <<EOF
#!/bin/sh
exec node "$HOME_DIR/$ASSET" "\$@"
EOF
chmod +x "$BIN_DIR/vast"
ok "shim at $BIN_DIR/vast"

printf '%s\n' "$TAG" > "$HOME_DIR/version"

# ----------------------------------------------------------------- PATH check
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "${SHELL:-}" in
      */zsh)  rc="~/.zshrc"  ;;
      */bash) rc="~/.bashrc" ;;
      *)      rc="your shell rc file" ;;
    esac
    say ""
    warn "$BIN_DIR is not on your PATH."
    say "    Add this to $rc, then open a new terminal:"
    say ""
    say "      ${B}export PATH=\"\$HOME/.local/bin:\$PATH\"${RST}"
    ;;
esac

# ------------------------------------------------------------------- next step
# Deliberately NOT running `vast init` when stdin is the installer itself:
# piped through bash, stdin is consumed, so any prompt would read EOF. We use
# the controlling terminal when there is one, and otherwise just say what to run.
say ""
if [ -r /dev/tty ] && [ -t 1 ]; then
  say "  ${DIM}Locating your Vast checkouts...${RST}"
  "$BIN_DIR/vast" init < /dev/tty || warn "vast init did not finish — run it yourself when ready."
else
  say "  ${B}Next:${RST} run ${B}vast init${RST} to find your repos."
fi

say ""
say "  Then try:  ${B}vast status --all${RST}"
say "  Help:      ${B}vast --help${RST}"
say ""
