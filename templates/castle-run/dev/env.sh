# Works on Windows (Git Bash) and macOS/Linux: python3 or python, timeout or gtimeout, busy-render check.
PY=$(for p in python3 python; do "$p" -c "import sys" >/dev/null 2>&1 && { command -v "$p"; break; }; done)
TO=$(command -v timeout || command -v gtimeout); TO=${TO:+$TO 3500}
render_busy() {
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | ? { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'hyperframes.* render' }) { exit 0 } else { exit 1 }"
  else pgrep -f 'hyperframes.* render' >/dev/null; fi
}
free_mb() {
  if command -v powershell >/dev/null 2>&1; then powershell -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)"
  elif [ "$(uname)" = Darwin ]; then echo $(( $(vm_stat | awk '/Pages free|Pages inactive/ {gsub(/\./,"",$3); s+=$3} END {print s}') * 4096 / 1048576 ))
  else awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo; fi
}
mkdir -p renders ../out
