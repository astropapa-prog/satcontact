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
├── index.html           # SPA, шапка + список карточек + mapView
├── style.css            # Telegram Dark, mobile-first, стили карты
├── app.js               # Парсинг XML, фильтры, рендер, openMapView/closeMapView
├── map.js               # Модуль 2: GPS, localStorage, HUD, initMap/cleanupMap
├── map-render.js        # Canvas-картография: карта день/ночь, терминатор, огни городов, орбиты, footprint, маркеры
├── tle.js               # TLE парсер, satellite.js расчёты, requestTrajectories (Worker)
├── tle-worker.js        # Web Worker: SGP4 в фоне (parseTle, getTrajectory24h)
├── lib/                 # Локальные библиотеки (PWA/офлайн)
│   ├── README.md        # Инструкции: что скачать
│   ├── satellite.min.js
│   ├── d3.min.js
│   └── topojson.min.js  # topojson-client, см. lib/README.md
├── data/
│   ├── Frequencies.xml
│   ├── tle.txt          # TLE (Satcom, Меридианы), автообновление GitHub Actions
│   └── countries-50m.json   # карта мира TopoJSON (world-atlas)
├── scripts/
│   └── update_tle.py    # Скрипт загрузки TLE с Space-Track (SPACETRACK_USER, SPACETRACK_PASS)
├── .github/workflows/
│   └── update-tle.yml   # Ежедневно 00:00 UTC + workflow_dispatch, авто-коммит data/tle.txt
├── PROJECT_CONTEXT.md
└── README.md
```

**Порядок скриптов в index.html:** satellite.min.js → d3.min.js → topojson.min.js → tle.js → map.js → map-render.js → app.js

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

- **index.html:** `<div id="mapView" class="map-view" hidden>` — шапка (Назад, Название, ВСЕ), #mapCanvas, оверлей загрузки, плашка GPS denied, HUD (азимут, элевация, дистанция, координаты, кнопка ↻).
- **app.js:** `openMapView(noradIds, satelliteName, noradIdToName?)` — скрывает .header/.main, показывает mapView, вызывает `window.initMap({ noradIds, satelliteName, noradIdToName })`. `closeMapView()` — возврат, вызывает `window.cleanupMap()`. Кнопка «посмотреть на карте» — data-norad, data-clean-name. Кнопка «ВСЕ» на карте — все NORAD IDs из filteredEntries + noradIdToName из filteredEntries.
- **style.css:** .map-view (fixed, fullscreen), .map-view__header, .map-view__hud (#212d3b), .map-view__gps-denied.

### 5.3 Шаг 3: Сервис геолокации (map.js)

- **GPS:** запрос с таймаутом 6 с, `navigator.permissions` (при denied — показ плашки без спама).
- **localStorage:** ключ `satcontact_observer`, lat, lon, altitude, timestamp.
- **Плашка «GPS заблокирован»:** «Проверить снова» / «Продолжить без GPS».
- **Фоновый опрос:** 1 раз в час (при denied не запускается).
- **Кнопка [↻]:** ручной запрос GPS.
- **API:** `window.getMapObserver()` — текущие координаты.

### 5.4 Шаг 4: TLE парсер и математика (tle.js, tle-worker.js)

- **satellite.js:** lib/satellite.min.js v6, `twoline2satrec`, `propagate`, `ecfToLookAngles`, `eciToGeodetic`.
- **loadTle():** fetch data/tle.txt (абсолютный URL для GitHub Pages), parseTle() → Map<NoradId, { line1, line2, satrec }>. После парсинга — worker.postMessage({ type: 'INIT_TLE', text }).
- **computeSatellite():** (tleData, observer, date) → { azimuth, elevation, distance, lat, lon, height }. Остаётся в основном потоке (HUD, footprint).
- **requestTrajectories(noradIds):** Promise. Отправляет noradIds в Worker, получает TRAJECTORIES_READY с массивом траекторий. При ошибке Worker — fallback getTrajectory24hSync() в основном потоке.
- **tle-worker.js:** importScripts('./lib/satellite.min.js'). INIT_TLE — парсинг, tleCache. CALCULATE_TRAJECTORIES — getTrajectory24h для каждого noradId, postMessage TRAJECTORIES_READY.
- **API:** `window.getMapNoradIds()`, `window.getMapNoradIdToName()`, `window.getSatellitePosition(noradId, date)`, `window.SatContactTle.requestTrajectories(noradIds)`.

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

## 6. ЧТО НЕ РЕАЛИЗОВАНО (следующие этапы)

- **Модуль 3:** AR-трекер (камера, DeviceOrientation, кнопка «НАВЕСТИСЬ»).
- **PWA:** manifest.json, Service Worker, Cache Storage, IndexedDB.

---

## 7. ИСТОРИЯ СЕССИЙ (для контекста при продолжении)

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
