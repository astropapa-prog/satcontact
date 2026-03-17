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
- **TLE** (data/tle.txt): обновляется автоматически GitHub Actions раз в сутки из Space-Track. Парсится в tle.js, используется satellite.js для расчётов орбит

## 4. ТЕКУЩАЯ РЕАЛИЗАЦИЯ — Модуль 1 (Менеджер частот)

### 4.1 Файловая структура

```
satcontact/
├── index.html           # SPA, шапка + список карточек + mapView
├── style.css            # Telegram Dark, mobile-first, стили карты
├── app.js               # Парсинг XML, фильтры, рендер, openMapView/closeMapView
├── map.js               # Модуль 2: GPS, localStorage, HUD, initMap/cleanupMap
├── map-render.js        # D3-картография: карта мира, орбиты, footprint, маркеры
├── tle.js               # TLE парсер, satellite.js расчёты (азимут, элевация, дистанция)
├── lib/                 # Локальные библиотеки (PWA/офлайн)
│   ├── README.md        # Инструкции: что скачать
│   ├── satellite.min.js
│   ├── d3.min.js
│   └── topojson.min.js  # topojson-client, см. lib/README.md
├── data/
│   ├── Frequencies.xml
│   ├── tle.txt          # TLE (Satcom, Меридианы), автообновление GitHub Actions
│   └── world-50m.json   # или countries-50m.json — карта мира TopoJSON
├── scripts/
│   └── update_tle.py    # Скрипт загрузки TLE с Space-Track (SPACETRACK_USER, SPACETRACK_PASS)
├── .github/workflows/
│   └── update-tle.yml   # Ежедневно 00:00 UTC + workflow_dispatch, авто-коммит data/tle.txt
├── PROJECT_CONTEXT.md
└── README.md
```

**Порядок скриптов в index.html:** satellite.min.js → d3.min.js → topojson.min.js → tle.js → map.js → map-render.js → app.js

**lib/:** локальные копии (PWA/офлайн). См. lib/README.md. **data/world-50m.json:** скачать countries-50m.json из world-atlas, переименовать.

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

- **scripts/update_tle.py:** авторизация Space-Track (POST ajaxauth/login), скачивание TLE по NORAD ID, сохранение в data/tle.txt. Учётные данные из env: SPACETRACK_USER, SPACETRACK_PASS.
- **.github/workflows/update-tle.yml:** cron 00:00 UTC, workflow_dispatch, secrets.SPACETRACK_USER/PASS, авто-коммит data/tle.txt при изменении. **GitHub Secrets:** SPACETRACK_USER, SPACETRACK_PASS (Settings → Secrets and variables → Actions).

### 5.2 Шаг 2: Базовый UI карты и SPA-маршрутизация

- **index.html:** `<div id="mapView" class="map-view" hidden>` — шапка (Назад, Название, ВСЕ), #mapCanvas, оверлей загрузки, плашка GPS denied, HUD (азимут, элевация, дистанция, координаты, кнопка ↻).
- **app.js:** `openMapView(noradIds, satelliteName)` — скрывает .header/.main, показывает mapView, вызывает `window.initMap()`. `closeMapView()` — возврат, вызывает `window.cleanupMap()`. Кнопка «посмотреть на карте» — data-norad, data-clean-name. Кнопка «ВСЕ» на карте — все NORAD IDs из filteredEntries.
- **style.css:** .map-view (fixed, fullscreen), .map-view__header, .map-view__hud (#212d3b), .map-view__gps-denied.

### 5.3 Шаг 3: Сервис геолокации (map.js)

- **GPS:** запрос с таймаутом 6 с, `navigator.permissions` (при denied — показ плашки без спама).
- **localStorage:** ключ `satcontact_observer`, lat, lon, altitude, timestamp.
- **Плашка «GPS заблокирован»:** «Проверить снова» / «Продолжить без GPS».
- **Фоновый опрос:** 1 раз в час (при denied не запускается).
- **Кнопка [↻]:** ручной запрос GPS.
- **API:** `window.getMapObserver()` — текущие координаты.

### 5.4 Шаг 4: TLE парсер и математика (tle.js)

- **satellite.js:** lib/satellite.min.js v6, `twoline2satrec`, `propagate`, `ecfToLookAngles`, `eciToGeodetic`.
- **loadTle():** fetch data/tle.txt, parseTle() → Map<NoradId, { line1, line2, satrec }>. NORAD ID из строки 2, символы 3–7.
- **computeSatellite():** (tleData, observer, date) → { azimuth, elevation, distance, lat, lon, height }.
- **getTrajectory24h(noradId, baseDate):** суточная траектория, шаг 5 мин, GeoJSON coordinates [[lon,lat],...].
- **map.js:** интеграция — loadTle после acquireObserver, HUD обновление каждую 1 с. Без GPS — «—» в HUD.
- **API:** `window.getMapNoradIds()`, `window.getSatellitePosition(noradId, date)`.

### 5.5 Кнопка «посмотреть на карте»

- Активна. При клике: извлечение data-norad и data-clean-name из карточки, SPA-переход в mapView, вызов initMap.

### 5.6 Шаг 5: D3-картография (map-render.js)

- **Библиотеки:** lib/d3.min.js, lib/topojson.min.js (topojson-client). data/world-50m.json или countries-50m.json.
- **Цвета:** океан #1c242d, суша #212d3b, границы rgba(255,255,255,0.1).
- **Карта:** fetch world-50m.json или countries-50m.json, topoToGeo(topology, 'countries'|'land'), d3.geoPath(), geoMercator.
- **Орбита:** getTrajectory24h(noradId) — 24 ч, шаг 5 мин, GeoJSON LineString, d3.geoPath (антимеридиан).
- **Footprint:** d3.geoCircle по высоте орбиты (arcsin(R/(R+h))).
- **Маркеры:** зелёный — наблюдатель, синий — спутник. Режим «ВСЕ» — только маркеры без орбит/footprint.
- **Интеграция:** SatContactMapRender.init(mapCanvas), update() каждую 1 с, destroy() в cleanupMap.
- **topojson API:** поддержка window.topojson.feature и window.topojsonClient (функция или объект).

---

## 6. ЧТО НЕ РЕАЛИЗОВАНО (следующие этапы)

- **Шаг 6:** Режим «ВСЕ» — уже работает (маркеры всех спутников), возможна полировка.
- **Модуль 3:** AR-трекер (камера, DeviceOrientation, кнопка «НАВЕСТИСЬ»).
- **PWA:** manifest.json, Service Worker, Cache Storage, IndexedDB.

---

## 7. КРАТКАЯ ИСТОРИЯ (для справки)

Модуль 1: каркас → группы, фильтры, поиск по частоте → редизайн шапки (тумблеры, чипсы) → мобильные фиксы (overscroll, forceBlur, chip--blurred) → брендинг SatContact, карточка 4 зоны, множественные NORAD ID. Модуль 2: GitHub Actions (TLE) → UI карты, GPS, HUD → tle.js + satellite.js → lib/ (офлайн) → D3-картография. Важно: topojson API — поддержка `topojson.feature` и `topojsonClient`; fallback для world-50m/countries-50m.
