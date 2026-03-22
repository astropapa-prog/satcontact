/**
 * SatContact — Централизованный GPS-сервис (gps-service.js)
 * Единая точка получения координат наблюдателя.
 * RAM-кеш + localStorage, watchPosition state machine, IP-геолокация, ручной ввод.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'satcontact_observer';
  var IP_LOCATION_TIMEOUT_MS = 5000;
  var GPS_WATCH_TIMEOUT_MS = 10000;
  var GPS_LS_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 min
  var COOLDOWN_TIMEOUT_MS = 15 * 60 * 1000;      // 15 min

  /* ====== State ====== */
  var cache = null;           // RAM cache: { latitude, longitude, altitude, accuracy, source, timestamp } | null
  var receiverState = 'off';  // 'off' | 'active' | 'cooldown' | 'denied'
  var hasLiveFix = false;
  var gpsUpdatedDuringSession = false;
  var lastGpsFlushTime = 0;
  var cooldownTimerId = null;
  var watchId = null;
  var listeners = [];

  /* ====== Helpers ====== */

  function validateCoords(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
           lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function normalizeCoords(raw) {
    if (!raw) return null;
    var lat = Number(raw.latitude);
    var lon = Number(raw.longitude);
    if (!validateCoords(lat, lon)) return null;
    var alt = Number.isFinite(Number(raw.altitude)) ? Number(raw.altitude) : null;
    var accRaw = Number(raw.accuracy);
    var acc = Number.isFinite(accRaw) && accRaw > 0 ? accRaw : null;
    return { latitude: lat, longitude: lon, altitude: alt, accuracy: acc };
  }

  function parseManualCoordsInput(value) {
    var text = String(value || '').trim();
    if (!text) return null;
    var matches = text.match(/-?\d+(?:[.,]\d+)?/g);
    if (!matches || matches.length < 2) return null;
    var lat = Number(matches[0].replace(',', '.'));
    var lon = Number(matches[1].replace(',', '.'));
    if (!validateCoords(lat, lon)) return null;
    return { latitude: lat, longitude: lon, altitude: null, accuracy: null };
  }

  /* ====== Persistence ====== */

  function flushToLocalStorage() {
    if (!cache) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('gps-service: localStorage write failed', e);
    }
  }

  function loadFromLocalStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!validateCoords(data.latitude, data.longitude)) return null;
      return {
        latitude: data.latitude,
        longitude: data.longitude,
        altitude: data.altitude != null ? data.altitude : null,
        accuracy: data.accuracy != null ? data.accuracy : null,
        source: data.source || 'cached',
        timestamp: data.timestamp || 0
      };
    } catch (e) {
      return null;
    }
  }

  function isLocalStorageEmpty() {
    try { return !localStorage.getItem(STORAGE_KEY); } catch (e) { return true; }
  }

  /* ====== Listeners ====== */

  function fireChange() {
    var payload = {
      coords: cache ? Object.assign({}, cache) : null,
      source: cache ? cache.source : null,
      receiverStatus: getReceiverStatus()
    };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](payload); } catch (e) { console.warn('gps-service: listener error', e); }
    }
  }

  /* ====== Cache write ====== */

  function writeCache(coords, source, flushNow) {
    cache = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude != null ? coords.altitude : null,
      accuracy: coords.accuracy != null ? coords.accuracy : null,
      source: source,
      timestamp: Date.now()
    };
    if (flushNow || isLocalStorageEmpty()) {
      flushToLocalStorage();
      lastGpsFlushTime = Date.now();
    }
    fireChange();
  }

  /* ====== watchPosition ====== */

  function startWatch() {
    if (watchId != null) return;
    if (!navigator.geolocation) {
      receiverState = 'off';
      return;
    }
    hasLiveFix = false;

    watchId = navigator.geolocation.watchPosition(
      function onSuccess(pos) {
        var norm = normalizeCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy
        });
        if (!norm) return;

        hasLiveFix = true;
        gpsUpdatedDuringSession = true;

        var shouldFlush = isLocalStorageEmpty() ||
          (Date.now() - lastGpsFlushTime >= GPS_LS_FLUSH_INTERVAL_MS);

        writeCache(norm, 'gps', shouldFlush);

        if (receiverState === 'cooldown') {
          flushToLocalStorage();
          clearWatch();
          clearCooldownTimer();
          receiverState = 'off';
          hasLiveFix = false;
          fireChange();
        }
      },
      function onError(err) {
        if (err && err.code === 1) {
          clearWatch();
          receiverState = 'denied';
          hasLiveFix = false;
          fireChange();
          return;
        }
        hasLiveFix = false;
      },
      { enableHighAccuracy: true, timeout: GPS_WATCH_TIMEOUT_MS, maximumAge: 0 }
    );
  }

  function clearWatch() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    hasLiveFix = false;
  }

  function clearCooldownTimer() {
    if (cooldownTimerId) {
      clearTimeout(cooldownTimerId);
      cooldownTimerId = null;
    }
  }

  /* ====== IP Geolocation ====== */

  function requestIpLocation() {
    var providers = [
      {
        url: 'https://ipwhois.app/json/',
        validate: function (data) {
          var hasValid = Number.isFinite(Number(data && data.latitude)) &&
                         Number.isFinite(Number(data && data.longitude));
          var ok = (data && (data.success === true || data.success === 'true'));
          return ok || hasValid;
        }
      },
      {
        url: 'https://geolocation-db.com/json/',
        validate: function (data) {
          return Number.isFinite(Number(data && data.latitude)) &&
                 Number.isFinite(Number(data && data.longitude));
        }
      }
    ];

    var idx = 0;

    function tryNext(resolve) {
      if (idx >= providers.length) { resolve(null); return; }
      var provider = providers[idx++];
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tid = null;
      if (controller) {
        tid = setTimeout(function () { controller.abort(); }, IP_LOCATION_TIMEOUT_MS);
      }
      fetch(provider.url, {
        method: 'GET',
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (data) {
        if (!provider.validate(data)) throw new Error('Invalid payload');
        var norm = normalizeCoords({
          latitude: data.latitude,
          longitude: data.longitude,
          altitude: null,
          accuracy: 5000
        });
        if (!norm) throw new Error('Invalid normalized');
        norm.source = 'network';
        norm.accuracy = 5000;
        resolve(norm);
      }).catch(function () {
        tryNext(resolve);
      }).finally(function () {
        if (tid) clearTimeout(tid);
      });
    }

    return new Promise(function (resolve) { tryNext(resolve); });
  }

  /* ====== Public API ====== */

  function getCoords() {
    return cache ? Object.assign({}, cache) : null;
  }

  function getReceiverStatus() {
    if (receiverState === 'denied') return 'denied';
    if (receiverState === 'off' || receiverState === 'cooldown') return 'off';
    if (receiverState === 'active' && hasLiveFix) return 'fix';
    if (receiverState === 'active') return 'searching';
    return 'off';
  }

  function getCacheAgeMs() {
    if (!cache || !cache.timestamp) return Infinity;
    return Date.now() - cache.timestamp;
  }

  function hasFix() {
    return receiverState === 'active' && hasLiveFix;
  }

  function start() {
    clearCooldownTimer();
    if (receiverState === 'denied') return;
    if (receiverState === 'cooldown') {
      receiverState = 'active';
      fireChange();
      return;
    }
    receiverState = 'active';
    gpsUpdatedDuringSession = false;
    startWatch();
    fireChange();
  }

  function enterCooldown() {
    if (receiverState !== 'active') return;

    if (cache) flushToLocalStorage();

    if (gpsUpdatedDuringSession) {
      clearWatch();
      receiverState = 'off';
      fireChange();
      return;
    }

    receiverState = 'cooldown';
    clearCooldownTimer();
    cooldownTimerId = setTimeout(function () {
      cooldownTimerId = null;
      clearWatch();
      receiverState = 'off';
      hasLiveFix = false;
      fireChange();
    }, COOLDOWN_TIMEOUT_MS);
    fireChange();
  }

  function updateFromNetwork() {
    return requestIpLocation().then(function (result) {
      if (result) {
        writeCache(result, 'network', true);
        return true;
      }
      return false;
    });
  }

  function updateManual(lat, lon) {
    var parsed = parseManualCoordsInput(lat + ', ' + lon);
    if (!parsed) return false;
    writeCache(parsed, 'manual', true);
    return true;
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function offChange(cb) {
    for (var i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i] === cb) { listeners.splice(i, 1); break; }
    }
  }

  /* ====== Init ====== */

  cache = loadFromLocalStorage();
  receiverState = 'off';

  window.addEventListener('beforeunload', function () {
    if (cache) flushToLocalStorage();
    if (receiverState === 'active' || receiverState === 'cooldown') {
      clearWatch();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && cache) {
      flushToLocalStorage();
    }
  });

  /* ====== Export ====== */

  window.SatContactGps = {
    getCoords: getCoords,
    getReceiverStatus: getReceiverStatus,
    getCacheAgeMs: getCacheAgeMs,
    hasFix: hasFix,
    start: start,
    enterCooldown: enterCooldown,
    updateFromNetwork: updateFromNetwork,
    updateManual: updateManual,
    onChange: onChange,
    offChange: offChange
  };

})();
