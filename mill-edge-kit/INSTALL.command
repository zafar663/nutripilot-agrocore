#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f config.json ]; then
  echo "Missing config.json — download mill-edge again from Mill IQ for this mill."
  exit 1
fi

INSTALLDIR="$HOME/NutriPilot/mill-edge"
NODE_BIN="$INSTALLDIR/runtime/bin/node"
mkdir -p "$INSTALLDIR/watch/sent" "$INSTALLDIR/watch/failed" "$INSTALLDIR/watch/inbox" "$INSTALLDIR/runtime"
cp -f index.js START.command START.bat README.txt package.json "$INSTALLDIR/" 2>/dev/null || true
cp -f config.json "$INSTALLDIR/config.json"

if [ ! -x "$NODE_BIN" ] && ! command -v node >/dev/null 2>&1; then
  echo "Preparing mill-edge. Please wait..."
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64) DIST=node-v20.20.2-darwin-arm64 ;;
    *) DIST=node-v20.20.2-darwin-x64 ;;
  esac
  TMPTGZ=$(mktemp -t mill-edge-node.XXXXXX.tar.gz)
  if curl -fsSL "https://nodejs.org/dist/v20.20.2/${DIST}.tar.gz" -o "$TMPTGZ"; then
    tar -xzf "$TMPTGZ" -C "$INSTALLDIR/runtime" --strip-components 1
  fi
  rm -f "$TMPTGZ"
fi

if [ -x "$NODE_BIN" ]; then
  NODE_CMD="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  NODE_CMD=node
else
  echo "Could not prepare mill-edge. Check internet and run INSTALL.command again."
  exit 1
fi

# Point Mac installs at a local inbox unless the mill already has a custom folder.
"$NODE_CMD" -e "
const fs=require('fs');
const p='$INSTALLDIR/config.json';
const c=JSON.parse(fs.readFileSync(p,'utf8'));
if (!c.watch_folder || /^[A-Za-z]:[\\\\/]/.test(c.watch_folder)) {
  c.watch_folder = '$INSTALLDIR/watch/inbox';
}
c.sent_folder = '$INSTALLDIR/watch/sent';
c.fail_folder = '$INSTALLDIR/watch/failed';
fs.writeFileSync(p, JSON.stringify(c, null, 2));
"

echo
echo "Mill-edge is installed at $INSTALLDIR"
echo "Drop PLC files into the watch folder. Truck tickets go in weighbridge, lab files in lab, pellet files in process, load-out in dispatch."
echo "Starting mill-edge. Leave this window open."
cd "$INSTALLDIR"
"$NODE_CMD" index.js
read -r -p "Press Enter to close…"
