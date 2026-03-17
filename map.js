/**
 * SatContact — Модуль 2: Сервис геолокации (map.js)
 * GPS-контроллер: запрос с таймаутом, localStorage, фоновый опрос 1 раз в час
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'satcontact_observer';
  const GPS_TIMEOUT_MS = 6000;
  const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 час

  let pollTimerId = null;
  let currentObserver = null;

  // DOM
  let mapLoading, mapGpsDenied, mapCoords, mapRefresh;
  let loadingStatus1, loadingStatus2;
  let gpsRetryBtn, gpsContinueBtn;

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
   * Инициализация карты (вызывается из app.js)
   */
  window.initMap = function (options) {
    const { noradIds, satelliteName } = options || {};

    mapLoading = document.getElementById('mapLoading');
    mapGpsDenied = document.getElementById('mapGpsDenied');
    mapCoords = document.getElementById('mapCoords');
    mapRefresh = document.getElementById('mapRefresh');
    loadingStatus1 = document.getElementById('mapLoadingStatus1');
    loadingStatus2 = document.getElementById('mapLoadingStatus2');
    gpsRetryBtn = document.getElementById('mapGpsRetry');
    gpsContinueBtn = document.getElementById('mapGpsContinue');

    acquireObserver().then(({ denied }) => {
      if (mapLoading) mapLoading.hidden = true;
      if (!denied) startPolling();
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
  };

  /**
   * Получить текущие координаты наблюдателя (для шагов 4–5)
   */
  window.getMapObserver = function () {
    return currentObserver;
  };
})();
