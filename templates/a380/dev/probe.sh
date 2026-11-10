#!/bin/bash
# usage: dev/probe.sh out.png 'json-state' [brot]
U=$(python -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$2")
W=1080 H=1920 node dev/shot.mjs "http://localhost:8765/templates/a380/dev/look.html?s=$U${3:+&brot=$3}" "$1" 2>&1 | grep -v "^A box" | tail -3
