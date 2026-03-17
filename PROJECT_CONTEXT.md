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
├── tle.js               # TLE парсер, satellite.js расчёты (азимут, элевация, дистанция)
├── lib/                 # Локальные библиотеки (PWA/офлайн)
│   ├── README.md        # Инструкции: что скачать
│   └── satellite.min.js # скачать вручную, см. lib/README.md
├── data/
│   ├── Frequencies.xml
│   └── tle.txt          # TLE (Satcom, Меридианы), автообновление GitHub Actions
├── scripts/
│   └── update_tle.py    # Скрипт загрузки TLE с Space-Track (SPACETRACK_USER, SPACETRACK_PASS)
├── .github/workflows/
│   └── update-tle.yml   # Ежедневно 00:00 UTC + workflow_dispatch, авто-коммит data/tle.txt
├── PROJECT_CONTEXT.md
└── README.md
```

**Порядок скриптов в index.html:** lib/satellite.min.js → tle.js → map.js → app.js

**lib/:** локальные копии библиотек (для PWA/офлайн). См. lib/README.md — что скачать.

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

- **satellite.js:** CDN v6, `twoline2satrec`, `propagate`, `ecfToLookAngles`, `eciToGeodetic`.
- **loadTle():** fetch data/tle.txt, parseTle() → Map<NoradId, { line1, line2, satrec }>. NORAD ID из строки 2, символы 3–7.
- **computeSatellite():** (tleData, observer, date) → { azimuth, elevation, distance, lat, lon }.
- **map.js:** интеграция — loadTle после acquireObserver, HUD обновление каждую 1 с. Без GPS — «—» в HUD.
- **API:** `window.getMapNoradIds()`, `window.getSatellitePosition(noradId, date)` — для D3 (Шаг 5).

### 5.5 Кнопка «посмотреть на карте»

- Активна. При клике: извлечение data-norad и data-clean-name из карточки, SPA-переход в mapView, вызов initMap.

---

## 6. ЧТО НЕ РЕАЛИЗОВАНО (следующие этапы)

- **Шаг 5:** Картография и рендер (D3.js) — topojson world-50m, орбиты, footprint, маркер спутника.
- **Шаг 6:** Режим «ВСЕ» на карте — все маркеры отфильтрованных спутников (без сложных орбит).
- **Модуль 3:** AR-трекер (камера, DeviceOrientation, кнопка «НАВЕСТИСЬ»).
- **PWA:** manifest.json, Service Worker, Cache Storage, IndexedDB.

### План Шага 5 (D3.js) — для продолжения

- **Библиотеки:** d3.js, topojson.js. Файл data/world-50m.json (Natural Earth).
- **Цвета:** океан #1c242d, суша #212d3b, границы rgba(255,255,255,0.1).
- **Суточная траектория:** t=0..24h, шаг 5 мин → d3.geoPath().
- **Footprint:** круг радиовидимости по высоте орбиты.
- **Маркер:** движущаяся точка спутника.
- **API для рендера:** `getMapObserver()`, `getMapNoradIds()`, `getSatellitePosition(noradId, date)`.

---

## 7. ИСТОРИЯ СЕССИИ (для контекста)

### Этапы разработки Модуля 1

1. Создан каркас: index.html, style.css, app.js — парсинг XML, карточки, базовые фильтры
2. Добавлен выпадающий список групп, заголовок «SAT Навигатор»
3. Разделение: фильтры по кнопкам (множественный выбор) и поиск по частоте
4. Удалён параметр IsFavourite
5. Регенерация чипсов при смене группы
6. Редизайн шапки: компактная панель, тумблеры Полоса/Чувств., горизонтальный скролл рядов
7. Исправления: wheel-скролл на десктопе, chip-row--collapsed вместо hidden, категория по родителю, blur() для снятия фокуса
8. Сброс фильтров при сворачивании рядов Полоса/Чувств.
9. Поиск по частоте: префикс (startsWith) вместо подстроки (includes)
10. Placeholder «Поиск по частоте»
11. **Overscroll на мобильных:** при скролле строки фильтров вправо до конца следующий жест закрывал браузер. Решение: `overscroll-behavior-x: none` на .chip-scroll и body; touchmove с preventDefault при достижении края (scrollLeft≤2 или ≥max-2) и свайпе в направлении overscroll
12. **Чипсы «залипают» на мобильных:** при отключении фильтра повторным кликом кнопка продолжала гореть. Решение: `forceBlur()` (blur + fallback с временным input); класс `chip--blurred` + CSS override; `bindChipBlurReset()` — сброс при касании вне чипсов
13. **Тумблеры Полоса/Чувств. «залипают» на мобильных:** аналогично чипсам. Решение: класс `btn--blurred` + CSS override для .btn--toggle; в click-хендлерах: add btn--blurred + forceBlur(); `bindChipBlurReset` расширен — сброс при касании вне чипсов и тумблеров

### Сессия: редизайн карточки и брендинг SatContact

14. **Брендинг:** SDR Frequency Manager → SatContact (title, meta, description, app.js, style.css, README)
15. **Множественные NORAD ID:** extractNoradIds() — извлечение всех [id] из Name; отображение всех ID в карточке; data-norad для модулей карты и AR-трекера
16. **Карточка 4 зоны:** grid-раскладка — слева имя/частота, центр транспондер+полоса, справа кнопки; число полосы на уровне RX; яркость по ширине (6–8 kHz / >8 kHz)
17. **Овальные кнопки:** «посмотреть на карте», «НАВЕСТИСЬ»; блок транспондера между частотой и кнопками; надпись без скобок
18. **Мобильная адаптация:** кнопки вертикально (одна над другой), фиксированный одинаковый размер, не зависящий от длины надписи
19. **Планшет/десктоп:** кнопки в ряд, по центру, равный размер

### Сессия: Модуль 2 — Интерактивная карта (Шаги 1–4)

20. **Шаг 1 — GitHub Actions:** scripts/update_tle.py (Space-Track auth, env vars), .github/workflows/update-tle.yml (cron 00:00 UTC, workflow_dispatch, secrets, авто-коммит data/tle.txt)
21. **Шаг 2 — UI карты:** index.html — mapView с шапкой, canvas, loading overlay, GPS denied overlay, HUD. app.js — openMapView/closeMapView, bindMapButtons. style.css — стили карты. data-clean-name на карточках.
22. **Шаг 3 — Геолокация:** map.js — GPS с таймаутом 6 с, permissions check, localStorage (satcontact_observer), плашка denied, фоновый опрос 1/час, кнопка [↻], getMapObserver()
23. **Шаг 4 — TLE и математика:** satellite.js (CDN v6), tle.js — loadTle, parseTle, computeSatellite, formatAzimuth, formatElevation. map.js — HUD update каждую 1 с, getMapNoradIds(), getSatellitePosition(). Без GPS: «—» в HUD
