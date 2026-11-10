# Builds index.html from index.tpl.part: captions from assets/voice/words.json, beat times, labels, seat map, audio.
import json, re, math

words = json.load(open('assets/voice/words.json'))
W = lambda i: words[i][1]
END = round(words[-1][2] + 0.35, 2)      # end card starts after the last word
DUR = round(END + 2.6, 2)

# ---------- captions (word-by-word chunks): (first word index, html) ----------
CH = [(0, 'THE <b>BIGGEST</b>'), (2, 'AIRLINER EVER BUILT.'), (5, 'AND AIRBUS'), (7, '<b>STOPPED</b> MAKING IT.'),
      (10, 'THE <b>A380:</b>'), (12, 'TWO FULL DECKS,'), (15, 'FOUR ENGINES,'), (17, 'OVER <b>500</b> SEATS.'),
      (21, 'NEXT TO A'), (23, 'BOEING 777,'), (26, "IT'S ACTUALLY"), (28, 'A METRE <b>SHORTER.</b>'), (31, 'BUT ITS WINGS'), (34, 'ARE <b>15 METRES</b>'), (37, '<b>WIDER.</b>'),
      (38, 'AIRBUS BET'), (40, 'ON GIANT JETS'), (43, 'FLYING BETWEEN'), (45, 'HUGE <b>HUB</b> AIRPORTS.'),
      (48, 'INSTEAD,'), (49, 'AIRLINES FLEW'), (51, '<b>DIRECT,</b>'), (52, 'ON EFFICIENT'), (54, '<b>TWIN-ENGINE</b> JETS.'),
      (56, '<b>FOUR</b> ENGINES'), (58, 'BURN MORE FUEL'), (61, 'AND NEED MORE'), (64, '<b>MAINTENANCE.</b>'),
      (65, 'AND <b>500</b> SEATS'), (69, 'ARE HARD TO FILL'), (73, 'EVERY DAY.'),
      (75, 'AIRBUS PULLED'), (77, 'THE PLUG'), (79, 'IN <b>2019.</b>'), (81, 'THE LAST OF'), (84, '<b>251</b>'), (88, 'WAS DELIVERED'), (90, 'IN <b>2021.</b>'),
      (92, '<b>EMIRATES</b>'), (93, 'TOOK ALMOST HALF.'), (96, 'TOO BIG'), (98, 'FOR THE WAY'), (101, 'WE <b>FLY.</b>')]
caps = []
for k, (i, html) in enumerate(CH):
    st = words[i][1]
    if k + 1 < len(CH):
        en = words[CH[k + 1][0]][1]
        last = words[CH[k + 1][0] - 1][2]
        if en - last > 0.3: en = last + 0.3
    else:
        en = min(words[-1][2] + 0.25, END)
    caps.append((round(st, 3), round(en - st, 3), html))
cap_html = '\n'.join(f'      <div id="cw-{k}" class="clip cw" data-start="{st}" data-duration="{d}" data-track-index="9"><span id="cw-{k}-t">{h}</span></div>' for k, (st, d, h) in enumerate(caps))
cap_times = json.dumps([c[0] for c in caps])

# ---------- beat times ----------
T = dict(stopped=W(5), name=W(10) - 0.1, decks=W(12) - 0.1, engines=W(15) - 0.1, seats1=W(17) - 0.1, next=W(21) - 0.1, short=W(28), wider=W(35) - 0.1,
         bet=W(38) - 0.1, hub=W(46), instead=W(48) - 0.1, direct=W(51), twin=W(53) - 0.1, four=W(56) - 0.1, fuel=W(58), seats=W(65) - 0.1, hard=W(70),
         pulled=W(75) - 0.1, last=W(81) - 0.1, n251=W(87), emi=W(92) - 0.1, too=W(96) - 0.1, end=END)
T = {k: round(v, 3) for k, v in T.items()}
T['251'] = T.pop('n251')
T['endd'] = round(DUR - END, 2)
T['endsc'] = round(END - 0.1, 3); T['endscd'] = round(DUR - END + 0.1, 2)
D = dict(name=T['next'] - T['name'], cmp=T['bet'] - T['next'], bet=T['instead'] - T['bet'], p2p=T['twin'] - T['instead'], map=T['twin'] - T['bet'],
         twin=T['four'] - T['twin'], four=T['seats'] - T['four'], seats=T['pulled'] - T['seats'], endc=T['last'] - T['pulled'], **{'251': T['emi'] - T['last']},
         emi=T['too'] - T['emi'])
D = {k: round(v, 3) for k, v in D.items()}

# ---------- compare layout: tails aligned at x = 480 on the apron (plane-local tail z measured in the probe) ----------
A_TAIL, B_TAIL, A_NOSE, B_NOSE = 33.67, 32.50, -38.74, -41.36
AX, BX = 480 + A_TAIL, 480 + B_TAIL
CX = round((480 + max(AX - A_NOSE, BX - B_NOSE)) / 2, 2)

# ---------- labels anchored to the 3D scene: id: (start, end, html, anchor, dx, dy, cls) ----------
LABELS = {
    'lab-up': (T['decks'], T['engines'], 'UPPER DECK', 'aUpper', -40, -170, ''),
    'lab-main': (T['decks'] + 0.2, T['engines'], 'MAIN DECK', 'aMain', -60, 150, ''),
    'lab-aname': (T['next'] + 0.2, T['bet'], 'A380', 'aCentre', 0, 0, 'big'),
    'lab-bname': (T['next'] + 0.4, T['bet'], '777-300ER', 'bCentre', 0, 0, 'w big'),
    'lab-alen': (T['short'] + 0.4, T['bet'], '72.7 m long', 'aLen', 0, -48, ''),
    'lab-blen': (T['short'] + 0.6, T['bet'], '73.9 m long', 'bLen', 0, 48, 'w'),
    'lab-aspan': (T['wider'] + 0.4, T['bet'], '79.8 m', 'aSpan', -150, 0, ''),
    'lab-bspan': (T['wider'] + 0.6, T['bet'], '64.8 m', 'bSpan', -150, 0, 'w'),
}
for k in range(4):
    LABELS[f'lab-e{k}'] = (T['engines'] + 0.1 + 0.1 * (3 - k), T['seats1'], str(4 - k), f'aE{k}', 0, 95, 'n')
    LABELS[f'lab-f{k}'] = (T['four'] + 0.25 + 0.12 * (3 - k), T['seats'], str(4 - k), f'aE{k}', 0, 95, 'n')
lab_html = '\n'.join(f'      <div id="{k}" class="clip lab {c}" data-start="{s:.3f}" data-duration="{e - s:.3f}" data-track-index="6" data-layout-ignore><div class="w" id="{k}-w"><i></i><span>{t}</span></div></div>' for k, (s, e, t, a, dx, dy, c) in LABELS.items())
lab_js = json.dumps({k: [a, dx, dy] for k, (s, e, t, a, dx, dy, c) in LABELS.items()})
lab_t = json.dumps({k: s for k, (s, e, t, a, dx, dy, c) in LABELS.items()})

# ---------- seat map: 525 seats (21 x 25); a deterministic ~38 % stay empty ----------
def h(i): v = math.sin(i * 12.9898 + 4.1) * 43758.5453; return v - math.floor(v)
seats = ''.join(f'<div class="s{" e" if h(i) < 0.38 else ""}"></div>' for i in range(525))
seat_js = (f'tl.fromTo("#seat-grid .s", {{ backgroundColor: "rgba(255,255,255,0.18)" }}, {{ backgroundColor: "#c6ff3d", duration: 0.06, stagger: {{ each: {round(1.3 / 525, 5)} }} }}, {T["seats"] + 0.15});\n'
           f'      tl.to("#seat-grid .s.e", {{ backgroundColor: "rgba(255,255,255,0.18)", duration: 0.2, stagger: {{ each: 0.004 }} }}, {T["hard"] - 0.25});')

# ---------- audio ----------
VOICE_END = round(words[-1][2] + 0.3, 2)
AUDIO = [  # id, file, start, dur, vol, fade-out
    ('a-voice', 'voice/voice.mp3', 0.0, VOICE_END, 1.0, 0),
    ('m-a', 'audio/music-a380-duck.mp3', 0.0, min(DUR, 47.95), 0.75, 1.0),
    ('a-takeoff', 'audio/takeoff.mp3', 0.0, round(T['name'] + 0.5, 2), 0.55, 0.7),
    ('a-flyby', 'audio/flyby.mp3', round(T['instead'] + 0.2, 2), 3.8, 0.45, 0.8),
]
aud_html = '\n'.join(f'      <audio id="{i}" class="clip" src="assets/{f}" data-start="{s}" data-duration="{d}" data-volume="{v}"' + (f' data-fade-out="{fo}"' if fo else '') + f' data-track-index="{20 + n}"></audio>' for n, (i, f, s, d, v, fo) in enumerate(AUDIO))

html = open('index.tpl.part', encoding='utf-8').read()
for k, v in sorted(T.items(), key=lambda kv: -len(kv[0])): html = html.replace('%T_' + k + '%', str(v))
for k, v in sorted(D.items(), key=lambda kv: -len(kv[0])): html = html.replace('%D_' + k + '%', str(v))
html = (html.replace('%DUR%', str(DUR)).replace('%CAPS%', cap_html).replace('%CAPT%', cap_times)
        .replace('%LABS%', lab_html).replace('%LABJS%', lab_js).replace('%LABT%', lab_t).replace('%AUDIO%', aud_html)
        .replace('%SEATS%', seats).replace('%SEATJS%', seat_js).replace('%AX%', str(AX)).replace('%BX%', str(BX)).replace('%CX%', str(CX)))
left = re.findall(r'%[A-Z_][A-Za-z0-9_]*%', html); assert not left, left
open('index.html', 'w', encoding='utf-8').write(html)
json.dump({'DUR': DUR, 'END': END, 'T': T}, open('timing.json', 'w'), indent=1)
print('ok', len(caps), 'captions, DUR', DUR, T)
