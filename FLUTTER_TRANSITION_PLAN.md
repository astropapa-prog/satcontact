# SatContact Native — План перехода на Flutter (Android-first, iOS — в перспективе)

## 1. Обоснование: почему полный переход, а не обёртка

PWA-версия SatContact работает в браузере и принципиально ограничена его песочницей.
Для полевого инструмента радиолюбителя эти ограничения критичны:

| Ограничение PWA | Что даёт нативное приложение |
|---|---|
| `DeviceOrientationEvent` — предобработанные углы Эйлера, нет контроля над фузией сенсоров | Сырые данные магнитометра, акселерометра, гироскопа. Собственный EKF AHRS с оценкой дрейфа и калибровкой |
| Gimbal lock при наведении в зенит (углы Эйлера) | Кватернионная ориентация — без вырождений |
| Нет информации о качестве GPS-фиксации | Сырые GNSS-данные: кол-во спутников, HDOP, SNR, созвездия (GPS/ГЛОНАСС/Galileo/BeiDou) |
| GPS засыпает при блокировке экрана | Foreground Service — GPS работает при заблокированном экране |
| Canvas/WebGL в WebView — ~30 FPS с просадками | Flutter Impeller (Vulkan/OpenGL) — стабильные 60 FPS, GPU-ускоренный CustomPainter |
| Cache Storage с квотами, система может удалить кеш | Прямой доступ к файловой системе — офлайн-тайлы карт в постоянной памяти |
| Нет доступа к параметрам камеры (FOV) | Camera2 API — реальное поле зрения для точной AR-проекции |
| Нет доплеровского сдвига на карточке частоты | Расчёт range rate из SGP4 — отображение актуальной частоты с учётом доплера |

**Решение:** Полностью новое приложение на **Flutter (Dart)** с приоритетом на Android.
Архитектура Flutter позволяет в будущем собрать и iOS-версию из той же кодовой базы,
но на текущем этапе все platform channels и тестирование — только Android.
PWA замораживается — продолжает работать по ссылке, но не развивается.

## 2. Технологический стек

| Компонент | Технология | Зачем |
|---|---|---|
| Язык | Dart (Flutter) | Компилируется в нативный ARM через AOT; единый код, собирается под Android сейчас и под iOS в будущем |
| Рендер | Impeller (Vulkan / OpenGL) | GPU-ускоренный CustomPainter для AR-оверлея, 60 FPS |
| Карта | `flutter_map` + `flutter_map_tile_caching` | Тайловая карта с офлайн-кешированием на файловую систему |
| GPS | `geolocator` + кастомный platform channel (Kotlin) для сырых GNSS | Координаты + качество фиксации + heading при движении |
| Сенсоры | **Кастомный platform channel (Kotlin)** + собственный EKF AHRS | Аппаратные timestamps, uncalibrated-данные, контроль частоты опроса (см. §3.1) |
| Камера | `camera` + platform channel для Camera2 характеристик | Видеопоток для AR + focal length / sensor size → реальный FOV |
| Хранилище | `drift` (SQLite) | Локальная БД для частот, TLE, настроек. Активно развивается, типобезопасные запросы |
| Бэкенд данных | Backblaze B2 (S3-совместимый) | Чат, доска объявлений, обновление Frequencies.xml без релиза APK |
| HTTP | `dio` | HTTP-клиент с S3-подписью для B2 |
| Стейт-менеджмент | `flutter_riverpod` | Реактивная подписка: каждый виджет слушает только свои данные, AR-painter не трогает остальной UI |
| Жизненный цикл | `wakelock_plus` | Экран не гаснет в AR-режиме; управляемое поведение при сворачивании |
| Разрешения | `permission_handler` | Единый API запроса CAMERA, FINE_LOCATION, FOREGROUND_SERVICE |

## 3. Архитектура ядра: AHRS (Attitude and Heading Reference System)

### 3.1 Почему не DeviceOrientation и не sensors_plus

Браузерный `DeviceOrientationEvent` — это чёрный ящик. Производитель телефона решает,
как смешивать сенсоры, и результат на разных устройствах катастрофически отличается.

Пакет `sensors_plus` для Flutter снимает часть ограничений, но для EKF он непригоден:
- **Нет аппаратного timestamp.** `sensors_plus` не пробрасывает `SensorEvent.timestamp`
  из Android SDK. Событие доходит до Dart через platform channel с неопределённой
  задержкой (event loop + GC + marshalling). Использование `DateTime.now()` вместо
  аппаратного времени вносит джиттер ~1-5 мс, что критично для интегрирования гироскопа.
- **Нет uncalibrated-типов.** `TYPE_GYROSCOPE_UNCALIBRATED` и
  `TYPE_MAGNETIC_FIELD_UNCALIBRATED` недоступны. Android может применить свою
  калибровку поверх нашей, искажая данные.
- **Нет контроля частоты.** Нельзя явно задать `SENSOR_DELAY_GAME` (~50 Гц, стабильный)
  или `SENSOR_DELAY_FASTEST` (~200 Гц, нестабильный).

**Решение:** Кастомный platform channel на Kotlin (`SensorService`), который:
1. Регистрирует `TYPE_GYROSCOPE_UNCALIBRATED`, `TYPE_ACCELEROMETER`,
   `TYPE_MAGNETIC_FIELD_UNCALIBRATED` с `SENSOR_DELAY_GAME`.
2. Для каждого события передаёт в Dart `[timestamp_ns, x, y, z]`, где `timestamp_ns` —
   значение `SensorEvent.timestamp` (наносекунды аппаратного таймера).
3. EKF вычисляет `dt = (timestamp_ns - prev_timestamp_ns) / 1e9` — точное,
   без джиттера Dart event loop.

### 3.2 Extended Kalman Filter (EKF)

**Вектор состояния** — 7 элементов:

```
x = [q0, q1, q2, q3, bωx, bωy, bωz]
     ─── кватернион ───  ─── дрейф гироскопа ───
```

**Predict (~50 Гц, `SENSOR_DELAY_GAME`)** — интеграция гироскопа:

```
dt = (event.timestamp_ns - prev_timestamp_ns) / 1e9   ← аппаратный таймер, не системное время
ω_corrected = ω_raw - bias_estimate
q_predicted = q ⊗ Δq(ω_corrected, dt)
P_predicted = F·P·Fᵀ + Q
```

`dt` берётся строго из разницы `SensorEvent.timestamp` двух последовательных событий
гироскопа. Системное время (`System.nanoTime()` / `DateTime.now()`) не используется,
так как оно включает задержки ОС, GC и event loop.

Гироскоп гладкий и быстрый, но дрейфует. Prediction даёт плавное отслеживание поворотов.

**Update: акселерометр** — коррекция крена и тангажа по вектору гравитации:

```
g_expected = quat_rotate(q, [0, 0, -9.81])
innovation = a_measured − g_expected
→ коррекция q (pitch, roll) через Kalman gain
```

**Адаптивное доверие к акселерометру:** Когда пользователь идёт, бежит или трясёт рукой,
`a_measured` содержит не только гравитацию, но и линейное ускорение движения.
Если `|a_measured|` отклоняется от 9.81 м/с², EKF снижает доверие к акселерометру,
увеличивая ковариацию шума `R_accel` (см. §3.6).

**Update: магнитометр** — коррекция курса по магнитному северу:

```
m_expected = quat_rotate(q, WMM_field_vector(lat, lon, alt))
innovation = m_calibrated − m_expected
→ коррекция q (heading) через Kalman gain
```

**Автоматическая оценка дрейфа гироскопа:**
EKF включает `bias` в состояние и непрерывно его уточняет.
Через ~30 секунд систематическая ошибка гироскопа скомпенсирована.

### 3.3 Почему сразу EKF, а не Madgwick

Фильтр Маджвика (Madgwick AHRS) проще в реализации — один параметр `beta`.
Однако для мобильного устройства в руке пользователя у него критические недостатки:

- **Фиксированный `beta`** — нет механизма адаптивного доверия. При ходьбе рядом
  с металлической конструкцией нужно одновременно снизить доверие к акселерометру
  (тряска) и магнитометру (помеха). Madgwick этого не умеет.
- **Нет оценки дрейфа гироскопа.** Madgwick полагается на то, что bias гироскопа
  пренебрежимо мал. На дешёвых MEMS-сенсорах мобильных это не так.
- **Адаптивный Madgwick ≈ половина EKF.** Чтобы добавить динамический `beta`
  по состоянию сенсоров, мы фактически изобретаем ковариационную матрицу.

EKF сложнее в реализации (матрицы 7×7, якобианы), но формулы уже описаны в этом
документе, а объём вычислений для матриц 7×7 на Dart AOT — ~50 мкс на итерацию,
что пренебрежимо мало для 50 Гц цикла (20 мс на кадр).

### 3.4 Калибровка магнитометра

**Hard Iron** — постоянное смещение от намагниченных деталей телефона:

```
B_corrected = B_raw - offset
offset ← least-squares sphere fitting по ~100 измерениям при вращении
```

**Soft Iron** — деформация поля (сфера → эллипсоид):

```
B_corrected = A_inv × (B_raw - offset)
A_inv ← eigenvalue decomposition из собранных данных
```

**Автоматический сбор данных:** При вращении телефона в AR-режиме (пользователь естественно
крутится, ища спутник) приложение накапливает данные магнитометра в фоне.
Когда набрано достаточно (~100 точек с хорошим покрытием сферы), пересчёт калибровки.

### 3.5 Детекция магнитных аномалий

```dart
double expectedMagnitude = wmm.totalField(lat, lon, altKm); // ~50 μT
double measuredMagnitude = magCorrected.length;
double deviation = (measuredMagnitude - expectedMagnitude).abs() / expectedMagnitude;

if (deviation > 0.15) {
  // Аномалия! Рядом металл, ЛЭП, автомобиль, антенна...
  // 1. Снизить вес магнитометра в EKF (увеличить R_mag)
  // 2. Полагаться на гироскоп (точен краткосрочно)
  // 3. Показать предупреждение в UI: "⚠ Магнитная помеха"
}
```

### 3.6 Адаптивное доверие к акселерометру

Зеркальная логика к детекции магнитных аномалий (§3.5), но для акселерометра.
Когда пользователь движется, `a_measured` содержит гравитацию + линейное ускорение
руки/тела. Использовать такие данные для коррекции pitch/roll нельзя.

```dart
double accelMag = accelMeasured.length;
double accelDeviation = (accelMag - 9.81).abs() / 9.81;

if (accelDeviation > 0.1) {
  // Движение или тряска: увеличить R_accel (снизить доверие)
  // EKF полагается на гироскоп для pitch/roll
  rAccelScale = 1.0 + accelDeviation * 50.0; // плавное масштабирование
} else {
  rAccelScale = 1.0; // покой — полное доверие акселерометру
}
```

Этот механизм и детекция магнитных аномалий (§3.5) работают совместно:
в худшем случае (ходьба рядом с ЛЭП) оба корректора снижают доверие
к акселерометру и магнитометру, и EKF кратковременно опирается
только на гироскоп + оценку дрейфа.

## 4. GPS: от координат к навигационной системе

### 4.1 Базовый GPS

Пакет `geolocator` — координаты, высота, скорость, heading, accuracy.
На Android поддерживает Foreground Service для работы при заблокированном экране.

### 4.2 Сырые GNSS (Android API 24+)

Через кастомный platform channel (Kotlin → Dart):

```
GnssStatus:
  - satelliteCount: 18
  - usedInFix: [true, true, false, true, ...]
  - svid[i], constellation[i] (GPS, GLОНАСС, Galileo, BeiDou)
  - cn0DbHz[i] (сила сигнала)
  - azimuth[i], elevation[i] (позиции навигационных спутников на небе)
```

**Применение:**
- Показать пользователю качество GPS: "12/18 спутников, HDOP 1.2"
- Отобразить навигационные спутники на AR-экране (GPS/ГЛОНАСС в небе)
- Предупредить, если калибровка по ориентиру ненадёжна из-за плохого GPS

### 4.3 Heading from GPS

Когда пользователь движется (скорость > 1 м/с), GPS-heading — дополнительный
источник для EKF, иммунный к магнитным помехам:

```dart
if (gpsSpeed > 1.0 && gpsHeadingAccuracy < 10.0) {
  ahrs.updateGpsHeading(gpsHeading, gpsHeadingAccuracy);
}
```

### 4.4 Калман-фильтр для позиции

Сглаживание GPS-прыжков + инерциальное счисление при потере сигнала:

```
State = [lat, lon, vN, vE]
Predict: position += velocity × dt (из акселерометра, повёрнутого в ENU)
Update: GPS measurement → коррекция
```

Когда GPS пропадает (лес, ущелье) — позиция продолжает обновляться
по инерции. Грубо, но лучше, чем "НЕТ ДАННЫХ".

### 4.5 Минимальная дистанция до ориентира

При калибровке по ориентиру на карте точность зависит от расстояния:

```
Ошибка азимута ≈ arctan(GPS_accuracy / distance_to_landmark)

distance = 50м,  accuracy = 5м  → ошибка ≈ 5.7°  (неприемлемо)
distance = 200м, accuracy = 5м  → ошибка ≈ 1.4°  (допустимо)
distance = 500м, accuracy = 5м  → ошибка ≈ 0.6°  (хорошо)
```

Приложение должно:
- Показывать расчётную ошибку: "Точность калибровки: ±1.4°"
- Предупреждать при distance < 200м: "Выберите более далёкий ориентир"
- Учитывать текущую GPS-accuracy в расчёте

## 5. Расчёт спутников: SGP4 + рефракция + доплер

### 5.1 SGP4/SDP4

Портируется из PWA (`satellite.min.js` → Dart). Вычисления работают в реальном
времени: позиция каждого видимого спутника пересчитывается раз в секунду через
`Timer.periodic` в основном Isolate. Для визуализации ground track на 24 часа
(~144 точки на спутник с шагом 10 мин) — десятки миллисекунд, Isolate не нужен.

**Тяжёлые батчи:** Парсинг свежего TLE-каталога (сотни спутников) или XML-справочника
частот может занять >16 мс и дёрнуть UI. Если профилирование (Flutter DevTools)
подтвердит jank — эти операции выносятся в `Isolate.run()` / `compute()`.

### 5.2 Полный пайплайн координатных преобразований

```
1. SGP4            → позиция в ECI (Earth-Centered Inertial)
2. ECI → ECEF      → поворот на GMST (Greenwich Mean Sidereal Time)
3. ECEF → ENU      → East-North-Up в точке наблюдателя (WGS84 эллипсоид)
4. ENU → Device    → поворот кватернионом AHRS
5. Device → Screen → перспективная проекция с калиброванным FOV камеры
```

Все преобразования — на WGS84 эллипсоиде (не на сфере, как в текущем PWA).

### 5.3 Атмосферная рефракция

Атмосфера искривляет видимое положение спутника у горизонта:

```dart
double refractionDeg(double elevationDeg) {
  if (elevationDeg > 85) return 0;
  double r = 1.02 / tan((elevationDeg + 10.3 / (elevationDeg + 5.11)) * deg);
  return r / 60; // при elevation=0° → коррекция ≈ +0.57°
}
```

Применяется к elevation перед проекцией на экран.

### 5.4 Доплеровский сдвиг

Range rate вычисляется из двух последовательных позиций SGP4:

```dart
double dopplerHz(double freqHz, double rangeRateKmS) {
  const c = 299792.458; // км/с
  return -freqHz * rangeRateKmS / c;
}
```

Отображение на карточке частоты:
"243.625 MHz → **243.618 MHz** (доплер −7.2 кГц)"

### 5.5 Визуализация ground track и «восьмёрок» GEO-спутников

Геостационарные спутники не находятся в идеально неподвижной точке —
наклонение орбиты и эксцентриситет заставляют их описывать характерную
фигуру «восьмёрка» (анаклемму) относительно номинальной позиции за сутки.

Визуализация ground track за 24 часа (шаг 10 мин = 144 точки SGP4 на спутник):

```dart
List<LatLng> groundTrack(TleData tle, {int hours = 24, int stepMin = 10}) {
  final points = <LatLng>[];
  final now = DateTime.now().toUtc();
  for (int m = 0; m <= hours * 60; m += stepMin) {
    final t = now.add(Duration(minutes: m));
    final eci = sgp4Propagate(tle, t);
    final geodetic = eciToGeodetic(eci, gmst(t));
    points.add(LatLng(geodetic.latDeg, geodetic.lonDeg));
  }
  return points;
}
```

Ground track пересчитывается при смене выбранного спутника и обновляется
раз в час. Батчевый предрасчёт пролётов (AOS/LOS) для сотен спутников
не реализуется — он не нужен для текущих задач и может быть добавлен позже
как отдельная фаза.

## 6. AR-рендер: проекция через кватернион

### 6.1 Проекция спутника на экран

```dart
// Вектор к спутнику в ENU
Vector3 satENU = ecefToEnu(satECEF, observerLLA);

// Поворот в систему координат устройства через кватернион AHRS
Vector3 satDevice = ahrs.quaternion.conjugate().rotate(satENU);

// Спутник за спиной — не рисуем
if (satDevice.z <= 0) continue;

// Перспективная проекция
double focalPx = (screenWidth / 2) / tan(fovH / 2);
double sx = screenWidth / 2  + (satDevice.x / satDevice.z) * focalPx;
double sy = screenHeight / 2 - (satDevice.y / satDevice.z) * focalPx;
```

Никаких углов Эйлера в пайплайне проекции. Кватернион → прямое 3D-преобразование.

### 6.2 Синхронизация камеры и AR-оверлея

Кадр камеры и `CustomPainter` рендерятся в разных pipeline-ах. Кадр камеры
приходит с задержкой ~30-80 мс (exposure + ISP + texture upload). Если для
проекции использовать кватернион AHRS «сейчас», а не «в момент захвата кадра»,
маркер спутника будет «плыть» при быстрых поворотах.

**Решение — timestamp matching:** AHRS хранит кольцевой буфер последних ~200 мс
кватернионов с аппаратными timestamps. Для каждого кадра камеры подбирается
ближайший по времени кватернион:

```dart
class AhrsHistory {
  final _buffer = Queue<(int timestampNs, Quaternion q)>();

  Quaternion getAtTime(int targetNs) {
    // бинарный поиск ближайшего timestamp в буфере
    // линейная интерполяция (slerp) между двумя соседними
  }
}
```

### 6.3 Калибровка FOV камеры

```dart
// Android Camera2 API через platform channel (Kotlin)
final focalLength = cameraCharacteristics.physicalFocalLength;   // мм
final sensorWidth = cameraCharacteristics.sensorPhysicalSize.x;  // мм
final sensorHeight = cameraCharacteristics.sensorPhysicalSize.y; // мм
double fovH = 2 * atan(sensorWidth / (2 * focalLength));  // рад
double fovV = 2 * atan(sensorHeight / (2 * focalLength)); // рад
```

> iOS-версия (в перспективе): `AVCaptureDevice.activeFormat.videoFieldOfView`.

### 6.4 Flutter CustomPainter

```dart
class ArOverlayPainter extends CustomPainter {
  final List<SatelliteScreenPos> satellites;
  final AhrsState ahrsState;
  final bool showHorizon;
  final String? focusedId;

  @override
  void paint(Canvas canvas, Size size) {
    if (showHorizon) drawHorizonLine(canvas, size);
    drawAzElGrid(canvas, size);        // координатная сетка
    drawTrajectories(canvas, size);     // траектории на небе
    drawSatellites(canvas, size);       // точки спутников + подписи
    if (focusedId != null) drawCrosshair(canvas, size); // прицел
  }
}
```

`ArOverlayPainter` подписан на `ValueNotifier<AhrsState>` через параметр `repaint`.
Перерисовывается **только** Canvas-слой оверлея (~50 Гц), дерево виджетов Flutter
не перестраивается. Остальной UI обновляется через Riverpod с независимой частотой (§10.1).

Рендер через Impeller — Vulkan/OpenGL (Android). Target: 60 FPS.

## 7. Калибровка компаса: три метода

### 7.1 По небесному телу (из PWA)

Солнце, Луна, Полярная звезда, Венера, Юпитер, Сириус.
Алгоритм портируется из `ar.js` → Dart. Астрономические формулы — 1:1.

### 7.2 По ориентиру на карте (новое)

1. Пользователь на спутниковой карте делает long tap на видимый объект
2. Приложение рассчитывает геодезический азимут (Vincenty) от GPS-позиции до маркера
3. Показывает расчётную точность (зависит от дистанции и GPS accuracy)
4. Пользователь переходит в AR, наводит камеру на ориентир, жмёт "Фиксация"
5. EKF получает абсолютное значение heading → `calibrationDelta` для коррекции

Требование: расстояние до ориентира ≥ 200м для accuracy ≤ 5м.

### 7.3 По GPS-heading при движении (новое, автоматическое)

Когда пользователь идёт или едет, GPS-heading непрерывно корректирует
AHRS без участия пользователя. Не заменяет основную калибровку,
но компенсирует медленный дрейф между калибровками.

## 8. Карта с офлайн-тайлами

### 8.1 flutter_map + tile caching

```dart
FlutterMap(
  options: MapOptions(center: userPosition, zoom: 14),
  children: [
    TileLayer(
      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileProvider: CachedTileProvider(store: fmtcStore),
    ),
    SatelliteTrackLayer(satellites: visibleSatellites),
    UserPositionLayer(position: gpsPosition, accuracy: gpsAccuracy),
    LandmarkMarkerLayer(onLongPress: setCalibrationLandmark),
  ],
)
```

### 8.2 Скачивание района

Кнопка "Сохранить район" — пользователь выбирает прямоугольник на карте,
приложение скачивает тайлы на zoom 12-16 в постоянную память:

```
Zoom 12: 1 тайл         (256×256, ~30 КБ)
Zoom 13: 4 тайла
Zoom 14: 16 тайлов
Zoom 15: 64 тайла
Zoom 16: 256 тайлов
Итого: ~341 тайл × ~30 КБ ≈ 10 МБ на район ~10×10 км
```

### 8.3 Отображение на карте

- Ground track из SGP4 — трек за 24 часа (для GEO-спутников видна «восьмёрка»)
- Зона видимости (footprint) — окружность под спутником
- Sub-satellite point — точка прямо под спутником
- Позиция пользователя + direction cone (куда смотрит камера)

## 9. Обновление данных

### 9.1 Frequencies.xml

- Хранится на Backblaze B2 в публичном бакете (read без ключей)
- При старте: HEAD-запрос (ETag/Last-Modified)
- Если обновилось — скачать, распарсить, сохранить в drift (SQLite)
- В офлайне — последняя сохранённая версия
- Fallback: встроенная копия в assets/ (на случай первого запуска без сети)

### 9.2 TLE-данные

- Источник: CelesTrak (как сейчас в PWA)
- Обновление раз в 12-24 часа (TLE устаревают)
- Кеширование в drift (SQLite) с timestamp
- Обновление при запуске приложения и по запросу пользователя

### 9.3 Доска объявлений + Чат

Портируется из `news.js`. B2-клиент переписывается на `dio` с S3v4-подписью.
Чат-сообщения: S3 ListObjects → fetch JSON → рендер в ListView.

## 10. Архитектура приложения: состояние, жизненный цикл, разрешения

### 10.1 Управление состоянием (Riverpod)

EKF генерирует кватернионы на ~50 Гц. GPS обновляется на 1 Гц. TLE пересчитывается
раз в секунду. Если пробрасывать каждое обновление через `setState()` верхнего уровня,
перестроится всё дерево виджетов — карта, справочник, навигация — и UI начнёт терять кадры.

**Принцип:** каждый виджет подписан только на те данные, которые ему нужны.

| Поток данных | Провайдер (Riverpod) | Подписчики |
|---|---|---|
| Кватернион AHRS (~50 Гц) | `StreamProvider<AhrsState>` | Только `ArOverlayPainter` через `ValueNotifier` (§6.4) |
| GPS-позиция (1 Гц) | `StreamProvider<GpsPosition>` | Карта, AR (для ENU-преобразования), статус-бар |
| Видимые спутники (1 Гц) | `Provider<List<SatScreenPos>>` | AR-оверлей, карта, справочник (доплер) |
| Сырые GNSS | `StreamProvider<GnssStatus>` | Статус-бар GPS (спутники, HDOP) |
| Магнитная аномалия | `Provider<bool>` | Статус-бар, AR (иконка предупреждения) |
| Настройки / тема | `StateProvider` | Весь UI (но меняется редко) |

**AR-оверлей** — самый горячий путь. `ArOverlayPainter` получает данные через
`ValueNotifier<AhrsState>`, переданный как `repaint` параметр `CustomPainter`.
Это вызывает `paint()` напрямую, минуя `build()` виджетов. Остальное дерево
Flutter не перестраивается.

### 10.2 Жизненный цикл приложения

Инструмент полевой — пользователь чередует активную работу с экраном, блокировку
телефона и переключение на другие приложения. Без явного управления жизненным циклом
сенсоры продолжат работать в фоне, убивая батарею.

**При уходе в фон (`AppLifecycleState.paused`):**

| Ресурс | Действие |
|---|---|
| Камера | Остановить (Android может убить процесс при удержании камеры в фоне) |
| Сенсоры (гироскоп, акселерометр, магнитометр) | Отключить через platform channel |
| EKF | Приостановить, сбросить `prev_timestamp_ns` |
| WakeLock | Отпустить |
| Foreground Service GPS | Оставить, если активен трекинг |

**При возврате на передний план (`AppLifecycleState.resumed`):**

1. Перерегистрировать сенсоры через platform channel
2. Сбросить `prev_timestamp_ns` в EKF (иначе первый `dt` = время в фоне → predict улетит)
3. Дать EKF 2-3 секунды на конвергенцию (показать индикатор «Стабилизация…»)
4. Перезапустить камеру (если был AR-режим)
5. Включить WakeLock (если AR-режим)

**WakeLock:** Пакет `wakelock_plus` включается при входе в AR-режим и выключается
при выходе. Экран не гаснет, пока пользователь наводит камеру на спутник.

### 10.3 Разрешения (Permissions)

Android требует явного запроса разрешений в runtime. Стратегия — запрашивать
разрешения **в момент первого использования функции**, а не все сразу при старте:

| Разрешение | Когда запрашивается | Без него |
|---|---|---|
| `CAMERA` | Первый вход в AR-режим | AR недоступен, остальное работает |
| `ACCESS_FINE_LOCATION` | Первый вход в Карту или AR | Карта без позиции, нет ENU-преобразования |
| `FOREGROUND_SERVICE_LOCATION` | Включение фонового GPS-трекинга | Трекинг невозможен |

Пакет `permission_handler` — единый API для всех платформ. При отказе пользователя
показывается объяснение (rationale) и кнопка перехода в системные настройки.

> `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` **не используется** — Android не троттлит
> сенсоры на переднем плане, а в фоне сенсоры и так отключены (§10.2).
> Foreground Service GPS работает без этого разрешения.

## 11. Структура проекта

```
D:\satcontact\
├── satcontact\                ← PWA (заморожена, read-only reference)
│   ├── app.js                     Модуль 1: справочник частот
│   ├── ar.js                      Модуль 3: AR-трекер, калибровка
│   ├── ar-render.js               Рендер AR-оверлея
│   ├── map.js / map-render.js     Модуль 2: D3-карта
│   ├── gps-service.js             GPS state machine
│   ├── tle.js / tle-worker.js     SGP4 в Web Worker
│   ├── news.js                    Модуль 4: доска + чат (B2)
│   ├── data/Frequencies.xml       Справочник частот
│   └── style.css                  Тёмная тема, дизайн
│
└── satcontact_flutter\        ← Новое нативное приложение (Android)
    ├── lib/
    │   ├── main.dart
    │   ├── core/
    │   │   ├── ahrs/                  EKF AHRS, калибровка магнитометра, адаптивные R
    │   │   ├── sensors/               Абстракция сенсоров (Dart-сторона platform channel)
    │   │   ├── gnss/                  GPS + сырые GNSS данные
    │   │   ├── satellite/             SGP4, ground track, доплер
    │   │   ├── wmm/                   WMM-2025 магнитная модель
    │   │   ├── astro/                 Солнце, Луна, планеты, звёзды
    │   │   ├── projection/            ECI→ECEF→ENU→Device→Screen
    │   │   └── math/                  Кватернионы, матрицы, геодезия
    │   ├── features/
    │   │   ├── frequencies/           Справочник частот + доплер
    │   │   ├── ar/                    AR-трекер + CustomPainter
    │   │   ├── map/                   flutter_map + офлайн
    │   │   └── news/                  Доска + чат (B2)
    │   ├── services/
    │   │   ├── storage/               drift (SQLite)
    │   │   └── b2_client.dart         Backblaze B2 API
    │   └── theme/                     Тёмная тема, Material 3
    ├── android/
    │   └── app/src/main/kotlin/       Platform channels: SensorService, GnssService, CameraInfo
    ├── assets/
    │   └── Frequencies.xml            Встроенный fallback
    ├── .cursor/rules/
    │   ├── architecture.mdc           Архитектурные правила
    │   └── reference.mdc              Ссылки на PWA-код
    └── pubspec.yaml
```

## 12. Маппинг модулей PWA → Flutter

| PWA-файл | Flutter-эквивалент | Что портируется | Что добавляется |
|---|---|---|---|
| `gps-service.js` | `core/gnss/` | State machine (off→active→cooldown→denied), кеш координат, IP-fallback | Сырые GNSS (platform channel Kotlin), Калман-фильтр позиции, GPS heading в EKF |
| `ar.js` | `features/ar/` + `core/ahrs/` + `core/sensors/` | Калибровка по небесным телам, state machine (calibrating→rendering), аудио-прицел | EKF AHRS с адаптивными R, калибровка по ориентиру, hw timestamps, кватернионная проекция |
| `ar-render.js` | `features/ar/painter/` | Отрисовка спутников, траекторий, прицела, телеметрии | CustomPainter через Impeller, 60 FPS, линия горизонта, AZ/EL-сетка, timestamp matching камера↔overlay |
| `map.js` + `map-render.js` | `features/map/` | Отображение позиций спутников | flutter_map, офлайн-тайлы, ground track 24ч («восьмёрки» GEO), footprint, landmark picker |
| `app.js` | `features/frequencies/` | Парсинг XML, фильтры, карточки, группы | Доплеровский сдвиг на карточке, Material 3 UI |
| `tle.js` + `tle-worker.js` | `core/satellite/` | SGP4 пропагация, загрузка TLE | Рефракция, доплер, ground track визуализация |
| `news.js` | `features/news/` | Чат через B2, доска объявлений, авторизация, медиа | dio + S3v4 |
| `style.css` | `theme/` | Цвета (#1c242d фон), тёмная тема | Material 3, адаптивный layout |

## 13. Дизайн: что сохранить, что улучшить

### Сохранить из PWA

- Тёмная тема (фон #1c242d) — удобна в поле ночью
- Карточный интерфейс справочника частот
- Чип-фильтры по спутникам, полосам, чувствительности
- Ribbon частот при фокусе на спутнике на карте
- Аудио-прицел с тональным наведением
- Калибровка по небесным телам (6 объектов)

### Добавить нового

- **Ночной режим (красный UI)** — для сохранения ночного зрения
- **Статус-бар сенсоров** — GPS (спутники, точность), компас (статус, аномалии), гироскоп
- **Индикатор магнитных помех** — предупреждение при аномалии поля (§3.5)
- **Индикатор движения/тряски** — визуализация адаптивного R акселерометра (§3.6)
- **Доплер на карточке частоты** — актуальная частота при пролёте
- **Навигационные спутники на AR** — GPS/ГЛОНАСС на небе рядом с коммуникационными
- **Ground track «восьмёрки»** — суточная траектория GEO-спутников на карте
- **Кнопка "Скачать район карты"** — офлайн-подготовка перед выездом

## 14. Пошаговый план реализации (Roadmap)

> **Платформа:** только Android. iOS-сборка возможна из той же кодовой базы,
> но platform channels (Kotlin) и тестирование — строго Android.
> Батчевый предрасчёт пролётов (AOS/LOS) и push-уведомления исключены из скоупа.

### Фаза 0: Инфраструктура (1 день)

- [ ] Установить Flutter SDK, создать проект `flutter create satcontact_flutter`
- [ ] Настроить `pubspec.yaml` с зависимостями (drift, geolocator, flutter_map, dio, camera, flutter_riverpod, wakelock_plus, permission_handler)
- [ ] Создать структуру папок (`core/`, `features/`, `services/`, `theme/`)
- [ ] Настроить `.cursor/rules/` (architecture.mdc, reference.mdc)
- [ ] Создать тёмную тему Material 3 по мотивам `style.css`
- [ ] Настроить навигацию между экранами (GoRouter или Navigator 2.0)
- [ ] Настроить `flutter_riverpod` — провайдеры для сенсоров, GPS, спутников (§10.1)
- [ ] Добавить `permission_handler` — стратегия запроса разрешений по месту (§10.3)

### Фаза 1: Математическое ядро (3-4 дня)

- [ ] `core/math/` — кватернионы, матрицы 3×3, геодезия (WGS84)
- [ ] `core/wmm/` — портировать WMM-2025 из `ar.js` (строки 85-165)
- [ ] `core/astro/` — портировать Солнце, Луна, звёзды из `ar.js` (строки 170-341)
- [ ] `core/satellite/sgp4.dart` — портировать из `satellite.min.js`
- [ ] `core/satellite/refraction.dart` — формула Беннетта
- [ ] `core/satellite/doppler.dart` — расчёт доплера из range rate
- [ ] `core/satellite/ground_track.dart` — визуализация трека 24ч (§5.5)
- [ ] `core/projection/` — пайплайн ECI→ECEF→ENU→Device→Screen
- [ ] Unit-тесты для каждого модуля (сверка с результатами PWA)

### Фаза 2: Platform channels + Сенсоры + GPS (3-4 дня)

- [ ] Platform channel (Kotlin): `SensorService` — `TYPE_GYROSCOPE_UNCALIBRATED`,
      `TYPE_ACCELEROMETER`, `TYPE_MAGNETIC_FIELD_UNCALIBRATED` с аппаратными timestamps
      и `SENSOR_DELAY_GAME` (~50 Гц) — см. §3.1
- [ ] `core/sensors/` — Dart-обёртка platform channel, абстракция SensorProvider
      (в будущем: iOS-реализация через CoreMotion)
- [ ] `core/ahrs/ekf.dart` — EKF AHRS: predict по гироскопу с hw-dt, update по accel+mag
- [ ] `core/ahrs/adaptive_noise.dart` — адаптивные R для акселерометра (§3.6) и магнитометра (§3.5)
- [ ] `core/ahrs/mag_calibration.dart` — hard iron + soft iron калибровка
- [ ] `core/ahrs/ahrs_history.dart` — кольцевой буфер кватернионов для timestamp matching (§6.2)
- [ ] Platform channel (Kotlin): `GnssService` — сырые GNSS данные (satellite count, HDOP, SNR)
- [ ] `core/gnss/gnss_service.dart` — GPS через `geolocator`
- [ ] `core/gnss/position_filter.dart` — Калман-фильтр для координат
- [ ] Интеграция GPS heading в AHRS при движении
- [ ] Обработка `AppLifecycleState`: paused → остановить сенсоры/камеру, resumed → перезапустить + сброс EKF `prev_timestamp_ns` (§10.2)

### Фаза 3: Справочник частот (2-3 дня)

- [ ] Парсинг `Frequencies.xml` (портировать логику из `app.js`)
- [ ] Экран списка карточек с Material 3
- [ ] Фильтры: чипы по спутникам, полосам, чувствительности (из `app.js`)
- [ ] Поиск по частоте (из `app.js`)
- [ ] Группы спутников (dropdown)
- [ ] Доплеровский сдвиг на карточке (новое)
- [ ] Хранение в drift (SQLite) для офлайн-доступа
- [ ] Обновление с B2 при наличии сети

### Фаза 4: Карта (3-4 дня)

- [ ] flutter_map с OSM / спутниковыми тайлами
- [ ] `flutter_map_tile_caching` для офлайн-тайлов
- [ ] UI "Скачать район карты" (выбор области + zoom 12-16)
- [ ] Отображение позиций спутников в реальном времени
- [ ] Ground track за 24 часа (для GEO-спутников — визуализация «восьмёрок»)
- [ ] Footprint (зона видимости)
- [ ] Позиция пользователя с accuracy circle + direction cone
- [ ] Long tap → landmark marker → расчёт азимута (Vincenty)
- [ ] Ribbon частот при фокусе на спутнике (из `app.js`)

### Фаза 5: AR-трекер (5-7 дней)

- [ ] Камера через пакет `camera` + получение FOV (Camera2 platform channel)
- [ ] `wakelock_plus` — включение при входе в AR, выключение при выходе (§10.2)
- [ ] Timestamp matching: кватернион AHRS из буфера по timestamp кадра камеры (§6.2)
- [ ] `ArOverlayPainter` (CustomPainter) — спутники, траектории, прицел
- [ ] Проекция через кватернион AHRS (шаг 4-5 пайплайна)
- [ ] Калибровка по небесным телам (портировать state machine из `ar.js`)
- [ ] Калибровка по ориентиру (landmark → azimuth → AR fix)
- [ ] Аудио-прицел (Web Audio → Dart audio: `flutter_soloud` или platform channel)
- [ ] Режим фокуса на спутнике (tap → telemetry: AZ, EL, DIST, доплер)
- [ ] Режим "Показать все" (из `ar.js`)
- [ ] Координатная сетка AZ/EL на AR-экране
- [ ] Линия горизонта
- [ ] Ночной режим (красный UI)

### Фаза 6: Доска объявлений и Чат (2-3 дня)

- [ ] B2-клиент на `dio` с S3v4-подписью
- [ ] Чат: listing, отправка, редактирование, удаление (портировать из `news.js`)
- [ ] Доска объявлений (board.html → WebView или нативный рендер)
- [ ] Ответы и личные сообщения
- [ ] Медиа (фото, видео, вложения)
- [ ] Аватары (blockie из hash)

### Фаза 7: Тестирование и релиз (2-3 дня)

- [ ] Тестирование AR-точности на реальном устройстве (Android)
- [ ] Тестирование адаптивных R: ходьба, тряска, магнитные аномалии
- [ ] Тестирование офлайн-работы (режим "В самолёте")
- [ ] Тестирование калибровки по ориентиру (реальные расстояния)
- [ ] Тестирование timestamp matching камера↔overlay при быстрых поворотах
- [ ] Профилирование производительности (Flutter DevTools)
- [ ] Подготовка release keystore (Android)
- [ ] Сборка release APK / AAB
- [ ] Подготовка листинга для Google Play
- [ ] Сборка с обфускацией: `flutter build apk --obfuscate --split-debug-info=./debug-info`
- [ ] Включить R8/ProGuard (`minifyEnabled true`) для Kotlin platform channels
- [ ] Профилирование парсинга XML/TLE — при jank >16 мс вынести в `Isolate.run()` (§5.1)

## 15. Критерии готовности

**MVP (Фазы 0-5, ~17-23 дня):**
- Справочник частот с офлайн-доступом и доплером
- Карта с офлайн-тайлами, ground track, «восьмёрки» GEO
- AR-трекер с EKF AHRS, адаптивными R, timestamp matching
- GPS с индикатором качества и сырыми GNSS
- Калибровка по небесным телам + по ориентиру на карте

**Полный продукт (Фазы 0-7, ~21-28 дней):**
- Всё из MVP + чат + доска объявлений + релиз в Google Play

**В перспективе (не в текущем скоупе):**
- iOS-сборка (platform channels на Swift/CoreMotion, тестирование на Mac)
- Батчевый предрасчёт пролётов (AOS/LOS) + таблица пролётов
- Push-уведомления о пролётах (Foreground Service + flutter_local_notifications)
- Виджет домашнего экрана (ближайший пролёт)
- Вынос EKF/SGP4 в нативную библиотеку C++ через dart:ffi (если профилирование покажет необходимость)
