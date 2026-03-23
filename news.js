/**
 * SatContact — Module 4 (News: Board + Chat)
 * Vanilla JS, PWA-ready
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════
  const S3_ENDPOINT = 'https://s3.eu-central-003.backblazeb2.com';
  const CHAT_BUCKET = 'satcontact-chat';
  const PUBLIC_URL  = 'https://f003.backblazeb2.com/file/satcontact-chat';
  const BOARD_PATH  = 'data/board.html';

  const B2_KEY_ID  = '003a862a1ffe1780000000002';
  const B2_APP_KEY = 'K003p3mK5LUuCKzLFEk3KZ5PJ6wTQkE';

  const MAX_IMAGE_SIZE   = 5 * 1024 * 1024;
  const MAX_VIDEO_SIZE   = 10 * 1024 * 1024;
  const MAX_ATTACH_SIZE  = 5 * 1024 * 1024;
  const IMAGE_MAX_DIM    = 1280;
  const IMAGE_QUALITY    = 0.75;
  const MSG_MAX_LENGTH   = 2000;
  const LISTING_CACHE_TTL = 90000;
  const POLL_INTERVAL     = 90000;
  const MESSAGES_PER_PAGE = 30;
  const MESSAGES_LOAD_MORE = 20;

  const LS_CALLSIGN_KEY   = 'satcontact_news_callsign';
  const LS_HASH_KEY       = 'satcontact_news_hash';
  const LS_BOARD_CACHE    = 'satcontact_board_html';
  const SS_LISTING_KEY    = 'satcontact_chat_listing';
  const LS_BOARD_COLLAPSED = 'satcontact_board_collapsed';

  // ═══════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════
  let chatClient = null;
  let callsign = '';
  let userHash = '';
  let allFileNames = [];
  let loadedMessages = [];
  let renderedSet = new Set();
  let pollTimer = null;
  let pendingMedia = null;
  let pendingAttach = null;
  let editingFilename = null;
  let isInitialized = false;
  let isLoadingMore = false;
  let boardLoaded = false;
  let chatLoaded = false;
  let pendingReply = null;
  let activeFilter = 'all';
  let allDmFiles = [];
  let loadedDmMessages = [];
  let allMessagesLoaded = false;
  let allDmsLoaded = false;

  // ═══════════════════════════════════════════
  // DOM REFERENCES
  // ═══════════════════════════════════════════
  let els = {};

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════
  window.initNews = initNews;
  window.cleanupNews = cleanupNews;

  // TODO [PWA]: migrate checkBoardForUpdates to Service Worker for background detection
  window.checkBoardForUpdates = checkBoardForUpdates;

  // ═══════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════
  function initNews() {
    if (isInitialized) return;
    isInitialized = true;
    boardLoaded = false;
    chatLoaded = false;

    els = {
      body:           document.getElementById('newsBody'),
      boardToggle:    document.getElementById('newsBoardToggle'),
      boardArrow:     document.getElementById('newsBoardArrow'),
      boardContent:   document.getElementById('boardContent'),
      boardSection:   document.getElementById('newsBoard'),
      chatToggle:     document.getElementById('newsChatToggle'),
      chatArrow:      document.getElementById('newsChatArrow'),
      chatContent:    document.getElementById('chatContent'),
      chatSection:    document.getElementById('newsChat'),
      chatFeed:       document.getElementById('chatFeed'),
      chatLoader:     document.getElementById('chatLoader'),
      chatEmpty:      document.getElementById('chatEmpty'),
      authModal:      document.getElementById('newsAuthModal'),
      callsignInput:  document.getElementById('newsCallsignInput'),
      passwordInput:  document.getElementById('newsPasswordInput'),
      authError:      document.getElementById('newsAuthError'),
      callsignBtn:    document.getElementById('newsCallsignBtn'),
      inputBar:       document.getElementById('newsInputBar'),
      textInput:      document.getElementById('newsTextInput'),
      sendBtn:        document.getElementById('newsSendBtn'),
      mediaBtn:       document.getElementById('newsMediaBtn'),
      attachBtn:      document.getElementById('newsAttachBtn'),
      mediaInput:     document.getElementById('newsMediaInput'),
      attachInput:    document.getElementById('newsAttachInput'),
      preview:        document.getElementById('newsPreview'),
      previewName:    document.getElementById('newsPreviewName'),
      previewSize:    document.getElementById('newsPreviewSize'),
      previewRemove:  document.getElementById('newsPreviewRemove'),
      editModal:      document.getElementById('newsEditModal'),
      editText:       document.getElementById('newsEditText'),
      editCancel:     document.getElementById('newsEditCancel'),
      editSave:       document.getElementById('newsEditSave'),
      back:           document.getElementById('newsBack'),
      refresh:        document.getElementById('newsRefresh'),
      settings:       document.getElementById('newsSettings'),
      chatFilters:    document.getElementById('chatFilters'),
      replyPreview:   document.getElementById('newsReplyPreview'),
      replyAuthor:    document.getElementById('newsReplyAuthor'),
      replyText:      document.getElementById('newsReplyText'),
      replyBadge:     document.getElementById('newsReplyBadge'),
      replyClose:     document.getElementById('newsReplyClose'),
    };

    chatClient = new AwsClient({
      accessKeyId: B2_KEY_ID,
      secretAccessKey: B2_APP_KEY,
      region: 'eu-central-003',
      service: 's3'
    });

    var boardShouldExpand = localStorage.getItem(LS_BOARD_COLLAPSED) === '0';
    if (boardShouldExpand) {
      if (els.boardArrow) els.boardArrow.textContent = '\u25BE';
      loadBoard();
    } else {
      if (els.boardSection) els.boardSection.classList.add('news-view__board--collapsed');
      if (els.boardArrow) els.boardArrow.textContent = '\u25B8';
    }

    if (els.chatSection) els.chatSection.classList.add('news-view__chat--collapsed');
    if (els.chatArrow) els.chatArrow.textContent = '\u25B8';
    if (els.inputBar) els.inputBar.hidden = true;

    checkAuth();
    bindEvents();
  }

  function cleanupNews() {
    stopPolling();
    if (els.chatFeed) els.chatFeed.innerHTML = '';
    allFileNames = [];
    loadedMessages = [];
    renderedSet.clear();
    pendingMedia = null;
    pendingAttach = null;
    editingFilename = null;
    isInitialized = false;
    isLoadingMore = false;
    boardLoaded = false;
    chatLoaded = false;
    activeFilter = 'all';
    allDmFiles = [];
    loadedDmMessages = [];
    allMessagesLoaded = false;
    allDmsLoaded = false;
    pendingReply = null;
  }

  // ═══════════════════════════════════════════
  // BOARD
  // ═══════════════════════════════════════════
  async function loadBoard() {
    if (!els.boardContent) return;
    boardLoaded = true;

    try {
      var cached = localStorage.getItem(LS_BOARD_CACHE);
      if (cached) els.boardContent.innerHTML = cached;
    } catch (e) { /* localStorage unavailable */ }

    try {
      var res = await fetch(BOARD_PATH);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var html = await res.text();
      els.boardContent.innerHTML = html;
      try { localStorage.setItem(LS_BOARD_CACHE, html); } catch (e) { /* */ }
    } catch (err) {
      if (!els.boardContent.innerHTML || els.boardContent.innerHTML.includes('Загрузка')) {
        els.boardContent.innerHTML = '<p style="color:var(--text-secondary)">Доска объявлений недоступна</p>';
      }
    }

    var btn = document.getElementById('newsBtn');
    if (btn) btn.classList.remove('btn--news-updated');
  }

  function toggleBoard() {
    if (!els.boardSection) return;
    var isCollapsed = els.boardSection.classList.toggle('news-view__board--collapsed');
    if (els.boardArrow) els.boardArrow.textContent = isCollapsed ? '\u25B8' : '\u25BE';
    try { localStorage.setItem(LS_BOARD_COLLAPSED, isCollapsed ? '1' : '0'); } catch (e) { /* */ }

    if (!isCollapsed && !boardLoaded) {
      loadBoard();
    }
  }

  function toggleChat() {
    if (!els.chatSection) return;
    var isCollapsed = els.chatSection.classList.toggle('news-view__chat--collapsed');
    if (els.chatArrow) els.chatArrow.textContent = isCollapsed ? '\u25B8' : '\u25BE';
    if (els.inputBar) els.inputBar.hidden = isCollapsed;
    if (els.chatFilters) els.chatFilters.hidden = isCollapsed || !userHash;
    if (els.replyPreview && isCollapsed) els.replyPreview.hidden = true;

    if (!isCollapsed) {
      if (!chatLoaded) {
        chatLoaded = true;
        fetchAndRenderFeed();
      } else {
        checkForNewMessages();
      }
      startPolling();
    } else {
      stopPolling();
    }
  }

  // TODO [PWA]: migrate to Service Worker for background board update detection
  async function checkBoardForUpdates() {
    try {
      var res = await fetch(BOARD_PATH, { cache: 'no-cache' });
      if (!res.ok) return;
      var html = await res.text();
      var cached = '';
      try { cached = localStorage.getItem(LS_BOARD_CACHE) || ''; } catch (e) { /* */ }
      if (cached && cached !== html) {
        var btn = document.getElementById('newsBtn');
        if (btn) btn.classList.add('btn--news-updated');
      }
    } catch (e) { /* network unavailable — skip */ }
  }

  // ═══════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════
  function checkAuth() {
    try {
      callsign = localStorage.getItem(LS_CALLSIGN_KEY) || '';
      userHash = localStorage.getItem(LS_HASH_KEY) || '';
    } catch (e) { /* */ }

    if (callsign && userHash) {
      unlockInput();
    } else {
      lockInput();
    }
  }

  async function setCallsign(name, password) {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return;
    const hash = await computeHash(trimmed + ':' + password);
    callsign = trimmed;
    userHash = hash;
    try {
      localStorage.setItem(LS_CALLSIGN_KEY, callsign);
      localStorage.setItem(LS_HASH_KEY, userHash);
    } catch (e) { /* */ }
    if (els.authModal) els.authModal.hidden = true;
    unlockInput();
  }

  function unlockInput() {
    if (els.textInput) els.textInput.disabled = false;
    if (els.sendBtn) els.sendBtn.disabled = false;
    if (els.mediaBtn) els.mediaBtn.disabled = false;
    if (els.attachBtn) els.attachBtn.disabled = false;
    if (els.textInput) els.textInput.placeholder = 'Сообщение...';
    if (els.chatFilters) els.chatFilters.hidden = false;
    updateSendBtnState();
  }

  function lockInput() {
    if (els.textInput) { els.textInput.disabled = true; els.textInput.placeholder = 'Введите позывной для отправки'; }
    if (els.sendBtn) els.sendBtn.disabled = true;
    if (els.mediaBtn) els.mediaBtn.disabled = true;
    if (els.attachBtn) els.attachBtn.disabled = true;
    if (els.chatFilters) els.chatFilters.hidden = true;
  }

  function showAuthModal() {
    if (!els.authModal) return;
    els.authModal.hidden = false;
    if (els.callsignInput) {
      els.callsignInput.value = callsign || '';
      setTimeout(() => els.callsignInput.focus(), 100);
    }
    if (els.passwordInput) els.passwordInput.value = '';
    if (els.authError) els.authError.hidden = true;
  }

  async function computeHash(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
  }

  function hashToColor(hash) {
    var h = parseInt(hash.substring(0, 3), 16) % 360;
    var s = 40 + (parseInt(hash.substring(3, 5), 16) % 40);
    var l = 55 + (parseInt(hash.substring(5, 7), 16) % 20);
    return 'hsl(' + h + ', ' + s + '%, ' + l + '%)';
  }

  var blockieCache = {};

  function createBlockie(hash, size) {
    if (blockieCache[hash]) return blockieCache[hash];
    size = size || 32;

    var seed = parseInt(hash, 16);
    function xorshift() {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }

    function randColor() {
      var h = Math.floor(xorshift() * 360);
      var s = 40 + Math.floor(xorshift() * 40);
      var l = 45 + Math.floor(xorshift() * 30);
      return 'hsl(' + h + ',' + s + '%,' + l + '%)';
    }

    var bgColor = randColor();
    var mainColor = randColor();
    var accentColor = randColor();

    var grid = 8;
    var half = grid / 2;
    var data = [];
    for (var i = 0; i < grid * half; i++) {
      var v = Math.floor(xorshift() * 3);
      data.push(v);
    }

    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var cell = size / grid;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    for (var y = 0; y < grid; y++) {
      for (var x = 0; x < half; x++) {
        var val = data[y * half + x];
        if (val === 0) continue;
        ctx.fillStyle = val === 1 ? mainColor : accentColor;
        ctx.fillRect(x * cell, y * cell, cell, cell);
        ctx.fillRect((grid - 1 - x) * cell, y * cell, cell, cell);
      }
    }

    var url = canvas.toDataURL();
    blockieCache[hash] = url;
    return url;
  }

  // ═══════════════════════════════════════════
  // LISTING & FETCHING
  // ═══════════════════════════════════════════
  function sortByTimestamp(arr) {
    arr.sort(function (a, b) {
      var ta = parseInt(a.replace('messages/', '').split('-')[0], 10) || 0;
      var tb = parseInt(b.replace('messages/', '').split('-')[0], 10) || 0;
      return ta - tb;
    });
  }

  async function fetchFileList(useCache) {
    if (useCache) {
      try {
        var raw = sessionStorage.getItem(SS_LISTING_KEY);
        if (raw) {
          var cached = JSON.parse(raw);
          if (Date.now() - cached.ts < LISTING_CACHE_TTL) {
            if (cached.dmFiles) allDmFiles = cached.dmFiles;
            return cached.files;
          }
        }
      } catch (e) { /* */ }
    }

    var url = S3_ENDPOINT + '/' + CHAT_BUCKET + '?list-type=2&prefix=messages/&max-keys=1000';
    var res = await chatClient.fetch(url);
    if (!res.ok) throw new Error('ListObjects failed: ' + res.status);
    var xmlText = await res.text();
    var keys = parseS3ListXml(xmlText);
    var msgFiles = keys.filter(function (k) { return k.endsWith('-msg.json'); });
    var dmFiles = keys.filter(function (k) { return k.endsWith('-dm.json'); });
    sortByTimestamp(msgFiles);
    sortByTimestamp(dmFiles);
    allDmFiles = dmFiles;

    try {
      sessionStorage.setItem(SS_LISTING_KEY, JSON.stringify({ ts: Date.now(), files: msgFiles, dmFiles: dmFiles }));
    } catch (e) { /* */ }

    return msgFiles;
  }

  async function fetchAndRenderFeed() {
    if (els.chatLoader) els.chatLoader.hidden = false;
    if (els.chatEmpty) els.chatEmpty.hidden = true;

    try {
      allFileNames = await fetchFileList(true);
      const toLoad = allFileNames.slice(-MESSAGES_PER_PAGE);
      const messages = await Promise.all(toLoad.map(fetchMessage));
      loadedMessages = messages.filter(Boolean);
      renderMessages();
      scrollToBottom();
    } catch (err) {
      console.error('Feed load error:', err);
    } finally {
      if (els.chatLoader) els.chatLoader.hidden = true;
    }
  }

  async function loadMoreMessages() {
    if (isLoadingMore) return;
    const loadedNames = new Set(loadedMessages.map(m => m._filename));
    const remaining = allFileNames.filter(f => !loadedNames.has(f));
    if (remaining.length === 0) return;

    isLoadingMore = true;
    const toLoad = remaining.slice(-MESSAGES_LOAD_MORE);

    const scrollEl = els.body;
    const prevScrollHeight = scrollEl ? scrollEl.scrollHeight : 0;
    const prevScrollTop = scrollEl ? scrollEl.scrollTop : 0;

    try {
      const messages = await Promise.all(toLoad.map(fetchMessage));
      const valid = messages.filter(Boolean);
      loadedMessages = [...valid, ...loadedMessages];
      renderMessages();
      if (scrollEl) {
        scrollEl.scrollTop = prevScrollTop + (scrollEl.scrollHeight - prevScrollHeight);
      }
    } catch (err) {
      console.error('Load more error:', err);
    } finally {
      isLoadingMore = false;
    }
  }

  async function fetchMessage(filename) {
    const name = filename.replace('messages/', '');
    try {
      const res = await fetch(PUBLIC_URL + '/messages/' + name);
      if (!res.ok) return null;
      const msg = await res.json();
      msg._filename = filename;
      msg._name = name;
      return msg;
    } catch (e) {
      return null;
    }
  }

  // ═══════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════
  function renderMessages() {
    if (!els.chatFeed) return;
    els.chatFeed.innerHTML = '';
    renderedSet.clear();

    var filtered = getFilteredMessages();
    if (filtered.length === 0) {
      if (els.chatEmpty) {
        els.chatEmpty.hidden = false;
        els.chatEmpty.textContent = getEmptyMessage();
      }
      return;
    }
    if (els.chatEmpty) els.chatEmpty.hidden = true;

    filtered.forEach(function (msg) {
      var el = createMessageElement(msg);
      els.chatFeed.appendChild(el);
      renderedSet.add(msg._filename);
    });
  }

  function createMessageElement(msg) {
    const isOwn = msg.author_hash === userHash && userHash !== '';
    const div = document.createElement('div');
    div.className = 'news-msg' + (isOwn ? ' news-msg--own' : '');
    div.dataset.filename = msg._filename || '';

    let html = '';

    // Header: author + time
    html += '<div class="news-msg__header">';
    var blockieSrc = msg.author_hash ? createBlockie(msg.author_hash, 32) : '';
    if (blockieSrc) {
      html += '<img class="news-msg__avatar" src="' + blockieSrc + '" width="24" height="24" alt="">';
    }
    var authorColor = msg.author_hash ? hashToColor(msg.author_hash) : 'var(--accent)';
    html += '<span class="news-msg__author" style="color:' + authorColor + '">' + escapeHtml(msg.author || '???') + '</span>';
    html += '<span class="news-msg__time">' + relativeTime(msg.ts) + '</span>';
    html += '</div>';

    if (msg.reply_to && msg.reply_to.author) {
      var quoteColor = msg.reply_to.hash ? hashToColor(msg.reply_to.hash) : 'var(--accent)';
      html += '<div class="news-msg__quote" style="border-left-color:' + quoteColor + '">';
      html += '<span class="news-msg__quote-author" style="color:' + quoteColor + '">' + escapeHtml(msg.reply_to.author) + '</span>';
      html += '<span class="news-msg__quote-text">' + escapeHtml(msg.reply_to.text || '') + '</span>';
      html += '</div>';
    }

    // Text
    if (msg.text) {
      html += '<div class="news-msg__text">' + escapeHtml(msg.text).replace(/\n/g, '<br>') + '</div>';
    }

    // Media
    if (msg.media && msg.media.length > 0) {
      const m = msg.media[0];
      html += '<div class="news-msg__media">';
      if (m.type === 'video') {
        html += '<video src="' + escapeHtml(PUBLIC_URL + '/' + m.path) + '" controls preload="metadata" playsinline class="news-msg__video"></video>';
      } else {
        html += '<img src="' + escapeHtml(PUBLIC_URL + '/' + m.path) + '" alt="' + escapeHtml(m.name || '') + '" loading="lazy" class="news-msg__image">';
      }
      html += '</div>';
    }

    // Attachments
    if (msg.attachments && msg.attachments.length > 0) {
      msg.attachments.forEach(a => {
        html += '<div class="news-msg__attachment">';
        html += '<a href="' + escapeHtml(PUBLIC_URL + '/' + a.path) + '" download="' + escapeHtml(a.name) + '" class="news-msg__attachment-link">';
        html += '\uD83D\uDCCE ' + escapeHtml(a.name) + ' <span class="news-msg__attachment-size">(' + formatFileSize(a.size) + ')</span>';
        html += '</a></div>';
      });
    }

    // Edited mark
    if (msg.edited_at) {
      html += '<span class="news-msg__edited">(изменено)</span>';
    }

    if (userHash) {
      var snippetText = escapeHtml((msg.text || '').substring(0, 25));
      html += '<div class="news-msg__reply-actions">';
      html += '<button type="button" class="news-msg__reply-btn"'
        + ' data-filename="' + escapeHtml(msg._filename || '') + '"'
        + ' data-author="' + escapeHtml(msg.author || '') + '"'
        + ' data-hash="' + escapeHtml(msg.author_hash || '') + '"'
        + ' data-text="' + snippetText + '"'
        + ' aria-label="Ответить">\u21A9\uFE0F</button>';
      if (!isOwn) {
        html += '<button type="button" class="news-msg__dm-btn"'
          + ' data-filename="' + escapeHtml(msg._filename || '') + '"'
          + ' data-author="' + escapeHtml(msg.author || '') + '"'
          + ' data-hash="' + escapeHtml(msg.author_hash || '') + '"'
          + ' data-text="' + snippetText + '"'
          + ' aria-label="В личку">\uD83D\uDD12</button>';
      }
      html += '</div>';
    }

    if (isOwn) {
      html += '<div class="news-msg__actions">';
      html += '<button type="button" class="news-msg__edit-btn" data-filename="' + escapeHtml(msg._filename || '') + '" aria-label="Изменить">\u270F\uFE0F</button>';
      html += '<button type="button" class="news-msg__delete-btn" data-filename="' + escapeHtml(msg._filename || '') + '" aria-label="Удалить">\uD83D\uDDD1\uFE0F</button>';
      html += '</div>';
    }

    div.innerHTML = html;
    return div;
  }

  function relativeTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч';

    const d = new Date(ts);
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === yesterday.toDateString()) return 'вчера, ' + hours + ':' + mins;
    return day + ' ' + month + ', ' + hours + ':' + mins;
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes < 0) return '0 Б';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function scrollToBottom() {
    if (els.body) {
      setTimeout(() => { els.body.scrollTop = els.body.scrollHeight; }, 50);
    }
  }

  // ═══════════════════════════════════════════
  // FILTERS & REPLIES
  // ═══════════════════════════════════════════
  function getFilteredMessages() {
    if (activeFilter === 'all') {
      return loadedMessages.filter(function (m) { return !m.private; });
    }
    if (activeFilter === 'replies') {
      var repliesToMe = loadedMessages.filter(function (m) {
        return !m.private && m.reply_to && m.reply_to.hash === userHash;
      });
      var originFilenames = new Set(repliesToMe.map(function (m) { return m.reply_to.filename; }));
      var myOriginals = loadedMessages.filter(function (m) { return originFilenames.has(m._filename); });
      var combined = new Map();
      myOriginals.forEach(function (m) { combined.set(m._filename, m); });
      repliesToMe.forEach(function (m) { combined.set(m._filename, m); });
      var result = Array.from(combined.values());
      result.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      return result;
    }
    if (activeFilter === 'dm') {
      return loadedDmMessages.filter(function (m) {
        return m.author_hash === userHash || (m.private && m.private.to_hash === userHash);
      });
    }
    return loadedMessages;
  }

  function getEmptyMessage() {
    if (activeFilter === 'replies') return 'Пока нет ответов на ваши сообщения.';
    if (activeFilter === 'dm') return 'Пока нет личных сообщений.';
    return 'Пока нет сообщений. Будьте первым!';
  }

  async function ensureAllMessagesLoaded() {
    if (allMessagesLoaded) return;
    var loadedNames = new Set(loadedMessages.map(function (m) { return m._filename; }));
    var remaining = allFileNames.filter(function (f) { return !loadedNames.has(f); });
    if (remaining.length === 0) { allMessagesLoaded = true; return; }
    if (els.chatLoader) els.chatLoader.hidden = false;
    var msgs = await Promise.all(remaining.map(fetchMessage));
    var valid = msgs.filter(Boolean);
    loadedMessages = loadedMessages.concat(valid);
    loadedMessages.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    allMessagesLoaded = true;
    if (els.chatLoader) els.chatLoader.hidden = true;
  }

  async function ensureAllDmsLoaded() {
    if (allDmsLoaded) return;
    if (allDmFiles.length === 0) { allDmsLoaded = true; return; }
    if (els.chatLoader) els.chatLoader.hidden = false;
    var msgs = await Promise.all(allDmFiles.map(fetchMessage));
    var valid = msgs.filter(Boolean);
    loadedDmMessages = valid.filter(function (m) {
      return m.author_hash === userHash || (m.private && m.private.to_hash === userHash);
    });
    loadedDmMessages.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    allDmsLoaded = true;
    if (els.chatLoader) els.chatLoader.hidden = true;
  }

  async function setFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.news-view__filter-btn').forEach(function (btn) {
      btn.classList.toggle('news-view__filter-btn--active', btn.dataset.filter === filter);
    });
    if (filter === 'replies') await ensureAllMessagesLoaded();
    if (filter === 'dm') await ensureAllDmsLoaded();
    renderMessages();
    if (filter === 'all') scrollToBottom();
    updateSendBtnState();
  }

  function setPendingReply(data, isDm) {
    pendingReply = {
      hash: data.hash,
      author: data.author,
      text: data.text,
      filename: data.filename,
      isDm: isDm
    };
    if (els.replyPreview) els.replyPreview.hidden = false;
    if (els.replyAuthor) {
      els.replyAuthor.textContent = (isDm ? '\uD83D\uDD12 ' : '\u21A9 ') + data.author;
      els.replyAuthor.style.color = data.hash ? hashToColor(data.hash) : '';
    }
    if (els.replyText) els.replyText.textContent = data.text || '';
    if (els.replyBadge) els.replyBadge.hidden = !isDm;
    if (els.textInput) els.textInput.focus();
    updateSendBtnState();
  }

  // ═══════════════════════════════════════════
  // SEND MESSAGE
  // ═══════════════════════════════════════════
  async function sendMessage() {
    if (!callsign || !userHash) { showAuthModal(); return; }

    const text = (els.textInput ? els.textInput.value.trim() : '');
    if (!text && !pendingMedia && !pendingAttach) return;

    if (els.sendBtn) els.sendBtn.disabled = true;
    const ts = Date.now();

    try {
      const mediaArr = [];
      const attachArr = [];

      // Upload media
      if (pendingMedia) {
        let blob = pendingMedia.file;
        let fileName = sanitizeFilename(pendingMedia.file.name);
        const mediaType = pendingMedia.type;

        if (mediaType === 'image') {
          blob = await compressImage(pendingMedia.file);
          const ext = '.jpg';
          fileName = fileName.replace(/\.[^.]+$/, '') + ext;
        }

        const mediaKey = 'media/' + ts + '-' + userHash + '-' + fileName;
        await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + mediaKey, {
          method: 'PUT',
          headers: { 'Content-Type': blob.type || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' },
          body: blob
        });

        mediaArr.push({
          type: mediaType,
          name: fileName,
          path: mediaKey,
          size: blob.size
        });
      }

      // Upload attachment
      if (pendingAttach) {
        const fileName = sanitizeFilename(pendingAttach.file.name);
        const attachKey = 'media/' + ts + '-' + userHash + '-' + fileName;
        await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + attachKey, {
          method: 'PUT',
          headers: { 'Content-Type': pendingAttach.file.type || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' },
          body: pendingAttach.file
        });

        attachArr.push({
          name: fileName,
          path: attachKey,
          size: pendingAttach.file.size
        });
      }

      // Build message JSON
      var isDm = pendingReply && pendingReply.isDm;
      const messageData = {
        v: 1,
        author: callsign,
        author_hash: userHash,
        text: text,
        media: mediaArr,
        attachments: attachArr,
        ts: ts,
        edited_at: null,
        reply_to: pendingReply ? {
          hash: pendingReply.hash,
          author: pendingReply.author,
          text: pendingReply.text,
          filename: pendingReply.filename
        } : null,
        private: isDm ? {
          to_hash: pendingReply.hash,
          to_author: pendingReply.author
        } : null
      };

      var msgType = isDm ? 'dm' : 'msg';
      const msgFilename = ts + '-' + userHash + '-' + msgType + '.json';
      const msgKey = 'messages/' + msgFilename;
      await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + msgKey, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
        body: JSON.stringify(messageData)
      });

      messageData._filename = msgKey;
      messageData._name = msgFilename;
      if (isDm) {
        loadedDmMessages.push(messageData);
        allDmFiles.push(msgKey);
      } else {
        loadedMessages.push(messageData);
        allFileNames.push(msgKey);
      }
      renderMessages();
      scrollToBottom();

      // Clear input
      if (els.textInput) els.textInput.value = '';
      clearPending();
      try { sessionStorage.removeItem(SS_LISTING_KEY); } catch (e) { /* */ }

    } catch (err) {
      console.error('Send error:', err);
      alert('Ошибка отправки: ' + err.message);
    } finally {
      updateSendBtnState();
    }
  }

  // ═══════════════════════════════════════════
  // IMAGE COMPRESSION
  // ═══════════════════════════════════════════
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (Math.max(w, h) > IMAGE_MAX_DIM) {
          const ratio = IMAGE_MAX_DIM / Math.max(w, h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob); else reject(new Error('Compress failed'));
        }, 'image/jpeg', IMAGE_QUALITY);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });
  }

  // ═══════════════════════════════════════════
  // EDIT MESSAGE
  // ═══════════════════════════════════════════
  function openEditModal(filename) {
    const msg = loadedMessages.find(m => m._filename === filename);
    if (!msg) return;
    editingFilename = filename;
    if (els.editText) els.editText.value = msg.text || '';
    if (els.editModal) els.editModal.hidden = false;
  }

  async function saveEdit() {
    if (!editingFilename) return;
    const msg = loadedMessages.find(m => m._filename === editingFilename);
    if (!msg) return;

    const newText = els.editText ? els.editText.value.trim() : '';
    msg.text = newText;
    msg.edited_at = Date.now();

    try {
      await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + editingFilename, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
        body: JSON.stringify({
          v: msg.v || 1,
          author: msg.author,
          author_hash: msg.author_hash,
          text: msg.text,
          media: msg.media || [],
          attachments: msg.attachments || [],
          ts: msg.ts,
          edited_at: msg.edited_at
        })
      });
      renderMessages();
      scrollToBottom();
    } catch (err) {
      console.error('Edit error:', err);
      alert('Ошибка редактирования: ' + err.message);
    } finally {
      if (els.editModal) els.editModal.hidden = true;
      editingFilename = null;
    }
  }

  // ═══════════════════════════════════════════
  // DELETE MESSAGE
  // ═══════════════════════════════════════════
  async function deleteMessage(filename) {
    if (!confirm('Удалить сообщение?')) return;
    const msg = loadedMessages.find(m => m._filename === filename);
    if (!msg) return;

    try {
      await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + filename, { method: 'DELETE' });

      if (msg.media) {
        for (const m of msg.media) {
          await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + m.path, { method: 'DELETE' });
        }
      }
      if (msg.attachments) {
        for (const a of msg.attachments) {
          await chatClient.fetch(S3_ENDPOINT + '/' + CHAT_BUCKET + '/' + a.path, { method: 'DELETE' });
        }
      }

      loadedMessages = loadedMessages.filter(m => m._filename !== filename);
      allFileNames = allFileNames.filter(f => f !== filename);
      renderMessages();
      try { sessionStorage.removeItem(SS_LISTING_KEY); } catch (e) { /* */ }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Ошибка удаления: ' + err.message);
    }
  }

  // ═══════════════════════════════════════════
  // POLLING
  // ═══════════════════════════════════════════
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      checkForNewMessages();
    }, POLL_INTERVAL);

    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && isInitialized) {
      checkForNewMessages();
    }
  }

  async function checkForNewMessages() {
    try {
      var prevMsgSet = new Set(allFileNames);
      var prevDmSet = new Set(allDmFiles);

      var freshMsgList = await fetchFileList(false);
      // allDmFiles is now updated by fetchFileList

      var newMsgFiles = freshMsgList.filter(function (f) { return !prevMsgSet.has(f); });
      var deletedMsgSet = new Set();
      prevMsgSet.forEach(function (f) { if (freshMsgList.indexOf(f) === -1) deletedMsgSet.add(f); });

      if (deletedMsgSet.size > 0) {
        loadedMessages = loadedMessages.filter(function (m) { return !deletedMsgSet.has(m._filename); });
      }

      allFileNames = freshMsgList;

      if (newMsgFiles.length > 0) {
        var newMsgs = await Promise.all(newMsgFiles.map(fetchMessage));
        var valid = newMsgs.filter(Boolean);
        loadedMessages.push.apply(loadedMessages, valid);
        loadedMessages.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      }

      var dmChanged = false;
      if (allDmsLoaded) {
        var freshDmSet = new Set(allDmFiles);
        var newDmFiles = allDmFiles.filter(function (f) { return !prevDmSet.has(f); });
        var deletedDmArr = [];
        prevDmSet.forEach(function (f) { if (!freshDmSet.has(f)) deletedDmArr.push(f); });

        if (deletedDmArr.length > 0) {
          var delDmSet = new Set(deletedDmArr);
          loadedDmMessages = loadedDmMessages.filter(function (m) { return !delDmSet.has(m._filename); });
          dmChanged = true;
        }

        if (newDmFiles.length > 0) {
          var dmMsgs = await Promise.all(newDmFiles.map(fetchMessage));
          var validDm = dmMsgs.filter(function (m) {
            return m && (m.author_hash === userHash || (m.private && m.private.to_hash === userHash));
          });
          if (validDm.length > 0) {
            loadedDmMessages.push.apply(loadedDmMessages, validDm);
            loadedDmMessages.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
            dmChanged = true;
          }
        }
      }

      if (newMsgFiles.length > 0 || deletedMsgSet.size > 0 || dmChanged) {
        var wasAtBottom = isScrolledToBottom();
        renderMessages();
        if (wasAtBottom) scrollToBottom();
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  }

  function isScrolledToBottom() {
    if (!els.body) return true;
    return els.body.scrollHeight - els.body.scrollTop - els.body.clientHeight < 80;
  }

  // ═══════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════
  function bindEvents() {
    if (els.back) els.back.addEventListener('click', () => {
      if (typeof window.closeNewsView === 'function') window.closeNewsView();
    });

    if (els.refresh) els.refresh.addEventListener('click', () => {
      try { sessionStorage.removeItem(SS_LISTING_KEY); } catch (e) { /* */ }
      if (boardLoaded) loadBoard();
      if (chatLoaded) fetchAndRenderFeed();
    });

    if (els.settings) els.settings.addEventListener('click', () => showAuthModal());

    if (els.boardToggle) els.boardToggle.addEventListener('click', () => toggleBoard());
    if (els.chatToggle) els.chatToggle.addEventListener('click', () => toggleChat());

    function validateAndLogin() {
      var name = els.callsignInput ? els.callsignInput.value : '';
      var pass = els.passwordInput ? els.passwordInput.value : '';
      if (!name.trim() || name.trim().length > 12) {
        if (els.authError) {
          els.authError.textContent = 'Позывной не может быть пустым и должен быть не длиннее 12 символов';
          els.authError.hidden = false;
        }
        return;
      }
      if (pass.length < 8) {
        if (els.authError) {
          els.authError.textContent = 'Пароль должен содержать минимум 8 символов';
          els.authError.hidden = false;
        }
        return;
      }
      if (els.authError) els.authError.hidden = true;
      setCallsign(name, pass);
    }

    if (els.callsignBtn) els.callsignBtn.addEventListener('click', validateAndLogin);

    if (els.callsignInput) els.callsignInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); validateAndLogin(); }
    });

    if (els.passwordInput) els.passwordInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); validateAndLogin(); }
    });

    if (els.sendBtn) els.sendBtn.addEventListener('click', () => sendMessage());

    if (els.textInput) {
      els.textInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendBtnState();
      });
      els.textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    if (els.mediaBtn) els.mediaBtn.addEventListener('click', () => {
      if (els.mediaInput) els.mediaInput.click();
    });

    if (els.attachBtn) els.attachBtn.addEventListener('click', () => {
      if (els.attachInput) els.attachInput.click();
    });

    if (els.mediaInput) els.mediaInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const isVideo = file.type.startsWith('video/');
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        alert('Файл слишком большой. Максимум: ' + formatFileSize(maxSize));
        e.target.value = '';
        return;
      }
      pendingMedia = { file: file, type: isVideo ? 'video' : 'image' };
      showPreview(file);
      updateSendBtnState();
      e.target.value = '';
    });

    if (els.attachInput) els.attachInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > MAX_ATTACH_SIZE) {
        alert('Файл слишком большой. Максимум: ' + formatFileSize(MAX_ATTACH_SIZE));
        e.target.value = '';
        return;
      }
      pendingAttach = { file: file };
      showPreview(file);
      updateSendBtnState();
      e.target.value = '';
    });

    if (els.previewRemove) els.previewRemove.addEventListener('click', () => {
      clearPending();
      updateSendBtnState();
    });

    if (els.editCancel) els.editCancel.addEventListener('click', () => {
      if (els.editModal) els.editModal.hidden = true;
      editingFilename = null;
    });

    if (els.editSave) els.editSave.addEventListener('click', () => saveEdit());

    if (els.chatFeed) els.chatFeed.addEventListener('click', function (e) {
      var replyBtn = e.target.closest('.news-msg__reply-btn');
      if (replyBtn) { setPendingReply(replyBtn.dataset, false); return; }
      var dmBtn = e.target.closest('.news-msg__dm-btn');
      if (dmBtn) { setPendingReply(dmBtn.dataset, true); return; }
      var editBtn = e.target.closest('.news-msg__edit-btn');
      if (editBtn) { openEditModal(editBtn.dataset.filename); return; }
      var deleteBtn = e.target.closest('.news-msg__delete-btn');
      if (deleteBtn) { deleteMessage(deleteBtn.dataset.filename); return; }
      var img = e.target.closest('.news-msg__image');
      if (img) { openFullscreenImage(img.src); return; }
    });

    if (els.chatFilters) els.chatFilters.addEventListener('click', function (e) {
      var btn = e.target.closest('.news-view__filter-btn');
      if (btn && btn.dataset.filter) setFilter(btn.dataset.filter);
    });

    if (els.replyClose) els.replyClose.addEventListener('click', function () {
      pendingReply = null;
      if (els.replyPreview) els.replyPreview.hidden = true;
      updateSendBtnState();
    });

    // Scroll-up to load more
    if (els.body) els.body.addEventListener('scroll', () => {
      if (els.body.scrollTop < 100 && allFileNames.length > loadedMessages.length) {
        loadMoreMessages();
      }
    });

    // Close auth modal overlay click
    const authOverlay = els.authModal ? els.authModal.querySelector('.news-view__auth-overlay') : null;
    if (authOverlay) authOverlay.addEventListener('click', () => {
      if (callsign && userHash) els.authModal.hidden = true;
    });

    // Close edit modal overlay click
    const editOverlay = els.editModal ? els.editModal.querySelector('.news-view__edit-overlay') : null;
    if (editOverlay) editOverlay.addEventListener('click', () => {
      if (els.editModal) els.editModal.hidden = true;
      editingFilename = null;
    });
  }

  function autoResizeTextarea() {
    if (!els.textInput) return;
    els.textInput.style.height = 'auto';
    els.textInput.style.height = Math.min(els.textInput.scrollHeight, 120) + 'px';
  }

  function updateSendBtnState() {
    if (!els.sendBtn) return;
    var hasText = els.textInput && els.textInput.value.trim().length > 0;
    var hasMedia = !!pendingMedia || !!pendingAttach;
    var hasAuth = !!(callsign && userHash);

    if (activeFilter === 'dm' && !pendingReply) {
      els.sendBtn.disabled = true;
      if (els.textInput) els.textInput.placeholder = 'Нажмите \uD83D\uDD12 на сообщении для ответа в личку';
      return;
    }
    if (els.textInput && activeFilter === 'dm' && pendingReply) {
      els.textInput.placeholder = 'Личное сообщение...';
    } else if (els.textInput && els.textInput.placeholder !== 'Сообщение...' && activeFilter !== 'dm') {
      if (hasAuth) els.textInput.placeholder = 'Сообщение...';
    }

    els.sendBtn.disabled = !(hasAuth && (hasText || hasMedia));
  }

  function showPreview(file) {
    if (els.previewName) els.previewName.textContent = file.name;
    if (els.previewSize) els.previewSize.textContent = formatFileSize(file.size);
    if (els.preview) els.preview.hidden = false;
  }

  function clearPending() {
    pendingMedia = null;
    pendingAttach = null;
    pendingReply = null;
    if (els.preview) els.preview.hidden = true;
    if (els.previewName) els.previewName.textContent = '';
    if (els.previewSize) els.previewSize.textContent = '';
    if (els.replyPreview) els.replyPreview.hidden = true;
  }

  function openFullscreenImage(src) {
    const overlay = document.createElement('div');
    overlay.className = 'news-view__fullscreen-overlay';
    overlay.innerHTML = '<img src="' + escapeHtml(src) + '" class="news-view__fullscreen-img">';
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════
  function parseFilename(name) {
    const clean = name.replace('messages/', '').replace('.json', '');
    const parts = clean.split('-');
    return {
      ts: parseInt(parts[0], 10),
      hash: parts[1],
      type: parts[2]
    };
  }

  function parseS3ListXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const contents = doc.querySelectorAll('Contents');
    const keys = [];
    contents.forEach(c => {
      const keyEl = c.querySelector('Key');
      if (keyEl) keys.push(keyEl.textContent);
    });
    return keys;
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
  }
})();
