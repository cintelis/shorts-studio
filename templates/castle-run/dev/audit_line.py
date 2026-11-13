import json, sys
d = json.load(sys.stdin); ev = [e for e in d['events'] if 'planted' not in e]
print(f"chunk {sys.argv[1]} frames {d['frames']}/{d['expected']} planted-slide {d['plantSlideMax']*100:.1f}cm pen {d['pen']*100:.1f}cm floorMis {d['floorMis']*100:.1f}cm soleMin {d['soleMin']*100:.1f}cm cam {d['camMin']:.3f}m@{d['camAt']} props {d.get('propSamples')} other-events {len(ev)} {ev[:4]}")
