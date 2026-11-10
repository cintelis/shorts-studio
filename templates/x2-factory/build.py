# Builds index.html from index.tpl.part: captions from assets/voice/words.json, beat times, station cards, audio.
import json, re

words = json.load(open('assets/voice/words.json'))
W = lambda i: words[i][1]
END = round(words[-1][2] + 0.35, 2)
DUR = round(END + 2.6, 2)

CH = [(7, '<b>TEN</b> ROBOTS.'), (9, 'TEN DIFFERENT <b>JOBS.</b>'),
      (12, 'THIS ONE TAKES'), (15, 'CRATES OFF THE LINE,'), (19, 'AND <b>STACKS</b> THEM.'),
      (22, 'THIS ONE LOADS'), (25, 'THE <b>MILLING MACHINE.</b>'),
      (28, 'THIS ONE RUNS'), (31, 'THE <b>PRESS,</b>'), (33, 'WITH BOTH HANDS'), (36, 'ON THE <b>BUTTONS.</b>'),
      (39, 'THIS ONE STOCKS'), (42, 'THE <b>SHELVES.</b>'),
      (44, 'THIS ONE <b>CHECKS</b>'), (47, 'EVERY PART.'),
      (49, 'AND THIS ONE'), (52, 'FEEDS A <b>ROBOT ARM.</b>'),
      (56, 'THAT ARM IS'), (59, '<b>BOLTED</b> IN PLACE.'),
      (62, 'THE HUMANOID'), (64, 'CAN <b>WALK</b>'), (66, 'TO THE NEXT JOB.'),
      (70, 'WHY A <b>HUMAN SHAPE?</b>'), (74, 'BECAUSE FACTORIES'), (76, 'ARE BUILT FOR <b>PEOPLE:</b>'),
      (80, 'THE <b>BUTTONS,</b>'), (82, 'THE <b>DOORS,</b>'), (84, 'THE <b>SHELVES.</b>'),
      (86, 'A ROBOT SHAPED'), (89, 'LIKE US'), (91, 'CAN USE THEM'), (94, 'WITHOUT <b>REBUILDING</b>'), (96, 'THE FACTORY.'),
      (98, 'CAR MAKERS ARE'), (101, 'ALREADY <b>TESTING</b> THIS.'),
      (104, '<b>BMW</b> HAS TRIALLED'), (107, 'A HUMANOID'), (109, 'PLACING <b>SHEET-METAL</b>'), (111, 'PARTS.'),
      (112, 'SAME FACTORY.'), (114, '<b>NEW WORKERS.</b>')]
caps = []
for k, (i, html) in enumerate(CH):
    st = words[i][1]
    if k + 1 < len(CH):
        en = words[CH[k + 1][0]][1]; last = words[CH[k + 1][0] - 1][2]
        if en - last > 0.3: en = last + 0.3
    else:
        en = min(words[-1][2] + 0.25, END)
    caps.append((round(st, 3), round(en - st, 3), html))
cap_html = '\n'.join(f'      <div id="cw-{k}" class="clip cw" data-start="{st}" data-duration="{d}" data-track-index="9"><span id="cw-{k}-t">{h}</span></div>' for k, (st, d, h) in enumerate(caps))
cap_times = json.dumps([c[0] for c in caps])

T = dict(ten=W(7), line=W(12) - 0.05, mill=W(22) - 0.05, press=W(28) - 0.05, shelf=W(39) - 0.05, inspect=W(44) - 0.05, cobot=W(49) - 0.05,
         bolted=W(56) - 0.05, walk=W(62) - 0.05, why=W(70) - 0.05, buttons=W(80) - 0.05, doors=W(82) - 0.05, shelves=W(84) - 0.05, shaped=W(86) - 0.05,
         cars=W(98) - 0.05, boxes=W(104) - 0.05, same=W(112) - 0.05, end=END)
T = {k: round(v, 3) for k, v in T.items()}
T['endd'] = round(DUR - END, 2)

# station cards: id: (start, end, kicker, big)
CARDS = {
    'c-line': (T['line'], T['mill'], 'CONVEYOR', 'PICK &amp; <b>STACK</b>'),
    'c-mill': (T['mill'], T['press'], 'CNC MILL', 'MACHINE <b>LOADING</b>'),
    'c-press': (T['press'], T['shelf'], 'HYDRAULIC PRESS', 'TWO-HAND <b>START</b>'),
    'c-shelf': (T['shelf'], T['inspect'], 'WAREHOUSE', '<b>SHELVING</b>'),
    'c-insp': (T['inspect'], T['cobot'], 'QUALITY', '<b>INSPECTION</b>'),
    'c-cobot': (T['cobot'], T['bolted'], 'ROBOT CELL', 'FEEDS THE <b>ARM</b>'),
    'c-bolt': (T['bolted'], T['walk'], 'ROBOT ARM', 'BOLTED <b>IN PLACE</b>'),
    'c-walk': (T['walk'], T['why'], 'HUMANOID', 'WALKS TO <b>THE NEXT JOB</b>'),
    'c-why': (T['why'], T['buttons'], 'WHY A HUMAN SHAPE?', 'BUILT FOR <b>PEOPLE</b>'),
    'c-btn': (T['buttons'], T['doors'], 'MADE FOR HANDS', '<b>BUTTONS</b>'),
    'c-door': (T['doors'], T['shelves'], 'MADE FOR HANDS', '<b>DOORS</b>'),
    'c-shv': (T['shelves'], T['shaped'], 'MADE FOR HANDS', '<b>SHELVES</b>'),
    'c-same': (T['shaped'], T['cars'], 'SAME MACHINES', 'NO <b>REBUILD</b>'),
    'c-cars': (T['cars'], T['same'], 'CAR MAKERS', 'ALREADY <b>TESTING</b>'),
}
card_html = '\n'.join(f'      <div id="{k}" class="clip call" data-start="{s}" data-duration="{round(e - s, 3)}" data-track-index="2"><div class="k" id="{k}-k">{kk}</div><div class="big" id="{k}-big">{b}</div></div>' for k, (s, e, kk, b) in CARDS.items())
card_t = json.dumps({k: v[0] for k, v in CARDS.items()})

VOICE_END = round(words[-1][2] + 0.3, 2)
AUDIO = [
    ('a-voice', 'voice/voice.mp3', 0.0, VOICE_END, 1.0, 0),
    ('m-a', 'audio/music-x2v2-duck.mp3', 0.0, DUR, 0.72, 0.8),
    ('a-hum', 'audio/hum-long.mp3', 0.0, DUR, 0.3, 1.0),
    ('a-servo', 'audio/servo.mp3', round(T['line'] + 0.2, 2), 1.5, 0.45, 0.3),
    ('a-clk', 'audio/clunk.mp3', 7.72, 0.8, 0.55, 0),
    ('a-mill', 'audio/mill.mp3', round(T['mill'] + 1.2, 2), 2.5, 0.4, 0.6),
    ('a-press', 'audio/press.mp3', 13.3, 1.8, 0.55, 0.3),
    ('a-beep', 'audio/beep.mp3', 16.9, 0.5, 0.35, 0),
    ('a-servo2', 'audio/servo.mp3', 18.6, 1.5, 0.4, 0.3),
    ('a-press2', 'audio/press.mp3', 30.25, 1.8, 0.45, 0.3),
]
aud_html = '\n'.join(f'      <audio id="{i}" class="clip" src="assets/{f}" data-start="{s}" data-duration="{d}" data-volume="{v}"' + (f' data-fade-out="{fo}"' if fo else '') + f' data-track-index="{20 + n}"></audio>' for n, (i, f, s, d, v, fo) in enumerate(AUDIO))

html = open('index.tpl.part', encoding='utf-8').read()
for k, v in T.items(): html = html.replace('%T_' + k + '%', str(v))
html = (html.replace('%DUR%', str(DUR)).replace('%CAPS%', cap_html).replace('%CAPT%', cap_times).replace('%TJS%', json.dumps(T))
        .replace('%CARDS%', card_html).replace('%CARDT%', card_t).replace('%AUDIO%', aud_html))
left = re.findall(r'%[A-Z_][A-Za-z0-9_]*%', html); assert not left, left
open('index.html', 'w', encoding='utf-8').write(html)
json.dump({'DUR': DUR, 'END': END, 'T': T}, open('timing.json', 'w'), indent=1)
print('ok', len(caps), 'captions, DUR', DUR, T)
