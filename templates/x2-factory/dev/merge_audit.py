# merges chunk reports; classifies each issue with the agreed tolerances; INVALID if any chunk failed to load or sample
import sys, re
groups, errs, chunks = {}, [], []
pat = re.compile(r'\s*([\d.]+) cm\s+([\d.]+)-([\d.]+)\s*s\s+n=(\d+)\s+(.*?)\s+run=(\d+) sus=([\d.]+)(\s+@([\d.]+)\s*(.*))?$')
for f in sys.argv[1:]:
    ok = None
    for l in open(f, encoding='utf-8', errors='ignore'):
        sm = re.match(r'AUDIT [\d.]+-[\d.]+s @[\d.]+s: \d+ issue groups, sampled (\d+)/(\d+) frames', l)
        if sm: ok = (int(sm[1]), int(sm[2])); continue
        m = pat.match(l.rstrip())
        if not m: errs.append(l.rstrip()); continue
        d, t0, t1, n, key, run, sus = float(m[1]), float(m[2]), float(m[3]), int(m[4]), m[5].strip(), int(m[6]), float(m[7])
        g = groups.get(key)
        if not g: groups[key] = dict(d=d, t0=t0, t1=t1, n=n, run=run, sus=sus, at=m[9], pos=m[10])
        else:
            g['t0'] = min(g['t0'], t0); g['t1'] = max(g['t1'], t1); g['n'] += n; g['run'] = max(g['run'], run); g['sus'] = max(g['sus'], sus)
            if d > g['d']: g['d'], g['at'], g['pos'] = d, m[9], m[10]
    chunks.append((f, ok))
def verdict(k, g):
    if re.search(r'floating|off the belt|^self |wrist above|forearm at helmet|IK miss|elbow raised', k): return 'FAIL'          # zero tolerance / rule already includes its allowance
    if 'hand not in front' in k: return 'FAIL' if g['run'] >= 2 else 'transient'                                            # 1 sample (~2 frames @30fps) allowed
    return 'FAIL' if g['d'] > 2.0 or g['sus'] > 1.0 else 'transient'                                                         # penetration: >2 cm never; 1-2 cm only as a 1-sample blip
bad = [f for f, ok in chunks if not ok or ok[0] != ok[1] or ok[0] == 0]
for f, ok in chunks: print(f'chunk {f}: ' + (f'sampled {ok[0]}/{ok[1]} frames' if ok else 'FAILED (no report)'))
if bad or errs: print('AUDIT INVALID: ' + ', '.join(bad or ['error lines present']))
fails = {k: g for k, g in groups.items() if verdict(k, g) == 'FAIL'}; trans = {k: g for k, g in groups.items() if k not in fails}
print(f'AUDIT merged: {len(fails)} FAIL groups, {len(trans)} allowed transients' + (f', {len(errs)} non-report lines' if errs else ''))
for e in errs[:5]: print('!!', e[:200])
for title, G in (('FAIL', fails), ('transient (allowed)', trans)):
    print(f'-- {title}')
    for k, g in sorted(G.items(), key=lambda x: -x[1]['d']):
        print(f"{g['d']:6.1f} cm  {g['t0']:5.1f}-{g['t1']:<5.1f}s  n={g['n']:<4} run={g['run']} sus={g['sus']:.1f}  {k}   @{g['at']} {g['pos'] or ''}")
