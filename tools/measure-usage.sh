#!/usr/bin/env bash
# Measures what Minie Pill costs: gnome-shell RAM + CPU with the extension OFF vs ON.
# The extension runs INSIDE gnome-shell, so the honest number is the difference between the two runs.
# Usage:  tools/measure-usage.sh [seconds-per-run]    (default 60). Keep mouse/keyboard untouched while it runs.
set -euo pipefail
UUID="minie-pill@toxic"
SECS="${1:-60}"
PID="$(pgrep -x gnome-shell | head -1)"
[ -n "$PID" ] || { echo "gnome-shell not running"; exit 1; }
HZ="$(getconf CLK_TCK)"

sample() {   # prints: "<rss_mb> <cpu_percent_of_one_core>"
    local t1 t2 rss
    t1="$(awk '{print $14+$15}' /proc/$PID/stat)"
    sleep "$SECS"
    t2="$(awk '{print $14+$15}' /proc/$PID/stat)"
    rss="$(awk '/VmRSS/{print $2}' /proc/$PID/status)"
    awk -v a="$t1" -v b="$t2" -v hz="$HZ" -v s="$SECS" -v r="$rss" 'BEGIN{printf "%.1f %.2f\n", r/1024, (b-a)/hz/s*100}'
}

echo "gnome-shell pid $PID, ${SECS}s per run"
gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
sleep 8
echo "[1/2] extension OFF ..."
read -r rss_off cpu_off < <(sample)
gnome-extensions enable "$UUID"
sleep 10
echo "[2/2] extension ON ..."
read -r rss_on cpu_on < <(sample)

awk -v a="$rss_off" -v b="$rss_on" -v c="$cpu_off" -v d="$cpu_on" 'BEGIN{
  printf "\n              RAM (MB)   CPU (%% of 1 core)\n";
  printf "ext OFF       %-10s %s\n", a, c;
  printf "ext ON        %-10s %s\n", b, d;
  printf "Minie Pill    %-10.1f %.2f\n", b-a, d-c;
}'
echo "Tip: run again while music plays / a download runs / the cat is visible to see the busy-case cost."
