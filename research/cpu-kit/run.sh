#!/usr/bin/env bash
# Один замер: один зонд на одной сессии, в настоящем терминале.
#
#   ./run.sh <зонд> [файл-сессии] [секунд] [сценарий]
#   сценарии: idle (ничего не делать) | scroll (листать историю) | stream (задать вопрос) | mixed (по умолчанию)
set -u
KIT="$(cd "$(dirname "$0")" && pwd)"
PROBE="${1:?укажите зонд: frames|classes|children|segmenter|triggers}"
SESSION="${2:-}"
SECONDS_TOTAL="${3:-60}"
SCENARIO="${4:-mixed}"
TMP="${TMPDIR:-/tmp}"   # в Termux /tmp недоступен на запись
OUT="${KIT_OUT:-$TMP/kit-$PROBE.json}"

[ -f "$KIT/probes/$PROBE.ts" ] || { echo "нет такого зонда: $PROBE"; exit 2; }
command -v pi >/dev/null || { echo "pi не найден в PATH"; exit 2; }

RUNNER=$(mktemp "$TMP/kit-run-XXXX.sh")
cat > "$RUNNER" <<RUN
stty rows ${KIT_ROWS:-50} cols ${KIT_COLS:-160} 2>/dev/null
export KIT_OUT="$OUT"
exec pi ${SESSION:+--session "$SESSION"} -e "$KIT/probes/$PROBE.ts"
RUN

drive() {
  sleep 12
  case "$SCENARIO" in
    scroll|mixed) for i in $(seq 1 6); do printf '\033[5~'; sleep 0.7; done
                  for i in $(seq 1 6); do printf '\033[6~'; sleep 0.7; done ;;
  esac
  case "$SCENARIO" in
    stream|mixed) printf '%s\n' "${KIT_PROMPT:-Напиши четыре абзаца про устройство кэшей, со списком и примером кода}" ;;
  esac
  sleep "$SECONDS_TOTAL"
  printf '\003'; sleep 1; printf '\003'; sleep 2
}

rm -f "$OUT"
# script на BSD и на Linux вызывается по-разному; Termux — это Linux.
if script -q /dev/null true >/dev/null 2>&1; then
  drive | timeout $((SECONDS_TOTAL + 45)) script -q /dev/null bash "$RUNNER" >/dev/null 2>&1
else
  drive | timeout $((SECONDS_TOTAL + 45)) script -qec "bash $RUNNER" /dev/null >/dev/null 2>&1
fi
rm -f "$RUNNER"
[ -f "$OUT" ] && cat "$OUT" || { echo '{"error":"зонд ничего не записал"}'; exit 1; }
