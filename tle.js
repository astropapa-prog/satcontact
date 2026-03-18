/**
 * SatContact — TLE парсер и математика (satellite.js)
 * Загрузка data/tle.txt, парсинг в Map<NoradId, TleData>, расчёт азимута/элевации/дистанции
 */

(function () {
  'use strict';

  const TLE_URL = 'data/tle.txt';
  let tleCache = null; // Map<noradId, { line1, line2, satrec }>
  let worker = null;

  try {
    const base = window.SatContactResolveUrl ? window.SatContactResolveUrl('') : './';
    worker = new Worker(base + 'tle-worker.js');
    worker.onerror = function (err) {
      console.error('TLE Worker error, falling back to sync mode:', err);
      worker = null;
    };
  } catch (e) {
    console.warn('tle.js: Worker недоступен, орбиты будут считаться в основном потоке', e);
  }

  /**
   * Парсинг TLE: текст → Map<NoradId, { line1, line2, satrec }>
   * NORAD ID из второй строки TLE, символы 3–7 (индексы 2–6)
   */
  function parseTle(text) {
    const map = new Map();
    const lines = (text || '').trim().split(/\r?\n/).filter(Boolean);

    for (let i = 0; i + 1 < lines.length; i += 2) {
      const line1 = lines[i].trim();
      const line2 = lines[i + 1].trim();

      if (line1.charAt(0) !== '1' || line2.charAt(0) !== '2') continue;

      const noradId = line2.substring(2, 7).trim();
      if (!noradId) continue;

      try {
        const satrec = window.satellite.twoline2satrec(line1, line2);
        map.set(noradId, { line1, line2, satrec });
      } catch (e) {
        console.warn('tle.js: не удалось распарсить TLE для NORAD', noradId, e);
      }
    }

    return map;
  }

  /**
   * Загрузка TLE из data/tle.txt
   * @returns {Promise<Map<string, {line1, line2, satrec}>>}
   */
  async function loadTle() {
    if (tleCache) return tleCache;

    const url = window.SatContactResolveUrl(TLE_URL);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TLE: HTTP ${res.status}`);
    const text = await res.text();
    tleCache = parseTle(text);
    if (worker) worker.postMessage({ type: 'INIT_TLE', text });
    return tleCache;
  }

  /**
   * Расчёт позиции и углов для спутника
   * @param {object} tleData - { satrec }
   * @param {object} observer - { latitude, longitude, altitude? } в градусах и метрах
   * @param {Date} date
   * @returns {{ azimuth, elevation, distance, lat, lon } | null}
   */
  function computeSatellite(tleData, observer, date) {
    if (!tleData || !observer || !window.satellite) return null;

    const { satrec } = tleData;
    const positionAndVelocity = window.satellite.propagate(satrec, date);
    if (!positionAndVelocity) return null;

    const positionEci = positionAndVelocity.position;
    const gmst = window.satellite.gstime(date);

    const observerGd = {
      longitude: window.satellite.degreesToRadians(observer.longitude),
      latitude: window.satellite.degreesToRadians(observer.latitude),
      height: (observer.altitude != null ? observer.altitude : 0) / 1000 // км
    };

    const positionEcf = window.satellite.eciToEcf(positionEci, gmst);
    const lookAngles = window.satellite.ecfToLookAngles(observerGd, positionEcf);
    const positionGd = window.satellite.eciToGeodetic(positionEci, gmst);

    return {
      azimuth: window.satellite.radiansToDegrees(lookAngles.azimuth),
      elevation: window.satellite.radiansToDegrees(lookAngles.elevation),
      distance: lookAngles.rangeSat,
      lat: window.satellite.degreesLat(positionGd.latitude),
      lon: window.satellite.degreesLong(positionGd.longitude),
      height: positionGd.height // км, для footprint
    };
  }

  /**
   * Расчёт траектории 24ч в основном потоке (fallback при отсутствии Worker).
   * Разбивает на сегменты при пересечении 180° меридиана (MultiLineString).
   */
  function getTrajectory24hSync(noradId, baseDate) {
    if (!tleCache) return [];
    const tleData = tleCache.get(noradId);
    if (!tleData) return [];
    const date = baseDate || new Date();
    const observer = { latitude: 0, longitude: 0, altitude: 0 };
    const segments = [];
    let currentSegment = [];
    let lastLon = null;

    for (let t = 0; t < 24 * 60; t += 5) {
      const d = new Date(date.getTime() + t * 60 * 1000);
      const r = computeSatellite(tleData, observer, d);
      if (r) {
        if (lastLon !== null && Math.abs(r.lon - lastLon) > 180) {
          segments.push(currentSegment);
          currentSegment = [];
        }
        currentSegment.push([r.lon, r.lat]);
        lastLon = r.lon;
      }
    }
    if (currentSegment.length > 0) segments.push(currentSegment);
    return segments;
  }

  /**
   * Запрос траекторий в воркере (асинхронно) или fallback в основном потоке
   * @param {string[]} noradIds
   * @returns {Promise<Array<Array<[number,number]>>>} trajectories[i] соответствует noradIds[i]
   */
  function requestTrajectories(noradIds) {
    const ids = noradIds || [];
    if (worker) {
      return new Promise((resolve) => {
        const handler = (e) => {
          if (e.data && e.data.type === 'TRAJECTORIES_READY') {
            worker.removeEventListener('message', handler);
            resolve(e.data.trajectories || []);
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'CALCULATE_TRAJECTORIES', noradIds: ids });
      });
    }
    return Promise.resolve(ids.map((id) => getTrajectory24hSync(id)));
  }

  /**
   * Форматирование азимута: 145.2° ЮВ
   */
  function formatAzimuth(deg) {
    if (deg == null || isNaN(deg)) return '—';
    const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    const idx = Math.round(((deg + 22.5) % 360) / 45) % 8;
    return `${deg.toFixed(1)}° ${dirs[idx]}`;
  }

  /**
   * Форматирование элевации: градусы или "За горизонтом"
   */
  function formatElevation(deg) {
    if (deg == null || isNaN(deg)) return '—';
    if (deg < 0) return 'За горизонтом';
    return `${deg.toFixed(1)}°`;
  }

  window.SatContactTle = {
    loadTle,
    parseTle,
    computeSatellite,
    requestTrajectories,
    formatAzimuth,
    formatElevation,
    getCache: () => tleCache
  };
})();
