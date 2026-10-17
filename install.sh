#!/bin/sh
# Puts `rcat` on your PATH and offers the agent skill to the coding agents found on this machine.
# Nothing is copied: both are symlinks into this checkout, so `git pull` (and `npm run build`) updates them.
#
#   ./install.sh              install
#   ./install.sh --uninstall  remove the links again
#   BIN_DIR=/usr/local/bin ./install.sh   choose where the command goes (default: ~/.local/bin)
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
BIN_DIR=${BIN_DIR:-$HOME/.local/bin}
SKILL=rcat
# Agents that follow the SKILL.md convention, by their folder in $HOME; only existing agents get a link.
AGENTS=".claude .codex .agents"

usage() { echo "usage: $0 [--uninstall]   (BIN_DIR=<dir> to choose where the command goes)"; }

# The links this checkout owns: a path is only ever replaced or removed when it is a symlink pointing here.
TARGETS="$BIN_DIR/rcat:$ROOT/bin/rcat.mjs"
for agent in $AGENTS; do TARGETS="$TARGETS $HOME/$agent/skills/$SKILL:$ROOT/skills/$SKILL"; done

ours() { [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; }

case "${1:-}" in
  '') ;;
  --uninstall)
    for pair in $TARGETS; do
      link=${pair%%:*}; target=${pair#*:}
      if ours "$link" "$target"; then rm "$link" && echo "removed $link"
      elif [ -e "$link" ] || [ -L "$link" ]; then echo "kept $link (not a link to this checkout)"; fi
    done
    exit 0
    ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# Creates the link unless something else already lives at that path (a real file or directory, or a link
# to another checkout): that is left alone and reported, never overwritten.
link() {
  if [ -L "$1" ] && ! ours "$1" "$2"; then
    echo "skipped $1: it links to $(readlink "$1"), not this checkout; remove it and run again" >&2; return 1
  elif [ -e "$1" ] && [ ! -L "$1" ]; then
    echo "skipped $1: a file or directory is already there; remove it and run again" >&2; return 1
  fi
  ln -sfn "$2" "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js 22.13 or newer is required (https://nodejs.org)." >&2
  exit 1
fi
NODE_VERSION=$(node -p process.versions.node)
NODE_MAJOR=${NODE_VERSION%%.*}
NODE_REST=${NODE_VERSION#*.}
NODE_MINOR=${NODE_REST%%.*}
case "$NODE_MAJOR$NODE_MINOR" in
  ''|*[!0-9]*)
    echo "error: cannot read the Node.js version (got \"$NODE_VERSION\"); 22.13 or newer is required." >&2
    exit 1
    ;;
esac
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "error: Node.js 22.13 or newer is required, found $NODE_VERSION." >&2
  exit 1
fi

# bin/rcat.mjs runs the compiled dist/, which is not in git: build it on a fresh checkout.
if [ ! -f "$ROOT/dist/cli.js" ]; then
  echo "building (npm ci && npm run build)…"
  (cd "$ROOT" && npm ci --silent && npm run build --silent)
fi

mkdir -p "$BIN_DIR"
status=0
if link "$BIN_DIR/rcat" "$ROOT/bin/rcat.mjs"; then echo "rcat  -> $BIN_DIR/rcat"; else status=1; fi

for agent in $AGENTS; do
  home="$HOME/$agent"
  [ -d "$home" ] || continue
  mkdir -p "$home/skills"
  if link "$home/skills/$SKILL" "$ROOT/skills/$SKILL"; then echo "skill -> $home/skills/$SKILL"; else status=1; fi
done

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: $BIN_DIR is not on your PATH; add it, or run $ROOT/bin/rcat.mjs directly." ;;
esac

echo
echo "Next: set REVENUECAT_<APP>_APIKEY variables to RevenueCat v2 secret keys, then run 'rcat accounts'."
exit $status
