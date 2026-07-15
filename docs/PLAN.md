# render-cache: TDD-план pi-extension (D+C)

Убирает O(весь ответ) рендер на каждый чанк стрима в pi TUI.
Патчи: `Markdown.prototype.render` (инкрементальный рендер, глобальный кэш)
+ `Intl.Segmenter.prototype.segment` (мемоизация ICU).

## Верифицированная база (не переоткрывать)

- Баг: `AssistantMessageComponent.updateContent()` (`assistant-message.js:66`) делает
  `contentContainer.clear()` + `new Markdown(...)` на КАЖДЫЙ `message_update`
  (= каждый text/thinking/toolcall delta, `agent-loop.js:210-225`).
  Per-instance кэш `cachedLines` (`markdown.js:56-77`) всегда холодный.
- Frame cost = O(длина всего ответа) × до 60fps (`MIN_RENDER_INTERVAL_MS=16`).
- Горячий стек (spindump, root): рендер-таймер → wrap → `Intl.Segmenter` (ICU) ≈ 20% сэмплов.
- Бенчи ревью: cache hit segmenter = 300–550× native; hit-rate 97% на реальном wrap;
  сам segmenter-кэш даёт лишь ~1.3–2× на процесс → нужен D (инкрементальный рендер).
- `Markdown.prototype.render` — публичный метод, патчабелен; pi-tui импортируем из extension
  (docs Available Imports). `Intl.Segmenter.prototype.segment` writable+configurable (Node 22.23.0).
- Extension грузится jiti'ом В ТОТ ЖЕ процесс, ПОСЛЕ создания TUI. `/reload`+new/resume/fork
  перезапускают фабрику → патчи обязаны быть идемпотентными.
- **Dual-instance риск СНЯТ** (проба на реальном jiti): loader.js:59-107 алиасит
  `@earendil-works/pi-tui` на абсолютный путь pi-копии; ESM native import → тот же
  module registry, тот же prototype (проба: same class/prototype/patch visible = true,
  в обоих режимах Node/Bun). Условие: импорт ТОЛЬКО bare specifier, pi-tui НИКОГДА
  не класть в deps плагина.
- **Boundary rules H1-H4+B1-B6 эмпирически провалидированы**: 110 targeted probes +
  6576 fuzz + 297 streaming-sim против реального Markdown.render(), 0 byte-diff failures.
  Probe/fuzz-скрипты: /tmp/segcache-review/*.mjs (переиспользовать в тестах!).
- **Тема pi = прокси над globalThis** (theme.js:608-623): тот же объект темы после /theme
  даёт другие ANSI → identity-ключ кэша ЗАПРЕЩЁН, нужен fingerprint.
- Межблочный spacing: `renderToken` эмитит `""` только при nextTokenType≠undefined →
  **все пустые строки-разделители принадлежат tail**, settled кончается \n последнего блока.

## Архитектура (SOLID/DRY/KISS)

```
plugins/render-cache/
├── PLAN.md
├── src/
│   ├── seg-cache.js       # C: чистый модуль-патчер Intl.Segmenter (0 зависимостей от pi)
│   ├── split.js           # D1: чистая функция splitSettled(text) → {settled, tail}
│   ├── md-cache.js        # D2: патчер Markdown.prototype.render (использует split.js)
│   └── stats.js           # общий счётчик hits/misses/fallbacks (один на оба патча)
├── test/
│   ├── seg-cache.test.js  # дифф-тесты C против нативного Segmenter
│   ├── split.test.js      # юнит-тесты сплиттера
│   └── md-cache.test.js   # дифф-тесты D: patched === orig байт-в-байт
└── render-cache.ts        # сам extension: install патчей + /rcstats + self-check
```

- **S**: каждый файл — одна ответственность; патчеры не знают друг о друге.
- **O/D**: md-cache зависит от абстракции splitSettled, не от marked/pi внутренностей.
- **DRY**: одна реализация FIFO-по-символам кэпа (общая утилита в stats.js), оба кэша её юзают.
- **KISS**: никакого AST-диффинга; сплит по консервативной эвристике, при сомнении — fallback
  на оригинальный render (корректность по построению).
- Тесты — plain node (`node --test`), импортируют pi-tui напрямую из установки pi.
  Никакой инфраструктуры.

## Инварианты (проверяются тестами, это и есть спецификация)

- I1: patched render(width) === orig render(width) байт-в-байт на ЛЮБОМ входе корпуса.
- I2: patched segment(str) эквивалентен native: одинаковые записи (segment/index/input,
  isWordLike ТОЛЬКО у word-granularity), spread/for..of/re-iterate работают, containing()
  делегирует.
- I3: повторный install патча (reload) не меняет поведение и не наслаивает обёртки.
- I4: суммарная память кэшей ограничена бюджетом символов (2M) — вставка сверх бюджета
  вытесняет, ничего не ломает.
- I5: стрим-сценарий (текст растёт кусками) — каждый промежуточный рендер === полный orig
  рендер того же текста.
- I6: при непатчабельном входе (ref-links, paddingY>0, images, кастомный styleContext)
  используется orig-путь (fallback-счётчик растёт, вывод идентичен).

## TDD-цикл (каждый шаг: красный → зелёный → рефакторинг)

### Шаг 0. Каркас + smoke (30 мин)
- test: `node --test` запускается, pi-tui импортируется из
  `/Users/shamash/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui`,
  `new Markdown("x",0,0,theme).render(80)` отдаёт строки. КРАСНЫЙ: нет файлов.
- code: пустые модули, тест-хелпер `loadPiTui()`.

### Шаг 1. C: seg-cache (2-3 ч)
1. test КРАСНЫЙ: дифф-корпус — ASCII, RU, thai, emoji-ZWJ, флаги, combining marks,
   пустая строка, "\r\n"; оба granularity; форма записей 1:1 (deepEqual + список ключей).
2. test КРАСНЫЙ: re-iterate, spread, containing(5) на патченом === native.
3. test КРАСНЫЙ: locale в ключе — два segmenter'а (en, th) не кросс-контаминируют.
4. test КРАСНЫЙ: двойной install → поведение то же, cache singleton один (Symbol.for guard).
5. test КРАСНЫЙ: бюджет 1000 символов → вставка 2000 вытесняет, всё работает.
6. test КРАСНЫЙ (perf, soft): 1000 повторных segment одной RU-строки — patched ≥10× faster.
- code: патч через spread нативных записей (`[...orig.call(this,str)]`), ASCII fast-path
  тоже кэшируется, containing non-enumerable, WeakMap resolvedOptions c fallback на orig.

### Шаг 2. D1: split.js (2-3 ч) — правила H1-H4 + B1-B6 (валидированы fuzz'ом, см. базу)

Нормализация до анализа (как рендерер): `\t`→"   ".

**Hazard-сканы текста → settled="" (полный fallback):**
- H1: `]:` где угодно (ref-defs: в blockquote/списке, multiline label ЧЕРЕЗ пустую строку,
  `[^1]:`, case-insens, emStrong-маскирование — всё ломает line-local анализ).
- H2: `/<a /i` (lexer-global state.inLink глушит GFM-автолинки в хвосте, даже из
  заголовков/списков/таблиц).
- H3: строка вне закрытых fence, ≤ 3 пробела + `<pre|<script|<style|<textarea|<!--|<?|<![`
  (case-insens) — HTML-блоки 1-5 живут через пустые строки до closer/EOF.
- H4: одинокий `\r` без `\n`.

**Граница = начало строки L, безопасна iff ВСЕ:**
- B1: L — первая непустая после ≥1 пустой (`/^[ \t]*$/` = пустая);
  **весь blank-run уходит в tail** (контракт spacing, см. базу).
- B2: prefix содержит непустой символ.
- B3: нет открытого fence. Трекер честный: символ opener==closer, len(closer)≥len(opener),
  пустой info у closer, ≤3 пробела, `` ``` `x `` — НЕ fence (backtick в info).
- B4: L завершена (`\n` получен) — растущая первая буква меняет класс (`1`→`1. буллет`).
- B5: L с колонки 0, не-пробел (убивает list-continuation/loose-flip/indented-code +
  wrap-расхождения на узких ширинах).
- B6: L = `^#{1,6}[ \t]` ИЛИ plain-стартер: первый символ ∉ `- + * > | < [ # \` ~ = _`
  и не `\d{1,9}[.)]`.

Тесты (КРАСНЫЕ):
1. Fence-трекер: ` ```` `≠` ``` `, `~~~`, info с backtick, closer с пробелами, вложенные.
2. Каждый hazard H1-H4 → settled="": включая убийцу `see it\n\n[foo\n\nbar]: /url`.
3. Каждое правило B1-B6 отдельно: list-continuation (`- a\n- b\n\n  cont`), 4-space после
   item, blank-run целиком в tail, незавершённая последняя строка.
4. Монотонность ОСЛАБЛЕННАЯ: split(text+delta).settled расширяет прежний settled
   ИЛИ == "" (hazard прилетел в стриме — легитимный сброс в fallback).
5. Пограничные: пусто/один параграф/только fence/blank-only prefix/CRLF.
- code: линейный сканер; сомнительно → settled="".

### Шаг 3. D2: md-cache (3-4 ч)
**Ключ кэша**: `(prefixText, width, paddingX, themeFingerprint, hyperlinksBit)`.
- paddingX В КЛЮЧЕ (hot path всегда paddingX=1, fallback убил бы весь смысл).
- themeFingerprint = hash(`theme.heading("x")+theme.code("x")+theme.listBullet("x")+
  theme.quote("x")+codeBlockIndent`) — считается на каждый patched render (O(мкс)).
  НЕ identity: тема — прокси, /theme меняет вывод при том же объекте.
- hyperlinksBit = getCapabilities().hyperlinks (OSC-8 vs `text (url)`).
- options непустой ИЛИ defaultTextStyle → fallback (v1; thinking-блоки остаются медленными —
  задокументировано; v2: ключ по stylePrefix-сентинелу, если Ф3 провалится на thinking-heavy).

1. test КРАСНЫЙ (I1): базовый корпус (заголовки, вложенные списки, таблицы, fence с langs,
   RU/thai/emoji, длинные строки, inline) × ширины **[20, 24, 47, 80]** (узкие ловят
   wrap-расхождения) — patched === orig байт-в-байт.
1b. test КРАСНЫЙ (I1-adversarial, корпус из базы — ОБЯЗАТЕЛЕН, два класса проходят малые
   корпуса молча): ref-defs через границу (оба направления; в blockquote/списке; case-insens;
   collapsed `[foo][]`; img `![alt][x]`; title на следующей строке; `[^1]:`; def-label через
   пустую строку), unclosed HTML 1-5 (все 8 openers × heading-tail И styled-tail) +
   closed-двойники (НЕ fallback), inLink-лики (`<a href` в параграфе/заголовке/списке/таблице;
   balanced — без fallback; email-tail), list-continuation весь набор, indented code,
   blank-run патологии, fence-трекер кейсы, partial closing fence у границы.
2. test КРАСНЫЙ (I5): стрим-симуляция по ~40 симв/чанк + resize посреди + hazard прилетает
   на чанке N (settled сбрасывается в "", вывод идентичен).
3. test КРАСНЫЙ (I1-theme): смена глобальной темы (setGlobalTheme) между рендерами при том же
   объекте темы → новые ANSI, нет stale-кэша.
4. test КРАСНЫЙ (I6): paddingY=1, options, defaultTextStyle → fallback-счётчик растёт, вывод = orig.
5. test КРАСНЫЙ (I3): двойной install → один слой.
6. test КРАСНЫЙ (I4): бюджет символов работает.
7. test КРАСНЫЙ (perf, hard gate): стрим 16KB по 40 симв/чанк: patched суммарно ≥5× быстрее.
8. Fuzz-ворота: адаптировать /tmp/segcache-review/fuzz.mjs (случайные конкатенации ×
   ширины) — регрессионный гейт на апгрейды pi/marked.
- code: patched render = hazards/границы (split.js) → кэш-хит префикса + origRender(tail)
  на scratch-инстансе (те же paddingX/theme, без options/style); конкат в СВЕЖИЙ массив
  (глобально-кэшированный массив наружу НЕ отдавать). Обязательно писать per-instance
  cachedText/cachedWidth/cachedLines (Container/overlay зовёт render дважды за кадр —
  второй вызов идёт O(1)-путём инстанса); точно воспроизвести `[]`/`[""]`-семантику.
  Сомнение → orig.

### Шаг 4. Extension (1-2 ч)
1. test КРАСНЫЙ: install() идемпотентен; shared state (originalRender, кэши, счётчики) на
   `globalThis[Symbol.for("render-cache:v1")]`; reinstall ПЕРЕНИМАЕТ состояние (не сбрасывает,
   иначе /rcstats после /reload слепнет); uninstall() восстанавливает оригинал ТОЛЬКО если
   render всё ещё наш (не роняем чужую обёртку поверх).
2. test КРАСНЫЙ: version-drift — hash(Markdown.prototype.render.toString()) при install;
   мисматч на reinstall → отказ + notify.
- code: `render-cache.ts` — install обоих патчей; self-check СОБЫТИЙНЫЙ: таймер 2с
  взводится на ПЕРВОМ `message_update` (НЕ на старте — тихая сессия легитимно рендерит
  0 Markdown, false-disable недопустим); счётчик 0 после таймера → самоотключение + notify.
  Команда `/rcstats` (hits/misses/fallbacks/memory обоих кэшей).
- ручная проверка: `pi -e ./render-cache.ts` в тестовой сессии (+ /theme-переключение глазами).

### Шаг 5. Ф3: живой замер (с тобой)
- Baseline уже снят: три сессии ~105% CPU (Δ cputime за 4с).
- Ты перезаходишь в старые сессии (`pi --resume`), extension в
  `~/.pi/agent/extensions/` (symlink на plugins/render-cache/render-cache.ts).
- Я снимаю: Δ cputime тех же сессий под стримом, spindump-долю segmenter, /rcstats.
- GATE: segmenter ≤2% сэмплов И CPU-падение ≥30 п.п. Цель: 105% → 20–40%.
- Провал gate → /rcstats покажет где (низкий hit-rate D? фоллбеки? остался marked-лексинг?) —
  итерируем или признаём предел extension-подхода и уходим в апстрим-PR.

## Не делаем (осознанно)
- Не патчим AssistantMessageComponent (throttle) — D делает это ненужным через глобальный кэш.
- Не трогаем MIN_RENDER_INTERVAL_MS.
- Не инкрементализируем сам marked-лексер (это апстрим-PR).
- Багрепорт апстриму (cold-rebuild Markdown на каждый чанк) — отдельная задача после Ф3,
  с нашими замерами до/после как доказательной базой.

## Риски
- ~~Dual-instance pi-tui~~ СНЯТ (проба: same prototype в Node/Bun режимах); self-check
  остаётся страховкой от будущих изменений загрузчика.
- Thinking-heavy модели: thinking идёт через fallback (defaultTextStyle) → выигрыш меньше;
  Ф3-gate провалился из-за этого → v2 с stylePrefix-ключом.
- pi-обновление меняет Markdown.render → version-drift hash + I1/fuzz перегоняются одной
  командой (`node --test`), плагин чинится или отключается.
- marked нестабилен между префикс+хвост и полным текстом → ловится I1/I5; лечится
  консервативностью split (шаг 2 именно поэтому отдельный модуль с отдельными тестами).
