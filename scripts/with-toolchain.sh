#!/bin/sh
# Run a command with the project-local Node 20 toolchain prepended to PATH
# if installed. Workaround for Kali's broken /usr/bin/node fs.glob (the
# `Missing internal module 'internal/deps/brace-expansion'` bug that bites
# `node --test`). Falls through to system node when .tools/ isn't present,
# so a fresh clone on a healthy Node host runs the same scripts unchanged.
TOOLS_NODE="$(cd "$(dirname "$0")/.." && pwd)/.tools/node-v20.20.2-linux-x64/bin"
[ -d "$TOOLS_NODE" ] && export PATH="$TOOLS_NODE:$PATH"
exec "$@"
