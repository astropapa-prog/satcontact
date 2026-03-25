/**
 * SatContact — Модуль 2: Интерактивная карта (map.js)
 * Телеметрия, NORAD-фокус, HUD. Координаты — из SatContactGps.
 */
(function () {
  'use strict';

  const HUD_UPDATE_MS = 1000;
  const TELEMETRY_EMPTY_PLACEHOLDER = '—';
  const TELEMETRY_MULTI_AZ_EL_PLACEHOLDER = '---';
  const TELEMETRY_MULTI_DISTANCE_PLACEHOLDER = '----';

  let hudTimerId = null;
  let currentNoradIds = [];
  let initialNoradIds = [];
  let currentNoradIdToName = {};
  let isShowAllMode = false;
  let focusedNoradIds = [];
  let hudTelemetryNoradId = null;
  let lastSingleFocusedNoradId = null;
  let mapFocusListener = null;
  let netBtnFeedbackTimerId = null;
  let manualBtnFeedbackTimerId = null;

  // DOM
  let mapShowAllBtn;
  let mapAzimuth, mapElevation, mapDistance;
  let mapGpsIndicator, mapGpsCoords, mapGpsAge, mapGpsNetBtn;
  let mapManualCoordsInput, mapManualWriteBtn;

  /* ====== NORAD / Show All / Focus ====== */

  function setMapShowAllButtonState(active) {
    isShowAllMode = !!active;
    if (!mapShowAllBtn) return;
    mapShowAllBtn.classList.toggle('active', isShowAllMode);
    mapShowAllBtn.setAttribute('aria-pressed', String(isShowAllMode));
  }

  function buildNoradNameMap(entries) {
    const map = {};
    (entries || []).forEach((entry) => {
      const name = entry?.cleanName || '';
      (entry?.noradIds || []).forEach((id) => {
        const key = String(id);
        if (!map[key]) map[key] = name || `NORAD ${key}`;
      });
    });
    return map;
  }

  function applyNoradSelection(nextNoradIds, nextNameMap) {
    const uniqueIds = [...new Set((nextNoradIds || []).map((id) => String(id)).filter(Boolean))];
    if (!uniqueIds.length) return;
    currentNoradIds = uniqueIds;
    focusedNoradIds = focusedNoradIds.filter((id) => currentNoradIds.includes(id));
    if (hudTelemetryNoradId && !currentNoradIds.includes(hudTelemetryNoradId)) {
      hudTelemetryNoradId = null;
    }
    if (lastSingleFocusedNoradId && !currentNoradIds.includes(lastSingleFocusedNoradId)) {
      lastSingleFocusedNoradId = null;
    }

    const mergedMap = {};
    uniqueIds.forEach((id) => {
      mergedMap[id] = (nextNameMap && nextNameMap[id]) || currentNoradIdToName[id] || `NORAD ${id}`;
    });
    currentNoradIdToName = mergedMap;

    if (window.SatContactMapRender && typeof window.SatContactMapRender.update === 'function') {
      window.SatContactMapRender.update();
    }
  }

  /* ====== HUD Telemetry helpers ====== */

  function setHudTelemetryPlaceholder(isMultiFocus) {
    if (!mapAzimuth || !mapElevation || !mapDistance) return;
    if (isMultiFocus) {
      mapAzimuth.textContent = TELEMETRY_MULTI_AZ_EL_PLACEHOLDER;
      mapElevation.textContent = TELEMETRY_MULTI_AZ_EL_PLACEHOLDER;
      mapDistance.textContent = TELEMETRY_MULTI_DISTANCE_PLACEHOLDER;
      return;
    }
    mapAzimuth.textContent = TELEMETRY_EMPTY_PLACEHOLDER;
    mapElevation.textContent = TELEMETRY_EMPTY_PLACEHOLDER;
    mapDistance.textContent = TELEMETRY_EMPTY_PLACEHOLDER;
  }

  function getDefaultTelemetryNoradId() {
    if (lastSingleFocusedNoradId && currentNoradIds.includes(lastSingleFocusedNoradId)) {
      return lastSingleFocusedNoradId;
    }
    return currentNoradIds[0] || null;
  }

  function resolveTelemetryNoradId() {
    if (focusedNoradIds.length > 1) return null;
    if (focusedNoradIds.length === 1) return focusedNoradIds[0];
    if (hudTelemetryNoradId && currentNoradIds.includes(hudTelemetryNoradId)) {
      return hudTelemetryNoradId;
    }
    return getDefaultTelemetryNoradId();
  }

  /* ====== Map Focus Telemetry ====== */

  function onMapFocusChange(evt) {
    const nextFocusedIds = Array.isArray(evt?.detail?.focusedIds)
      ? [...new Set(evt.detail.focusedIds.map((id) => String(id)).filter(Boolean))]
      : [];

    focusedNoradIds = nextFocusedIds.filter((id) => currentNoradIds.includes(id));

    if (focusedNoradIds.length === 1) {
      hudTelemetryNoradId = focusedNoradIds[0];
      lastSingleFocusedNoradId = focusedNoradIds[0];
    } else if (focusedNoradIds.length === 0) {
      hudTelemetryNoradId = getDefaultTelemetryNoradId();
    } else {
      hudTelemetryNoradId = null;
    }

    updateHudTelem();
  }

  function bindMapFocusTelemetry() {
    unbindMapFocusTelemetry();
    mapFocusListener = (evt) => onMapFocusChange(evt);
    window.addEventListener('satcontact:map-focus', mapFocusListener);
  }

  function unbindMapFocusTelemetry() {
    if (!mapFocusListener) return;
    window.removeEventListener('satcontact:map-focus', mapFocusListener);
    mapFocusListener = null;
  }

  function bindMapShowAllButton() {
    if (!mapShowAllBtn) return;
    mapShowAllBtn.replaceWith(mapShowAllBtn.cloneNode(true));
    mapShowAllBtn = document.getElementById('mapShowAll');
    if (!mapShowAllBtn) return;

    setMapShowAllButtonState(false);
    mapShowAllBtn.addEventListener('click', () => {
      const nextState = !isShowAllMode;
      setMapShowAllButtonState(nextState);

      if (nextState) {
        const filteredEntries = typeof window.getSatContactFilteredEntries === 'function'
          ? window.getSatContactFilteredEntries()
          : [];
        const idsFromFiltered = [...new Set(filteredEntries.flatMap((entry) => entry?.noradIds || []).map((id) => String(id)).filter(Boolean))];
        if (!idsFromFiltered.length) {
          setMapShowAllButtonState(false);
          return;
        }
        const namesFromFiltered = buildNoradNameMap(filteredEntries);
        applyNoradSelection(idsFromFiltered, namesFromFiltered);
        return;
      }

      const focusedIds = (window.SatContactMapRender && typeof window.SatContactMapRender.getFocusedNoradIds === 'function')
        ? window.SatContactMapRender.getFocusedNoradIds()
        : [];
      if (focusedIds.length > 0) {
        applyNoradSelection(focusedIds, currentNoradIdToName);
      } else {
        applyNoradSelection(initialNoradIds, currentNoradIdToName);
      }
    });
  }

  /* ====== GPS Status Row ====== */

  function formatCacheAge(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < 60000) return '';
    if (ageMs < 3600000) {
      const m = Math.floor(ageMs / 60000);
      const s = Math.floor((ageMs % 60000) / 1000);
      return '(кеш ' + m + ':' + String(s).padStart(2, '0') + ')';
    }
    if (ageMs < 86400000) return '(кеш ' + Math.floor(ageMs / 3600000) + 'ч)';
    return '(кеш ' + Math.floor(ageMs / 86400000) + 'д)';
  }

  function updateGpsStatusRow() {
    const gps = window.SatContactGps;
    if (!gps) return;

    const coords = gps.getCoords();
    const status = gps.getReceiverStatus();
    const ageMs = gps.getCacheAgeMs();

    if (mapGpsIndicator) {
      if (status === 'fix')          mapGpsIndicator.textContent = '\uD83D\uDFE2 GPS';
      else if (status === 'searching') mapGpsIndicator.textContent = '\uD83D\uDFE1 ПОИСК';
      else if (status === 'denied')  mapGpsIndicator.textContent = '\uD83D\uDD34 ЗАПРЕЩЁН';
      else                           mapGpsIndicator.textContent = '\u26AA ВЫКЛ';
    }

    if (mapGpsCoords) {
      mapGpsCoords.textContent = coords
        ? coords.latitude.toFixed(2) + '\u00B0, ' + coords.longitude.toFixed(2) + '\u00B0'
        : 'НЕТ ДАННЫХ';
    }

    if (mapGpsAge) {
      mapGpsAge.textContent = coords ? formatCacheAge(ageMs) : '';
    }
  }

  /* ====== GPS Controls Binding ====== */

  function onNetworkBtnClick() {
    if (!mapGpsNetBtn || !window.SatContactGps) return;
    const savedText = mapGpsNetBtn.textContent;
    mapGpsNetBtn.textContent = '...';
    mapGpsNetBtn.disabled = true;

    window.SatContactGps.updateFromNetwork().then(function (ok) {
      if (ok) {
        mapGpsNetBtn.textContent = '\u2713';
        if (window.SatContactMapRender && typeof window.SatContactMapRender.update === 'function') {
          window.SatContactMapRender.update();
        }
      } else {
        mapGpsNetBtn.textContent = 'Сеть недоступна';
      }
      if (netBtnFeedbackTimerId) clearTimeout(netBtnFeedbackTimerId);
      netBtnFeedbackTimerId = setTimeout(() => {
        mapGpsNetBtn.textContent = savedText;
        mapGpsNetBtn.disabled = false;
        netBtnFeedbackTimerId = null;
      }, 2000);
    });
  }

  function onManualWriteBtnClick() {
    if (!mapManualCoordsInput || !mapManualWriteBtn || !window.SatContactGps) return;
    const text = mapManualCoordsInput.value.trim();
    const matches = text.match(/-?\d+(?:[.,]\d+)?/g);
    if (!matches || matches.length < 2) {
      showBriefFeedback(mapManualWriteBtn, 'Неверный формат', manualBtnFeedbackTimerId, (tid) => { manualBtnFeedbackTimerId = tid; }, true);
      return;
    }
    const lat = Number(matches[0].replace(',', '.'));
    const lon = Number(matches[1].replace(',', '.'));
    const ok = window.SatContactGps.updateManual(lat, lon);
    if (ok) {
      showBriefFeedback(mapManualWriteBtn, '\u2713', manualBtnFeedbackTimerId, (tid) => { manualBtnFeedbackTimerId = tid; }, false);
      if (window.SatContactMapRender && typeof window.SatContactMapRender.update === 'function') {
        window.SatContactMapRender.update();
      }
    } else {
      showBriefFeedback(mapManualWriteBtn, 'Неверный формат', manualBtnFeedbackTimerId, (tid) => { manualBtnFeedbackTimerId = tid; }, true);
    }
  }

  function showBriefFeedback(btn, text, timerId, setTimerId, isError) {
    if (!btn) return;
    const savedText = btn.textContent;
    btn.textContent = text;
    if (isError) btn.style.color = '#ef9a9a';
    if (timerId) clearTimeout(timerId);
    setTimerId(setTimeout(() => {
      btn.textContent = savedText;
      btn.style.color = '';
      setTimerId(null);
    }, 2000));
  }

  function gpsChangeHandler() {
    updateGpsStatusRow();
    if (window.SatContactMapRender && typeof window.SatContactMapRender.update === 'function') {
      window.SatContactMapRender.update();
    }
  }

  /* ====== HUD Telemetry ====== */

  function updateHudTelem() {
    if (!mapAzimuth || !mapElevation || !mapDistance) return;
    if (!window.SatContactTle) return;

    const isMultiFocus = focusedNoradIds.length > 1;
    const noradId = resolveTelemetryNoradId();
    if (!noradId) {
      setHudTelemetryPlaceholder(isMultiFocus);
      return;
    }

    const tleMap = window.SatContactTle.getCache();
    if (!tleMap) return;

    const tleData = tleMap.get(noradId);
    if (!tleData) {
      setHudTelemetryPlaceholder(isMultiFocus);
      return;
    }

    const observer = window.SatContactGps ? window.SatContactGps.getCoords() : null;
    if (!observer) {
      setHudTelemetryPlaceholder(isMultiFocus);
      return;
    }

    const result = window.SatContactTle.computeSatellite(tleData, observer, new Date());
    if (!result) {
      setHudTelemetryPlaceholder(isMultiFocus);
      return;
    }

    mapAzimuth.textContent = window.SatContactTle.formatAzimuth(result.azimuth);
    mapElevation.textContent = window.SatContactTle.formatElevation(result.elevation);
    mapDistance.textContent = result.distance != null
      ? `${Math.round(result.distance)} км`
      : TELEMETRY_EMPTY_PLACEHOLDER;
  }

  function startHudUpdate() {
    stopHudUpdate();
    updateHudTelem();
    updateGpsStatusRow();
    hudTimerId = setInterval(() => {
      updateHudTelem();
      updateGpsStatusRow();
    }, HUD_UPDATE_MS);
  }

  function stopHudUpdate() {
    if (hudTimerId) {
      clearInterval(hudTimerId);
      hudTimerId = null;
    }
  }

  /* ====== Init / Cleanup ====== */

  window.initMap = function (options) {
    const { noradIds = [], satelliteName, noradIdToName = {} } = options || {};
    initialNoradIds = [...new Set((noradIds || []).map((id) => String(id)).filter(Boolean))];
    currentNoradIds = initialNoradIds.slice();
    focusedNoradIds = [];
    lastSingleFocusedNoradId = currentNoradIds[0] || null;
    hudTelemetryNoradId = currentNoradIds[0] || null;
    currentNoradIdToName = (noradIdToName && Object.keys(noradIdToName).length > 0)
      ? Object.fromEntries(Object.entries(noradIdToName).map(([id, name]) => [String(id), name]))
      : Object.fromEntries(initialNoradIds.map((id) => [id, satelliteName || `NORAD ${id}`]));

    const mapCanvas = document.getElementById('mapCanvas');
    mapShowAllBtn = document.getElementById('mapShowAll');
    mapAzimuth = document.getElementById('mapAzimuth');
    mapElevation = document.getElementById('mapElevation');
    mapDistance = document.getElementById('mapDistance');
    mapGpsIndicator = document.getElementById('mapGpsIndicator');
    mapGpsCoords = document.getElementById('mapGpsCoords');
    mapGpsAge = document.getElementById('mapGpsAge');
    mapGpsNetBtn = document.getElementById('mapGpsNetBtn');
    mapManualCoordsInput = document.getElementById('mapManualCoordsInput');
    mapManualWriteBtn = document.getElementById('mapManualWriteBtn');

    bindMapShowAllButton();
    bindMapFocusTelemetry();

    if (mapGpsNetBtn) {
      mapGpsNetBtn.replaceWith(mapGpsNetBtn.cloneNode(true));
      mapGpsNetBtn = document.getElementById('mapGpsNetBtn');
      mapGpsNetBtn.addEventListener('click', onNetworkBtnClick);
    }
    if (mapManualWriteBtn) {
      mapManualWriteBtn.replaceWith(mapManualWriteBtn.cloneNode(true));
      mapManualWriteBtn = document.getElementById('mapManualWriteBtn');
      mapManualWriteBtn.addEventListener('click', onManualWriteBtnClick);
    }

    if (window.SatContactGps) {
      window.SatContactGps.start();
      window.SatContactGps.onChange(gpsChangeHandler);
    }

    updateGpsStatusRow();

    (async function () {
      try {
        if (window.SatContactTle) {
          await window.SatContactTle.loadTle();
        }
      } catch (e) {
        console.warn('map.js: не удалось загрузить TLE', e);
      }
      startHudUpdate();
      if (window.SatContactMapRender && mapCanvas) {
        window.SatContactMapRender.init(mapCanvas);
      }
    })();
  };

  window.cleanupMap = function () {
    stopHudUpdate();
    unbindMapFocusTelemetry();

    if (netBtnFeedbackTimerId) { clearTimeout(netBtnFeedbackTimerId); netBtnFeedbackTimerId = null; }
    if (manualBtnFeedbackTimerId) { clearTimeout(manualBtnFeedbackTimerId); manualBtnFeedbackTimerId = null; }

    if (window.SatContactGps) {
      window.SatContactGps.enterCooldown();
      window.SatContactGps.offChange(gpsChangeHandler);
    }

    setMapShowAllButtonState(false);
    focusedNoradIds = [];
    hudTelemetryNoradId = null;
    lastSingleFocusedNoradId = null;
    if (window.SatContactMapRender) window.SatContactMapRender.destroy();
  };

  window.getMapObserver = function () {
    return window.SatContactGps ? window.SatContactGps.getCoords() : null;
  };

  window.getMapNoradIds = function () {
    return currentNoradIds;
  };

  window.getMapNoradIdToName = function () {
    return currentNoradIdToName || {};
  };

  window.getSatellitePosition = function (noradId, date) {
    if (!window.SatContactTle) return null;
    const tleMap = window.SatContactTle.getCache();
    if (!tleMap) return null;
    const tleData = tleMap.get(noradId);
    if (!tleData) return null;
    const observer = (window.SatContactGps && window.SatContactGps.getCoords()) || { latitude: 0, longitude: 0, altitude: 0 };
    const result = window.SatContactTle.computeSatellite(tleData, observer, date || new Date());
    return result ? { lat: result.lat, lon: result.lon } : null;
  };
})();
