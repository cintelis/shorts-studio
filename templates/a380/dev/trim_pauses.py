# Shorten long pauses in the voiceover: any gap between words > MAXG becomes MAXG. Rewrites voice.mp3 and words.json (keeps *-raw copies).
import json, subprocess, shutil, os, sys
MAXG = float(sys.argv[1]) if len(sys.argv) > 1 else 0.3
d = 'assets/voice/'
if not os.path.exists(d + 'voice-raw.mp3'): shutil.copy(d + 'voice.mp3', d + 'voice-raw.mp3'); shutil.copy(d + 'words.json', d + 'words-raw.json')
w = json.load(open(d + 'words-raw.json'))
keep = []  # segments of raw audio to keep
cur = 0.0; shift = 0.0; out = []
for i, (t, s, e) in enumerate(w):
    if i > 0:
        pe = w[i - 1][2]; gap = s - pe
        if gap > MAXG:
            cut0 = pe + MAXG / 2; cut1 = s - MAXG / 2
            keep.append((cur, cut0)); cur = cut1; shift += cut1 - cut0
    out.append([t, round(s - shift, 3), round(e - shift, 3)])
end = w[-1][2] + 0.4
keep.append((cur, end))
f = ''.join(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=N/SR/TB[s{k}];" for k, (a, b) in enumerate(keep))
f += ''.join(f"[s{k}]" for k in range(len(keep))) + f"concat=n={len(keep)}:v=0:a=1[o]"
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', d + 'voice-raw.mp3', '-filter_complex', f, '-map', '[o]', '-c:a', 'libmp3lame', '-b:a', '192k', d + 'voice.mp3'], check=True)
json.dump(out, open(d + 'words.json', 'w'))
print('segments', len(keep), 'new end', out[-1][2], 'saved', round(shift, 2))
