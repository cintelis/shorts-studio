# runs the audit in 4 s chunks (one browser at a time, closed between chunks) and merges the reports into $1 (default audit.txt)
# refuses to start on a syntax error; stops at the first chunk that fails (page error or missing frames)
out=${1:-audit.txt}; rm -f audit-chunk-*.txt
for f in lib/*.js dev/audit.mjs; do node --check "$f" || { echo "AUDIT INVALID: syntax error in $f" > $out; exit 2; }; done
for a in 0 4 8 12 16 20 24 28 32 36 40 44 48; do
  b=$(python -c "print(min($a+3.9, 48.8))"); f=audit-chunk-$(printf %02d $a).txt
  node dev/audit.mjs $a $b 0.1 > $f 2>&1 || { echo "chunk $a exit $?" >> $f; python dev/merge_audit.py audit-chunk-*.txt > $out; echo "stopped at chunk $a" >> $out; exit 2; }
done
python dev/merge_audit.py audit-chunk-*.txt > $out
