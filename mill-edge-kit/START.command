#!/bin/bash
cd "$(dirname "$0")"
if [ -x "./runtime/bin/node" ]; then
  ./runtime/bin/node index.js
else
  node index.js
fi
read -r -p "Press Enter to close…"
