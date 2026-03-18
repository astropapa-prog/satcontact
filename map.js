/**
 * SatContact — Модуль 2: Сервис геолокации (map.js)
 * GPS-контроллер: запрос с таймаутом, localStorage, фоновый опрос 1 раз в час
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'satcontact_observer';
  const GPS_TIMEOUT_MS = 6000;
  const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 час
  const HUD_UPDATE_MS = 1000; // обновление телеметрии каждую секунду

  let pollTimerId = null;
  let hudTimerId = null;
  let currentObserver = null;
  let currentNoradIds = [];
  let initialNoradIds = [];
  let currentNoradIdToName = {};
  let isShowAllMode = false;

  // DOM
  let mapLoading, mapGpsDenied, mapCoords, mapRefresh, mapShowAllBtn;
  let mapAzimuth, mapElevation, mapDistance;
  let loadingStatus1, loadingStatus2;
  let gpsRetryBtn, gpsContinueBtn;

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

    const mergedMap = {};
    uniqueIds.forEach((id) => {
      mergedMap[id] = (nextNameMap && nextNameMap[id]) || currentNoradIdToName[id] || `NORAD ${id}`;
    });
    currentNoradIdToName = mergedMap;

    if (window.SatContactMapRender && typeof window.SatContactMapRender.update === 'function') {
      window.SatContactMapRender.update();
    }
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

  /**
   * Сохранение координат в localStorage
   */
  function saveObserver(coords) {
    try {
      const data = {
        lat: coords.latitude,
        lon: coords.longitude,
        altitude: coords.altitude ?? null,
        timestamp: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('map.js: не удалось сохранить координаты', e);
    }
  }

  /**
   * Чтение координат из localStorage
   */
  function loadObserver() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return {
        latitude: data.lat,
        longitude: data.lon,
        altitude: data.altitude
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Обновление HUD: координаты пользователя
   */
  function updateCoordsDisplay(coords) {
    if (!mapCoords) return;
    if (!coords) {
      mapCoords.textContent = '—';
      return;
    }
    const lat = coords.latitude.toFixed(5);
    const lon = coords.longitude.toFixed(5);
    const alt = coords.altitude != null ? ` ${coords.altitude.toFixed(0)} м` : '';
    mapCoords.textContent = `${lat}°, ${lon}°${alt}`;
  }

  /**
   * Обновление статуса загрузки
   */
  function setLoadingStatus(line1, line2) {
    if (loadingStatus1) loadingStatus1.textContent = line1 || 'Поиск GPS…';
    if (loadingStatus2) loadingStatus2.textContent = line2 || 'Загрузка орбит…';
  }

  /**
   * Показать плашку «GPS заблокирован»
   */
  function showGpsDenied() {
    if (mapLoading) mapLoading.hidden = true;
    if (mapGpsDenied) mapGpsDenied.hidden = false;
  }

  /**
   * Скрыть плашку «GPS заблокирован»
   */
  function hideGpsDenied() {
    if (mapGpsDenied) mapGpsDenied.hidden = true;
    if (mapLoading) mapLoading.hidden = false;
  }

  /**
   * Запрос GPS с таймаутом
   * @returns {Promise<{latitude, longitude, altitude?}|null>}
   */
  function requestGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      const timeoutId = setTimeout(() => {
        resolve(null);
      }, GPS_TIMEOUT_MS);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timeoutId);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude
          });
        },
        () => {
          clearTimeout(timeoutId);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS - 500, maximumAge: 0 }
      );
    });
  }

  /**
   * Проверка разрешения (navigator.permissions — не везде поддерживается)
   */
  function checkPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return null;
    return navigator.permissions.query({ name: 'geolocation' });
  }

  /**
   * Основная логика получения координат при открытии карты
   * @returns {Promise<{coords: object|null, denied: boolean}>}
   */
  async function acquireObserver() {
    setLoadingStatus('Поиск GPS…', 'Загрузка орбит…');
    hideGpsDenied();

    const perm = checkPermission();
    if (perm) {
      try {
        const state = await perm;
        if (state.state === 'denied') {
          showGpsDenied();
          currentObserver = loadObserver();
          updateCoordsDisplay(currentObserver);
          return { coords: currentObserver, denied: true };
        }
      } catch (e) {
        // Игнорируем, пробуем запрос
      }
    }

    const coords = await requestGps();

    if (coords) {
      saveObserver(coords);
      currentObserver = coords;
      updateCoordsDisplay(currentObserver);
      setLoadingStatus('Загрузка орбит…', '');
      return { coords, denied: false };
    }

    // Таймаут или ошибка — берём из localStorage
    currentObserver = loadObserver();
    updateCoordsDisplay(currentObserver);
    setLoadingStatus('Загрузка орбит…', '');
    return { coords: currentObserver, denied: false };
  }

  /**
   * Ручное обновление GPS (кнопка [↻])
   */
  async function onManualRefresh() {
    if (!mapRefresh) return;
    mapRefresh.disabled = true;
    setLoadingStatus('Поиск GPS…', '');
    hideGpsDenied();

    const coords = await requestGps();

    if (coords) {
      saveObserver(coords);
      currentObserver = coords;
      updateCoordsDisplay(currentObserver);
    }

    setLoadingStatus('Загрузка орбит…', '');
    mapRefresh.disabled = false;
  }

  /**
   * Фоновый опрос раз в час
   */
  function startPolling() {
    stopPolling();
    pollTimerId = setInterval(async () => {
      const coords = await requestGps();
      if (coords) {
        saveObserver(coords);
        currentObserver = coords;
        updateCoordsDisplay(coords);
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimerId) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
  }

  /**
   * Обновление HUD: азимут, элевация, дистанция (из TLE + satellite.js)
   */
  function updateHudTelem() {
    if (!mapAzimuth || !mapElevation || !mapDistance) return;
    if (!window.SatContactTle) return;

    const noradId = currentNoradIds[0];
    if (!noradId) {
      mapAzimuth.textContent = '—';
      mapElevation.textContent = '—';
      mapDistance.textContent = '—';
      return;
    }

    const tleMap = window.SatContactTle.getCache();
    if (!tleMap) return;

    const tleData = tleMap.get(noradId);
    if (!tleData) {
      mapAzimuth.textContent = '—';
      mapElevation.textContent = '—';
      mapDistance.textContent = '—';
      return;
    }

    if (!currentObserver) {
      mapAzimuth.textContent = '—';
      mapElevation.textContent = '—';
      mapDistance.textContent = '—';
      return;
    }

    const result = window.SatContactTle.computeSatellite(tleData, currentObserver, new Date());
    if (!result) {
      mapAzimuth.textContent = '—';
      mapElevation.textContent = '—';
      mapDistance.textContent = '—';
      return;
    }

    mapAzimuth.textContent = window.SatContactTle.formatAzimuth(result.azimuth);
    mapElevation.textContent = window.SatContactTle.formatElevation(result.elevation);
    mapDistance.textContent = result.distance != null ? `${Math.round(result.distance)} км` : '—';
  }

  function startHudUpdate() {
    stopHudUpdate();
    updateHudTelem();
    hudTimerId = setInterval(() => {
      updateHudTelem();
      if (window.SatContactMapRender) window.SatContactMapRender.update();
    }, HUD_UPDATE_MS);
  }

  function stopHudUpdate() {
    if (hudTimerId) {
      clearInterval(hudTimerId);
      hudTimerId = null;
    }
  }

  /**
   * Инициализация карты (вызывается из app.js)
   */
  window.initMap = function (options) {
    const { noradIds = [], satelliteName, noradIdToName = {} } = options || {};
    initialNoradIds = [...new Set((noradIds || []).map((id) => String(id)).filter(Boolean))];
    currentNoradIds = initialNoradIds.slice();
    currentNoradIdToName = (noradIdToName && Object.keys(noradIdToName).length > 0)
      ? Object.fromEntries(Object.entries(noradIdToName).map(([id, name]) => [String(id), name]))
      : Object.fromEntries(initialNoradIds.map((id) => [id, satelliteName || `NORAD ${id}`]));

    const mapCanvas = document.getElementById('mapCanvas');
    mapLoading = document.getElementById('mapLoading');
    mapGpsDenied = document.getElementById('mapGpsDenied');
    mapCoords = document.getElementById('mapCoords');
    mapRefresh = document.getElementById('mapRefresh');
    mapShowAllBtn = document.getElementById('mapShowAll');
    mapAzimuth = document.getElementById('mapAzimuth');
    mapElevation = document.getElementById('mapElevation');
    mapDistance = document.getElementById('mapDistance');
    loadingStatus1 = document.getElementById('mapLoadingStatus1');
    loadingStatus2 = document.getElementById('mapLoadingStatus2');
    gpsRetryBtn = document.getElementById('mapGpsRetry');
    gpsContinueBtn = document.getElementById('mapGpsContinue');
    bindMapShowAllButton();

    acquireObserver().then(async ({ denied }) => {
      setLoadingStatus('Загрузка орбит…', '');
      try {
        if (window.SatContactTle) {
          await window.SatContactTle.loadTle();
        }
      } catch (e) {
        console.warn('map.js: не удалось загрузить TLE', e);
      }
      if (mapLoading) mapLoading.hidden = true;
      if (!denied) startPolling();
      startHudUpdate();
      if (window.SatContactMapRender && mapCanvas) {
        window.SatContactMapRender.init(mapCanvas);
      }
    });

    if (mapRefresh) {
      mapRefresh.replaceWith(mapRefresh.cloneNode(true));
      mapRefresh = document.getElementById('mapRefresh');
      mapRefresh.addEventListener('click', onManualRefresh);
    }

    if (gpsRetryBtn) {
      gpsRetryBtn.replaceWith(gpsRetryBtn.cloneNode(true));
      gpsRetryBtn = document.getElementById('mapGpsRetry');
      gpsRetryBtn.addEventListener('click', () => acquireObserver().then(({ denied }) => {
        if (!denied) {
          hideGpsDenied();
          if (mapLoading) mapLoading.hidden = true;
          startPolling();
        }
      }));
    }

    if (gpsContinueBtn) {
      gpsContinueBtn.replaceWith(gpsContinueBtn.cloneNode(true));
      gpsContinueBtn = document.getElementById('mapGpsContinue');
      gpsContinueBtn.addEventListener('click', () => {
        if (mapGpsDenied) mapGpsDenied.hidden = true;
        if (mapLoading) mapLoading.hidden = true;
      });
    }
  };

  /**
   * Очистка при закрытии карты
   */
  window.cleanupMap = function () {
    stopPolling();
    stopHudUpdate();
    setMapShowAllButtonState(false);
    if (window.SatContactMapRender) window.SatContactMapRender.destroy();
  };

  /**
   * Получить текущие координаты наблюдателя (для шагов 4–5)
   */
  window.getMapObserver = function () {
    return currentObserver;
  };

  /**
   * Получить текущие NORAD ID (для D3-рендера)
   */
  window.getMapNoradIds = function () {
    return currentNoradIds;
  };

  /**
   * Получить соответствие NORAD ID → название спутника
   */
  window.getMapNoradIdToName = function () {
    return currentNoradIdToName || {};
  };

  /**
   * Вычислить позицию спутника (для D3-карты)
   * @param {string} noradId
   * @param {Date} [date]
   * @returns {{ lat, lon } | null}
   */
  window.getSatellitePosition = function (noradId, date) {
    if (!window.SatContactTle) return null;
    const tleMap = window.SatContactTle.getCache();
    if (!tleMap) return null;
    const tleData = tleMap.get(noradId);
    if (!tleData) return null;
    const observer = currentObserver || { latitude: 0, longitude: 0, altitude: 0 };
    const result = window.SatContactTle.computeSatellite(tleData, observer, date || new Date());
    return result ? { lat: result.lat, lon: result.lon } : null;
  };
})();
