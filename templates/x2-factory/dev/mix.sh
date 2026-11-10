# two-pass loudnorm to -14.5 LUFS with the end-card boost; usage: bash dev/mix.sh in.mp4 out.mp4
in=$1; out=$2; pre="volume='1+0.5*min(1,max(0,(t-45.9)/0.4))':eval=frame"
j=$(ffmpeg -hide_banner -i "$in" -af "$pre,loudnorm=I=-14.5:TP=-1.0:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$j" | python -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -y -hide_banner -loglevel error -i "$in" -c:v copy -af "$pre,loudnorm=I=-14.5:TP=-1.0:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true" -ar 48000 -c:a aac -b:a 192k "$out"
