#!/bin/bash
# Final audit -> footfalls/steps -> render (one at a time) -> loudness mix.
cd "$(dirname "$0")/.." || exit 1
source dev/env.sh
[ "$SKIP_AUDIT" = "1" ] || ./dev/audit.sh || { echo AUDIT FAILED; exit 1; }
# wait for any other hyperframes render on the machine to finish
while render_busy; do sleep 30; done
W=64 H=64 $TO node dev/shot.mjs "http://localhost:8765/templates/castle-run/dev/footfalls.html" renders/x3.png 2>&1 | head -1 > footfalls.json && $PY make_steps.py || exit 1
npx --yes hyperframes@0.8.226 render --workers 1 -o renders/raw-v2.mp4 > render.log 2>&1 || { echo RENDER FAILED; tail -20 render.log; exit 1; }
$PY - <<'PY'
import json, re, subprocess
src, dst = 'renders/raw-v2.mp4', '../out/79-castle-run-v2.mp4'
r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
j = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr)[-1])
af = f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true"
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', af, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', dst], check=True)
print('mixed', dst)
PY
echo DONE
