#!/bin/bash
# Chunked audit in 4 s chunks (one browser per chunk). Fails loudly on page errors; prints sampled/expected frames.
#   ./dev/audit.sh [T0] [T1]     (default 0 .. 27.5)
cd "$(dirname "$0")/.." || exit 1
node --check lib/castle.js || exit 1; node --check lib/audit.js || exit 1
T0=${1:-0}; T1=${2:-27.5}
out=renders/audit-full.txt; [ "$T0" = "0" ] && : > $out
chunks=$(python -c "import sys; t=float(sys.argv[1]); D=float(sys.argv[2]); print(' '.join(f'{a:.1f}:{min(a+4,D):.1f}' for a in [t+4*k for k in range(1000)] if a < D-1e-9))" "$T0" "$T1" | tr -d '\r')
for ch in $chunks; do
  t0=${ch%%:*}; t1=${ch##*:}
  # never start an audit browser while another render is running and RAM is short
  while true; do
    free=$(powershell -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)")
    busy=$(powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | ? { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'hyperframes.* render' }) { 'yes' } else { 'no' }")
    if [[ "$busy" == *yes* && ${free//[^0-9]/} -lt 3072 ]]; then sleep 30; else break; fi
  done
  r=$(W=64 H=64 timeout 3500 node dev/shot.mjs "http://localhost:8765/templates/castle-run/dev/audit.html?t0=$t0&t1=$t1" renders/x.png 2>&1 | grep -E '^\{|PAGEERROR|pageerror' | head -1)
  if [[ -z "$r" || "$r" == *PAGEERROR* || "$r" == *pageerror* ]]; then echo "CHUNK $t0-$t1 FAILED: $r" | tee -a $out; exit 1; fi
  echo "CHUNK $t0-$t1 $r" >> $out
  echo "$r" | python dev/audit_line.py "$t0-$t1" || exit 1
done
