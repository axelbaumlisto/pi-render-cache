#!/usr/bin/env bash
# Стенд: pi в контейнере «перекладывает кубики» — печатает, листает, открывает
# подсказки — без модели и без сети. Меряем процессорное время всего дерева.
set -u
SECS="${BENCH_SECONDS:-45}"
PROBE="${BENCH_PROBE:-frames}"
SESSION="${BENCH_SESSION:-}"
EXT="${BENCH_EXT:-}"
OUT=/out/result-${BENCH_LABEL:-run}.json

# режим интерфейса: по умолчанию в pi — fullscreen (альтернативный экран)
mkdir -p "$HOME/.pi/agent"
python3 - <<PY
import json, os
p = os.path.expanduser("~/.pi/agent/settings.json")
s = {}
if os.path.exists(p):
    try: s = json.load(open(p))
    except Exception: s = {}
mode = os.environ.get("BENCH_TUIMODE", "")
if mode: s["tuiMode"] = mode
json.dump(s, open(p, "w"), indent=2)
PY

[ -n "${BENCH_CWD:-}" ] && mkdir -p "$BENCH_CWD" && cd "$BENCH_CWD"

cat > /tmp/run.sh <<RUN
stty rows 50 cols 160 2>/dev/null
export KIT_OUT=$OUT
cd "${BENCH_CWD:-/work}" 2>/dev/null || true
exec pi ${EXT} ${SESSION:+--session "$SESSION"} -e /opt/probes/${PROBE}.ts
RUN

drive() {
  sleep 8
  local deadline=$(( SECONDS + SECS ))
  while [ $SECONDS -lt $deadline ]; do
    printf 'как устроен кэш'      # печать: перерисовка редактора на каждый символ
    sleep 0.4
    printf '\033[5~'; sleep 0.3   # листание вверх
    printf '\033[6~'; sleep 0.3   # и вниз
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do printf '\177'; done  # стереть набранное
    sleep 0.3
  done
  printf '\003'; sleep 1; printf '\003'; sleep 2
}

START=$(cut -d' ' -f1 /proc/uptime)
drive | timeout $((SECS + 40)) script -qec "bash /tmp/run.sh" /dev/null >/dev/null 2>&1
# суммарное процессорное время контейнера, включая всех потомков
CPU=$(cat /sys/fs/cgroup/cpu.stat 2>/dev/null | awk '/usage_usec/{printf "%.1f", $2/1000000}')
END=$(cut -d' ' -f1 /proc/uptime)
WALL=$(awk -v a="$START" -v b="$END" 'BEGIN{printf "%.1f", b-a}')
echo "{\"label\":\"${BENCH_LABEL:-run}\",\"cpuSec\":${CPU:-0},\"wallSec\":$WALL}" > /out/cpu-${BENCH_LABEL:-run}.json
cat /out/cpu-${BENCH_LABEL:-run}.json
