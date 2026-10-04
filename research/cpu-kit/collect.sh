#!/usr/bin/env bash
# Полная матрица: все зонды × самые большие сессии × сценарии.
#
#   ./collect.sh [сколько-сессий] [секунд-на-прогон]
# Результат: results/<дата>/*.json + сводка в консоль.
set -u
KIT="$(cd "$(dirname "$0")" && pwd)"
N_SESSIONS="${1:-3}"
SECS="${2:-45}"
STAMP=$(date +%Y-%m-%d_%H%M)
DIR="$KIT/results/$STAMP"
mkdir -p "$DIR"

mapfile -t SESSIONS < <(ls -S "$HOME"/.pi/agent/sessions/*/*.jsonl 2>/dev/null | head -"$N_SESSIONS")
echo "pi: $(pi --version 2>/dev/null | head -1)"
echo "сессий взято: ${#SESSIONS[@]} (самые большие), по $SECS с на прогон"
echo

run_one() { # зонд, сессия, метка, сценарий
  local probe="$1" session="$2" label="$3" scenario="$4"
  local out="$DIR/${probe}__${label}__${scenario}.json"
  KIT_OUT="$out" "$KIT/run.sh" "$probe" "$session" "$SECS" "$scenario" >/dev/null 2>&1
  [ -f "$out" ] && echo "$out"
}

for probe in frames classes children segmenter triggers; do
  echo "== зонд: $probe =="
  run_one "$probe" "" "новая-сессия" "stream" >/dev/null
  python3 "$KIT/summarize.py" "$DIR/${probe}__новая-сессия__stream.json" 2>/dev/null
  i=0
  for s in "${SESSIONS[@]}"; do
    i=$((i+1))
    mb=$(du -m "$s" | cut -f1)
    run_one "$probe" "$s" "сессия${i}-${mb}МБ" "mixed" >/dev/null
    python3 "$KIT/summarize.py" "$DIR/${probe}__сессия${i}-${mb}МБ__mixed.json" 2>/dev/null
  done
  echo
done
echo "сырые данные: $DIR"
