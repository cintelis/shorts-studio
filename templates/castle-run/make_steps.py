# Builds assets/audio/steps.wav: one footstep sample per footfall (from footfalls.json), stone outside, carpet in the hall,
# louder when the camera is close, with slight deterministic pitch/volume variation.
import json, subprocess, numpy as np, wave, math
SR = 48000; DUR = 27.5
def load(f):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768
S = {'stone': load('assets/audio/step-stone.mp3'), 'carpet': load('assets/audio/step-carpet.mp3')}
for k in S:   # trim to the transient: drop leading silence, keep 0.35 s, fade out
    a = S[k]; i0 = int(np.argmax(np.abs(a) > 0.02 * np.abs(a).max())); a = a[max(0, i0 - 48):][: int(0.35 * SR)]
    a = a * np.minimum(1, np.linspace(6, 0, len(a))); S[k] = a / np.abs(a).max()
ff = json.load(open('footfalls.json'))
gain = {0: 0.85, 1: 0.42, 2: 0.8, 3: 0.55, 5: 0.9, 6: 0.8, 7: 0.7}
out = np.zeros(int(DUR * SR) + SR, np.float32); last = {}
n = 0
for t, side, surf, shot in ff:
    if side in last and t - last[side] < 0.15: continue
    last[side] = t
    g = gain.get(shot) if shot != 4 else 0.3 + 0.6 * min(1, max(0, (t - 12.3) / 3.5))
    h = (math.sin(t * 91.7) * 43758.5) % 1
    rate = 0.95 + 0.1 * h; s = S[surf]; idx = np.arange(0, len(s) - 1, rate); smp = np.interp(idx, np.arange(len(s)), s)
    i = int(t * SR); out[i:i + len(smp)] += smp * g * (0.85 + 0.3 * ((h * 7) % 1)); n += 1
out = out[: int(DUR * SR)]; out = out / max(1, np.abs(out).max() / 0.9)
with wave.open('assets/audio/steps.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype(np.int16).tobytes())
print('steps', n)
