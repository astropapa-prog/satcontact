# ТЕХНИЧЕСКИЙ ПАСПОРТ ПРОЕКТА: SatContact (PWA)

## 1. Общее описание приложения

Проект представляет собой автономное веб-приложение (Progressive Web App - PWA) для радиолюбителей и пользователей SDR (Software-Defined Radio). Приложение предназначено для удобного просмотра, фильтрации и поиска радиочастот из базы данных (XML), а также для визуального отслеживания положения спутников на реальном небе с помощью технологий дополненной реальности (AR) в браузере мобильного устройства. Приложение ориентировано на работу в условиях отсутствия интернета (оффлайн-режим).

## 2. Инструментарий разработчика

- **Среда разработки:** Cursor IDE
- **Языки:** Чистый HTML5, CSS3, JavaScript (Vanilla JS, без фреймворков)
- **Хостинг:** GitHub Pages (статический сайт)

## 3. Источники данных

- **Frequencies.xml** (data/): XML из SDR#, теги MemoryEntry: Name, Frequency, GroupName, DetectorType, FilterBandwidth
- **NORAD ID:** извлекаются все значения из Name в квадратных скобках [28117], [40296][44453][45254][52145] и т.д.
- **TLE** (data/tle.txt): обновляется автоматически GitHub Actions раз в сутки из Space-Track + N2YO (дозагрузка 26635, 34810, 40614). Парсится в tle.js, используется satellite.js для расчётов орбит

## 4. ТЕКУЩАЯ РЕАЛИЗАЦИЯ — Модуль 1 (Менеджер частот)

### 4.1 Файловая структура

```
satcontact/
├── index.html           # SPA, шапка + список карточек + mapView + arView + newsView
├── style.css            # Telegram Dark, mobile-first, стили карты, AR и новостей
├── app.js               # Парсинг XML, фильтры, рендер, openMapView/closeMapView, openArView/closeArView, openNewsView/closeNewsView
├── gps-service.js       # Централизованный GPS-сервис: watchPosition, IP-геолокация, ручной ввод, RAM/localStorage кеш
├── map.js               # Модуль 2: HUD, телеметрия, NORAD-фокус, initMap/cleanupMap (координаты из SatContactGps)
├── map-render.js        # Canvas-картография: карта день/ночь, терминатор, огни городов, орбиты, footprint, маркеры
├── ar.js                # Модуль 3: камера, сенсоры, калибровка, Worker-траектории, initAr/cleanupAr (координаты из SatContactGps)
├── ar-render.js         # Модуль 3: WebGL орбиты + Canvas2D маркеры поверх видео
├── news.js              # Модуль 4: доска объявлений + чат, Backblaze B2 через aws4fetch, initNews/cleanupNews
├── tle.js               # TLE парсер, satellite.js, requestTrajectories + requestArTrajectories (Worker)
├── tle-worker.js        # Web Worker: SGP4, getTrajectory24h, CALCULATE_AR_TRAJECTORIES
├── lib/                 # Локальные библиотеки (PWA/офлайн)
│   ├── README.md        # Инструкции: что скачать
│   ├── satellite.min.js
│   ├── d3.min.js
│   ├── topojson.min.js  # topojson-client, см. lib/README.md
│   └── aws4fetch.min.js # IIFE-сборка aws4fetch (S3 Signature V4, для Модуля 4)
├── data/
│   ├── Frequencies.xml
│   ├── tle.txt          # TLE (Satcom, Меридианы), автообновление GitHub Actions
│   ├── countries-50m.json   # карта мира TopoJSON (world-atlas)
│   ├── board.html       # HTML-фрагмент доски объявлений (Модуль 4, редактируется админом через GitHub)
│   └── board-media/     # Медиафайлы доски объявлений (загружаются админом через GitHub)
├── scripts/
│   └── update_tle.py    # Скрипт загрузки TLE с Space-Track (SPACETRACK_USER, SPACETRACK_PASS)
├── .github/workflows/
│   └── update-tle.yml   # Ежедневно 00:00 UTC + workflow_dispatch, авто-коммит data/tle.txt
├── PROJECT_CONTEXT.md
├── MODUL4_PROJECT_CONTEXT.md  # Полное техническое описание Модуля 4 (архитектура, API, форматы, стоимость)
└── README.md
```

**Порядок скриптов в index.html:** utils.js → satellite.min.js → d3.min.js → topojson.min.js → tle.js → **gps-service.js** → map.js → map-render.js → ar-render.js → ar.js → **aws4fetch.min.js** → **news.js** → app.js

**lib/:** локальные копии (PWA/офлайн). См. lib/README.md. **data/countries-50m.json:** скачать из world-atlas.

**GitHub Pages:** index.html содержит `<base href="/satcontact/">`. Для локальной разработки закомментировать или заменить на `<base href="./">`.

### 4.2 Парсинг данных (app.js)

- **NORAD IDs:** из Name, паттерн `\[(\d+)\]` (matchAll) — извлекаются все ID, напр. [40296][44453][45254][52145]
- **TX частота:** из Name, паттерн `([\d.,\s]+)` в круглых скобках
- **Clean Name:** удаление NORAD, TX, статусов, "кгц" из Name
- **Статус:** по ключевым словам в Name/GroupName — чувствительный→🟢, средняя/ср→🟡, тупой/ту→🔴, иначе ⚫
- **IsFavourite:** не используется (параметр игнорируется)

### 4.3 Архитектура фильтрации

**Три независимых механизма (порядок применения):**

1. **Группа** — выпадающий список по GroupName. Список групп формируется динамически из XML.
2. **Кнопки-фильтры** — множественный выбор (toggle):
   - `selectedFilters.satellites` (Set)
   - `selectedFilters.bandwidths` (Set)
   - `selectedFilters.sensitivities` (Set)
   - Логика: OR внутри категории, AND между категориями
   - **Важно:** категория чипа определяется по родителю (`getFilterSetForChip`) — chipRowSatellites, chipRowBandwidth, chipRowSensitivity
3. **Поиск по частоте** — поле ввода, только цифры:
   - Префикс-совпадение (`startsWith`), не подстрока
   - RX: строка Hz (e.frequency)
   - TX: `Math.round(e.txFreq * 1000)` как строка

### 4.4 UI шапки (компактная, mobile-first)

**Панель управления (одна строка):**
- Кнопка «ВСЕ» — сброс всех фильтров, сворачивание рядов Полоса/Чувств., очистка поиска
- Поле «Поиск по частоте» — placeholder, inputmode="numeric"
- Тумблер «Полоса» — показать/скрыть ряд полос пропускания
- Тумблер «Чувств.» — показать/скрыть ряд чувствительности

**Ряды чипсов (горизонтальный скролл, scrollbar скрыт):**
- Ряд 1 (Спутники): всегда виден
- Ряд 2 (Полосы): изначально скрыт (класс `chip-row--collapsed`)
- Ряд 3 (Чувствительность): изначально скрыт

**Поведение тумблеров:**
- При сворачивании ряда — сброс соответствующего Set (bandwidths/sensitivities)
- После клика — `forceBlur()` + класс `btn--blurred` (сброс «залипшего» hover на мобильных)

### 4.5 Важные детали реализации

- **Горизонтальный скролл мышью:** обработчик `wheel` преобразует deltaY в scrollLeft (passive: false)
- **Оverscroll на мобильных:** `overscroll-behavior-x: none` на .chip-scroll и body; в `bindHorizontalScroll` — touchmove с preventDefault при достижении края (scrollLeft≤2 или ≥max-2) и свайпе в направлении overscroll — предотвращает закрытие браузера
- **Подсветка чипсов:** `chip--active`; при отключении фильтра — `chip--blurred` + `forceBlur()`; при касании вне чипсов/тумблеров — сброс `chip--blurred`, `btn--blurred` через `bindChipBlurReset()`
- **forceBlur(el):** blur() + fallback: если элемент остаётся в фокусе (типично на мобильных), создаётся временный input, фокус переносится на него, input удаляется
- **Классы chip--blurred, btn--blurred:** CSS override для :hover/:focus — принудительно показывают дефолтный стиль, устраняют «залипание» на мобильных
- **Сворачивание рядов:** CSS-класс `chip-row--collapsed` (display: none), не атрибут hidden
- **Регенерация чипсов:** при смене группы — пересборка рядов спутников и полос из данных выбранной группы
- **Кнопка ВСЕ:** не сбрасывает выбор группы

**Мобильные исправления (style.css, app.js):**
- style.css: overscroll-behavior-x (body, .chip-scroll); .chip.chip--blurred:not(.chip--active); .btn--toggle.btn--blurred:not(.active)
- app.js: forceBlur(), bindChipBlurReset(), touchmove в bindHorizontalScroll

### 4.6 Дизайн (style.css)

- Палитра: фон #1c242d, карточки #212d3b, акцент #5288c1, текст #ffffff / #8a9ba8
- Частоты и NORAD — моноширинный шрифт
- Карточки вместо таблицы

### 4.7 Карточка частоты (4 зоны)

**Структура (CSS Grid):**
- **Колонка 1 (слева):** имя спутника, RX частота, TX частота
- **Колонка 2 (центр):** надпись «транспондер», число полосы в кГц — на уровне RX; блок центрирован между частотой и кнопками
- **Колонка 3 (справа):** две овальные кнопки «посмотреть на карте» и «НАВЕСТИСЬ» (заготовки для модулей карты и AR-трекера)

**Стили:**
- Число полосы: ярко белое при 6–8 kHz, приглушённое при большей ширине
- Полоса (bandwidth) убрана из футера; в футере: NFM, чувствительность, все NORAD ID
- data-norad на карточке: список ID через запятую для передачи в модули 2–3

**Кнопки:**
- Овальная форма (border-radius: 9999px)
- Мобильный: одна над другой, фиксированный одинаковый размер (40×width), не зависит от длины надписи
- Планшет/десктоп (≥600px): в ряд, по центру, равный размер (flex: 1)

---

## 5. МОДУЛЬ 2 — Интерактивная карта (реализовано)

### 5.1 Шаг 1: GitHub Actions (TLE)

- **scripts/update_tle.py:** авторизация Space-Track (POST ajaxauth/login), скачивание TLE по NORAD ID, дозагрузка 26635/34810/40614 с N2YO.com (Space-Track их не отдаёт), сохранение в data/tle.txt. Env: SPACETRACK_USER, SPACETRACK_PASS, N2YO_API_KEY.
- **.github/workflows/update-tle.yml:** cron 00:00 UTC, workflow_dispatch, secrets.SPACETRACK_USER/PASS/N2YO_API_KEY, авто-коммит data/tle.txt при изменении. **GitHub Secrets:** SPACETRACK_USER, SPACETRACK_PASS, N2YO_API_KEY.

### 5.2 Шаг 2: Базовый UI карты и SPA-маршрутизация

- **index.html:** `<div id="mapView" class="map-view" hidden>` — шапка (Назад, Название, ВСЕ), #mapCanvas, HUD (азимут, дистанция, GPS-строка статуса с индикатором/координатами/возрастом кеша/кнопкой «↻ Сеть», строка ручного ввода с полем и кнопкой «Записать»).
- **app.js:** `openMapView(noradIds, satelliteName, noradIdToName?)` — скрывает .header/.main, показывает mapView, вызывает `window.initMap({ noradIds, satelliteName, noradIdToName })`. `closeMapView()` — возврат, вызывает `window.cleanupMap()`. Кнопка «посмотреть на карте» — data-norad, data-clean-name. Кнопка «ВСЕ» на карте — все NORAD IDs из filteredEntries + noradIdToName из filteredEntries.
- **style.css:** .map-view (fixed, fullscreen), .map-view__header, .map-view__hud (#212d3b), .gps-status (единый компонент для Модуля 2 и 3).

### 5.3 Централизованный GPS-сервис (gps-service.js)

Вся логика геолокации сосредоточена в **gps-service.js**. Ни map.js, ни ar.js не обращаются к `navigator.geolocation` напрямую.

**Двухуровневый кеш:**
- **RAM-кеш** — переменная в JS, обновляется мгновенно. Модули читают только из RAM-кеша через `SatContactGps.getCoords()`.
- **Персистентный кеш** — `localStorage`, ключ `satcontact_observer`. Формат: `{ latitude, longitude, altitude, accuracy, source, timestamp }`.

**Правила записи в localStorage:**
- Первый запуск (localStorage пуст) → немедленно при получении первых данных.
- Ручной ввод (кнопка «Записать») → немедленно.
- Обновление по сети (кнопка «↻ Сеть») → немедленно.
- GPS авто-обновление → каждые 5 минут (не чаще).
- Переход приёмника в cooldown/off → немедленно.
- `beforeunload` / `visibilitychange(hidden)` → немедленно.

**Приоритет источников:** нет жёсткого приоритета. Кто последний записал — тот актуален.

**Состояния GPS-приёмника (state machine):**
- `off` → watchPosition не запущен.
- `active` → watchPosition работает (пользователь в Модуле 2 или 3).
- `cooldown` → пользователь вышел в Модуль 1; если GPS обновлял кеш → off сразу; иначе watchPosition работает до 15 мин или первого фикса.
- `denied` → пользователь запретил геолокацию в браузере.

**IP-геолокация** (`updateFromNetwork`): каскад ipwhois.app → geolocation-db.com, таймаут 5 с. Вызывается только по кнопке «↻ Сеть».

**Ручной ввод** (`updateManual`): парсинг координат, запись в кеш с `source: 'manual'`.

**Публичный API (`window.SatContactGps`):**
- Чтение: `getCoords()`, `getReceiverStatus()` → `'off'|'searching'|'fix'|'denied'`, `getCacheAgeMs()`, `hasFix()`.
- Управление: `start()`, `enterCooldown()`.
- Обновление: `updateFromNetwork()` → Promise, `updateManual(lat, lon)` → boolean.
- Подписка: `onChange(cb)`, `offChange(cb)`.

**UI — единая GPS-строка статуса** (отображается в обоих модулях):
- Индикатор приёмника: 🟢 GPS / 🟡 ПОИСК / 🔴 ЗАПРЕЩЁН / ⚪ ВЫКЛ.
- Координаты из кеша (всегда если кеш не пуст).
- Возраст кеша: `0:42`, `2ч`, `1д`.
- Кнопка «↻ Сеть».
- Модуль 2 дополнительно: строка ручного ввода с полем и кнопкой «Записать».

**map.js** — теперь только телеметрия, NORAD-фокус, HUD. При `initMap()` вызывает `SatContactGps.start()`, подписывается на `onChange`. При `cleanupMap()` — `SatContactGps.enterCooldown()`.
- **API:** `window.getMapObserver()` → `SatContactGps.getCoords()`.

### 5.4 Шаг 4: TLE парсер и математика (tle.js, tle-worker.js)

- **satellite.js:** lib/satellite.min.js v6, `twoline2satrec`, `propagate`, `ecfToLookAngles`, `eciToGeodetic`.
- **loadTle():** fetch data/tle.txt (абсолютный URL для GitHub Pages), parseTle() → Map<NoradId, { line1, line2, satrec }>. После парсинга — worker.postMessage({ type: 'INIT_TLE', text }).
- **computeSatellite():** (tleData, observer, date) → { azimuth, elevation, distance, lat, lon, height }. Остаётся в основном потоке (HUD, footprint).
- **requestTrajectories(noradIds):** Promise. Отправляет noradIds в Worker, получает TRAJECTORIES_READY с массивом траекторий. При ошибке Worker — fallback getTrajectory24hSync() в основном потоке.
- **requestArTrajectories(noradIds, observer, pointsPerSat):** Promise для **Модуля 3 (AR)** — траектории в азимуте/элевации; Worker: **CALCULATE_AR_TRAJECTORIES** → **AR_TRAJECTORIES_READY**; при недоступности Worker — синхронный fallback в основном потоке.
- **tle-worker.js:** importScripts('./lib/satellite.min.js'). INIT_TLE — парсинг, tleCache. CALCULATE_TRAJECTORIES — getTrajectory24h для карты; CALCULATE_AR_TRAJECTORIES — траектории az/el для AR.
- **API:** `window.getMapNoradIds()`, `window.getMapNoradIdToName()`, `window.getSatellitePosition(noradId, date)`, `window.SatContactTle.requestTrajectories(noradIds)`, `window.SatContactTle.requestArTrajectories(...)`.

### 5.5 Кнопка «посмотреть на карте»

- Активна. При клике: извлечение data-norad и data-clean-name из карточки, SPA-переход в mapView, вызов initMap.

### 5.6 Шаг 5: Canvas-картография (map-render.js)

**Рендер:** HTML5 Canvas (не SVG). D3 используется для проекции и geoPath, отрисовка — нативный Canvas API.

**Архитектура:**
- **Состояние (обновляется в циклах):** currentSunPos, terminatorShadowGeo, terminatorLineGeo, activeSatellites, cachedOrbitGeos, observerPos, observerBaseXY, focusedNoradIds.
- **Кэш Path2D:** cachedLandPath2D, cachedTerminatorShadowPath2D, cachedTerminatorLinePath2D. Орбиты и footprints — Path2D. path = d3.geoPath().projection(projection) без context — возвращает SVG-строки для Path2D.
- **Предрасчёт:** city.baseXY, city.isNight (slowLoop); sat.baseXY, observerBaseXY (fastLoop). В renderFrame() нет вызовов projection() и geoDist().
- **Циклы:** fastLoop (1 с) — observerPos, activeSatellites, cachedOrbitGeos, footprints; slowLoop (60 с) — терминатор, city.isNight. Оба вызывают renderFrame().
- **renderFrame():** Painter's algorithm. ctx.save/translate/scale в начале, ctx.restore в конце. lineWidth и радиусы делятся на currentTransform.k.

**Зум и панорамирование:** d3.zoom(), scaleExtent [1, 8]. currentTransform. isDragging — только при изменении transform (не при tap). Клик: onCanvasClick, d3.pointer(event, canvas.node()).

**Орбиты и footprint:**
- Орбиты рисуются для ВСЕХ выбранных спутников (асинхронно через Worker). Каждая орбита — свой цвет из ORBIT_PALETTE.
- Footprint по умолчанию скрыт. Показывается при клике по спутнику (focusedNoradIds). Повторный клик — скрыть. Клик в пустоту — сброс всех. Вместе с footprint показывается название спутника.
- activeSatellites: noradId, pos, baseXY, footprintPath2D, markerRadius, name, orbitColor.
- Маркеры — иконки спутников (drawSatelliteIcon: корпус, панели, антенна, сопло). Названия — в экранных координатах, 12px, фиксированный размер при зуме.

**Пути и GitHub Pages:** resolveUrl(relativePath), base в index.html. style.css: touch-action: none на .map-view__canvas.

**Интеграция:** SatContactMapRender.init(mapCanvas), update() = fastLoop, destroy().

---

## 6. МОДУЛЬ 3 — AR-трекер (реализовано)

### 6.1 Назначение и файлы

- **ar.js** — оркестратор: камера (`getUserMedia`, задняя), координаты из `SatContactGps` (не обращается к `navigator.geolocation` напрямую), DeviceOrientation (компасный режим), WMM-коррекция магнитного склонения (пересчёт в `onChange` кеша), калибровка по Солнцу/Луне/Полярной (формулы внутри ar.js), Web Audio (звуковой прицел в режиме фокуса — угол наведения из **`SatContactArRender.computeAimingAngularErrorDeg`**, см. п. 6.5), таймер дрейфа, машина состояний **overview / focus** (UI: перекрестие, звук, скрытие прочих спутников при фокусе).
- **ar-render.js** — **единый пайплайн Real 3D:** орбитные линии в **WebGL** (vertex: az/el → ориентация → перспектива → NDC; fragment: цвет + свечение), маркеры и подписи — **Canvas2D** поверх `#arCanvas`. При отсутствии WebGL — отрисовка линий на Canvas2D через `projectReal3D()`. Публичный API: помимо `init` / `draw` / `hitTest` / `updateTrajectories` — **`computeAimingAngularErrorDeg(az, el, orientationMatrix)`** (угол между направлением на спутник и осью камеры; та же геометрия, что у маркеров и шейдера; используется звуковым прицелом в **ar.js**).
- **index.html:** `#arView` — `<video>`, `<canvas id="arCanvasGL">`, `<canvas id="arCanvas">`; шапка, HUD, калибровочная нижняя панель (`#arCalibPanel`), кнопка рекалибровки (`#arRecalibBtn`), заглушка для десктопа без камеры/гироскопа.
- **tle.js / tle-worker.js:** помимо карты — **`requestArTrajectories(noradIds, observer, pointsPerSat)`** и сообщение Worker **`CALCULATE_AR_TRAJECTORIES`** → ответ **`AR_TRAJECTORIES_READY`** с траекториями `{ [noradId]: [{ az, el }, ...] }` (отсечение по элевации, ~120 точек на спутник). Синхронный fallback в основном потоке при недоступности Worker.
- **app.js:** `openArView()` / `closeArView()`, кнопка «НАВЕСТИСЬ» (`data-action="track"`).
- **Палитра:** `window.SatContactOrbitPalette` (как в map-render.js, `ORBIT_PALETTE`).

**Порядок скриптов (фрагмент):** … → `map-render.js` → **`ar-render.js` → `ar.js`** → `app.js`.

### 6.2 Архитектура рендера и данных (текущая)

**Слои (снизу вверх):** видео → WebGL (линии орбит) → Canvas2D (иконки, текст, hit-test).

**Три такта обновления:**

| Такт | Частота | Где | Содержание |
|------|---------|-----|------------|
| Рендер | ~30 FPS | main | WebGL + Canvas2D; позиции спутников **интерполируются** между соседними тиками 1 Гц |
| Позиции | 1 Гц | main | `SatContactTle.computeSatellite()` по каждому NORAD из текущего набора (над горизонтом); `prevPositions` / `currentPositions` для интерполяции |
| Траектории | ~1,3 с | Worker | `requestArTrajectories` → обновление VBO / данных для линий |

До **~30 спутников** (кнопка «ВСЕ» в AR подтягивает NORAD из фильтра Модуля 1). В режиме **focus** на экране остаётся один выбранный спутник (линия + маркер); в **overview** — все видимые из набора. Различие режимов — **поведение UI**, не отдельные математические проекции.

### 6.3 Геолокация и сенсоры

- **GPS в AR:** координаты берутся из централизованного кеша `SatContactGps.getCoords()`. AR не запрашивает GPS напрямую. При входе вызывается `SatContactGps.start()`, при выходе — `enterCooldown()`. Потеря GPS **не останавливает** рендеринг — AR продолжает работать с кешем.
- **Единая GPS-строка статуса** в AR HUD: индикатор приёмника, координаты, возраст кеша, кнопка «↻ Сеть».
- **Камера, компас:** iOS — по жесту `DeviceOrientationEvent.requestPermission`. DeviceMotion не используется.
- **Готовность датчиков** (`areSensorsReady()`): кеш координат не пуст (`SatContactGps.getCoords() !== null`) + DeviceOrientation + камера. До готовности кнопка «Зафиксировать» неактивна. Если кеш пуст — «Нет координат — обновите по сети или введите вручную в Модуле 2». Если кеш есть (хоть суточной давности) — калибровка работает.
- **Десктоп:** если нет камеры/ориентации — заглушка с пояснением.
- **magneticDeclination:** пересчитывается в колбэке `SatContactGps.onChange()`.

### 6.4 Компас, калибровка, дрейф

- Встроенная упрощённая **WMM** для склонения по координатам GPS (в матрицу ориентации).
- **Матрица ориентации (`orientationMatrix[9]`):** `computeOrientationMatrix(α, β, γ)` вычисляет ZXY Euler R = Rz(α)·Rx(β)·Ry(γ) (device→world), хранит **R^T** (world→device) row-major. Все потребители (`projectReal3D`, WebGL-шейдер, `computeAimingAngularErrorDeg`) используют `m[row]·v_world` — это `(R^T · v_world)[row]`, координаты в системе устройства. Forward камеры в мире = `R·(0,0,−1)` = `−(Row2 of R^T)` = `−(m6, m7, m8)`. WebGL-upload: данные row-major с `transpose=false` → GLSL column-major автоматически даёт R, и `dot(R[col_i], world)` = `(R^T · world)[i]`.
- **Только компасный режим:** `DeviceOrientation` / `deviceorientationabsolute`, поправка `calibrationDelta` + WMM на `alpha`. Инерциальный режим (heading-based gyro yaw) удалён.
- **`refreshOrientationMatrix()`** — `computeOrientationMatrix(sensorState.alpha − calibrationDelta − magneticDeclination, beta, gamma)`.
- **`onOrientation()`** — обновляет `sensorState`, вызывает `refreshOrientationMatrix()`. При первом вызове (`sensorReady = true`) обновляет состояние кнопок калибровки.

#### Формальная машина состояний калибровки (`calibState`)

Два состояния: `'calibrating'` → `'rendering'`.

- **`calibrating`**: камера и сенсоры запущены, рендеринг не идёт. Нижняя панель `#arCalibPanel` с кнопками небесных тел (Солнце/Луна/Полярная) и кнопкой «Зафиксировать». Кнопка «Назад» в шапке доступна. Доступность тел определяется по elevation > 5° (`updateCelestialBodiesAvailability`, обновляется каждые 10 с). Кнопка «Зафиксировать» неактивна пока `areSensorsReady()` не вернёт true (кеш координат + сенсоры + камера) и не выбрано небесное тело. При пустом кеше — «Нет координат», кнопка «↻ Сеть» работает прямо в AR. «Зафиксировать» — калибровка по выбранному телу, `calibrationDelta` рассчитан.
- **`rendering`**: рендеринг спутников (запуск или возобновление). Кнопка `#arRecalibBtn` в правой панели. Таймер дрейфа (`updateDriftIndicator`): при `error ≥ MAX_DRIFT_ERROR_DEG` автоматически вызывает `triggerRecalibration()` → переход в `calibrating`. Потеря GPS **не вызывает** рекалибровку — рендеринг продолжается с кешированными координатами. Ручная рекалибровка через ту же `triggerRecalibration()`.

**Дрейф:** таймер после калибровки; при превышении порога — автоматический вход в рекалибровку (`triggerRecalibration`).

### 6.5 Звук, «ВСЕ», события

- **Звуковой прицел:** только в режиме **focus**; Web Audio API (`updateAudioPitch` в **ar.js**): частота **20–900 Гц** по величине углового отклонения **0°–90°** (константы `AUDIO_MIN_HZ` / `AUDIO_MAX_HZ` / `AUDIO_MAX_OFFSET_DEG`).
- **Единая геометрия с рендером:** угол наведения не считается из отдельных «азимут/элевация камеры» по сенсору. Вызов **`SatContactArRender.computeAimingAngularErrorDeg(satAz, satEl, orientationMatrix)`** в **ar-render.js**: тот же unit-вектор на спутник в мировых осях, что в **`projectReal3D()`** и в вершинном шейдере; ось «вперёд» в мире = **`R·(0,0,−1)`** = `−(m6, m7, m8)` (Row2 хранимой R^T). Так звук и положение иконки опираются на одну **`orientationMatrix`** (калибровка задаётся в **`refreshOrientationMatrix`**: Euler α из `DeviceOrientation` после `calibrationDelta` и WMM, beta/gamma из OS fusion).
- **«ВСЕ» в AR:** как тумблер — при включении: все NORAD из `getSatContactFilteredEntries()`; при выключении: если есть спутник в фокусе — остаётся только он (фокус сохраняется), если фокуса нет — откат к `initialNoradIds`. Логика аналогична кнопке «ВСЕ» на карте (Модуль 2).
- Событие **`satcontact:ar-focus`** — `{ detail: { focusedIds } }` для возможной синхронизации UI.

### 6.6 Что намеренно не делается в Модуле 3

- Нет **Three.js** и тяжёлого 3D-глобуса; орбиты — **нативный WebGL** (линии), не сцена из полигонов.
- Нет ленты частот (частота у маркера в фокусе).
- Нет мульти-фокуса в AR (один спутник в фокусе).
- Нет тяжёлого ML / распознавания неба.

### 6.7 Сводная таблица (Модуль 3)

| Аспект | Решение |
|--------|---------|
| Вход | «НАВЕСТИСЬ» → `openArView` |
| Калибровка | Машина: `calibrating` (нижняя панель, Fix) → `rendering` |
| Позиции спутников | 1 Гц, `computeSatellite`, интерполяция под ~30 FPS |
| Траектории az/el | Worker `CALCULATE_AR_TRAJECTORIES`, ~120 точек, период ~1,3 с |
| Линии орбит | WebGL `LINE_STRIP` + свечение в шейдере; fallback Canvas2D |
| Маркеры / текст | Canvas2D, `drawSatelliteIcon`, палитра как на карте |
| Звуковой прицел | `computeAimingAngularErrorDeg` + `updateAudioPitch`; та же матрица и соглашения, что у маркера |
| Режимы | overview / focus — только UI и фильтрация отрисовки |

---

## 7. МОДУЛЬ 4 — Новости: доска объявлений + чат (реализовано)

> Полное техническое описание модуля (архитектура, B2 API, форматы данных, расчёт стоимости, CORS, Lifecycle Rules) — в файле **`MODUL4_PROJECT_CONTEXT.md`**.

### 7.1 Назначение и файлы

Модуль 4 «Новости» — четвёртый экран SPA. Состоит из двух сворачиваемых секций: доска объявлений администратора и чат-лента сообщений.

- **news.js** — вся логика модуля: доска, чат, авторизация по позывному + паролю (хеш из `callsign:password`), визуальная идентификация (hashToColor, blockies-аватарки), CRUD сообщений, ответы с цитированием, личные сообщения (DM), фильтры («Все»/«Ответы мне»/«Личные»), двухрежимный поллинг (инкрементальный 30 сек + полный при re-open/visibility), S3-пагинация (до 10 000 файлов), автосворачивание чата по неактивности (5 мин), сжатие изображений, ленивая загрузка секций, детекция обновлений доски.
- **lib/aws4fetch.min.js** — IIFE-сборка библиотеки aws4fetch (AWS Signature V4 для S3-совместимого API Backblaze B2 из браузера).
- **data/board.html** — HTML-фрагмент доски объявлений, редактируемый админом через web-интерфейс GitHub.com.
- **data/board-media/** — медиафайлы доски (загружаются админом через GitHub).
- **index.html** — `<div id="newsView">` с заголовком, доской, лентой чата, модалками авторизации/редактирования, панелью ввода.
- **app.js** — `openNewsView()` / `closeNewsView()`, кнопка входа — `#newsBtn` (кнопка «НОВОСТИ» в шапке Модуля 1).

### 7.2 Архитектура данных

| Компонент | Хранение | Доступ |
|-----------|----------|--------|
| Доска объявлений | GitHub Pages (`data/board.html`, `data/board-media/`) | Обычный fetch, без авторизации |
| Чат — сообщения | Backblaze B2, бакет `satcontact-chat`, prefix `messages/` | Чтение: публичный URL; листинг/запись/удаление: S3 API через aws4fetch |
| Чат — медиа | Backblaze B2, prefix `media/` | Чтение: публичный URL; запись: S3 API |

Каждое сообщение — отдельный JSON-файл. Публичные: `{timestamp}-{author_hash}-msg.json`, личные (DM): `{timestamp}-{author_hash}-dm.json`. Медиафайлы — отдельные бинарные объекты `{timestamp}-{author_hash}-{filename}.{ext}`. Автоочистка: Backblaze B2 Lifecycle Rules (3 дня → hide, 4 дня → delete).

**JSON-структура сообщения (v1):**
```json
{
  "v": 1,
  "author": "UA9XXX",
  "author_hash": "a1b2c3d4",
  "text": "текст",
  "media": [],
  "attachments": [],
  "ts": 1711234567890,
  "edited_at": null,
  "reply_to": null,
  "private": null
}
```

- `reply_to` — `null` (обычное) или `{ hash, author, text, filename }` (ответ с цитатой). `text` обрезается до 25 символов при создании.
- `private` — `null` (публичное) или `{ to_hash, to_author }` (личное сообщение). Только у файлов с суффиксом `-dm.json`.
- Обратная совместимость: старые сообщения без `reply_to`/`private` обрабатываются как `null`.

### 7.3 Идентификация пользователя

При первом входе пользователь вводит позывной (до 12 символов) и пароль (минимум 8 символов). Хеш (SHA-256, первые 8 hex-символов) вычисляется из строки `callsign + ':' + password` через SubtleCrypto. В localStorage сохраняются только позывной и хеш — пароль не хранится. Проверка авторства: `msg.author_hash === localUserHash`. Свои сообщения отображаются с другим фоном и кнопками редактирования/удаления.

**Визуальная идентификация:**
- **Цвет имени** — `hashToColor(hash)`: HSL из хеша (H 0-360°, S 40-80%, L 55-75%), оптимизирован под тёмный фон (`--bg-card: #212d3b`). Задаётся inline-стилем в `createMessageElement`.
- **Blockies-аватарка** — `createBlockie(hash, size)`: детерминистичный identicon (xorshift PRNG из hex-хеша, 3 цвета, симметричная 8×8 матрица, offscreen canvas → data-URL). Результат кешируется в `blockieCache` по ключу hash. Отображается как `<img class="news-msg__avatar">` 24×24px слева от имени.

**Валидация (клиентская):** позывной — непустой после trim, ≤12 символов; пароль — ≥8 символов. Ошибки отображаются в `#newsAuthError`.

### 7.4 SPA-переход и кнопка «НОВОСТИ»

Идентичен модулям 2 и 3: `openNewsView()` скрывает header + main, показывает `#newsView`, вызывает `window.initNews()`. `closeNewsView()` — обратный переход, вызывает `window.cleanupNews()`.

**Точка входа:** кнопка `#newsBtn` («НОВОСТИ») в шапке Модуля 1 (`.header__top`). Стили: приглушённый полупрозрачный фон (`.btn--news`). При обнаружении обновлений `board.html` — переливающаяся анимация жёлтый/зелёный/оранжевый (`.btn--news-updated`, `@keyframes newsShimmer`). Шиммер снимается при просмотре доски (`loadBoard()`).

### 7.5 Сворачиваемые секции и ленивая загрузка

Обе секции (доска и чат) — сворачиваемые вкладки с кнопками-тогглами.

**При входе в Модуль 4:**
- Доска: состояние из localStorage (`satcontact_board_collapsed`), по умолчанию свёрнута.
- Чат: **всегда свёрнут**, состояние не сохраняется.
- Содержимое загружается **только при первом разворачивании** секции.

**Ленивая загрузка:**
- Доска: `loadBoard()` вызывается при первом развороте (cache-first: показ из localStorage → обновление по сети).
- Чат: `fetchAndRenderFeed()` вызывается при первом развороте. Поллинг стартует при развороте, останавливается при сворачивании.
- Повторный разворот чата: `checkForNewMessagesFull()` (полный листинг — ловит удаления) + `startPolling()` + `resetInactivityTimer()`.
- При сворачивании чата: `stopPolling()` + `stopInactivityTimer()`.
- Панель ввода (`#newsInputBar`), панель фильтров (`#chatFilters`) и превью ответа (`#newsReplyPreview`) скрыты при свёрнутом чате. Панель фильтров также скрыта для неавторизованных пользователей.

**Автосворачивание по неактивности (5 минут):**
- При развороте чата запускается таймер `INACTIVITY_TIMEOUT` (300 000 мс = 5 мин).
- Любое взаимодействие пользователя (scroll, click, touchstart, keydown в области чата, input в поле ввода) сбрасывает таймер.
- По истечении таймера — `collapseByInactivity()` → `toggleChat()` → чат сворачивается, поллинг останавливается.
- Возврат на вкладку (Visibility API) также сбрасывает таймер.

### 7.6 Детекция обновлений доски

`checkBoardForUpdates()` — фоновый fetch `board.html` (cache: no-cache), сравнение с localStorage-кешем. При обнаружении различий — класс `btn--news-updated` на `#newsBtn`.

**TODO [PWA]:** при реализации Service Worker перенести детекцию в SW (Background Sync или периодический fetch → postMessage в клиент).

### 7.7 Кеширование

| Что | Где | TTL |
|-----|-----|-----|
| Листинг файлов (ListObjectsV2): `{ ts, files, dmFiles, lastKey }` | sessionStorage | 30 сек |
| HTML доски (board.html) | localStorage | До следующего просмотра доски |
| JSON сообщений | HTTP cache браузера | 120 сек (Cache-Control) |
| Медиафайлы | HTTP cache браузера | 3600 сек (Cache-Control) |
| Позывной + хеш | localStorage | Бессрочно |
| Blockies data-URL | RAM (`blockieCache`) | До перезагрузки страницы |
| Состояние доски (свёрнута/развёрнута) | localStorage | Бессрочно |

Кеш листинга расширен полем `lastKey` — лексикографически максимальный ключ из последнего листинга. Используется для инкрементального поллинга (`start-after` в S3 API).

### 7.8 Поллинг (двухрежимный)

**Инкрементальный поллинг** (`checkForNewMessages`, каждые 30 сек):
- Запрос: `start-after=lastListedKey`, `max-keys=100` — только новые файлы после последнего известного ключа.
- Только добавляет новые сообщения, **не детектит удаления** (экономия трафика).
- Вызывается из `setInterval` в `startPolling()`.

**Полный листинг** (`checkForNewMessagesFull`):
- Запрос: пагинация через `continuation-token`, до 10 страниц по 1000 ключей (до 10 000 файлов).
- Детектит и добавления, и удаления (сравнение Set-ов).
- Вызывается при: повторном развороте чата (`toggleChat`), возврате на вкладку (`onVisibilityChange`), ручном refresh (`#newsRefresh`).

**S3-пагинация** (`fetchFileList`):
- Параметр `incremental` (boolean) выбирает режим.
- Полный режим: цикл `while (isTruncated)` с `continuation-token` (парсинг `IsTruncated` и `NextContinuationToken` через `parseS3ListXmlMeta`).
- Инкрементальный режим: один запрос `start-after=lastListedKey`, `max-keys=100`. Результат дописывается к `allFileNames`/`allDmFiles`.
- `lastListedKey` обновляется лексикографически максимальным ключом из ответа.

**Управление поллингом:**
- Только при развёрнутом чате. При скрытой вкладке — пропуск итерации (Visibility API).
- При сворачивании чата → `stopPolling()` + `stopInactivityTimer()`.
- При развороте → `startPolling()` + `resetInactivityTimer()`.
- Автосворачивание по неактивности (5 мин) → `toggleChat()` → остановка поллинга.

**Константы:** `POLL_INTERVAL = 30000` (30 сек), `LISTING_CACHE_TTL = 30000` (30 сек), `INACTIVITY_TIMEOUT = 300000` (5 мин).

### 7.9 Фильтры, ответы с цитированием, личные сообщения

**Панель фильтров** (`#chatFilters`) — три кнопки-переключателя внутри `#chatContent`, перед `#chatLoader`:
- **«Все»** (`activeFilter = 'all'`) — публичные сообщения (без `private`). По умолчанию.
- **«Ответы мне»** (`activeFilter = 'replies'`) — публичные сообщения с `reply_to.hash === userHash` + оригинальные сообщения, на которые ответили. При первом нажатии — дозагрузка всех публичных файлов (`ensureAllMessagesLoaded`).
- **«Личные»** (`activeFilter = 'dm'`) — DM-сообщения, принадлежащие текущему пользователю (`author_hash === userHash || private.to_hash === userHash`). При первом нажатии — дозагрузка всех `-dm.json` файлов (`ensureAllDmsLoaded`).

**Ответ с цитированием:**
- Кнопка ↩️ (`.news-msg__reply-btn`) на каждом сообщении при авторизации. Устанавливает `pendingReply` с `isDm: false`.
- Превью ответа (`#newsReplyPreview`) — тонкая полоска над `#newsInputBar` с именем автора (в цвете хеша), первыми 25 символами цитаты, кнопкой отмены (✕).
- При отправке — `reply_to` записывается в JSON сообщения, `pendingReply` очищается.
- В ленте — блок цитаты (`.news-msg__quote`) с цветной левой границей (hashToColor автора цитаты), именем и текстом.

**Личные сообщения:**
- Кнопка 🔒 (`.news-msg__dm-btn`) на чужих сообщениях. Устанавливает `pendingReply` с `isDm: true`.
- Превью ответа показывает badge «ЛИЧНОЕ» (`.news-view__reply-preview-badge`).
- При отправке — файл получает суффикс `-dm.json`, в JSON записывается `private: { to_hash, to_author }`.
- Приватность косметическая (UI-фильтрация, без шифрования).
- В фильтре «Личные» без `pendingReply` — отправка заблокирована, placeholder указывает нажать 🔒 для выбора адресата.

**Переменные состояния (news.js):** `pendingReply`, `activeFilter`, `allDmFiles`, `loadedDmMessages`, `allMessagesLoaded`, `allDmsLoaded`, `inactivityTimer`, `lastListedKey`.

**Ключевые функции (news.js):** `getFilteredMessages()`, `getEmptyMessage()`, `ensureAllMessagesLoaded()`, `ensureAllDmsLoaded()`, `setFilter()`, `setPendingReply()`, `sortByTimestamp()`, `checkForNewMessages()` (инкрементальная), `checkForNewMessagesFull()` (полная), `parseS3ListXmlMeta()`, `resetInactivityTimer()`, `stopInactivityTimer()`, `collapseByInactivity()`.

### 7.10 Публичный API

- `window.initNews()` — инициализация модуля (вызывается из `openNewsView` в app.js).
- `window.cleanupNews()` — очистка (вызывается из `closeNewsView`).
- `window.checkBoardForUpdates()` — фоновая проверка обновлений доски (вызывается в `app.js` при загрузке).
- `window.closeNewsView` — экспорт для кнопки «Назад» в news.js.

---

## 8. ЧТО НЕ РЕАЛИЗОВАНО (следующие этапы)

- **PWA:** manifest.json, Service Worker, Cache Storage, IndexedDB.
- **TODO [PWA]:** перенести `checkBoardForUpdates()` из клиентского fetch в Service Worker для фоновой детекции обновлений доски объявлений.

---

## 9. ИСТОРИЯ СЕССИЙ (для контекста при продолжении)

### Модуль 1
Каркас → группы, фильтры, поиск по частоте → редизайн шапки (тумблеры, чипсы) → мобильные фиксы (overscroll, forceBlur, chip--blurred) → брендинг SatContact, карточка 4 зоны, множественные NORAD ID.

### Модуль 2 (до сессии карты)
GitHub Actions (TLE) → UI карты, GPS, HUD → tle.js + satellite.js → lib/ (офлайн) → D3-картография. topojson API — поддержка `topojson.feature` и `topojsonClient`.

### Сессия: Карта день/ночь, терминатор, огни городов

1. **Добавлена линия терминатора и ночная тень** — getSubsolarPoint/getAntisolarPoint по UTC, d3.geoCircle для ночного полушария, дневные цвета (#5b9bd5 океан, #e8e0d0 суша).

2. **Полная переработка map-render.js** — MAJOR_CITIES (75 городов), иерархия слоёв, radialGradient city-glow, initCityLights/updateCityLights, разделение fastLoop (1 с) и slowLoop (60 с). Дневные цвета: #6b9bc2 океан, #c6dbe8 суша.

3. **Плавный терминатор (4 накладывающихся geo-круга)** — радиусы 90°, 84°, 78°, 72° с разной opacity для градиента сумерек. **ОТМЕНЕНО** по запросу пользователя.

4. **Восстановлена линия терминатора без плавного перехода** — один путь ночной тени (d3.geoCircle 90° от антипода) + линия границы (stroke). layerBordersNight для контуров в тёмной зоне.

5. **Осветление ночной стороны** — ночная тень была #1c242d (полностью чёрная). Заменено на rgba(28,36,45,0.55) — полупрозрачная заливка, чтобы синева океана и суша оставались различимы.

### Сессия: Оптимизация карты, Canvas, Worker, интерактивность

**Этап 1: Кэширование орбит (map-render.js)**
- Устранено узкое место: getTrajectory24h вызывался каждую секунду для каждого спутника.
- Добавлены cachedTrajectories (Map), lastNoradIds. noradIdsEqual() для сравнения.
- Орбиты пересчитываются и перерисовываются только при noradIdsChanged. При неизменном списке layerOrbits не трогается.
- onResize: обновление path орбит при смене проекции.

**Этап 2: Миграция SVG → Canvas (map-render.js)**
- Замена SVG на HTML5 Canvas. High-DPI: devicePixelRatio, ctx.scale(dpr, dpr).
- path = d3.geoPath().projection(projection).context(ctx).
- Разделение данных и рендера: fastLoop/slowLoop обновляют состояние, вызывают renderFrame().
- renderFrame(): Painter's algorithm — океан, суша, границы, тень, терминатор, огни городов, орбиты, footprints, маркеры.

**Этап 3: Path2D для производительности**
- path без context — возвращает SVG-строки. Path2D(path(geo)) для кэша.
- cachedLandPath2D, cachedTerminatorShadowPath2D, cachedTerminatorLinePath2D.
- cachedOrbitGeos — массив Path2D. activeSatellites[].footprintPath2D.
- В renderFrame() — только ctx.fill(p), ctx.stroke(p), без path() и beginPath().

**Этап 4: Зум и панорамирование**
- d3.zoom(), scaleExtent [1, 8]. currentTransform.
- ctx.save/translate/scale в начале renderFrame, ctx.restore в конце.
- lineWidth и радиусы arc делятся на currentTransform.k.
- style.css: touch-action: none на .map-view__canvas.

**Этап 5: Предрасчёт для renderFrame**
- onResize: city.baseXY = projection([city.lon, city.lat]).
- slowLoop: city.isNight = geoDist(...) > π/2.
- fastLoop: observerBaseXY, sat.baseXY. В renderFrame() нет projection() и geoDist().

**Этап 6: Web Worker (tle-worker.js, tle.js)**
- tle-worker.js: importScripts('./lib/satellite.min.js'), parseTle, getTrajectory24h.
- INIT_TLE — парсинг TLE, сохранение в tleCache.
- CALCULATE_TRAJECTORIES — расчёт траекторий для noradIds, postMessage TRAJECTORIES_READY.
- tle.js: worker = new Worker(url), loadTle → worker.postMessage(INIT_TLE).
- requestTrajectories(noradIds) — Promise. При ошибке Worker — getTrajectory24hSync().
- map-render: при noradIdsChanged — requestTrajectories().then() → Path2D → cachedOrbitGeos → renderFrame().

**Этап 7: Интерактивность (орбиты для всех, клики по footprint)**
- focusedNoradIds = new Set(). Убрано ограничение !isAllMode — орбиты для всех спутников.
- Footprint по умолчанию скрыт. showFootprint = focusedNoradIds.has(noradId).
- activeSatellites: noradId, baseXY, footprintPath2D (только при showFootprint), markerRadius (5 или 6).
- onCanvasClick: hit-test 20px, currentTransform.apply(sat.baseXY). Toggle focusedNoradIds. Клик в пустоту — clear.
- isDragging — только при изменении transform (zoom/pan), не при tap. d3.pointer(event, canvas.node()).

**Этап 8: Исправления для GitHub Pages и мобильных**
- resolveUrl(relativePath) — абсолютные URL для fetch. base = path.endsWith('/') ? path : path + '/'.
- index.html: <base href="/satcontact/">. Для локальной разработки — закомментировать.
- tle.js: абсолютные URL для fetch и Worker. try-catch при создании Worker.
- Path2D: try-catch, проверка typeof Path2D !== 'undefined'.
- Логирование ошибок загрузки карты.

### Сессия: Стабилизация карты на десктопе (март 2026)

**Проблемы, найденные в сессии:**
- На десктопе появлялся «обрыв»/тёмная полоса в верхней части карты.
- Клик по спутнику мог не срабатывать (обработчик был повешен через `d3.zoom().on('click', ...)`).
- Орбиты «ломались» при пересечении 180-го меридиана (прыжок долготы +180/-180).
- При сбое Worker требовался гарантированный fallback без потери орбит.

**Финальные правки (актуальное состояние кода):**
1. **Клики по спутникам**
   - В `map-render.js` обработчик клика привязан к `canvas`:
     - `d3.select(canvas.node()).call(zoomBehavior).on('click', onCanvasClick)`
   - `d3.zoom()` оставлен только для события `zoom`.

2. **Устойчивый рендер без «синего/тёмного разрыва»**
   - Ручной `clipExtent(...)` в проекции `geoMercator` удалён (и в `initD3Map`, и в `onResize`).
   - Заливка океана перенесена в экранные координаты (до `ctx.save()/translate()/scale()`):
     - `ctx.fillRect(0, 0, width, height)`
   - Это гарантирует полный фон viewport при любом pan/zoom.

3. **Орбиты как сегменты (anti-meridian-safe)**
   - `tle-worker.js:getTrajectory24h()` теперь возвращает **массив сегментов**:
     - разбиение траектории при `Math.abs(lon - lastLon) > 180`.
   - `tle.js:getTrajectory24hSync()` (fallback) реализован аналогично, тоже с сегментами.
   - В `map-render.js` орбиты строятся как `MultiLineString`:
     - `path({ type: 'MultiLineString', coordinates: segments })`.

4. **Надёжный fallback при ошибке Worker**
   - В `tle.js` добавлен `worker.onerror`:
     - лог ошибки + `worker = null`.
   - После этого `requestTrajectories()` автоматически считает орбиты синхронно (`getTrajectory24hSync`).

5. **GitHub Pages / base path**
   - В `index.html` активирован `<base href="/satcontact/">` для продакшн-хостинга на GitHub Pages.
   - В комментарии указано: для локальной разработки base при необходимости комментировать.

**Итог поведения после сессии:**
- На десктопе корректно отображаются треки всех выбранных спутников.
- Клик по спутнику стабильно включает/выключает footprint.
- Орбиты не «простреливают» через всю карту при переходе через 180°.
- При проблемах с Worker модуль карты остаётся рабочим за счёт sync-fallback.

### Сессия: Footprint, иконки спутников, названия, орбиты, контуры (март 2026)

**1. Исправление формулы зоны покрытия (footprint)**
- **Проблема:** зона покрытия отображалась ~2.7× больше реальной.
- **Причина:** использовался `arcsin(R/(R+h))` — угол θ от спутника к горизонту. Для d3.geoCircle нужен угол β на поверхности Земли (от надира до горизонта).
- **Формула:** β = arccos(R/(R+h)). Связь: θ + β = 90°.
- **Файл:** map-render.js, `footprintRadiusDeg()` — заменён Math.asin на Math.acos.

**2. Цвет зоны покрытия**
- Было: rgba(82, 136, 193, 0.15) (синий).
- Стало: rgba(154, 205, 50, 0.15) (жёлто-зелёный).

**3. Разные цвета орбит и маркеров**
- ORBIT_PALETTE — 10 цветов (синий, оранжевый, зелёный, фиолетовый, красный, бирюзовый, жёлтый, тёмно-красный, голубой, пурпурный).
- cachedOrbitGeos: массив { path, color } где color = { orbit, marker }.
- Каждый спутник получает цвет по индексу. Маркер и обводка footprint — того же цвета, что орбита.

**4. Названия спутников**
- **map.js:** currentNoradIdToName, getMapNoradIdToName(). initMap({ noradIds, satelliteName, noradIdToName }).
- **app.js:** openMapView(noradIds, satelliteName, noradIdToName). При «ВСЕ» — noradIdToName из filteredEntries.
- **Отображение:** только при клике по спутнику, вместе с footprint (одно событие — toggle обоих).

**5. Иконка спутника вместо кружков**
- `drawSatelliteIcon(ctx, x, y, size, fillColor, strokeColor)` — рисует в коде:
  - Корпус (прямоугольник)
  - Солнечные панели (крылья, слева и справа)
  - Параболическая антенна (вниз, к Земле)
  - Сопло Лаваля (вверх, от Земли)
- Размер: 21px (в фокусе) / 18px (обычно), масштабируется с зумом (/k).
- Hit area: 24px.

**6. Название — фиксированный размер, экранные координаты**
- Название рисуется **после** ctx.restore(), вне zoom-трансформации.
- labelsToDraw: массив { text, x, y }. Позиция: currentTransform.apply([x, y]) для экранных координат.
- Шрифт: 12px sans-serif — постоянный размер на экране при любом зуме.

**7. Контуры стран — чётче**
- dayBorder: rgba(0,0,0,0.1) → 0.25, lineWidth 0.5 → 1.
- nightBorder: rgba(255,255,255,0.12) → 0.25, lineWidth 0.5 → 1.

**Актуальная структура activeSatellites:**
- noradId, pos, baseXY, footprintPath2D, markerRadius, name, orbitColor.

### Сессия: Умная кнопка «ВСЕ» + Лента частот на карте + desktop-fixes (март 2026)

**Цель сессии:**
- Связать Canvas-модуль карты (`map-render.js`) с UI (`app.js`) через событие фокуса.
- Добавить выезжающую снизу ленту частот для режима карты.
- Переделать логику `#mapShowAll` в «умный» тумблер, завязанный на текущее состояние карты.

**1. Умная кнопка `ВСЕ` (перенос управления в `map.js`)**
- В `map.js:initMap(options)` добавлено сохранение `initialNoradIds` (массив ID, с которыми карта открыта изначально).
- В `map.js` управление `#mapShowAll` перенесено из `app.js`:
  - Кнопка переключает класс `.active` и `aria-pressed`.
  - При **включении**:
    - берутся `filteredEntries` из `app.js` через `window.getSatContactFilteredEntries()`,
    - собираются уникальные `noradIds`,
    - обновляются `currentNoradIds` и `currentNoradIdToName`,
    - вызывается `window.SatContactMapRender.update()`.
  - При **выключении**:
    - берётся выделение через `window.SatContactMapRender.getFocusedNoradIds()`,
    - если есть фокус: карта остаётся на этих ID,
    - если фокуса нет: откат к `initialNoradIds`.
- В `cleanupMap()` состояние тумблера сбрасывается.

**2. Событие фокуса карты (`map-render.js`)**
- Добавлено `window.SatContactMapRender.getFocusedNoradIds()` (возвращает `Array.from(focusedNoradIds)`).
- В `onCanvasClick` после изменения `focusedNoradIds` отправляется:
  - `window.dispatchEvent(new CustomEvent('satcontact:map-focus', { detail: { focusedIds } }))`.
- Дополнительно событие отправляется при смене набора `noradIds` (когда фокус очищается), чтобы UI ленты синхронно скрывался.

**3. Разметка и стили ленты (`index.html`, `style.css`)**
- В `index.html` добавлен контейнер:
  - `<div id="mapFreqRibbon" class="map-view__freq-ribbon"></div>` перед `#mapHud`.
- В `style.css` добавлены блоки:
  - `.map-view__freq-ribbon` + `.map-view__freq-ribbon--visible` (анимация выезда через `transform`),
  - `.ribbon-scroll` (горизонтальный scroll + `scroll-snap-type: x mandatory`, скрытый scrollbar),
  - `.ribbon-card` (`flex: 0 0 85%`, card-style),
  - `.ribbon-card__content` (layout `RX | BW | TX`),
  - Цвета TX по статусам (`status-sens`, `status-med`, `status-dull`), RX всегда `var(--accent)`.

**4. Рендер ленты в `app.js`**
- Добавлен слушатель `window.addEventListener('satcontact:map-focus', ...)`.
- Логика:
  - `focusedIds.length === 1`: рендер карточек по всем `allEntries`, где `noradIds` содержит выбранный ID.
  - `focusedIds.length === 0` или `> 1`: скрытие ленты с анимацией, очистка HTML через 300ms.
- При `openMapView()`/`closeMapView()` лента принудительно скрывается.

**5. Дополнительные правки после теста**
- Поменян порядок цифр в карточке ленты:
  - теперь `Downlink (RX)` слева, `Bandwidth` по центру, `Uplink (TX)` справа.
- Добавлена защита от edge-swipe Android в ленте карты:
  - `touchstart/touchmove` + `preventDefault()` на краях горизонтального скролла (аналог решения для чип-лент на главной).
- Для десктопа добавлен рабочий скролл ленты:
  - `wheel` (поддержка `deltaX`/`deltaY`),
  - drag-scroll ЛКМ (`mousedown/mousemove/mouseup/mouseleave`),
  - клик по карточке центрирует её (`scrollIntoView(... inline: 'center')`),
  - курсор `grab/grabbing`.
- Исправлено налезание ленты на строку координат HUD на десктопе:
  - в `app.js` добавлен `updateRibbonBottomOffset()`,
  - `bottom` ленты вычисляется динамически относительно позиции `#mapHud`,
  - пересчёт выполняется при показе ленты и при `window.resize`.

**6. Рефакторинг/очистка**
- Удалён старый обработчик `#mapShowAll` из `app.js` (источник истины теперь `map.js`).
- Удалены неиспользуемые хвосты в `app.js`:
  - неиспользуемые DOM-переменные (`mapShowAll`, `mapCanvas`, `mapHud` — оставлен только реально используемый набор),
  - неиспользуемый экспорт `window.getSatContactAllEntries`.
- Оставлен и используется экспорт `window.getSatContactFilteredEntries`.

**Итог поведения после сессии:**
- Карта и UI связаны событием `satcontact:map-focus`.
- При одиночном выборе спутника показывается выезжающая лента частот с snap-прокруткой.
- Кнопка `ВСЕ` работает как тумблер контекста (все из фильтра / фокус / исходный набор).
- На мобильном блокируется опасный edge-swipe при скролле ленты.
- На десктопе лента прокручивается колёсиком и перетаскиванием мышью; карточки центрируются кликом.

### Сессия: Геолокация fallback + ручные координаты + HUD (март 2026)

**Цель сессии:**
- Устранить «вечную загрузку орбит» при нажатии `↻`.
- Сделать устойчивую геолокацию на десктопе/мобилке без GPS (через IP fallback).
- Добавить приоритетный ручной override координат для стационарной станции.

**1. Исправление ручного refresh (`↻`)**
- Убрано повторное включение полноэкранного loading-overlay при ручном обновлении.
- `setLoadingStatus()` переведён на `??`, чтобы пустые строки не подставляли дефолт обратно.
- Добавлен короткий фидбек в HUD (успех/предупреждение), автоскрытие через таймер.

**2. Источники геолокации и приоритеты**
- Введена явная модель источников: `manual` > `gps` > `network` > `cache`.
- Добавлен бейдж источника в HUD: `РУЧН` / `GPS` / `СЕТЬ` / `НЕТ GPS`.
- Порог точного GPS снижен до 100 м, чтобы coarse-координаты на ПК не считались «настоящим GPS».

**3. IP fallback и отказоустойчивость**
- `requestIpLocation()` реализован с каскадом API:
  - primary: `ipwhois.app`
  - secondary: `geolocation-db.com` (рабочий CORS в браузере)
- При ошибках API теперь есть `console.warn('IP Location error:', e)` (без тихого подавления).
- При недоступности IP API в UI явно показывается состояние «API недоступно, загружен кэш».

**4. Ручной ввод координат (manual override)**
- В HUD добавлены `mapManualCoordsInput` и `mapManualCoordsToggle`.
- Поддерживаемый формат: `53.28024034333129, 63.24983460394551` и краткий `53 , 63`.
- При включённой галочке:
  - поле блокируется от редактирования (`readonly`),
  - карта/HUD работают от ручной точки,
  - auto-обновления только обновляют `autoObserver`, но не перехватывают активную позицию.
- При выключении галочки — возврат на auto-источник (GPS/IP/cache).
- Состояние ручного режима хранится в `satcontact_manual_observer`.

**5. UI/HUD правки**
- Элевация вынесена из нижней панели в плавающий блок в левом верхнем углу карты (`map-view__elevation-float`) — чтобы на мобильном «За горизонтом» не налезал на элементы HUD.
- Лента частот на карте: RX/TX сделаны визуально ярче/контрастнее для читаемости.
- Чекбокс «Применить» для manual override приглушён под тёмную тему (не режет глаз).

**Итог поведения после сессии:**
- Десктоп без GPS корректно показывает координаты провайдера (IP fallback) вместо старого «Лондона».
- Мобилка без GPS использует IP fallback; при включении аппаратного GPS автоматически возвращается к GPS-координатам.
- Ручные координаты работают как явный override с высшим приоритетом.

### Сессия: Синхронизация HUD телеметрии с кликом по спутнику (март 2026)

**Цель сессии:**
- Исправить баг: клик по иконке спутника корректно показывал footprint/название, но панели телеметрии (азимут/элевация/дистанция) продолжали показывать данные «базового» спутника, с которым карта была открыта.
- Согласовать поведение HUD с текущим фокусом карты, включая повторный клик и мультивыбор.

**1. Причина бага (выявлено в коде)**
- В `map.js:updateHudTelem()` телеметрия всегда бралась из `currentNoradIds[0]`.
- Состояние кликов хранилось отдельно в `map-render.js` (`focusedNoradIds`) и наружу шло только событием `satcontact:map-focus`.
- Из-за этого HUD не был связан с фокусом, хотя footprint и подписи уже были связаны.

**2. Связка HUD с событием фокуса (`map.js`)**
- Добавлены состояния:
  - `focusedNoradIds` — текущий фокус из события карты,
  - `hudTelemetryNoradId` — ID спутника, по которому сейчас считает HUD,
  - `lastSingleFocusedNoradId` — последний одиночно выбранный спутник,
  - `mapFocusListener` — ссылка на обработчик для корректного removeEventListener.
- Добавлены функции:
  - `bindMapFocusTelemetry()` / `unbindMapFocusTelemetry()` — подписка/отписка на `satcontact:map-focus`,
  - `onMapFocusChange(evt)` — нормализация `focusedIds`, выбор целевого спутника HUD, немедленный `updateHudTelem()`,
  - `resolveTelemetryNoradId()` — выбор источника телеметрии по правилам фокуса.
- Подписка выполняется в `initMap()`, отписка и сброс состояния — в `cleanupMap()`.

**3. Новая логика отображения телеметрии**
- **Одиночный фокус (`focusedIds.length === 1`)**:
  - HUD сразу переключается на кликнутый спутник;
  - ID сохраняется как `lastSingleFocusedNoradId`.
- **Снятие фокуса (`focusedIds.length === 0`)**:
  - если есть валидный `lastSingleFocusedNoradId` в текущем наборе — HUD продолжает показывать его;
  - иначе fallback на первый ID из текущего набора `currentNoradIds`.
- **Мультивыбор (`focusedIds.length > 1`)**:
  - в поля HUD выводятся заглушки:
    - азимут: `---`
    - элевация: `---`
    - дистанция: `----`
- При смене набора спутников (`applyNoradSelection`) невалидные ссылки на прошлый фокус/последний выбор автоматически очищаются.

**4. Рефакторинг текстов HUD в константы (`map.js`)**
- Централизованы строковые литералы, чтобы менять UI-тексты из одного места:
  - `TELEMETRY_EMPTY_PLACEHOLDER`,
  - `TELEMETRY_MULTI_AZ_EL_PLACEHOLDER`,
  - `TELEMETRY_MULTI_DISTANCE_PLACEHOLDER`,
  - `GPS_SOURCE_BADGE_LABELS`,
  - `HUD_LOADING_TEXT`,
  - `HUD_REFRESH_FEEDBACK_TEXT`.
- Логика и UX не менялись; изменена только организация кода/конфигурируемость текстов.

**5. Проверки после изменений**
- `ReadLints` по `map.js`: ошибок не выявлено.
- Синтаксическая проверка `map.js` через `node -e new Function(...)`: `parse ok`.

**Итог поведения после сессии:**
- HUD телеметрии теперь синхронен с тем же событием клика, что и footprint/название спутника.
- Повторный клик (снятие фокуса) сохраняет телеметрию последнего одиночно выбранного спутника.
- При выборе нескольких спутников HUD показывает режим «неоднозначного выбора» через `---/----`.
- Тексты HUD собраны в константах в начале `map.js` для безопасной поддержки в следующих сессиях.

### Модуль 3 — AR-трекер (март 2026)

- Первая версия: **ar.js** + **ar-render.js**, `#arView` в **index.html**, интеграция в **app.js** (`openArView` / «НАВЕСТИСЬ»), палитра и иконки как на карте, только аппаратный GPS, машина состояний overview/focus.
- Эволюция рендера: единый **Real 3D** — орбиты в **WebGL**, маркеры/текст на **Canvas2D**; траектории az/el в **Worker** (`CALCULATE_AR_TRAJECTORIES` / `requestArTrajectories`), интерполяция позиций ~30 FPS, второй canvas `#arCanvasGL`. Подробности — в **разделе 6** выше.

### Сессия: AR — единый пайплайн звукового прицела (март 2026)

**Проблема:** маркеры спутников строились через **`orientationMatrix`**, **`projectReal3D()`** и WebGL-шейдер, а звуковой прицел в **focus** использовал отдельную модель **`getCameraAzEl()`** (комбинация `alpha`/`beta`, иная свёртка калибровки и `compassCalibrationDelta`), из‑за чего тон минимальной частоты (20 Гц при «нулевой» ошибке по той формуле) не совпадал с визуальным положением иконки.

**Изменения в коде:**
1. **ar-render.js** — функция **`computeAimingAngularErrorDeg(satAz, satEl, orientationMatrix)`**: угол между направлением на спутник и оптической осью камеры; те же world-вектор (az/el) и соглашения, что в **`projectReal3D`** и вершинном шейдере. Экспорт: **`SatContactArRender.computeAimingAngularErrorDeg`**.
2. **ar.js** — в цикле рендера (**`renderLoop`**, режим focus) **`updateAudioPitch`** получает результат **`computeAimingAngularErrorDeg`** для спутника в фокусе и текущей **`orientationMatrix`** (те же **`focSat.azimuth`/`elevation`**, что и для отрисовки). Функция **`getCameraAzEl`** удалена; с **`window.SatContactAr`** снят экспорт **`getCameraAzEl`**.

**Итог:** звук и отрисовка маркера используют одну матрицу ориентации и один геометрический смысл «наведения»; калибровка по Солнцу/Луне/Полярной по-прежнему влияет на **`computeOrientationMatrix`** через **`refreshOrientationMatrix()`** (из **`onOrientation`**), без дублирования логики для аудио.

### Сессия: Исправление матрицы ориентации и проекции AR (март 2026)

**Проблема:** спутники отображались в неправильных позициях (~180° от реальных); при повороте телефона маркеры двигались в противоположном направлении. В инерциальном режиме дополнительно наблюдался ложный дрейф наклона.

**Причина 1 (критическая): транспозиция матрицы ориентации.**
`computeOrientationMatrix` хранила R (device→world) row-major, но `projectReal3D`, WebGL-шейдер и `computeAimingAngularErrorDeg` умножали `m[row]·v`, что давало `(R · v_world)` вместо необходимого `(R^T · v_world)`. Результат: спутник на Севере при камере, направленной на Север, проецировался за камеру (cz < 0). По центру экрана вместо него появлялся спутник с Юга.

**Причина 2 (средняя): перепутанные beta/gamma в `tiltDegreesFromAccel`.**
Формула beta использовала `−ax` (ось gamma), а gamma — `ay/az` (ось beta). Акселерометрическая коррекция (`ACCEL_TILT_BLEND = 0.08`) медленно тянула наклон к неправильным значениям в инерциальном режиме.

**Что на тот момент считалось корректным разделением режимов** (после heading-based миграции формулировки уточнены под актуальный код):
- `refreshOrientationMatrix`: магнитный → `sensorState.alpha − calibrationDelta − magneticDeclination`; инерциальный → `alpha = headingToAlpha((inertialHeading − calibrationDelta) mod 360, β, γ)` (см. **ar.js**).
- `performCalibration`: магнитный — `calibrationDelta` из `truePos.azimuth` и `sensorAz`; инерциальный — `calibrationDelta = inertialHeading − truePos.azimuth` (нормализация ±180°).
- `onCompassToggleClick`: сброс калибровки, при включении инерциального режима — `inertialHeading = alphaToHeading(...)`, пауза до рекалибровки.
- `onDeviceMotion` (инерциальный): интеграция `yawRate` в `inertialHeading` (не старая связка `dAlpha = ra·cosβ + rg·sinβ` — она заменена в сессии heading-based).

**Исправления в коде:**

1. **ar.js: `computeOrientationMatrix`** — матрица теперь хранит **R^T** (world→device) row-major. Изменены 6 off-diagonal элементов (m[1], m[2], m[3], m[5], m[6], m[7]). Ни одна из трёх функций-потребителей (`projectReal3D`, шейдер, `computeAimingAngularErrorDeg`) не потребовала правок — формула `m[row]·v` теперь даёт корректный `(R^T · v_world)[row]`.

2. **ar.js: `tiltDegreesFromAccel`** — правильные формулы:
   - `beta = atan2(ay, √(ax² + az²))` (наклон вокруг X, вперёд/назад)
   - `gamma = atan2(−ax, √(ay² + az²))` (наклон вокруг Y, влево/вправо)

3. **ar-render.js** — обновлены комментарии в `projectReal3D`, `computeAimingAngularErrorDeg` и WebGL-шейдере: точное описание конвенции R^T row-major.

**Итог поведения после сессии:**
- Спутники отображаются в правильных позициях: камера на Север → спутник на Севере по центру экрана.
- Поворот телефона корректно сдвигает маркеры в ожидаемом направлении в обоих режимах (compass и inertial).
- Звуковой прицел (`computeAimingAngularErrorDeg`) согласован с визуальной проекцией — forward = `−(m6, m7, m8)` = `R·(0,0,−1)`.
- Акселерометрическая коррекция в инерциальном режиме стабилизирует наклон, а не дестабилизирует.

### Сессия: Гибридный инерциальный режим — OS pitch/roll + гиро yaw (март 2026)

**Проблема:** в инерциальном режиме (компас выключен) спутники отображались неправильно и нелогично реагировали на движение телефона. Причина — инерциальный контур **переизобретал** pitch/roll из сырых данных `DeviceMotionEvent` (`accelerationIncludingGravity` с 8% blend + интеграция `rotationRate` по всем трём осям), вместо того чтобы использовать готовые стабильные значения из OS sensor fusion. Самодельный наклон отставал, был неточным, страдал от gimbal lock при β ≈ ±90°.

**Ключевое наблюдение:** `DeviceOrientationEvent.beta` (pitch) и `.gamma` (roll) определяются из **акселерометра + гироскопа** на уровне ОС и **не зависят от магнитометра**. Магнитометр влияет **только** на `.alpha` (yaw/heading). Поэтому даже в магнитно неблагоприятной среде beta и gamma остаются корректными.

**Архитектурное решение — гибридный инерциальный режим:**
- **Pitch/roll** (`sensorState.beta/gamma`) — всегда из OS fusion (`DeviceOrientationEvent`), в обоих режимах.
- **Yaw для матрицы** — в магнитном режиме: **α** из OS fusion + WMM после `calibrationDelta`; в инерциальном (актуально): сначала интеграция мирового heading в **`inertialHeading`** (`onDeviceMotion`), затем **`headingToAlpha(inertialHeading − calibrationDelta, β, γ)`** → **α** (подход heading-based заменил хранение «сырого» Euler **α** как `inertialAlpha`).
- `refreshOrientationMatrix()` единообразна: `computeOrientationMatrix(alpha, sensorState.beta, sensorState.gamma)`, разница — только в способе получения **α**.

**Удалённый код (ar.js):**
- Переменные `inertialBeta`, `inertialGamma` — pitch/roll больше не интегрируются из гироскопа.
- Функция `tiltDegreesFromAccel()` — самодельное восстановление наклона из акселерометра больше не нужно.
- Константа `ACCEL_TILT_BLEND` (0.08) — вес подмешивания акселерометра больше не нужен.
- Функция `wrapAngle180()` — использовалась только для `inertialBeta`.
- В `onDeviceMotion`: удалены интеграция `rb·dt` (beta), `dGamma` (gamma), весь блок акселерометрической коррекции.
- В `onCompassToggleClick`, `initAr`, `cleanupAr`: убраны инициализация и сброс `inertialBeta/Gamma`.

**Изменённый код (ar.js):**
1. **`refreshOrientationMatrix()`** — beta/gamma **всегда** из `sensorState`; alpha по режиму.
2. **`onOrientation()`** — вызывает `refreshOrientationMatrix()` **всегда**, а не только в магнитном режиме (обновляет pitch/roll для инерциального контура).
3. **`onDeviceMotion()`** — в инерциальном режиме интегрирует **только** мировой yaw в **`inertialHeading`** (актуально — через **`yawRate`**, см. сессию heading-based); для шага используются `sensorState.beta/gamma` из OS fusion.

**Не изменено:**
- **ar-render.js** — рендерер работает с `orientationMatrix[9]` как чёрным ящиком; `projectReal3D`, WebGL-шейдер, `computeAimingAngularErrorDeg` не затронуты.
- **`computeOrientationMatrix()`** — формула R^T (world→device) ZXY Euler не изменена.
- **`performCalibration()`** — магнитный контур без изменений; инерциальный после heading-based задаёт **`calibrationDelta`** через **`inertialHeading`** и истинный азимут тела (не через отдельный «сырой» **α**).
- **Таймер дрейфа, звуковой прицел, машина состояний** — без изменений.

**Итог поведения после сессии:**
- Инерциальный режим: pitch/roll стабильны и точны (OS fusion), наклон телефона корректно сдвигает маркеры. Единственный дрейфующий параметр — yaw (азимут), ~1–5°/мин, покрывается калибровкой.
- Магнитный режим: поведение не изменилось (beta/gamma и раньше брались из `sensorState`).
- Код упрощён: одна интегрируемая скалярная величина по yaw (**актуально `inertialHeading`**, ранее промежуточно — `inertialAlpha`) вместо трёх интегралов + акселерометрический blend.

### Сессия: Heading-based инерциальный tracking — устранение gimbal lock (март 2026)

**Проблема:** в инерциальном режиме калибровка в портретной ориентации (β ≈ 90°) приводила к неправильному отображению спутников (~62° ошибка азимута). Спутник на 13° долготы отображался на ~75°. Калибровка в ландшафтной (β ≈ 0°) с просмотром в портретной — работала. В магнитном режиме портретная калибровка проблем не вызывала.

**Корневая причина:** ZXY Euler-углы имеют **gimbal lock** при β = ±90° (портретная ориентация). При β = 90° матрица зависит от суммы (α + γ), а не от α и γ по отдельности. Старая формула `dAlpha = ra·cos(β) + rg·sin(β)` интегрировала **world yaw rate** (= α̇ + γ̇·sin(β)), а не Euler α̇. При β ≈ 90° вся γ̇ попадала в `inertialAlpha` и **удваивалась** (один раз из `inertialAlpha`, второй — из `sensorState.gamma`). Промежуточная попытка вычитать γ̇ через `Δgamma/dt` провалилась: оценка γ̇ крайне шумная из-за несинхронности `DeviceOrientationEvent` и `DeviceMotionEvent`.

**Решение — heading-based tracking (полная замена подхода):**

Вместо отслеживания Euler α (подвержен gimbal lock) инерциальный контур теперь отслеживает **heading** — мировой азимут направления камеры. Heading не имеет сингулярностей при любом β.

**Новая архитектура:**

1. **Переменная `inertialHeading`** (заменила `inertialAlpha`) — мировой азимут [0, 360), интегрируется из гироскопа.

2. **`onDeviceMotion()`** — интеграция world yaw rate (проекция ω на вертикаль):
   `yawRate = cos(β)·(ra·cos(γ) − rb·sin(γ)) + sin(β)·rg`
   `inertialHeading −= yawRate · dt` (heading растёт по часовой, yawRate — CCW)
   Формула **точная**, не требует оценки γ̇, не имеет сингулярностей. Использует все три компоненты `rotationRate`.

3. **`headingToAlpha(H, β, γ)`** — singularity-free конверсия heading → Euler α:
   `α = atan2(−(sb·cg·sin(H) + sg·cos(H)), sb·cg·cos(H) − sg·sin(H))`
   Обратная к `alphaToHeading`. Round-trip `headingToAlpha(alphaToHeading(α,β,γ), β, γ) = α` выполняется для всех (α, β, γ).

4. **`alphaToHeading(α, β, γ)`** — heading из Euler-углов (forward = −(m6, m7, m8)):
   `H = atan2(forward_x, forward_y)` где `forward_x = −(ca·sg + sa·sb·cg)`, `forward_y = ca·sb·cg − sa·sg`.

5. **`refreshOrientationMatrix()`** — в инерциальном режиме:
   `correctedHeading = inertialHeading − calibrationDelta`
   `alpha = headingToAlpha(correctedHeading, sensorState.beta, sensorState.gamma)`
   `computeOrientationMatrix(alpha, sensorState.beta, sensorState.gamma)`

6. **`performCalibration()`** — калибровка в пространстве heading:
   `calibrationDelta = inertialHeading − trueAzimuth`

7. **`onCompassToggleClick()`** — инициализация heading из OS-ориентации:
   `inertialHeading = alphaToHeading(sensorState.alpha, sensorState.beta, sensorState.gamma)`

**Удалённый код:** `inertialAlpha`, `prevGamma`, вся логика `sensorAzIn = (360 − inertialAlpha)`.

**Не изменено:** `computeOrientationMatrix` (R^T, ZXY), ar-render.js, WebGL-шейдер, `computeAimingAngularErrorDeg`, калибровка компасного режима, таймер дрейфа, звуковой прицел, `onOrientation` (pitch/roll из OS fusion по-прежнему).

**Почему это решает проблему:**
- При β = 90° (портретная): heading rate = rg (rotation around Y). Heading интегрируется корректно. Затем `headingToAlpha` вычисляет α с учётом текущего γ — без двойного счёта.
- При β = 0° (ландшафтная): heading rate = ra·cos(γ) − rb·sin(γ). При γ = 0: heading rate = ra. Работает как прежде.
- Переходные β: формула непрерывна и точна при любых углах.

### Сессия: Автодетекция единиц/знака rotationRate (март 2026)

**Проблема:** в инерциальном режиме при очищенном кеше браузера спутники реагировали на горизонтальное движение камеры **медленно** (нужно несколько полных оборотов) и **в неправильном направлении** (поворот влево двигал западные спутники к центру вместо восточных). Элевация и вертикальное движение работали корректно. Если до этого использовался магнитный режим с калибровкой — инерциальный режим начинал работать правильно.

**Корневая причина:** W3C спецификация требует `DeviceMotionEvent.rotationRate` в **deg/s** с правилом правой руки, однако реальные устройства/браузеры могут возвращать:
- **rad/s** вместо deg/s → heading меняется ~57x медленнее
- **инвертированный знак** → heading идёт в противоположном направлении
- Комбинацию обоих ошибок

Магнитный режим не страдал, т.к. **не использует `rotationRate`** вообще (`onDeviceMotion` выходит при `!compassDisabled`). После использования магнитного режима браузер/ОС выполняли внутреннюю калибровку sensor fusion (коррекция bias гироскопа), что исправляло проблему до очистки кеша.

**Решение — автодетекция единиц/знака при каждом переключении в инерциальный режим:**

1. **Фаза детекции** (`startGyroDetection`): при переключении в инерциальный режим (между toggle и калибровкой) параллельно накапливаются:
   - `detectGyroAccum` — сумма `yawRate · dt` из **сырого** гироскопа (без коррекции)
   - `osDelta` — изменение heading из OS fusion `alphaToHeading(sensorState.alpha, β, γ)` (через `DeviceOrientationEvent`)

2. **Финализация** (`finalizeGyroDetection`): когда OS heading изменился на ≥15° (≥5° при force):
   - Вычисляется `ratio = −osDelta / detectGyroAccum`
   - Классификация (`classifyGyroRatio`):
     - `|ratio| < 5` → единицы deg/s; знак из ratio → коррекция `±1.0`
     - `|ratio| > 15` → единицы rad/s; знак из ratio → коррекция `±(180/π)`
     - Амбигуозный диапазон → оставить текущее значение
   - Результат сохраняется в `localStorage` (`satcontact_gyro_correction`)

3. **Применение**: `inertialHeading -= yawRate · gyroCorrection · dt` (строка 494 ar.js)

4. **Жизненный цикл** (после внедрения машины состояний):
   - `initAr` → `gyroCorrection = 1.0` (не из кеша) → `calibState = 'phase1'` (если GPS есть) → `startGyroDetection()`
   - `finalizeGyroDetection` (|osDelta| ≥ 15°) → `transitionToPhase2()` — автопереход к Фазе 2
   - `onPhase2CompassToggle` (→ inertial) → `inertialHeading = alphaToHeading(...)`; начинается интеграция heading
   - `onFixCalibration` (инерциальный) → `saveGyroCorrection(gyroCorrection)` в localStorage
   - `onFixCalibration` (магнитный) → gyroCorrection не трогается, не сохраняется
   - `triggerRecalibration` / таймер дрейфа → `calibState = 'phase1'` (gyroCorrection = 1.0, детекция заново)
   - `cleanupAr` → `calibState = 'waiting_gps'`, `detectPhase = false`

**Константы (ar.js):**
- `GYRO_DETECT_MIN_DEG = 15` — порог OS heading delta для надёжной детекции
- `GYRO_DETECT_FORCE_MIN_DEG = 5` — пониженный порог при force (калибровка)
- `GYRO_CORRECTION_KEY = 'satcontact_gyro_correction'` — ключ localStorage
- `CELESTIAL_ELEVATION_THRESHOLD = 5` — минимальная elevation тела (°) для калибровки
- `CELESTIAL_AVAILABILITY_INTERVAL_MS = 10000` — частота обновления доступности тел в Фазе 2
- (Константа `GYRO_DETECT_TIMEOUT_MS` **удалена** — Фаза 1 без таймаута, см. сессию «Формальная машина состояний»)

**Не изменено:** `computeOrientationMatrix`, ar-render.js, WebGL-шейдер, `computeAimingAngularErrorDeg`, калибровка обоих режимов (только вызов `finalizeGyroDetection(true)` добавлен перед калибровкой), таймер дрейфа, звуковой прицел.

**Итог:** инерциальный режим автоматически определяет единицы (deg/s vs rad/s) и знак `rotationRate` на конкретном устройстве/браузере. Коррекция кэшируется и переопределяется при каждом входе в инерциальный режим. Нет хардкоженных устройство-специфичных обходов.

### Сессия: Формальная машина состояний «Режим калибровки» (март 2026)

**Проблемы, которые решает данная реализация:**

В предыдущем коде ar.js не было формального состояния калибровки. «Режим калибровки» был реализован неявно через комбинацию флагов `renderingStarted`, `sessionCalibrated`, `driftPaused`, `detectPhase`. Это приводило к трём багам:
1. **Баг 1**: Фаза автодетекции `gyroCorrection` могла быть прервана преждевременным нажатием кнопки калибровки. При чистом кеше `gyroCorrection` оставался 1.0 (default), и при устройстве с rad/s — heading менялся ~57x медленнее реальности.
2. **Баг 2**: Пользователь мог пропустить детекцию, нажав «Калибровать» сразу после переключения в инерциальный режим.
3. **Баг 3**: Переключение режима компаса во время рендеринга приводило к неконсистентному состоянию — `sessionCalibrated` сбрасывался, `driftPaused` включался, но детекция не гарантировалась.

**Решение — формальная машина с четырьмя состояниями:**

`calibState: 'waiting_gps' | 'phase1' | 'phase2' | 'rendering'`

Граф переходов:
```
initAr() → GPS есть → PHASE_1; GPS нет → WAITING_GPS
WAITING_GPS + GPS получен → PHASE_1 (авто, в slowLoop)
PHASE_1 + |osDelta| ≥ 15° → PHASE_2 (авто, в onOrientation → finalizeGyroDetection → transitionToPhase2)
PHASE_1 + GPS потерян → WAITING_GPS (в slowLoop)
PHASE_2 + «Зафиксировать» → RENDERING (onFixCalibration → enterRendering)
PHASE_2 + GPS потерян → WAITING_GPS (в slowLoop)
RENDERING + дрейф ≥ порога / «Калибровка» → PHASE_1 или WAITING_GPS (triggerRecalibration)
Любое + «Назад» → EXIT_AR (cleanupAr)
```

**Изменения в ar.js:**

1. **Удалённые переменные:** `sessionCalibrated`, `driftPaused`, `compassCalibrationDelta`, `GYRO_DETECT_TIMEOUT_MS`.
2. **Новые переменные:** `calibState` (строка), `selectedCalibBody` (`'sun'|'moon'|'polaris'|null`), `celestialAvailTimerId`.
3. **Новые константы:** `CELESTIAL_ELEVATION_THRESHOLD = 5`, `CELESTIAL_AVAILABILITY_INTERVAL_MS = 10000`.
4. **Удалённые функции:** `performCalibration()`, `onCompassToggleClick()`, `waitForGps()`, `loadGyroCorrection()`.
5. **Новые функции (13 штук):**
   - `showCalibOverlay(state)` — управление видимостью трёх оверлеев и кнопки рекалибровки
   - `updatePhase1Progress(absDeg)` — обновление SVG-кольца и текста «X° / 15°», цвет red→green через hsl
   - `transitionToPhase2()` — переход из Фазы 1: calibState → 'phase2', compassDisabled → false, запуск таймера доступности тел
   - `clearCelestialAvailTimer()` — очистка таймера обновления доступности
   - `updateCelestialBodiesAvailability()` — вычисление elevation Солнца/Луны/Полярной через getSunAzEl/getMoonAzEl/getPolarisAzEl, enabled/disabled кнопок
   - `syncBodySelection()` — визуальное состояние 'selected' на кнопках тел
   - `onSelectCelestialBody(evt)` — обработчик клика по кнопке тела (toggle выбора)
   - `updatePhase2FixButton()` — disabled/enabled кнопки «Зафиксировать» (тело выбрано + GPS есть)
   - `updatePhase2Instruction()` — текст инструкции в зависимости от выбранного тела
   - `onPhase2CompassToggle()` — toggle compassDisabled, при включении инерциального — инициализация inertialHeading из OS fusion
   - `onFixCalibration()` — замена performCalibration: калибровка по выбранному телу, saveGyroCorrection только для инерциального; вызов enterRendering
   - `enterRendering()` — transition to rendering: showCalibOverlay, start/resume renderer, restore focus
   - `triggerRecalibration()` — stop renderer, mute audio, reset compassDisabled, переход в phase1 или waiting_gps по GPS
6. **Рефакторинг `onDeviceMotion()`:** убран guard `!compassDisabled` — накопление `detectGyroAccum` теперь идёт в Фазе 1 независимо от режима компаса (compassDisabled ещё false). Интеграция `inertialHeading` по-прежнему только при `compassDisabled`.
7. **Рефакторинг `onOrientation()`:** убран `compassDisabled` из guard-а `finalizeGyroDetection`. Добавлено обновление прогресса Фазы 1 (`updatePhase1Progress`).
8. **Рефакторинг `finalizeGyroDetection()`:** убран таймаут `GYRO_DETECT_TIMEOUT_MS`, убран `saveGyroCorrection` (перенесён в `onFixCalibration`). При успехе вызывает `transitionToPhase2()`.
9. **Рефакторинг `initAr()`:** убраны `loadGyroCorrection()`, `waitForGps()`, инициализация `sessionCalibrated`/`driftPaused`/`compassCalibrationDelta`. `gyroCorrection` всегда начинается с 1.0. После готовности сенсоров — проверка GPS → `calibState = 'phase1'` + `startGyroDetection()` или `calibState = 'waiting_gps'`.
10. **Рефакторинг `renderLoop()`:** `if (!active || calibState !== 'rendering') return;` вместо проверок `driftPaused`.
11. **Рефакторинг `updateDriftIndicator()`:** при `calibState !== 'rendering'` — скрытие индикатора. При `error ≥ MAX_DRIFT_ERROR_DEG` — вызов `triggerRecalibration()`.
12. **Рефакторинг `slowLoop()`:** добавлена GPS-мониторинг: `waiting_gps` + GPS → `phase1` (авто); `phase1`/`phase2` + GPS lost → `waiting_gps`.
13. **Рефакторинг `bindUi()`/`unbindUi()`:** привязка/отвязка новых обработчиков (recalibBtn, celestial body buttons, phase2 compass toggle, fix button). Удалён `onCompassToggleClick`.
14. **Рефакторинг `cleanupAr()`:** `calibState = 'waiting_gps'`, `clearCelestialAvailTimer()`, удалены сбросы `sessionCalibrated`/`driftPaused`/`compassCalibrationDelta`.
15. **Новые DOM-ссылки в `cacheDom()`:** `elCalibWaitGps`, `elCalibPhase1`, `elCalibPhase2`, `elPhase1Progress`, `elPhase1Text`, `elCalibSun`, `elCalibMoon`, `elCalibPolaris`, `elPhase2CompassToggle`, `elCalibFixBtn`, `elPhase2Instruction`, `elPhase2NoBodies`, `elRecalibBtn`. Удалены: `elCalibSource`, `elCalibBtn`, `elCompassToggle`.

**Изменения в index.html:**

- **Удалён** весь блок `<div class="ar-view__panel-left">` (содержал `#arCompassToggle`, `#arCalibSource`, `#arCalibBtn`).
- **Добавлены** три оверлея после `#arCrosshair`, перед `.ar-view__panel-right`:
  - `#arCalibWaitGps` — текст «Ожидание GPS…»
  - `#arCalibPhase1` — инструкция «Медленно поверните телефон», SVG-кольцо прогресса (`#arPhase1Ring` + `#arPhase1Progress`, r=54, `stroke-dasharray=339.292`), текст «0° / 15°` (`#arPhase1Text`)
  - `#arCalibPhase2` — три кнопки тел (`#arCalibSun`, `#arCalibMoon`, `#arCalibPolaris`), предупреждение «Нет доступных тел» (`#arPhase2NoBodies`), тумблер компаса (`#arPhase2CompassToggle`), инструкция (`#arPhase2Instruction`), кнопка «Зафиксировать» (`#arCalibFixBtn`, disabled по умолчанию)
- **Добавлена** кнопка `#arRecalibBtn` в `.ar-view__panel-right` (первая в ряду, hidden по умолчанию)

**Изменения в style.css:**

- **Удалены** стили: `.ar-view__panel-left`, старый `.ar-view__compass-toggle` (из panel-left), `.ar-view__calib-select`, `.ar-view__calib-btn`.
- **Новые стили:**
  - `.ar-view__calib-overlay` — `position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,0.7); flex center`
  - `.ar-view__calib-overlay-icon`, `-text`, `-sub`, `-warn` — типографика оверлеев
  - `.ar-view__phase1-ring`, `-bg`, `-fg` — SVG-кольцо (stroke: #333 фон, fg динамический через атрибут)
  - `.ar-view__phase2-bodies`, `.ar-view__phase2-body` — кнопки тел (accent #5288c1, disabled: #555 / opacity 0.4, selected: яркая обводка)
  - `.ar-view__phase2-compass-row` — layout тумблера в Фазе 2
  - `.ar-view__compass-toggle` (переиспользован) — стили для тумблера в Фазе 2 (`.disabled` — визуально OFF)
  - `.ar-view__phase2-fix-btn` — крупная кнопка (accent, disabled state)
  - `.ar-view__recalib-btn` — круглая кнопка в правой панели AR HUD

**Файлы НЕ изменены:** ar-render.js, tle.js, tle-worker.js, map.js, map-render.js, app.js.

**Итог поведения после сессии:**
- Калибровка AR теперь проходит через формальные фазы: GPS → детекция гиро → наведение на тело → фиксация → рендеринг.
- Пользователь не может пропустить детекцию gyroCorrection — Фаза 1 блокирует до поворота ≥ 15°.
- Пользователь не может прервать детекцию преждевременно — кнопки калибровки нет в Фазе 1.
- Переключение режима компаса доступно только в Фазе 2 (не во время рендеринга).
- Рекалибровка (ручная или по дрейфу) всегда проходит полный цикл phase1 → phase2 → rendering.
- Фокус спутника и звук сохраняются через рекалибровку.
- UI: три полупрозрачных оверлея поверх видео камеры для каждой фазы, SVG-кольцо прогресса, кнопки небесных тел с авто-доступностью.

### Сессия: Исправление детекции gyroCorrection — race condition и вырожденные ориентации (март 2026)

**Проблемы, найденные в сессии (5 связанных багов):**

1. **`startGyroDetection()` вызывалась до первого `onOrientation`** — `detectStartHeading = alphaToHeading(0,0,0) = 0`, весь `osDelta` отражал абсолютный heading, а не реальный поворот. Причина: `startGps()` запускался до `await startSensors()`, при кэшированном GPS `gpsCoords` был доступен раньше первого события ориентации.
2. **`alphaToHeading` вырождалась при beta ≈ 0** — `atan2(~0, ~0)` математически неопределён; изменение beta на 2° давало скачок heading на 180°. Индикатор Фазы 1 «бесился» на неподвижном плоском телефоне.
3. **`yawRate` в первых кадрах использовал stale `beta=0, gamma=0`** — формула вырождалась до `yawRate = ra`, игнорируя `rg` (основной компонент при вертикальном удержании).
4. **Знак `gyroCorrection` мог быть неправильным** — `osDelta` от нулевого baseline не связан с направлением поворота; `ratio` имел 50/50 шанс дать `+RAD` vs `-RAD`.
5. **`sensorState` не сбрасывался в `initAr()`** — при повторном входе в AR baseline формировался из устаревших значений предыдущей сессии.

**Исправления в ar.js:**

1. **Флаг `sensorReady`** — устанавливается в `true` при первом вызове `onOrientation()`. Фаза 1 (`startGyroDetection`) запускается только при наличии И GPS, И первого события ориентации. Проверка `sensorReady` добавлена в `initAr()`, `slowLoop()`, `triggerRecalibration()`.

2. **Инкрементальные дельты вместо фиксированного baseline** — удалён `detectStartHeading`. Введены `detectOsAccum` (кумулятивная дельта heading из пар последовательных `onOrientation`) и `detectPrevHeading`/`detectPrevHeadingValid`. В `startGyroDetection()` baseline не вычисляется; `detectOsAccum` накапливается только при `detectPrevHeadingValid = true`, первый кадр только инициализирует `detectPrevHeading`.

3. **Фильтр вырожденных ориентаций** — новая константа `BETA_MIN_FOR_HEADING = 15°`. И OS heading delta (`onOrientation`), и gyro accumulator (`onDeviceMotion`) не обновляются при `|beta| < 15°`. Это синхронизирует оба аккумулятора и устраняет проблему `atan2(~0, ~0)`.

4. **Минимальное время детекции** — новая константа `GYRO_DETECT_MIN_TIME_MS = 500`. `finalizeGyroDetection()` не завершает детекцию раньше 500 мс (кроме force), предотвращая ложное срабатывание от первого скачка `sensorState`.

5. **Сброс `sensorState` в `initAr()`** — при входе в AR `sensorState` возвращается к `{alpha: 0, beta: 0, gamma: 0, ...}`, `sensorReady` к `false`. Гарантирует отсутствие влияния устаревших значений при повторном входе.

6. ~~**Диагностическое логирование** — `finalizeGyroDetection()` теперь всегда пишет в консоль: `osDelta`, `gyroAccum`, `ratio`, `correction`, `elapsed`.~~ **Удалено** в следующей сессии (см. ниже).

**Новые константы (ar.js):**
- `BETA_MIN_FOR_HEADING = 15`
- `GYRO_DETECT_MIN_TIME_MS = 500`

**Новые/изменённые переменные (ar.js):**
- `sensorReady` (bool, ставится при первом `onOrientation`)
- `detectOsAccum` (кумулятивная дельта OS heading)
- `detectPrevHeading`, `detectPrevHeadingValid` (заменили `detectStartHeading`)

**Изменённые функции (ar.js):** `startGyroDetection`, `finalizeGyroDetection`, `onOrientation`, `onDeviceMotion`, `initAr`, `cleanupAr`, `slowLoop`, `triggerRecalibration`.

**Файлы НЕ изменены:** ar-render.js, tle.js, tle-worker.js, map.js, map-render.js, app.js, index.html, style.css.

**Итог поведения после сессии:**
- Фаза 1 не стартует до получения первого реального события ориентации — устранён race condition GPS vs сенсоры.
- Индикатор прогресса корректно показывает 0° на неподвижном телефоне; не «бесится» при плоском положении.
- `gyroCorrection` определяется из реального поворота, а не из абсолютного heading — знак и величина корректны.
- При повторном входе в AR — чистое состояние сенсоров, без влияния предыдущей сессии.

### Сессия: Двойной старт Phase 1 в initAr() + очистка console.log (март 2026)

**Проблема 1 (баг): двойной старт Phase 1 из-за race condition в `initAr()`.**

Цепочка событий:
1. `startGps()` вызывается **до** `await` (строка 1334).
2. Внутри `await`, `startSensors()` регистрирует слушатели. Первый `onOrientation` может сработать ещё во время `await`.
3. `onOrientation` ставит `sensorReady = true`. Если GPS уже пришёл — Phase 1 стартует прямо из `onOrientation` (строки 462-470): `calibState = 'phase1'`, `startGyroDetection()` вызван, аккумуляторы работают.
4. `await` завершается (когда `loadTle()` получит файл по сети + `startCamera()` получит поток).
5. Блок после `await` проверял только `gpsCoords && sensorReady` — **без проверки `calibState`**. Оба условия `true`.
6. `gyroCorrection = 1.0` — **перезаписывает** значение, если детекция уже завершилась во время `await` и установила `gyroCorrection = RAD`.
7. `startGyroDetection()` — **сбрасывает** все аккумуляторы, детекция начинается с нуля.

При медленной сети (1-2 с на `loadTle`) или подтверждении камеры Phase 1 могла успеть завершиться и установить `gyroCorrection`. Блок после `await` затирал его обратно в `1.0`. Даже если Phase 1 не завершилась — двойной `startGyroDetection()` терял накопленные данные.

**Проблема 2 (tech debt): диагностический `console.log` в `finalizeGyroDetection()`.**

Добавлен в предыдущей сессии для отладки. Бесполезен на мобильном без USB remote debugging.

**Исправления в ar.js:**

1. **Guard по `calibState` в `initAr()`** — блок после `await` теперь:
   ```
   if (calibState === 'waiting_gps' && gpsCoords && gpsQuality !== 'searching' && sensorReady) {
   ```
   Если `onOrientation` уже перевёл машину в `'phase1'` (или далее) во время `await`, блок **не выполняется**: не перезаписывает `gyroCorrection`, не перезапускает `startGyroDetection()`. Ветка `else` тоже защищена: `else if (calibState === 'waiting_gps')` — оверлей показывается только если машина действительно ещё в начальном состоянии.

2. **Удалён `console.log`** из `finalizeGyroDetection()` — вывод `osDelta`, `gyroAccum`, `ratio`, `correction`, `elapsed` убран.

**Изменённые функции (ar.js):** `initAr`, `finalizeGyroDetection`.

**Файлы НЕ изменены:** ar-render.js, tle.js, tle-worker.js, map.js, map-render.js, app.js, index.html, style.css.

**Итог поведения после сессии:**
- Phase 1 стартует ровно один раз — либо из `onOrientation` (если GPS+сенсор готовы раньше `await`), либо из блока после `await`, либо из `slowLoop`. Ни один путь не дублирует другой.
- `gyroCorrection` не затирается после успешной детекции.
- Накопленные аккумуляторы `detectGyroAccum`/`detectOsAccum` не сбрасываются повторным `startGyroDetection()`.
- Код не содержит `console.log` (остаются только `console.error` и `console.warn` для реальных ошибок).

### Сессия: Устранение «серой зоны» classifyGyroRatio + непрерывная верификация gyroCorrection (март 2026)

**Проблема:** в инерциальном режиме спутники реагировали на горизонтальное движение камеры медленно (~6 оборотов для полного круга) и в неправильном направлении. Элевация (вертикаль) работала корректно. Магнитный режим — без нарушений.

**Корневая причина:** `classifyGyroRatio()` содержала «серую зону» (absRaw 5–15), возвращавшую текущее значение `gyroCorrection` (дефолт 1.0). На некоторых устройствах/браузерах ratio из Фазы 1 попадал именно в этот диапазон из-за рассинхронизации DeviceOrientation и DeviceMotion событий или нестандартного поведения `rotationRate`. В результате `gyroCorrection` оставался 1.0 при необходимости ±1.0 или ±RAD.

**Исправления в ar.js:**

1. **`classifyGyroRatio()`** — серая зона (5–15) удалена. Граница между deg/s и rad/s: **геометрическое среднее** √(1 × 57.3) ≈ **7.57**. Ниже → `±1.0`; выше → `±RAD`. Порог 0.3 (шум) сохранён.

2. **Непрерывная верификация `gyroCorrection` при рендеринге** — новый механизм:
   - **Переменные:** `verifyOsAccum`, `verifyGyroRawAccum`, `verifyPrevHeading`, `verifyPrevHeadingValid`, `verifyLastCheckTime`.
   - **Константы:** `VERIFY_INTERVAL_MS = 3000` (период проверки), `VERIFY_MIN_OS_DEG = 8` (минимум OS heading delta для решения).
   - **`onOrientation`** (rendering + compassDisabled + |β| ≥ 15°): накапливает дельту OS heading через `alphaToHeading()`.
   - **`onDeviceMotion`** (rendering + compassDisabled + |β| ≥ 15°): накапливает `yawRate × dt` (сырой, без gyroCorrection).
   - **`checkGyroCorrection()`** (вызывается из `slowLoop`, 1 Гц): каждые 3 с при достаточных данных (|verifyOsAccum| ≥ 8°) вычисляет `ratio = −verifyOsAccum / verifyGyroRawAccum`, классифицирует через `classifyGyroRatio`, обновляет `gyroCorrection` если разница > 0.5, сбрасывает аккумуляторы.
   - **`resetVerifyState()`** — сброс всех verify-переменных. Вызывается в `enterRendering()`, `triggerRecalibration()`, `onPhase2CompassToggle()`.
   - **`cleanupAr()`** — ручной сброс `verifyOsAccum`, `verifyGyroRawAccum`, `verifyPrevHeadingValid`.

**Почему это безопасно для инерциального режима:** верификация использует OS heading **дельты** (не абсолютные значения). Магнитные помехи влияют на абсолютный heading, но не на краткосрочную скорость его изменения. Поэтому верификация корректирует масштаб/знак гироскопа без компрометации устойчивости к магнитным помехам.

**Файлы НЕ изменены:** ar-render.js, tle.js, tle-worker.js, map.js, map-render.js, app.js, index.html, style.css.

**Итог поведения после сессии:**
- Фаза 1 больше не «проваливается» в серую зону — любой ratio получает определённую классификацию.
- Если Фаза 1 всё же дала неточный `gyroCorrection`, непрерывная верификация исправляет его в течение 3–6 секунд рендеринга при повороте ≥ 8°.
- Магнитный режим не затронут (верификация работает только при `compassDisabled && calibState === 'rendering'`).
- Элевация, звуковой прицел, калибровка, таймер дрейфа — без изменений.

### Сессия: Compass-free Phase 1 детекция gyroCorrection — гибрид A2+D (март 2026)

**Проблема:** Phase 1 детекция и verify-контур сравнивали интеграл сырого гироскопа (`yawRate × dt`) с изменением OS heading (`alphaToHeading` из `sensorState.alpha`). OS heading зависит от магнитометра — в магнитно неблагоприятной среде delta heading зашумлена, `DeviceOrientationEvent` и `DeviceMotionEvent` асинхронны, `classifyGyroRatio` мог вернуть дефолт `+1.0`.

**Ключевое наблюдение:** OS `beta` (pitch) и `gamma` (roll) из `DeviceOrientationEvent` **не зависят от магнитометра** — определяются из акселерометра + гироскопа на уровне ОС. Сравнение gyro pitch integral (`rotationRate.beta × dt`) с OS pitch delta (`sensorState.beta` diff) даёт надёжный ratio без участия компаса.

**Решение — три пары аккумуляторов (параллельно):**

1. **Pitch-пара** (compass-free, ОСНОВНАЯ): `detectBetaOs` (кумулятивная дельта `sensorState.beta`) + `detectBetaGyro` (интеграл `rotationRate.beta × dt`).
2. **Roll-пара** (compass-free, ДОПОЛНИТЕЛЬНАЯ): `detectGammaOs` + `detectGammaGyro` (аналогично gamma).
3. **Heading-пара** (существующая, fallback): `detectOsAccum` + `detectGyroAccum` (без изменений).

**Финализация (`finalizeGyroDetection`) — 4-step cascade:**
1. Выбор лучшей compass-free пары (pitch или roll, по `|bestOs| >= DETECT_PITCH_ROLL_MIN_DEG` = 10°), вычисление `ratio = bestOs / bestGyro`, `classifyGyroRatio(ratio)`.
2. Fallback D (maxRate heuristic): если compass-free пары не набрали 10°, по `detectMaxAbsRate` определяется масштаб (< 3 → rad/s, > 10 → deg/s), знак из heading-пары.
3. Fallback heading pair: существующий метод (`-detectOsAccum / detectGyroAccum`).
4. Если ничего не сработало — Phase 1 продолжается.

**Условие завершения Phase 1:** `|detectBetaOs| >= 10° ИЛИ |detectGammaOs| >= 10° ИЛИ |detectOsAccum| >= 15°`.

**Verify-контур (`checkGyroCorrection`):** аналогичная замена — primary: pitch/roll пара (`verifyBetaOs/verifyBetaGyro` или `verifyGammaOs/verifyGammaGyro`), `VERIFY_MIN_OS_DEG = 8°`; fallback: heading-пара.

**Загрузка из кеша:** `loadGyroCorrection()` читает `localStorage` (`satcontact_gyro_correction`), возвращает cached значение или 1.0. Вызывается в `initAr()` и при каждом старте Phase 1 (`onOrientation`, `slowLoop`, `triggerRecalibration`, пост-await `initAr`). Phase 1 перезапишет при успешной детекции, но кешированное значение работает как fallback вместо бесполезного 1.0.

**Новые константы (ar.js):** `DETECT_PITCH_ROLL_MIN_DEG = 10`, `RATE_BOUNDARY_LOW = 3`, `RATE_BOUNDARY_HIGH = 10`.

**Новые переменные (ar.js):**
- Detect: `detectBetaOs`, `detectBetaGyro`, `detectGammaOs`, `detectGammaGyro`, `detectPrevBeta`, `detectPrevGamma`, `detectPrevBetaGammaValid`, `detectMaxAbsRate`.
- Verify: `verifyBetaOs`, `verifyBetaGyro`, `verifyGammaOs`, `verifyGammaGyro`, `verifyPrevBeta`, `verifyPrevGamma`, `verifyPrevBetaGammaValid`.
- DOM: `elPhase1Step1`, `elPhase1Step2`.

**Изменённые функции (ar.js):** `startGyroDetection`, `finalizeGyroDetection`, `classifyGyroRatio` (без изменений), `checkGyroCorrection`, `resetVerifyState`, `onOrientation`, `onDeviceMotion`, `updatePhase1Progress`, `showCalibOverlay`, `initAr`, `triggerRecalibration`, `cleanupAr`, `cacheDom`.

**Новая функция (ar.js):** `loadGyroCorrection()` — чтение из localStorage.

**UI Phase 1 (index.html, style.css):**
- `#arCalibPhase1` перестроен на два шага: `#arPhase1Step1` («Наклоните телефон вперёд-назад» + SVG-анимация наклона) виден сразу; `#arPhase1Step2` («Теперь медленно поверните влево-вправо») появляется после 5° по pitch.
- Кольцо прогресса остаётся, показывает `max(|betaOs|, |gammaOs|, |osAccum|)`.
- Целевое значение под кольцом динамическое: 10° (pitch/roll leading) или 15° (heading leading).
- CSS: `.ar-view__phase1-step`, `.ar-view__phase1-anim--tilt` с `@keyframes tiltPhone` (±15° качание).

**Файлы изменены:** ar.js, index.html, style.css, PROJECT_CONTEXT.md.

**Файлы НЕ изменены:** ar-render.js, tle.js, tle-worker.js, map.js, map-render.js, app.js.

**Не изменено:** `computeOrientationMatrix`, `refreshOrientationMatrix`, `headingToAlpha`, `alphaToHeading`, формула `yawRate`, Phase 2 (калибровка по небесному телу), `onFixCalibration`, `enterRendering`.

**Итог поведения после сессии:**
- Phase 1 определяет `gyroCorrection` корректно без зависимости от компаса (через pitch/roll comparison).
- Phase 1 завершается быстрее при наклоне телефона (10° вместо 15° heading).
- Verify-контур при рендеринге также compass-free (pitch/roll pair primary).
- При чистом кеше первый вход в AR работает корректно (fallback 1.0 → Phase 1 определяет).
- При повторном входе кешированное значение используется как начальное.
- UI интуитивно ведёт пользователя: наклон → поворот.

### Сессия: Исправление ложного срабатывания Phase 1 и шума в инерциальном режиме (март 2026)

**Проблемы, найденные в сессии:**

1. **Phase 1 завершалась на неподвижном телефоне** — `detectBetaOs` и `detectGammaOs` были кумулятивными суммами дельт (random walk), накапливали сенсорный шум и пересекали порог 10° за 10-20 секунд без реального движения.
2. **Шкала прогресса Phase 1 прыгала** — `bestProgress` брался из `Math.abs(detectBetaOs)` (random walk шума), создавая визуальное впечатление движения.
3. **gyroCorrection определялся из шума** — при noise-based финализации ratio `detectBetaOs / detectBetaGyro` был отношением двух случайных процессов, давая случайный знак и масштаб.
4. **Спутники «плясали» в инерциальном режиме** — мусорный `gyroCorrection` (неправильный знак/масштаб) делал heading-интеграцию неработоспособной.
5. **Verify-контур перезаписывал gyroCorrection мусором** — те же кумулятивные дельты без фильтрации в `verifyBetaOs`/`verifyGammaOs` пересекали 8° порог от шума за 3-секундное окно.
6. **Гиро-аккумуляторы накапливали bias** — `detectBetaGyro += rb * dt` на неподвижном телефоне набирал 10-50° за 10 с от bias гироскопа.
7. **Отсутствие warmup** — `GYRO_DETECT_MIN_TIME_MS = 500` мс недостаточно для стабилизации OS sensor fusion; первые события создавали большие ложные дельты.

**Корневая причина:** кумулятивные дельты `sensorState.beta` (random walk) использовались и как progress indicator, и как gate для финализации, и как числитель для ratio. На неподвижном телефоне random walk гарантированно пересекает любой фиксированный порог за конечное время.

**Решение — тройная защита: range gate + dead zone + warmup:**

1. **Range-based gate** (главная защита): вместо `|detectBetaOs| >= 10°` (random walk) для проверки «достаточно ли движения» — отслеживается **диапазон** (max − min) значений `sensorState.beta`. Диапазон не накапливает шум: на неподвижном телефоне range < 2°, при реальном наклоне range ≈ 10-20°+.
2. **Dead zone для дельт**: кумулятивные аккумуляторы (`detectBetaOs`, `detectGammaOs`) используют dead zone `DETECT_DELTA_NOISE_DEG = 0.3°` — дельты < 0.3° отбрасываются. Это снижает шумовое блуждание кумулятивных значений, из которых потом считается ratio.
3. **Warmup 2 секунды**: `GYRO_DETECT_MIN_TIME_MS` увеличено с 500 до 2000 мс. Все аккумуляторы (OS, gyro, range) не обновляются первые 2 секунды после старта Phase 1 — OS sensor fusion стабилизируется, bias гироскопа не накапливается.

**Новые константы (ar.js):** `DETECT_DELTA_NOISE_DEG = 0.3`.

**Изменённые константы:** `GYRO_DETECT_MIN_TIME_MS: 500 → 2000`.

**Новые переменные (ar.js):**
- Detect: `detectBetaMin`, `detectBetaMax`, `detectGammaMin`, `detectGammaMax` — range tracking.
- Verify: `verifyBetaMin`, `verifyBetaMax`, `verifyGammaMin`, `verifyGammaMax` — range tracking.

**Изменённые функции (ar.js):**

1. **`startGyroDetection()`** — инициализация `detectBetaMin/Max`, `detectGammaMin/Max` из текущего `sensorState`.
2. **`onOrientation()` detect block** — warmup gate (`GYRO_DETECT_MIN_TIME_MS`): ничего не накапливается до стабилизации. После warmup: range tracking (min/max), dead zone на дельтах (`DETECT_DELTA_NOISE_DEG`), heading pair тоже gated. `finalizeGyroDetection` вызывается только после warmup.
3. **`onOrientation()` progress block** — `bestProgress` из `Math.max(betaRange, gammaRange, |detectOsAccum|)` вместо `Math.max(|detectBetaOs|, ...)`. Step2 показывается при `betaRange >= 5`.
4. **`onOrientation()` verify block** — range tracking + dead zone на дельтах (аналогично detect).
5. **`onDeviceMotion()` detect block** — warmup gate для `detectBetaGyro`/`detectGammaGyro`/`detectGyroAccum`. `detectMaxAbsRate` обновляется всегда (нужен для fallback D).
6. **`finalizeGyroDetection()`** — Step 1+2 использует **range** (`betaRange >= minPR`) как gate, плюс `|detectBetaOs| >= 3` и `|detectBetaGyro| >= 0.1` для валидации ratio. Остальные steps (3, 4) без изменений.
7. **`checkGyroCorrection()`** — range gate для verify pitch/roll pair (`vBetaRange >= VERIFY_MIN_OS_DEG`), плюс `|verifyBetaOs| >= 3` и `|verifyBetaGyro| >= 0.1`. При сбросе аккумуляторов — reset `verifyBetaMin/Max`, `verifyGammaMin/Max`.
8. **`resetVerifyState()`** — добавлен reset `verifyBetaMin/Max`, `verifyGammaMin/Max`.
9. **`cleanupAr()`** — добавлен reset всех range-переменных.

**Файлы изменены:** ar.js, PROJECT_CONTEXT.md.

**Файлы НЕ изменены:** ar-render.js, tle.js, tle-worker.js, map.js, map-render.js, app.js, index.html, style.css.

**Не изменено:** `computeOrientationMatrix`, `refreshOrientationMatrix`, `headingToAlpha`, `alphaToHeading`, формула `yawRate`, Phase 2, `onFixCalibration`, `enterRendering`, `classifyGyroRatio`, fallback D (maxRate), fallback heading pair.

**Итог поведения после сессии:**
- Phase 1 НЕ завершается на неподвижном телефоне: range < 2° (шум), не пересекает 10° порог.
- Шкала прогресса стабильна: показывает range (max − min), а не random walk.
- При реальном наклоне 10°: range = 10°, detectBetaOs ≈ 8-10° (после dead zone), detectBetaGyro ≈ 10 или 0.17 — ratio вычисляется из реального движения.
- Warmup 2 с даёт время OS fusion стабилизироваться и пользователю прочитать инструкцию.
- Verify-контур при рендеринге не перезаписывает gyroCorrection шумом: range gate требует реального движения >= 8°.
- Инерциальный режим стабилен: gyroCorrection определяется из реальных данных, heading-интеграция корректна.

### Сессия: Удаление инерциального режима — только компасный режим (март 2026)

**Мотивация:** упрощение кодовой базы. Инерциальный режим (heading-based gyro yaw + DeviceMotion) добавлял значительную сложность: ~200 строк detect/verify контуров, Phase 1 UI, 11 констант, ~40 переменных, 18 функций — при том что компасный режим работает надёжно на современных устройствах.

**Архитектурное изменение — 2-состояния вместо 4:**

Было: `waiting_gps` → `phase1` (gyro detect) → `phase2` (aim + fix) → `rendering`.
Стало: `calibrating` → `rendering`.

**Удалённый код (ar.js):**

1. **Константы (11):** `GYRO_DETECT_MIN_DEG`, `GYRO_DETECT_FORCE_MIN_DEG`, `GYRO_CORRECTION_KEY`, `BETA_MIN_FOR_HEADING`, `GYRO_DETECT_MIN_TIME_MS`, `VERIFY_INTERVAL_MS`, `VERIFY_MIN_OS_DEG`, `DETECT_PITCH_ROLL_MIN_DEG`, `RATE_BOUNDARY_LOW`, `RATE_BOUNDARY_HIGH`, `DETECT_DELTA_NOISE_DEG`.
2. **Переменные (~40):** `compassDisabled`, `inertialHeading`, `lastMotionTimestamp`, `motionStateTimestamp`, `gyroCorrection`, 18 `detect*` переменных, 16 `verify*` переменных, `PHASE1_CIRCUMFERENCE`, DOM-ссылки Phase 1 / sensor panel / compass toggle.
3. **Функции (18):** `alphaToHeading`, `headingToAlpha`, `saveGyroCorrection`, `loadGyroCorrection`, `startGyroDetection`, `classifyGyroRatio`, `resetVerifyState`, `checkGyroCorrection`, `finalizeGyroDetection`, `onDeviceMotion`, `showCalibOverlay`, `updatePhase1Progress`, `transitionToPhase2`, `onPhase2CompassToggle`, `setSensorClass`, `updateSensorStatus`.

**Новые функции (ar.js):**

- `areSensorsReady()` — GPS + DeviceOrientation + камера.
- `updateCalibButtons()` — управление состоянием кнопки «Зафиксировать» и статусом датчиков.
- `showCalibPanel(visible)` — показ/скрытие калибровочной панели.

**Модифицированные функции:** `refreshOrientationMatrix` (только компасная ветка), `onOrientation` (без detect/verify), `startSensors`/`stopSensors` (без DeviceMotion), `onFixCalibration` (без инерциальной ветки), `enterRendering`, `triggerRecalibration` (→ calibrating), `updateDriftIndicator`, `slowLoop`, `renderLoop`, `bindUi`/`unbindUi`, `cacheDom`, `initAr`, `cleanupAr`.

**Удалённый код (ar-render.js):** `drawDriftWarning()`, проверка `params.driftPaused` в `draw()`.

**Изменения в index.html:**

- **Удалены:** `#arSensorPanel` (4 иконки в header), `#arCalibWaitGps` (оверлей GPS), `#arCalibPhase1` (оверлей Phase 1 с SVG-кольцом), `.ar-view__phase2-compass-row` с `#arPhase2CompassToggle`.
- **Переделан** `#arCalibPhase2` → `#arCalibPanel`: из полноэкранного оверлея в нижнюю панель (`ar-view__calib-panel`). Добавлена строка статуса датчиков (`#arCalibSensorStatus`). Кнопка «Зафиксировать» в `.ar-view__calib-actions`.

**Изменения в style.css:**

- **Удалены:** `.ar-view__sensors`/`.ar-view__sensor`, `.ar-view__calib-overlay`/`-icon`, `.ar-view__phase1-ring*`, `.ar-view__phase1-step*`, `.ar-view__phase1-anim--tilt`, `.ar-view__tilt-icon`, `@keyframes tiltPhone`, `.ar-view__phase2-compass-row`, `.ar-view__compass-toggle*`.
- **Переименованы:** `.ar-view__calib-overlay-text`/`-sub`/`-warn` → `.ar-view__calib-panel-text`/`-sub`/`-warn`.
- **Новые:** `.ar-view__calib-panel` (bottom panel, backdrop-filter), `.ar-view__calib-actions` (flex row), `.ar-view__calib-sensor-status` (yellow warning text).

**Файлы изменены:** ar.js, ar-render.js, index.html, style.css, PROJECT_CONTEXT.md.

**Файлы НЕ изменены:** app.js, map.js, map-render.js, tle.js, tle-worker.js.

**Не изменено:** `computeOrientationMatrix`, WMM (`getMagneticDeclination`, `WMM_COEFFS`), астрономия (`getSunAzEl`, `getMoonAzEl`, `getPolarisAzEl`), `updateCelestialBodiesAvailability`, `syncBodySelection`, `onSelectCelestialBody`, `updatePhase2FixButton`, `updatePhase2Instruction`, drift timer (`getDriftError`, `updateDriftIndicator`), audio, overview/focus, rendering pipeline, Worker trajectories, camera, GPS.

### Модуль 4 — Новости: доска объявлений + чат (март 2026)

Интеграция четвёртого модуля в SPA. Полная спецификация — в файле **`MODUL4_PROJECT_CONTEXT.md`**.

**Созданные файлы:**
- `news.js` — IIFE-модуль: конфигурация B2, состояние чата, жизненный цикл (`initNews`/`cleanupNews`), загрузка доски (`loadBoard`, localStorage-кеш), авторизация по позывному + паролю (SHA-256 из `callsign:password` через SubtleCrypto), визуальная идентификация (`hashToColor`, `createBlockie`), двухрежимный листинг S3 (`fetchFileList` — инкрементальный/полный, пагинация до 10 000 файлов, sessionStorage-кеш 30 сек), рендер сообщений (`createMessageElement`, `relativeTime`, `formatFileSize`), отправка (`sendMessage`, `compressImage` — canvas resize 1280px, JPEG 0.75), редактирование (PUT overwrite), удаление (DELETE JSON + медиа + вложения), инкрементальный поллинг 30 сек + полный при re-open/visibility, автосворачивание по неактивности 5 мин, fullscreen-просмотр изображений.
- `lib/aws4fetch.min.js` — IIFE-сборка из ESM-исходника aws4fetch (Michael Hart, MIT), экспорт `window.AwsClient` и `window.AwsV4Signer`.
- `data/board.html` — заглушка доски объявлений.
- `data/board-media/.gitkeep` — пустая папка для медиа доски.

**Изменения в index.html:**
- `<h1 class="header__title">` получил `id="headerTitle"`, `role="button"`, `tabindex="0"`, `cursor:pointer` — клик открывает Модуль 4.
- Добавлен `<div id="newsView" class="news-view" hidden>` после `#arView`: заголовок (Назад, Новости, Обновить, Настройки), сворачиваемая доска объявлений, лента чата, модальное окно авторизации (ввод позывного), панель ввода (фото, файл, textarea, кнопка отправки), превью вложения, модальное окно редактирования.
- Добавлены скрипты: `<script src="lib/aws4fetch.min.js">` и `<script src="news.js">` перед `app.js`.

**Изменения в app.js:**
- Добавлена переменная `newsView` и её инициализация `document.getElementById('newsView')`.
- Добавлены `openNewsView()` / `closeNewsView()` по паттерну map/AR.
- `openMapView()` и `openArView()` скрывают `newsView`.
- Привязка клика и Enter/Space на `#headerTitle` → `openNewsView()`.
- Экспорт `window.closeNewsView`.

**Изменения в style.css:**
- Добавлены ~400 строк стилей `.news-view*` и `.news-msg*`: fullscreen view (z-index: 250), header, сворачиваемая доска, карточки сообщений (свои `.news-msg--own` со смещением вправо и фоном `#1a3a5c`), панель ввода (rounded textarea, круглая кнопка отправки), модалки авторизации и редактирования (backdrop-filter, blur), превью файла, fullscreen-оверлей для просмотра изображений, responsive-адаптация для tablet/desktop (max-width 720px).

**B2 конфигурация (вшита в news.js):**
- S3 Endpoint: `s3.eu-central-003.backblazeb2.com`
- Bucket: `satcontact-chat`
- Public URL: `https://f003.backblazeb2.com/file/satcontact-chat`

**Файлы НЕ изменены:** map.js, map-render.js, ar.js, ar-render.js, tle.js, tle-worker.js, gps-service.js, utils.js.

### Сессия: Кнопка «НОВОСТИ», сворачиваемые вкладки, ленивая загрузка (март 2026)

**Цель сессии:**
- Заменить неинтуитивный вход в Модуль 4 (клик по заголовку «SAT Навигатор») на полноценную кнопку «НОВОСТИ» в стиле Модуля 1.
- Сделать обе секции (доска + чат) сворачиваемыми с ленивой загрузкой содержимого.
- Добавить детекцию обновлений доски объявлений (шиммер-анимация на кнопке).

**1. Кнопка «НОВОСТИ» (index.html, style.css, app.js)**
- **Удалён** `<h1 class="header__title" id="headerTitle">SAT Навигатор</h1>` и все стили `.header__title`.
- **Добавлена** `<button class="btn btn--news" id="newsBtn">НОВОСТИ</button>` в `.header__top`.
- Стили `.btn--news`: приглушённый полупрозрачный фон `rgba(82,136,193,0.15)`, текст `var(--text-secondary)`.
- Стили `.btn--news-updated`: градиент жёлтый/зелёный/оранжевый (`linear-gradient 270deg`), `animation: newsShimmer 3s ease infinite` (background-position 0→100→0%).
- В `app.js`: `#headerTitle` заменён на `#newsBtn`, убран keydown-обработчик (кнопка нативно реагирует на Enter/Space), добавлен вызов `checkBoardForUpdates()` при загрузке.

**2. Сворачиваемый чат (index.html, style.css, news.js)**
- В `index.html` добавлена кнопка-тогл `#newsChatToggle` (💬 ЧАТ ▸) и обёртка `#chatContent` вокруг ленты сообщений.
- Стили `.news-view__chat-toggle` (аналог `.news-view__board-toggle`), `.news-view__chat-content`, `.news-view__chat--collapsed .news-view__chat-content { display: none }`.
- В `news.js`: `toggleChat()` — переключение класса `--collapsed`, показ/скрытие `#newsInputBar`, управление поллингом.
- Чат **всегда свёрнут** при входе в Модуль 4 (состояние НЕ сохраняется в localStorage).

**3. Ленивая загрузка (news.js)**
- Флаги `boardLoaded`, `chatLoaded` — содержимое загружается только при первом развороте.
- `initNews()` больше НЕ вызывает `loadBoard()`, `fetchAndRenderFeed()`, `startPolling()` сразу.
- Доска: при развороте → `loadBoard()` (cache-first). Состояние доски из localStorage (default: collapsed).
- Чат: при развороте → `fetchAndRenderFeed()` + `startPolling()`. При повторном развороте → `checkForNewMessages()`.
- Поллинг: стартует при развороте чата, останавливается при сворачивании.
- Кнопка «Обновить» (`#newsRefresh`) обновляет только загруженные секции.

**4. Детекция обновлений доски (news.js, app.js)**
- `checkBoardForUpdates()` (экспорт `window.checkBoardForUpdates`): fetch `board.html` (cache: no-cache), сравнение с `LS_BOARD_CACHE` в localStorage. При различии → `#newsBtn.classList.add('btn--news-updated')`.
- Шиммер снимается в `loadBoard()` при просмотре доски.
- Вызывается из `app.js` при инициализации приложения.
- **TODO [PWA]:** перенести в Service Worker для фоновой детекции.

**Файлы изменены:** index.html, style.css, app.js, news.js, PROJECT_CONTEXT.md.

**Файлы НЕ изменены:** map.js, map-render.js, ar.js, ar-render.js, tle.js, tle-worker.js, gps-service.js, utils.js, lib/aws4fetch.min.js, data/board.html.

### Сессия: Усиление идентификации пользователя в чате (март 2026)

**Цель сессии:**
- Заменить идентификацию «только по позывному» на «позывной + пароль».
- Добавить визуальную уникальность: цвет имени из хеша и identicon-аватарку (blockies).

**1. Модалка авторизации (index.html)**
- Заголовок `<h3>` изменён с «Введите ваш позывной» на «Вход в чат».
- `#newsCallsignInput`: `maxlength="20"` → `maxlength="12"`.
- Добавлено поле `<input type="password" id="newsPasswordInput">` после позывного.
- Добавлен элемент ошибки `<p id="newsAuthError" class="news-view__auth-error" hidden>`.
- Подсказка обновлена: «Позывной будет виден в чате. Пароль нужен для защиты имени.»

**2. Формула хеша (news.js)**
- `setCallsign(name)` → `setCallsign(name, password)`.
- Хеш вычисляется из `callsign + ':' + password` (разделитель `:` предотвращает коллизии пар).
- Пароль НЕ сохраняется в localStorage — только позывной и хеш.

**3. Валидация (news.js)**
- Функция `validateAndLogin()` — проверка позывного (непустой, trim ≤ 12) и пароля (≥ 8 символов).
- Ошибки выводятся в `#newsAuthError`.
- Валидация срабатывает по клику кнопки «Войти в чат», Enter в поле позывного и Enter в поле пароля.
- `showAuthModal()` — при показе очищает пароль и скрывает ошибку.

**4. Цвет имени (news.js, style.css)**
- Функция `hashToColor(hash)` — HSL из хеша: H 0-360°, S 40-80%, L 55-75%.
- Применяется inline `style="color:..."` в `createMessageElement`.
- В `.news-msg__author` убран `color: var(--accent)` (цвет теперь из хеша).

**5. Blockies-аватарка (news.js, style.css)**
- Функция `createBlockie(hash, size)` (~50 строк): xorshift PRNG из hex, 3 цвета, симметричная 8×8 матрица, offscreen canvas → `toDataURL()`.
- Кеш `blockieCache = {}` по ключу hash (RAM, до перезагрузки).
- В `createMessageElement` — `<img class="news-msg__avatar">` 24×24 перед именем автора.
- CSS: `.news-msg__avatar` (24px, border-radius 4px, image-rendering pixelated).
- `.news-msg__header`: `align-items: baseline` → `align-items: center`.

**6. Новые CSS-правила (style.css)**
- `.news-view__auth-input + .news-view__auth-input` — отступ между полями модалки.
- `.news-view__auth-error` — стиль ошибки валидации (красный текст, скрытие через `[hidden]`).

**7. Объект els (news.js)**
- Добавлены: `passwordInput` (`#newsPasswordInput`), `authError` (`#newsAuthError`).

**Формат данных НЕ изменён:** JSON сообщений (поля `author`, `author_hash`), имена файлов в B2, длина хеша (8 hex), функция `computeHash`, логика S3, `checkAuth`, ключи localStorage.

**Файлы изменены:** index.html, style.css, news.js, PROJECT_CONTEXT.md.

**Файлы НЕ изменены:** app.js, map.js, map-render.js, ar.js, ar-render.js, tle.js, tle-worker.js, gps-service.js, utils.js, lib/aws4fetch.min.js, data/board.html.

### Сессия: Фильтры, ответы с цитированием, личные сообщения (март 2026)

**Цель сессии:**
- Добавить ответ с цитированием (публичный ответ со снимком-цитатой).
- Добавить фильтр «Ответы мне» (показ только ответов на мои сообщения + контекст).
- Добавить личные сообщения (DM) между двумя пользователями с фильтром «Личные».
- Приватность DM — косметическая (UI-фильтрация, без шифрования).

**1. HTML (index.html)**
- Добавлена панель фильтров `#chatFilters` внутрь `#chatContent` (перед `#chatLoader`): три кнопки «Все», «Ответы мне», «Личные» (`data-filter`). Скрыта по умолчанию (`hidden`).
- Добавлено превью ответа `#newsReplyPreview` перед `#newsInputBar`: автор (`#newsReplyAuthor`), текст цитаты (`#newsReplyText`), badge «ЛИЧНОЕ» (`#newsReplyBadge`), кнопка закрытия (`#newsReplyClose`). Скрыто по умолчанию.

**2. CSS (style.css)**
- ~170 строк новых стилей между блоком `.news-msg__actions` и `/* Input bar */`:
  - `.news-msg__reply-actions`, `.news-msg__reply-btn`, `.news-msg__dm-btn` — кнопки ↩️/🔒 на сообщениях.
  - `.news-msg__quote`, `.news-msg__quote-author`, `.news-msg__quote-text` — блок цитаты внутри сообщения.
  - `.news-view__filters`, `.news-view__filter-btn`, `.news-view__filter-btn--active` — панель фильтров.
  - `.news-view__reply-preview`, `.news-view__reply-preview-content`, `.news-view__reply-preview-author`, `.news-view__reply-preview-text`, `.news-view__reply-preview-badge`, `.news-view__reply-preview-close` — превью ответа.
- `[hidden]` правила с `display: none !important` для `.news-view__filters`, `.news-view__reply-preview`, `.news-view__reply-preview-badge`.

**3. Новые переменные состояния (news.js)**
- `pendingReply` — текущий выбранный ответ (`{ hash, author, text, filename, isDm }` или `null`).
- `activeFilter` — активный фильтр (`'all'` | `'replies'` | `'dm'`).
- `allDmFiles` — массив имён `-dm.json` файлов из листинга B2.
- `loadedDmMessages` — загруженные JSON-ы DM, отфильтрованные по принадлежности пользователю.
- `allMessagesLoaded` — флаг: все публичные сообщения загружены (для фильтра «Ответы мне»).
- `allDmsLoaded` — флаг: все DM загружены и отфильтрованы.

**4. Новые DOM-ссылки в els (news.js)**
- `chatFilters`, `replyPreview`, `replyAuthor`, `replyText`, `replyBadge`, `replyClose`.

**5. fetchFileList (news.js)**
- Вынесена утилита `sortByTimestamp(arr)`.
- Листинг фильтрует и `-msg.json`, и `-dm.json`.
- `allDmFiles` обновляется как side-effect.
- Кеш sessionStorage расширен: `{ ts, files, dmFiles }`. При чтении кеша восстанавливается `allDmFiles`.

**6. createMessageElement (news.js)**
- Блок цитаты (`.news-msg__quote`) вставляется между header и text, если `msg.reply_to` присутствует.
- Кнопки ↩️ (`.news-msg__reply-btn`) и 🔒 (`.news-msg__dm-btn`) добавляются перед блоком edit/delete. 🔒 только на чужих сообщениях. Обе видны только при `userHash`.
- `data-filename`, `data-author`, `data-hash`, `data-text` (первые 25 символов) — атрибуты для `setPendingReply`.

**7. Новые функции (news.js)**
- `getFilteredMessages()` — фильтрация `loadedMessages`/`loadedDmMessages` по `activeFilter`.
- `getEmptyMessage()` — текст-заглушка для каждого фильтра.
- `ensureAllMessagesLoaded()` — async, догружает все оставшиеся `-msg.json` файлы.
- `ensureAllDmsLoaded()` — async, загружает все `-dm.json` файлы, фильтрует по принадлежности.
- `setFilter(filter)` — async, переключает `activeFilter`, обновляет классы кнопок, вызывает ensure-функции и `renderMessages()`.
- `setPendingReply(data, isDm)` — устанавливает `pendingReply`, показывает превью с автором/текстом/badge.

**8. renderMessages (news.js)**
- Использует `getFilteredMessages()` вместо прямого `loadedMessages`.
- Пустой результат — показывает `getEmptyMessage()` в `#chatEmpty`.

**9. sendMessage (news.js)**
- `messageData` дополнен полями `reply_to` и `private` (из `pendingReply`).
- Имя файла: суффикс `-dm.json` для DM, `-msg.json` для публичных.
- Optimistic update: DM добавляется в `loadedDmMessages`/`allDmFiles`, публичные — в `loadedMessages`/`allFileNames`.

**10. bindEvents (news.js)**
- Делегирование кликов по `chatFeed`: обработка `.news-msg__reply-btn` → `setPendingReply(data, false)`, `.news-msg__dm-btn` → `setPendingReply(data, true)`.
- Слушатель на `#chatFilters`: клик по `.news-view__filter-btn` → `setFilter()`.
- Слушатель на `#newsReplyClose`: очистка `pendingReply`, скрытие превью.

**11. checkForNewMessages (news.js)**
- Перед `fetchFileList` сохраняется snapshot `prevMsgSet`/`prevDmSet` для сравнения.
- Новые `-dm.json` → если `allDmsLoaded`, догружаются и добавляются в `loadedDmMessages` (при принадлежности).
- Удалённые файлы фильтруются из обоих массивов.

**12. Обновления существующих функций (news.js)**
- `toggleChat()` — показывает/скрывает `#chatFilters` вместе с `#newsInputBar`.
- `unlockInput()` — показывает `#chatFilters`.
- `lockInput()` — скрывает `#chatFilters`.
- `updateSendBtnState()` — при `activeFilter === 'dm'` без `pendingReply` блокирует отправку, меняет placeholder.
- `clearPending()` — очищает `pendingReply`, скрывает `#newsReplyPreview`.
- `cleanupNews()` — сбрасывает все 6 новых переменных состояния.

**Формат публичных файлов НЕ изменён:** `{timestamp}-{hash}-msg.json` остаётся как есть. Новые поля `reply_to`/`private` обратно совместимы (undefined/null обрабатываются одинаково).

**Файлы изменены:** index.html, style.css, news.js, PROJECT_CONTEXT.md.

**Файлы НЕ изменены:** app.js, map.js, map-render.js, ar.js, ar-render.js, tle.js, tle-worker.js, gps-service.js, utils.js, lib/aws4fetch.min.js, data/board.html.

### Сессия: Оптимизация чата — инкрементальный поллинг, пагинация, автосворачивание (март 2026)

**Цель сессии:**
- Ускорить обновление чата (90 сек → 30 сек) при минимизации трафика за счёт инкрементального поллинга.
- Добавить S3-пагинацию для поддержки до 10 000 файлов (было ограничение 1 000).
- Реализовать автосворачивание чата по неактивности (5 мин) для экономии запросов.
- Увеличить лимит видео (10 МБ → 25 МБ).

**1. Константы (news.js)**
- `MAX_VIDEO_SIZE`: `10 * 1024 * 1024` → `25 * 1024 * 1024` (25 МБ, позволяет 20-40 сек видео 720p).
- `LISTING_CACHE_TTL`: `90000` → `30000` (30 сек, синхронизирован с поллингом).
- `POLL_INTERVAL`: `90000` → `30000` (30 сек, более быстрое обновление).
- Добавлена `INACTIVITY_TIMEOUT = 300000` (5 мин — порог автосворачивания).

**2. Новые переменные состояния (news.js)**
- `inactivityTimer` — ID таймера `setTimeout` для автосворачивания.
- `lastListedKey` — лексикографически максимальный ключ из последнего листинга S3. Используется как `start-after` для инкрементального поллинга.

**3. Двухрежимный листинг — fetchFileList(useCache, incremental) (news.js)**
- Полный режим (`incremental=false`): пагинация через `continuation-token` (цикл `while (isTruncated)`), до 10 страниц × 1000 ключей = 10 000 файлов. Полная замена `allFileNames` и `allDmFiles`.
- Инкрементальный режим (`incremental=true`): один запрос `start-after=lastListedKey`, `max-keys=100`. Новые ключи дописываются к существующим массивам.
- После каждого листинга — обновление `lastListedKey` (максимальный ключ).
- Кеш sessionStorage расширен полем `lastKey`.

**4. Новая вспомогательная функция parseS3ListXmlMeta (news.js)**
- Извлекает `IsTruncated` и `NextContinuationToken` из XML-ответа S3 ListObjectsV2.
- Используется `fetchFileList` в полном режиме для пагинации.

**5. Разделение поллинга на две функции (news.js)**
- `checkForNewMessages()` — **инкрементальная**: вызывает `fetchFileList(false, true)`, добавляет только новые сообщения, не детектит удаления. Вызывается из `setInterval` каждые 30 сек.
- `checkForNewMessagesFull()` — **полная**: вызывает `fetchFileList(false, false)`, детектит и добавления, и удаления (через сравнение Set-ов). Вызывается при: повторном развороте чата, возврате на вкладку, ручном refresh.

**6. Автосворачивание по неактивности (news.js)**
- `resetInactivityTimer()` — перезапускает 5-минутный таймер.
- `stopInactivityTimer()` — останавливает и обнуляет таймер.
- `collapseByInactivity()` — если чат развёрнут, вызывает `toggleChat()` (→ `stopPolling()` + `stopInactivityTimer()`).
- Отслеживание активности: события `scroll`, `click`, `touchstart`, `keydown` на контейнере чата + `input` на поле ввода — каждое сбрасывает таймер.

**7. Обновлённые функции (news.js)**
- `toggleChat()` — при развороте: `checkForNewMessagesFull()` + `startPolling()` + `resetInactivityTimer()`. При сворачивании: `stopPolling()` + `stopInactivityTimer()`.
- `onVisibilityChange()` — при возврате на вкладку: `checkForNewMessagesFull()` + `resetInactivityTimer()`.
- `cleanupNews()` — добавлен `stopInactivityTimer()` + сброс `lastListedKey`.
- Обработчик `#newsRefresh` — сбрасывает `lastListedKey`, `allMessagesLoaded`, `allDmsLoaded` для полного refresh.

**Экономика (при 100 DAU, 20 msg/user, 30 сек поллинг, 5 мин автосворачивание):**
- Egress: ~60 ГБ/мес (~$0.52). Запас до бюджета $2: 74%.

**Файлы изменены:** news.js, PROJECT_CONTEXT.md, CHAT_OPTIMIZATION_SPEC.md (новый).

**Файлы НЕ изменены:** index.html, style.css, app.js, map.js, map-render.js, ar.js, ar-render.js, tle.js, tle-worker.js, gps-service.js, utils.js, lib/aws4fetch.min.js, data/board.html.
