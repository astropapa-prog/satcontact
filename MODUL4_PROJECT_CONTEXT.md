ПОЛНОЕ ТЕХНИЧЕСКОЕ ОПИСАНИЕ МОДУЛЯ 4 «НОВОСТИ»
1. ОБЩЕЕ ОПИСАНИЕ
Модуль 4 «Новости» — четвёртый экран SPA-приложения SatContact. Состоит из двух частей:

1.1 Доска объявлений администратора (верхняя, сворачиваемая секция):

Одно объявление: текст ~500 символов, пара картинок, возможно прикреплённый файл до 5 МБ
Только чтение для пользователей
Контент хранится в GitHub-репозитории рядом с остальными данными приложения (data/board.html + data/board-media/)
Админ редактирует через web-интерфейс GitHub.com в браузере домашнего ПК
Загружается клиентом через обычный fetch(), как Frequencies.xml
1.2 Чат-лента (основная часть экрана):

Хронологическая лента сообщений — новые внизу, старые уходят вверх
Любой пользователь может: писать текст, вставлять картинки, короткие видео, прикреплять файлы
Пользователь может редактировать и удалять свои сообщения (проверка по author_hash на уровне UI)
Автоочистка сообщений старше 3 дней (Backblaze B2 Lifecycle Rules)
Данные хранятся в Backblaze B2 (бакет satcontact-chat)
Модерации нет
1.3 Ограничения:

Бюджет на B2: до $2/мес
Cloudflare НЕ используется (блокируется в стране аудитории)
Стек: vanilla JS, без фреймворков, без сборщика — как весь проект
Будущее: PWA (service worker, офлайн-режим)
2. АРХИТЕКТУРА
GitHub Pages (satcontact)              Backblaze B2
┌──────────────────────────┐      ┌──────────────────────────┐
│  index.html              │      │  Бакет: satcontact-chat  │
│  style.css               │      │  Тип: allPublic          │
│  app.js   (Module 1)     │      │  ├── messages/           │
│  map.js   (Module 2)     │      │  │   ├── {ts}-{hash}-msg.json
│  ar.js    (Module 3)     │      │  │   └── ...             │
│  news.js  (Module 4) ────│─────►│  └── media/              │
│  lib/aws4fetch.min.js    │      │      ├── {ts}-{hash}-{name}.jpg
│  data/board.html    ◄──admin    │      └── ...             │
│  data/board-media/* ◄──admin    │                          │
│  data/Frequencies.xml    │      │  Lifecycle: 3+1 день     │
│  data/tle.txt            │      │  CORS: * (PUT/GET/HEAD/DELETE)
└──────────────────────────┘      └──────────────────────────┘
Потоки данных:

Доска: GitHub Pages → браузер (обычный fetch, без авторизации)
Чат — чтение: B2 публичный URL → браузер (без авторизации)
Чат — листинг: B2 S3 API → браузер (подписанный запрос через aws4fetch)
Чат — запись/правка/удаление: браузер → B2 S3 API (подписанный запрос через aws4fetch)
3. ПОДГОТОВКА BACKBLAZE B2 (до начала разработки)
Админ (разработчик) выполняет эти шаги в web-консоли Backblaze B2:

Шаг 1: Создать бакет

Имя: satcontact-chat
Тип: Public (allPublic)
Default Encryption: Disable (не нужно)
Object Lock: Disable
Шаг 2: Настроить Lifecycle Rules В настройках бакета → Lifecycle Rules → Add Rule:

Rule 1:
  File Name Prefix: messages/
  Days From Upload to Hide: 3
  Days From Hide to Delete: 1
Rule 2:
  File Name Prefix: media/
  Days From Upload to Hide: 3
  Days From Hide to Delete: 1
Эффект: файлы скрываются через 3 дня после загрузки, физически удаляются через 4 дня. Старые версии файлов (при перезаписи/редактировании) тоже удаляются автоматически.

Шаг 3: Настроить CORS В настройках бакета → CORS Rules → добавить:

[
  {
    "corsRuleName": "allowAll",
    "allowedOrigins": ["*"],
    "allowedOperations": [
      "s3_head",
      "s3_get",
      "s3_put",
      "s3_delete",
      "b2_download_file_by_name",
      "b2_download_file_by_id"
    ],
    "allowedHeaders": [
      "Authorization",
      "Content-Type",
      "Content-Length",
      "Cache-Control",
      "x-amz-content-sha256",
      "x-amz-date"
    ],
    "exposeHeaders": ["ETag", "x-amz-request-id"],
    "maxAgeSeconds": 86400
  }
]
Шаг 4: Создать Application Key App Keys → Add a New Application Key:

Name: satcontact-chat-app
Allow access to Bucket: satcontact-chat (только этот бакет)
Type of Access: Read and Write
Allow List All Bucket Names: No
File name prefix: оставить пустым (нужен доступ и к messages/, и к media/)
Duration: оставить пустым (бессрочный, можно ротировать вручную)
Capabilities ключа: listBuckets, listFiles, readFiles, writeFiles, deleteFiles (все в рамках одного бакета).

Шаг 5: Записать в блокнот После создания ключа Backblaze покажет данные один раз:

S3 Endpoint:     https://s3.{region}.backblazeb2.com
                 (написан в свойствах бакета, например s3.us-west-004.backblazeb2.com)
Bucket Name:     satcontact-chat
Key ID:          xxxxxxxxxxxxxxxxxxxxxxxxx
Application Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Эти четыре значения будут вшиты в news.js.

4. СТРУКТУРА ДАННЫХ
4.1 Доска объявлений (GitHub-репозиторий)
Файлы:

data/
├── board.html              — HTML-фрагмент доски объявлений
└── board-media/            — медиафайлы доски
    ├── photo1.jpg
    └── document.pdf
Формат data/board.html — чистый HTML-фрагмент (без <html>, <head>, <body>):

<p>Ближайший пролёт ISS: 24.03 в 22:15 МСК. Частота 145.800 FM,
максимальная элевация 67°.</p>
<img src="data/board-media/iss-pass.jpg" alt="Схема пролёта" loading="lazy">
<p>📎 <a href="data/board-media/schedule.pdf">Расписание на неделю</a></p>
Пути к медиа — относительные, резолвятся через <base href="/satcontact/"> на GitHub Pages.

Рабочий процесс админа:

Открыть github.com → репозиторий → data/board.html → карандаш (Edit)
Отредактировать текст
Commit changes
Для загрузки медиа: data/board-media/ → Add file → Upload files → Commit
Обновление на сайте через ~1-2 мин (GitHub Pages deploy)
4.2 Чат-сообщение (Backblaze B2)
Имя файла: {timestamp}-{author_hash}-msg.json

Компоненты:

timestamp — Date.now() в момент отправки (миллисекунды). Для сортировки и определения возраста.
author_hash — первые 8 символов SHA-256 от позывного. Для определения авторства.
msg — суффикс-маркер (тип файла = сообщение).
Пример: 1711180800000-a1b2c3d4-msg.json

Содержимое JSON:

{
  "v": 1,
  "author": "UA9XXX",
  "author_hash": "a1b2c3d4",
  "text": "Поймал ISS на 145.800, отличный пролёт!",
  "media": [
    {
      "type": "image",
      "name": "iss-capture.jpg",
      "path": "media/1711180800000-a1b2c3d4-iss-capture.jpg",
      "size": 142000
    }
  ],
  "attachments": [
    {
      "name": "recording.wav",
      "path": "media/1711180800000-a1b2c3d4-recording.wav",
      "size": 2400000
    }
  ],
  "ts": 1711180800000,
  "edited_at": null
}
Поля:

v — версия формата (для обратной совместимости). Текущая: 1.
author — позывной (отображаемое имя).
author_hash — первые 8 символов SHA-256 позывного (для сопоставления с локальным хешем).
text — текст сообщения (может быть пустой, если есть только медиа).
media — массив медиафайлов (0 или 1 элемент). Поле type: "image" или "video".
attachments — массив вложений (0 или 1 элемент).
ts — timestamp (дублирует значение из имени файла, для удобства при рендере).
edited_at — timestamp редактирования или null.
Никакого Base64 внутри JSON. Медиа — отдельные бинарные объекты. В JSON — только путь (path).

4.3 Медиафайлы (Backblaze B2)
Имя файла: {timestamp}-{author_hash}-{original_name}.{ext}

Пример: 1711180800000-a1b2c3d4-iss-capture.jpg

Ограничения (проверяются на клиенте перед загрузкой):

Тип	Форматы	Макс. размер	Примечание
Изображение	JPEG, PNG, WebP	5 МБ (до сжатия)	Обязательное клиентское сжатие
Видео	MP4, WebM	10 МБ	Без сжатия, рекомендация до 15 сек
Файл	Любой	5 МБ	Скачивание по ссылке
Лимит на сообщение: 1 медиафайл (картинка ИЛИ видео) + 1 вложение.

Клиентское сжатие изображений (обязательное):

Загрузка файла в <img> → отрисовка на <canvas>
Ресайз: max 1280px по большей стороне (пропорционально)
Экспорт: canvas.toBlob('image/jpeg', 0.75)
Результат: типично 100–300 КБ вместо 3–10 МБ оригинала
4.4 Принцип именования файлов (из концепции «Супер Статического Форума»)
Метаданные закодированы в имени файла. При листинге (S3 ListObjectsV2) клиент получает массив имён и может извлечь:

timestamp → сортировка, определение возраста, группировка по дням
author_hash → определение «моих» сообщений (без скачивания JSON)
msg → фильтрация (это сообщение, не медиа)
Парсинг имени:

function parseFilename(filename) {
  // "1711180800000-a1b2c3d4-msg.json" → { ts, hash, type }
  const parts = filename.replace('.json', '').split('-');
  return {
    ts: parseInt(parts[0], 10),
    hash: parts[1],
    type: parts[2]   // "msg"
  };
}
5. РАБОТА С B2 ИЗ БРАУЗЕРА
5.1 Почему S3-Compatible API
Нативный B2 API (b2_authorize_account, b2_get_upload_url) не работает из браузера — Backblaze не отдаёт CORS-заголовки на этих эндпоинтах.

S3-Compatible API не требует предварительной авторизации. Каждый запрос подписывается алгоритмом AWS Signature V4 (HMAC-SHA256) на клиенте. Нужны только keyID и applicationKey.

5.2 Библиотека aws4fetch
Репозиторий: https://github.com/mhart/aws4fetch
Размер: 6.4 КБ minified, 2.5 КБ gzipped
Зависимости: ноль
Требования: fetch API + SubtleCrypto (Web Crypto API) — есть во всех современных браузерах
Интеграция: файл lib/aws4fetch.min.js, подключается тегом <script> перед news.js
Экспорт: класс AwsClient в глобальный scope (для IIFE-сборки)
Важно: нужна IIFE/UMD-сборка, экспортирующая window.AwsClient. npm-версия — ESM-модуль, для нашего проекта (без сборщика) нужно пересобрать в IIFE или взять browser-build. Способ: скачать aws4fetch.js, обернуть в IIFE с window.AwsClient = AwsClient и минифицировать.

5.3 Инициализация клиента
const chatClient = new AwsClient({
  accessKeyId: 'KEY_ID_ИЗ_БЛОКНОТА',
  secretAccessKey: 'APP_KEY_ИЗ_БЛОКНОТА',
  region: 'us-west-004',   // из S3 Endpoint
  service: 's3'
});
const S3_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
const CHAT_BUCKET = 'satcontact-chat';
const PUBLIC_URL  = 'https://f005.backblazeb2.com/file/satcontact-chat';
S3_ENDPOINT — для подписанных запросов (листинг, загрузка, удаление). PUBLIC_URL — для чтения файлов без авторизации (публичный бакет).

5.4 Все операции
Листинг сообщений (Class C — 2500/день бесплатно):

const res = await chatClient.fetch(
  `${S3_ENDPOINT}/${CHAT_BUCKET}?list-type=2&prefix=messages/&max-keys=500`
);
const xmlText = await res.text();
// Парсинг S3 XML-ответа → массив <Key> → фильтрация *-msg.json → сортировка по timestamp
Ответ — XML с элементами <Contents><Key>messages/1711...-msg.json</Key></Contents>.

Чтение сообщения (Class B — 2500/день бесплатно):

// Публичный бакет → прямой URL, без подписи
const msg = await fetch(`${PUBLIC_URL}/messages/${filename}`).then(r => r.json());
Чтение медиа (Class B):

// Изображение: <img src="${PUBLIC_URL}/media/${mediaPath}" loading="lazy">
// Видео: <video src="${PUBLIC_URL}/media/${mediaPath}" controls preload="metadata" playsinline>
// Файл: <a href="${PUBLIC_URL}/media/${mediaPath}" download="${originalName}">
Создание сообщения (Class A — бесплатно, безлимитно):

const filename = `${Date.now()}-${userHash}-msg.json`;
await chatClient.fetch(
  `${S3_ENDPOINT}/${CHAT_BUCKET}/messages/${filename}`,
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
    body: JSON.stringify(messageData)
  }
);
Загрузка медиафайла (Class A — бесплатно):

const mediaKey = `media/${timestamp}-${userHash}-${safeName}`;
await chatClient.fetch(
  `${S3_ENDPOINT}/${CHAT_BUCKET}/${mediaKey}`,
  {
    method: 'PUT',
    headers: { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=3600' },
    body: blob  // сжатый Blob для картинок, оригинальный для видео/файлов
  }
);
Редактирование сообщения (PUT на тот же ключ = перезапись):

existingMsg.text = newText;
existingMsg.edited_at = Date.now();
await chatClient.fetch(
  `${S3_ENDPOINT}/${CHAT_BUCKET}/messages/${existingFilename}`,
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
    body: JSON.stringify(existingMsg)
  }
);
Удаление сообщения (DELETE):

await chatClient.fetch(
  `${S3_ENDPOINT}/${CHAT_BUCKET}/messages/${filename}`,
  { method: 'DELETE' }
);
// Если есть медиа — удалить и их:
for (const m of msg.media) {
  await chatClient.fetch(`${S3_ENDPOINT}/${CHAT_BUCKET}/${m.path}`, { method: 'DELETE' });
}
for (const a of msg.attachments) {
  await chatClient.fetch(`${S3_ENDPOINT}/${CHAT_BUCKET}/${a.path}`, { method: 'DELETE' });
}
Порядок операций при отправке сообщения с медиа:

Сжать изображение (если есть) на клиенте
Загрузить медиафайл(ы) в media/ (PUT)
Сформировать JSON с путями к загруженным файлам
Загрузить JSON в messages/ (PUT)
Optimistic update: показать сообщение в ленте немедленно
6. ИДЕНТИФИКАЦИЯ ПОЛЬЗОВАТЕЛЯ
При первом входе в модуль 4 — модальное окно «Введите ваш позывной».

Сохранение:

localStorage ключ satcontact_news_callsign → позывной (например "UA9XXX")
localStorage ключ satcontact_news_hash → первые 8 символов SHA-256 от позывного
Вычисление хеша:

async function computeHash(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
}
Правила:

Позывной обязателен для отправки сообщений. Без него панель ввода заблокирована.
Чтение ленты и доски доступно без позывного.
Кнопка «Сменить позывной» — в заголовке или меню модуля 4.
Проверка «моё сообщение»: msg.author_hash === localUserHash.
UI «своих» сообщений: другой цвет фона + кнопки «Изменить» / «Удалить».
7. ИНТЕРФЕЙС МОДУЛЯ 4
7.1 Точка входа (модуль 1)
В шапке (header) модуля 1 добавляется кнопка «Новости» — в control-panel рядом с «ВСЕ», «Поиск», «Полоса», «Чувств.».

Альтернативное размещение: отдельная строка под control-panel или кнопка-иконка в header__top рядом с заголовком.

Решение о точном размещении — при реализации, исходя из визуального баланса.

7.2 SPA-переход
Идентичен модулям 2 и 3:

function openNewsView() {
  if (!newsView || !header || !main) return;
  header.classList.add('hidden');
  main.hidden = true;
  mapView.hidden = true;
  arView.hidden = true;
  newsView.hidden = false;
  window.initNews();
}
function closeNewsView() {
  if (!newsView || !header || !main) return;
  newsView.hidden = true;
  header.classList.remove('hidden');
  main.hidden = false;
  window.cleanupNews();
}
В openMapView() и openArView() добавить newsView.hidden = true. Экспорт: window.closeNewsView = closeNewsView.

7.3 Макет экрана newsView
┌─────────────────────────────────────────┐
│  ⬅ Назад         НОВОСТИ      🔄 ⚙    │  фиксированный header
├─────────────────────────────────────────┤
│                                         │
│  ┌─ 📌 ДОСКА ОБЪЯВЛЕНИЙ ▾ ──────────┐  │  сворачиваемая секция
│  │  Текст объявления админа...       │  │
│  │  [картинка]                       │  │
│  │  📎 Файл для скачивания           │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ─── ЧАТ ───────────────────────────    │  разделитель
│                                         │
│  ↑ загрузить ещё (при скролле вверх)    │
│                                         │
│  UA3ABC · 22 мар, 14:30                 │  чужое сообщение
│  Кто слышал Метеор-М2 на 137.100?       │
│                                         │
│               UA9XXX · 22 мар, 15:45  ← │  моё сообщение (другой фон)
│          Поймал ISS на 145.800!         │  кнопки ✏️🗑 (только для своих)
│          [картинка]                     │
│                                         │
│  RV6LNA · 23 мар, 09:12                │
│  Отличный вечер для приёма              │
│  [видео 8 сек ▶]                        │
│  📎 recording.wav (2.3 МБ)              │
│                                         │  ← автоскролл сюда при открытии
├─────────────────────────────────────────┤
│ 📷 📎  │ Сообщение...         │ ➤ Отпр │  фиксированная панель ввода
├─────────────────────────────────────────┤
│ [превью: photo.jpg 240KB ✕]            │  превью вложения (если есть)
└─────────────────────────────────────────┘
7.4 HTML-разметка newsView (добавить в index.html)
<!-- Модуль 4: Новости (SPA-переход) -->
<div id="newsView" class="news-view" hidden>
  <header class="news-view__header">
    <button type="button" class="news-view__back" id="newsBack" aria-label="Назад">⬅ Назад</button>
    <h2 class="news-view__title">Новости</h2>
    <div class="news-view__header-actions">
      <button type="button" class="news-view__refresh-btn" id="newsRefresh" aria-label="Обновить">🔄</button>
      <button type="button" class="news-view__settings-btn" id="newsSettings" aria-label="Настройки">⚙</button>
    </div>
  </header>
  <div class="news-view__body" id="newsBody">
    <!-- Доска объявлений -->
    <section class="news-view__board" id="newsBoard">
      <button type="button" class="news-view__board-toggle" id="newsBoardToggle">
        📌 ДОСКА ОБЪЯВЛЕНИЙ <span id="newsBoardArrow">▾</span>
      </button>
      <div class="news-view__board-content" id="boardContent">
        <p class="news-view__loading">Загрузка...</p>
      </div>
    </section>
    <!-- Чат-лента -->
    <section class="news-view__chat" id="newsChat">
      <div class="news-view__chat-loader" id="chatLoader" hidden>Загрузка сообщений...</div>
      <div class="news-view__chat-feed" id="chatFeed">
        <!-- Сообщения рендерятся в news.js -->
      </div>
      <div class="news-view__chat-empty" id="chatEmpty" hidden>
        Пока нет сообщений. Будьте первым!
      </div>
    </section>
  </div>
  <!-- Модальное окно идентификации -->
  <div class="news-view__auth-modal" id="newsAuthModal" hidden>
    <div class="news-view__auth-overlay"></div>
    <div class="news-view__auth-box">
      <h3>Введите ваш позывной</h3>
      <input type="text" id="newsCallsignInput" class="news-view__auth-input"
             placeholder="UA9XXX" autocomplete="off" spellcheck="false" maxlength="20">
      <button type="button" id="newsCallsignBtn" class="news-view__auth-btn">Войти в чат</button>
      <p class="news-view__auth-hint">Позывной будет виден другим пользователям</p>
    </div>
  </div>
  <!-- Панель ввода (фиксирована внизу) -->
  <div class="news-view__input-bar" id="newsInputBar">
    <div class="news-view__input-actions">
      <button type="button" class="news-view__media-btn" id="newsMediaBtn" aria-label="Фото/видео">📷</button>
      <button type="button" class="news-view__attach-btn" id="newsAttachBtn" aria-label="Файл">📎</button>
    </div>
    <textarea class="news-view__text-input" id="newsTextInput"
              placeholder="Сообщение..." rows="1" maxlength="2000"></textarea>
    <button type="button" class="news-view__send-btn" id="newsSendBtn" disabled aria-label="Отправить">➤</button>
    <input type="file" id="newsMediaInput" accept="image/*,video/mp4,video/webm" hidden>
    <input type="file" id="newsAttachInput" hidden>
  </div>
  <!-- Превью вложения -->
  <div class="news-view__preview" id="newsPreview" hidden>
    <span class="news-view__preview-name" id="newsPreviewName"></span>
    <span class="news-view__preview-size" id="newsPreviewSize"></span>
    <button type="button" class="news-view__preview-remove" id="newsPreviewRemove">✕</button>
  </div>
  <!-- Модальное окно редактирования -->
  <div class="news-view__edit-modal" id="newsEditModal" hidden>
    <div class="news-view__edit-overlay"></div>
    <div class="news-view__edit-box">
      <h3>Редактирование</h3>
      <textarea id="newsEditText" class="news-view__edit-textarea" rows="4" maxlength="2000"></textarea>
      <div class="news-view__edit-actions">
        <button type="button" id="newsEditCancel" class="news-view__edit-cancel">Отмена</button>
        <button type="button" id="newsEditSave" class="news-view__edit-save">Сохранить</button>
      </div>
    </div>
  </div>
</div>
7.5 Порядок скриптов в index.html (обновлённый)
<script src="utils.js"></script>
<script src="lib/satellite.min.js"></script>
<script src="lib/d3.min.js"></script>
<script src="lib/topojson.min.js"></script>
<script src="lib/aws4fetch.min.js"></script>    <!-- НОВОЕ -->
<script src="tle.js"></script>
<script src="gps-service.js"></script>
<script src="map.js"></script>
<script src="map-render.js"></script>
<script src="ar-render.js"></script>
<script src="ar.js"></script>
<script src="news.js"></script>                  <!-- НОВОЕ -->
<script src="app.js"></script>
8. СТРУКТУРА news.js
/**
 * SatContact — Module 4 (News: Board + Chat)
 * Vanilla JS, PWA-ready
 */
(function () {
  'use strict';
  // ═══════════════════════════════════════════
  // КОНФИГУРАЦИЯ
  // ═══════════════════════════════════════════
  const S3_ENDPOINT = 'https://s3.REGION.backblazeb2.com';
  const CHAT_BUCKET = 'satcontact-chat';
  const PUBLIC_URL  = 'https://f005.backblazeb2.com/file/satcontact-chat';
  const BOARD_PATH  = 'data/board.html';
  const MAX_IMAGE_SIZE   = 5 * 1024 * 1024;   // 5 МБ до сжатия
  const MAX_VIDEO_SIZE   = 10 * 1024 * 1024;   // 10 МБ
  const MAX_ATTACH_SIZE  = 5 * 1024 * 1024;    // 5 МБ
  const IMAGE_MAX_DIM    = 1280;               // пикселей по большей стороне
  const IMAGE_QUALITY    = 0.75;               // JPEG quality
  const MSG_MAX_LENGTH   = 2000;               // символов
  const LISTING_CACHE_TTL = 90000;             // 90 сек
  const POLL_INTERVAL     = 90000;             // 90 сек
  const MESSAGES_PER_PAGE = 30;                // первая загрузка
  const MESSAGES_LOAD_MORE = 20;               // подгрузка при скролле вверх
  const LS_CALLSIGN_KEY = 'satcontact_news_callsign';
  const LS_HASH_KEY     = 'satcontact_news_hash';
  const LS_BOARD_CACHE  = 'satcontact_board_html';
  const SS_LISTING_KEY  = 'satcontact_chat_listing';
  const LS_BOARD_COLLAPSED = 'satcontact_board_collapsed';
  // ═══════════════════════════════════════════
  // СОСТОЯНИЕ
  // ═══════════════════════════════════════════
  let chatClient = null;        // AwsClient instance
  let callsign = '';
  let userHash = '';
  let allFileNames = [];        // все имена файлов из листинга (отсортированные по ts)
  let loadedMessages = [];      // загруженные JSON-сообщения
  let renderedCount = 0;        // сколько отрендерено
  let pollTimer = null;
  let pendingMedia = null;      // {file, type} — выбранный медиафайл до отправки
  let pendingAttach = null;     // {file} — выбранный файл-вложение до отправки
  let editingFilename = null;   // имя файла редактируемого сообщения (или null)
  // ═══════════════════════════════════════════
  // DOM-ЭЛЕМЕНТЫ
  // ═══════════════════════════════════════════
  // Инициализируются в initNews() через getElementById
  // ═══════════════════════════════════════════
  // ПУБЛИЧНЫЙ API
  // ═══════════════════════════════════════════
  window.initNews = initNews;
  window.cleanupNews = cleanupNews;
  // ═══════════════════════════════════════════
  // ЖИЗНЕННЫЙ ЦИКЛ
  // ═══════════════════════════════════════════
  function initNews() {
    // 1. Привязка DOM-элементов
    // 2. Инициализация chatClient (new AwsClient(...))
    // 3. Загрузка доски (loadBoard)
    // 4. Проверка идентификации (checkAuth)
    // 5. Загрузка ленты (fetchAndRenderFeed)
    // 6. Привязка обработчиков событий (bindEvents)
    // 7. Запуск поллинга (startPolling)
  }
  function cleanupNews() {
    // 1. Остановка поллинга (stopPolling)
    // 2. Очистка DOM (chatFeed.innerHTML = '')
    // 3. Сброс состояния (allFileNames, loadedMessages, renderedCount, pending*)
    // 4. Отвязка обработчиков (если нужно)
  }
  // ═══════════════════════════════════════════
  // ДОСКА ОБЪЯВЛЕНИЙ
  // ═══════════════════════════════════════════
  async function loadBoard() {
    // 1. Показать кешированную версию из localStorage немедленно
    // 2. Запросить свежую через fetch(SatContactResolveUrl(BOARD_PATH))
    // 3. При успехе: обновить DOM и кеш localStorage
    // 4. При ошибке: оставить кешированную, или показать "Доска недоступна"
  }
  function toggleBoard() {
    // Свернуть/развернуть секцию доски
    // Сохранить состояние в localStorage (LS_BOARD_COLLAPSED)
  }
  // ═══════════════════════════════════════════
  // ИДЕНТИФИКАЦИЯ
  // ═══════════════════════════════════════════
  function checkAuth() {
    // Прочитать callsign и hash из localStorage
    // Если есть — установить переменные, разблокировать панель ввода
    // Если нет — показать модальное окно (newsAuthModal)
  }
  async function setCallsign(name) {
    // 1. Вычислить hash: await computeHash(name.trim().toUpperCase())
    // 2. Сохранить в localStorage
    // 3. Установить переменные callsign, userHash
    // 4. Скрыть модальное окно
    // 5. Разблокировать панель ввода
  }
  async function computeHash(str) {
    // SHA-256 через SubtleCrypto → hex → первые 8 символов
  }
  // ═══════════════════════════════════════════
  // ЛИСТИНГ И ЗАГРУЗКА СООБЩЕНИЙ
  // ═══════════════════════════════════════════
  async function fetchFileList(useCache) {
    // 1. Если useCache — проверить sessionStorage (SS_LISTING_KEY + TTL)
    // 2. Если кеш валиден — вернуть из кеша
    // 3. Иначе — chatClient.fetch(ListObjectsV2) → парсинг XML
    // 4. Извлечь массив <Key>, отфильтровать *-msg.json
    // 5. Отсортировать по timestamp (по возрастанию — старые первые)
    // 6. Сохранить в sessionStorage с текущим timestamp
    // 7. Вернуть массив имён файлов
  }
  async function fetchAndRenderFeed() {
    // 1. allFileNames = await fetchFileList(true)
    // 2. Взять последние MESSAGES_PER_PAGE из allFileNames
    // 3. Загрузить их JSON (пакетно, Promise.all)
    // 4. loadedMessages = результат
    // 5. renderMessages()
    // 6. Скроллить chatFeed вниз (к последнему сообщению)
  }
  async function loadMoreMessages() {
    // Вызывается при скролле вверх
    // 1. Определить сколько ещё не загружено
    // 2. Взять следующие MESSAGES_LOAD_MORE из allFileNames
    // 3. Загрузить их JSON
    // 4. Добавить в начало loadedMessages
    // 5. Рендерить новые в начало chatFeed
    // 6. Сохранить позицию скролла (чтобы не прыгало)
  }
  async function fetchMessage(filename) {
    // fetch(PUBLIC_URL + '/messages/' + filename) → JSON
    // Добавить filename в объект сообщения для последующего обращения
  }
  // ═══════════════════════════════════════════
  // РЕНДЕРИНГ
  // ═══════════════════════════════════════════
  function renderMessages() {
    // Очистить chatFeed
    // Для каждого сообщения в loadedMessages: создать DOM-элемент карточки
    // Если chatEmpty — показать/скрыть в зависимости от количества
  }
  function createMessageElement(msg) {
    // Создать DOM-элемент карточки сообщения:
    // - author + относительное время (relativeTime)
    // - текст (с переносами строк → <br>)
    // - медиа: <img> (с lazy loading, клик → полноэкранный просмотр)
    //   или <video controls preload="metadata" playsinline>
    // - вложение: ссылка с иконкой 📎, именем файла и размером
    // - если edited_at: метка "(изменено)"
    // - если своё (author_hash === userHash): кнопки ✏️ и 🗑, другой CSS-класс фона
    // URL медиа и вложений: PUBLIC_URL + '/' + msg.media[0].path
  }
  function relativeTime(ts) {
    // Вернуть строку: "только что", "5 мин", "2 часа", "вчера, 14:30", "22 мар, 09:00"
  }
  function formatFileSize(bytes) {
    // Вернуть строку: "1.2 КБ", "340 КБ", "2.3 МБ"
  }
  // ═══════════════════════════════════════════
  // ОТПРАВКА СООБЩЕНИЯ
  // ═══════════════════════════════════════════
  async function sendMessage() {
    // 1. Прочитать текст из textarea
    // 2. Валидация: текст или медиа/вложение обязательны
    // 3. Заблокировать кнопку отправки, показать индикатор
    // 4. Если pendingMedia — сжать (если изображение) и загрузить в media/
    // 5. Если pendingAttach — загрузить в media/
    // 6. Сформировать JSON сообщения
    // 7. Загрузить JSON в messages/
    // 8. Optimistic update: добавить сообщение в loadedMessages и chatFeed немедленно
    // 9. Скролл вниз
    // 10. Очистить панель ввода и превью
    // 11. При ошибке: пометить сообщение "Не отправлено", кнопка "Повторить"
  }
  async function compressImage(file) {
    // 1. Создать Image, загрузить файл через URL.createObjectURL
    // 2. Вычислить новые размеры (max IMAGE_MAX_DIM по большей стороне)
    // 3. Нарисовать на canvas
    // 4. canvas.toBlob('image/jpeg', IMAGE_QUALITY)
    // 5. Вернуть Blob
  }
  // ═══════════════════════════════════════════
  // РЕДАКТИРОВАНИЕ СООБЩЕНИЯ
  // ═══════════════════════════════════════════
  function openEditModal(filename) {
    // 1. Найти сообщение в loadedMessages по filename
    // 2. Заполнить textarea текстом сообщения
    // 3. Установить editingFilename
    // 4. Показать модальное окно
  }
  async function saveEdit() {
    // 1. Прочитать новый текст из textarea
    // 2. Обновить JSON: msg.text = newText, msg.edited_at = Date.now()
    // 3. PUT на тот же ключ (перезапись файла)
    // 4. Обновить loadedMessages и DOM
    // 5. Скрыть модальное окно
  }
  // ═══════════════════════════════════════════
  // УДАЛЕНИЕ СООБЩЕНИЯ
  // ═══════════════════════════════════════════
  async function deleteMessage(filename) {
    // 1. Подтверждение (confirm или кастомный диалог)
    // 2. Найти сообщение в loadedMessages
    // 3. DELETE сообщение
    // 4. DELETE медиафайлы (если есть)
    // 5. DELETE вложения (если есть)
    // 6. Удалить из loadedMessages и DOM
  }
  // ═══════════════════════════════════════════
  // КЕШИРОВАНИЕ
  // ═══════════════════════════════════════════
  // sessionStorage: листинг файлов (SS_LISTING_KEY) с TTL 90 сек
  // localStorage: board.html (LS_BOARD_CACHE)
  // Browser HTTP cache: Cache-Control заголовки при загрузке файлов в B2:
  //   - JSON сообщений: max-age=120 (2 мин)
  //   - Медиа: max-age=3600 (1 час)
  // ═══════════════════════════════════════════
  // ПОЛЛИНГ
  // ═══════════════════════════════════════════
  function startPolling() {
    // setInterval(checkForNewMessages, POLL_INTERVAL)
    // Добавить listener на document visibilitychange — пауза при скрытой вкладке
  }
  function stopPolling() {
    // clearInterval(pollTimer)
  }
  async function checkForNewMessages() {
    // 1. fetchFileList(false) — без кеша
    // 2. Сравнить с текущим allFileNames
    // 3. Если есть новые файлы — загрузить их JSON
    // 4. Добавить в loadedMessages и chatFeed
    // 5. Если пользователь проскроллил вверх — показать плашку "N новых сообщений ▼"
    // 6. Если пользователь внизу — плавно добавить и скроллить
  }
  // ═══════════════════════════════════════════
  // ОБРАБОТЧИКИ СОБЫТИЙ (bindEvents)
  // ═══════════════════════════════════════════
  // newsBack → closeNewsView()
  // newsRefresh → fetchAndRenderFeed() с очисткой кеша
  // newsSettings → показать меню (смена позывного)
  // newsBoardToggle → toggleBoard()
  // newsSendBtn → sendMessage()
  // newsMediaBtn → newsMediaInput.click()
  // newsAttachBtn → newsAttachInput.click()
  // newsMediaInput change → валидация размера → показ превью
  // newsAttachInput change → валидация размера → показ превью
  // newsPreviewRemove → очистка pendingMedia/pendingAttach
  // newsTextInput input → auto-resize textarea, enable/disable send button
  // chatFeed scroll → если scrollTop < threshold → loadMoreMessages()
  // Делегирование кликов в chatFeed: edit/delete кнопки, открытие изображений
  // ═══════════════════════════════════════════
  // УТИЛИТЫ
  // ═══════════════════════════════════════════
  function parseFilename(name) {
    // "1711180800000-a1b2c3d4-msg.json" → { ts, hash, type }
  }
  function parseS3ListXml(xmlText) {
    // Парсинг XML ответа S3 ListObjectsV2 → массив ключей (Key)
  }
  function sanitizeFilename(name) {
    // Убрать спецсимволы из имени файла для безопасного использования в S3 ключе
  }
})();
9. СТИЛИ (добавить в style.css)
Все классы начинаются с .news-view (аналогично .map-view и .ar-view).

Ключевые стили:

.news-view — position: fixed; inset: 0; display: flex; flex-direction: column; background: #1c242d;
.news-view__header — фиксированная шапка, стиль как .map-view__header
.news-view__body — flex: 1; overflow-y: auto; (основная скроллируемая область)
.news-view__board — background: #1a2530; border-bottom: 1px solid #2a3a4a; padding: 12px;
.news-view__board-content — стили для HTML-контента доски (img max-width: 100%, типографика)
.news-view__board--collapsed .news-view__board-content — display: none;
.news-view__chat-feed — контейнер сообщений
.news-msg — карточка сообщения: background: #212d3b; border-radius: 12px; padding: 10px 14px; margin: 6px 12px;
.news-msg--own — своё сообщение: background: #1a3a5c; margin-left: 40px; (смещение вправо)
.news-msg:not(.news-msg--own) — чужое: margin-right: 40px;
.news-msg__author — color: #5288c1; font-weight: 600;
.news-msg__time — color: #8a9ba8; font-size: 0.8em;
.news-msg__text — color: #ffffff; white-space: pre-wrap; word-break: break-word;
.news-msg__media img — max-width: 100%; border-radius: 8px; cursor: pointer;
.news-msg__media video — max-width: 100%; border-radius: 8px;
.news-msg__attachment — color: #5288c1; text-decoration: none;
.news-msg__actions — кнопки ✏️🗑 (только для .news-msg--own)
.news-msg__edited — color: #8a9ba8; font-size: 0.75em; font-style: italic;
.news-view__input-bar — position: sticky; bottom: 0; display: flex; align-items: flex-end; background: #1c242d; border-top: 1px solid #2a3a4a; padding: 8px;
.news-view__text-input — flex: 1; resize: none; background: #212d3b; color: #fff; border: 1px solid #2a3a4a; border-radius: 20px; padding: 8px 14px;
.news-view__send-btn:disabled — opacity: 0.4;
.news-view__auth-modal — полноэкранный оверлей с центрированной формой
.news-view__edit-modal — аналогично
.news-view__preview — background: #2a3a4a; padding: 6px 12px; display: flex; align-items: center;
Палитра: такая же, как в основном приложении (
#1c242d, 
#212d3b, 
#5288c1, 
#ffffff, 
#8a9ba8)
10. КЕШИРОВАНИЕ — СВОДНАЯ ТАБЛИЦА
Что кешируется	Где	TTL	Сброс
Листинг файлов (ListObjectsV2)	sessionStorage	90 сек	Кнопка 🔄, отправка сообщения, поллинг
HTML доски (board.html)	localStorage	До следующего открытия модуля	Загружается фоном при каждом входе
JSON сообщений	HTTP cache браузера	120 сек (Cache-Control)	Автоматически
Медиафайлы	HTTP cache браузера	3600 сек (Cache-Control)	Автоматически
Позывной + хеш	localStorage	Бессрочно	«Сменить позывной»
Состояние доски (свёрнута/развёрнута)	localStorage	Бессрочно	Клик по заголовку доски
11. ПОЛЛИНГ — ЛОГИКА
При входе в модуль 4: первый ListObjectsV2 (заполняет ленту)
Каждые 90 секунд (POLL_INTERVAL): фоновый ListObjectsV2
Сравнение нового списка с текущим allFileNames:
Новые файлы (есть в новом, нет в старом) → загрузить их JSON, добавить в ленту
Удалённые файлы (есть в старом, нет в новом) → убрать из DOM
Если вкладка скрыта (document.visibilityState === 'hidden') — поллинг приостанавливается
При возвращении на вкладку — немедленный запрос (и сброс таймера)
При выходе из модуля 4 (closeNewsView) — поллинг останавливается
12. PWA-СОВМЕСТИМОСТЬ
Модуль 4 проектируется с учётом будущего service worker:

news.js и lib/aws4fetch.min.js войдут в precache (app shell)
data/board.html — Stale While Revalidate (показать кеш, обновить фоном)
JSON сообщений — Network First (приоритет свежих данных, при оффлайне — кеш)
Медиа — Cache First (неизменяемые файлы)
Отправка оффлайн: сообщение в IndexedDB → Background Sync при восстановлении сети
13. РАСЧЁТ СТОИМОСТИ (без Cloudflare)
Типичный сценарий: 100 DAU, 50 сообщений/день, с кешированием:

Ресурс	Потребление/мес	Бесплатно/мес	Доплата
Хранилище	~32 МБ пик	10 ГБ	$0
Upload (Class A)	~1,500	Безлимит	$0
Listing (Class C)	~15,000	75,000	$0
Downloads (Class B)	~120,000	75,000	~$0.02
Bandwidth	~25 ГБ	~33 ГБ	$0
Итого			~$0.02
Высокая нагрузка: 300 DAU, 150 сообщений/день:

Ресурс	Потребление/мес	Бесплатно/мес	Доплата
Хранилище	~150 МБ пик	10 ГБ	$0
Listing (Class C)	~60,000	75,000	$0
Downloads (Class B)	~400,000	75,000	~$0.13
Bandwidth	~100 ГБ	~33 ГБ	~$0.67
Итого			~$0.80
Бюджет $2/мес покрывает 500+ DAU.

14. ИЗМЕНЕНИЯ В СУЩЕСТВУЮЩИХ ФАЙЛАХ
14.1 index.html
Добавить HTML-блок #newsView (раздел 7.4) после #arView и до закрывающего </div> от .app
Добавить <script src="lib/aws4fetch.min.js"></script> после topojson.min.js
Добавить <script src="news.js"></script> после ar.js и перед app.js
14.2 app.js
В блоке DOM-элементов добавить: let newsView;
В init(): newsView = document.getElementById('newsView');
Добавить функции openNewsView() и closeNewsView() (раздел 7.2)
В openMapView() добавить: if (newsView) newsView.hidden = true;
В openArView() добавить: if (newsView) newsView.hidden = true;
Добавить кнопку «Новости» в header и обработчик клика → openNewsView()
Экспорт: window.closeNewsView = closeNewsView;
14.3 style.css
Добавить все стили .news-view* и .news-msg* (раздел 9).

14.4 Новые файлы
Файл	Описание
news.js	Модуль 4: вся логика чата и доски (раздел 8)
lib/aws4fetch.min.js	IIFE-сборка aws4fetch для браузера
data/board.html	HTML-фрагмент доски объявлений (создаёт и редактирует админ)
data/board-media/	Папка для медиафайлов доски (создаёт админ через GitHub)
15. ПОТЕНЦИАЛЬНЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ
Проблема	Решение
B2 недоступен в стране аудитории	Проверить доступность s3.REGION.backblazeb2.com и f005.backblazeb2.com до начала разработки. Альтернатива: Yandex Object Storage (S3-совместимое, серверы в РФ, совместимо с aws4fetch без изменений кода)
aws4fetch нет в IIFE-сборке	Скачать ESM-исходник, обернуть в IIFE: (function(){ ... window.AwsClient = AwsClient; })(), минифицировать
Race condition при записи	Невозможна: каждое сообщение — отдельный файл с уникальным именем (timestamp + hash)
Два сообщения с одинаковым timestamp	Крайне маловероятно (миллисекунды + разные hash). Если случится — оба файла сохранятся (разные имена)
Спам через вшитый ключ	Ключ ограничен одним бакетом. Мусор вымывается lifecycle за 3 дня. Можно настроить Data Cap Alert в B2
Пользователь представился чужим позывным	Осознанный компромисс. Нет серверной авторизации — нет гарантии подлинности. Для нашей аудитории радиолюбителей использование чужого позывного — серьёзное нарушение этики, социальный контроль сильнее технического
Большие видео тормозят загрузку	Клиентский лимит 10 МБ, предупреждение при превышении. Видео стримится через <video> + HTTP Range Requests (B2 поддерживает)
ListObjectsV2 >1000 файлов	При 150 msg/day × 3 = 450, даже при 300 msg/day = 900 — в лимите 1000. Если превысит — пагинация через continuation-token в S3 API
SubtleCrypto (для SHA-256 хеша позывного)	Доступен во всех современных браузерах на HTTPS. GitHub Pages = HTTPS. На file:// в Chrome работает, в Firefox может не работать (не критично — это локальная разработка)
board.html кеширование GitHub Pages CDN	GitHub Pages кеширует ~10 мин. Для редко меняемой доски это приемлемо. Cache-busting ?t=... пробивает кеш
Редактирование чужих сообщений через API	Технически возможно (ключ даёт writeFiles). Защита на уровне UI: кнопка «Изменить» только для своих. Осознанный компромисс (как в концепции форума)
16. ЧЕКЛИСТ ГОТОВНОСТИ К РАЗРАБОТКЕ
Перед началом кодирования убедиться:


Аккаунт Backblaze B2 создан

Бакет
satcontact-chat
создан (Public)

Lifecycle Rules настроены (messages/ и media/, 3+1 день)

CORS настроен (раздел 3, шаг 3)

Application Key создан и данные записаны:
S3 Endpoint
Bucket Name
Key ID
Application Key

Доступность B2 из страны аудитории проверена

data/board.html
создан в репозитории (хотя бы заглушка)

data/board-media/
создана в репозитории

lib/aws4fetch.min.js
подготовлен (IIFE-сборка)
Это полная спецификация. В новой сессии планировщик может взять этот документ как единственный источник истины и перейти к поэтапной реализации.

1. data/board.html (Заглушка доски)
✅ Cursor может создать сам.
"Создай файл data/board.html с базовой HTML-разметкой для одного тестового объявления". Он без проблем создаст файл, напишет код и предложит вам его сохранить (Apply).
2. Папка data/board-media/
⚠️ Cursor может создать, но есть нюанс с Git.
Git не умеет отслеживать пустые папки. Чтобы папка запушилась на GitHub, в ней должен быть хотя бы один файл.
Как сделать: Попросите Cursor: "Создай папку data/board-media/ и положи в неё пустой файл .gitkeep, чтобы папка запушилась в репозиторий". Либо просто закиньте туда любую тестовую картинку руками.
3. Библиотека lib/aws4fetch.min.js
НУЖНО ЕЁ ЗАКАЧАТЬ САМ ТЫ ВРЯД ЛИ БЕЗ ОНИБОК СМОЖЕШЬ ЕЁ СГЕНЕРИРОВАТЬ. нО Я НЕ УВЕРЕН. ПОДСКАЖЕШЬ ЕСЛИ ОТ МЕНЯ ПОТРЕБУЮТСЯ ДЕЙСТВИЯ.
 на  созданы папки messages и media для них настроены правила тёхдневной отчистки  пользовтели будут прикреплять к сообщениям всевозможные файлы зип пдф техст док их с картинкамии видео грузить всё в media/

CORS обновлён. Финальная конфигурация бакета satcontact-chat:

Параметр	Значение
AllowedOrigins	*
AllowedMethods	HEAD, GET, PUT, DELETE (S3) + b2_download_file_by_name, b2_download_file_by_id (B2 native)
AllowedHeaders	Authorization, Content-Type, Content-Length, Cache-Control, x-amz-content-sha256, x-amz-date
ExposeHeaders	ETag, x-amz-request-id
MaxAgeSeconds	86400


Ключи от бакета

keyID:
003a862a1ffe1780000000002
keyName:
satcontact-chat-app
applicationKey:
K003p3mK5LUuCKzLFEk3KZ5PJ6wTQkE

 S3 Endpoint.  s3.eu-central-003.backblazeb2.com
