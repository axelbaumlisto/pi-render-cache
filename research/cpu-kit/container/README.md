# Стенд в контейнере: pi под ограниченным ядром

Зачем: на живой машине мешают посторонние процессы, а режим интерфейса у всех
разный. Здесь pi запускается в чистом контейнере с `--cpus 1`, ему подсовывают
настоящую сессию и ровную нагрузку («кубики»: печать, листание, стирание), а
меряется процессорное время всего контейнера через `/sys/fs/cgroup/cpu.stat`.

```bash
docker build -t pi-bench:1.0.2 .
S=$(ls -S ~/.pi/agent/sessions/*/*.jsonl | head -3 | tail -1)
docker run --rm --cpus 1 -v "$PWD/out:/out" -v "$S:/work/session.jsonl:ro" \
  -e BENCH_LABEL=fs -e BENCH_TUIMODE=fullscreen -e BENCH_SECONDS=45 \
  -e BENCH_PROBE=screens -e BENCH_SESSION=/work/session.jsonl \
  -e BENCH_CWD=/Users/shamash/work/naked pi-bench:1.0.2
```

Переменные: `BENCH_TUIMODE` (fullscreen/regular), `BENCH_SESSION`, `BENCH_CWD`
(каталог из сессии — pi откажется её открывать, если его нет), `BENCH_SECONDS`,
`BENCH_PROBE`, `BENCH_LABEL`.

Две ловушки, обе стоили времени. Ввод нужно подавать размеренно: если вывалить
триста символов разом, pi склеит их в один кадр и замер покажет пустоту. И
нужен зонд `screens`, который считает кадры отдельно по `TuiMainScreen` и
`TuiAltScreen` — иначе легко измерить не тот экран.
