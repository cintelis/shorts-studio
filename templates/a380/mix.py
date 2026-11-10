# Post-mix: adds the closing hit under the end card, then loudness-normalises to -14.5 LUFS (two-pass loudnorm).
#   python mix.py renders/a380-raw.mp4 ../out/69-a380.mp4 [sting-volume]
import json, subprocess, sys, re
src, dst = sys.argv[1], sys.argv[2]
STV = float(sys.argv[3]) if len(sys.argv) > 3 else 1.1
tm = json.load(open('timing.json')); END = tm['END']; DUR = tm['DUR']
ST = END - 0.25
fc = (f"[1:a]aformat=channel_layouts=stereo,volume={STV},afade=t=out:st=2.4:d=0.5,adelay={int(ST * 1000)}|{int(ST * 1000)},apad=whole_dur={DUR}[sting];"
      "[0:a][sting]amix=inputs=2:normalize=0:duration=first[pre]")
def run(extra_af, out):
    return subprocess.run(['ffmpeg', '-v', 'info', '-hide_banner', '-nostats', '-y', '-i', src, '-i', 'assets/audio/sting.mp3',
                           '-filter_complex', fc + ';[pre]' + extra_af + '[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] + out,
                          capture_output=True, text=True)
r = run('loudnorm=I=-14.5:TP=-1.5:LRA=11:print_format=json', ['-f', 'null', '-'])
j = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr)[-1])
af = (f"loudnorm=I=-14.5:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
      f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
r = run(af, [dst])
if r.returncode: print(r.stderr[-2000:]); sys.exit(1)
print('mixed', dst)
