# usage: sh dev/sh.sh name 'json-state'
S="C:/Users/NICKFO~1/AppData/Local/Temp/claude/C--code-anime/3bff8c85-d5a8-42cf-a978-afba379ab0a0/scratchpad/x2"
B=http://localhost:8765/templates/x2-factory/dev/scene.html
W=1080 H=1920 node dev/shot.mjs "$B#$(python -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$2")" $S/$1.png
