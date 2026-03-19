/**
 * SatContact — TLE Worker: тяжёлая математика SGP4 в фоне
 * Парсинг TLE и расчёт 24-часовых траекторий без блокировки UI
 */

importScripts('./lib/satellite.min.js');

let tleCache = null; // Map<noradId, { line1, line2, satrec }>

/**
 * Парсинг TLE: текст → Map<NoradId, { line1, line2, satrec }>
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
      const satrec = satellite.twoline2satrec(line1, line2);
      map.set(noradId, { line1, line2, satrec });
    } catch (e) {
      console.warn('tle-worker: не удалось распарсить TLE для NORAD', noradId, e);
    }
  }

  return map;
}

/**
 * Расчёт позиции спутника (внутри воркера)
 */
function computeSatellite(tleData, observer, date) {
  if (!tleData || !observer) return null;

  const { satrec } = tleData;
  const positionAndVelocity = satellite.propagate(satrec, date);
  if (!positionAndVelocity) return null;

  const positionEci = positionAndVelocity.position;
  const gmst = satellite.gstime(date);

  const observerGd = {
    longitude: satellite.degreesToRadians(observer.longitude),
    latitude: satellite.degreesToRadians(observer.latitude),
    height: (observer.altitude != null ? observer.altitude : 0) / 1000
  };

  const positionEcf = satellite.eciToEcf(positionEci, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
  const positionGd = satellite.eciToGeodetic(positionEci, gmst);

  return {
    azimuth: satellite.radiansToDegrees(lookAngles.azimuth),
    elevation: satellite.radiansToDegrees(lookAngles.elevation),
    distance: lookAngles.rangeSat,
    lat: satellite.degreesLat(positionGd.latitude),
    lon: satellite.degreesLong(positionGd.longitude),
    height: positionGd.height
  };
}

/**
 * Суточная траектория (24 ч, шаг 5 мин).
 * Разбивает на сегменты при пересечении 180° меридиана (MultiLineString).
 */
function getTrajectory24h(noradId, baseDate) {
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
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * AR-траектории в небесных координатах (az/el) для наблюдателя.
 * Сканирует +/- полупериод орбиты, возвращает точки выше elevationCutoff.
 */
function getArTrajectory(noradId, observer, pointsPerSat, elevationCutoff) {
  if (!tleCache) return [];
  const tleData = tleCache.get(noradId);
  if (!tleData) return [];

  const now = new Date();
  const no = tleData.satrec.no;
  const periodMin = (no > 0) ? (2 * Math.PI) / no : 90;
  const halfWindowSec = Math.round(periodMin / 2) * 60;
  const step = Math.max(1, Math.round((2 * halfWindowSec) / pointsPerSat));

  const points = [];
  for (let t = -halfWindowSec; t <= halfWindowSec; t += step) {
    const d = new Date(now.getTime() + t * 1000);
    const p = computeSatellite(tleData, observer, d);
    if (p && p.elevation >= elevationCutoff) {
      points.push({ az: p.azimuth, el: p.elevation });
    }
  }
  return points;
}

self.onmessage = function (e) {
  const { type, text, noradIds } = e.data;

  if (type === 'INIT_TLE') {
    tleCache = parseTle(text || '');
    self.postMessage({ type: 'TLE_INITIALIZED' });
    return;
  }

  if (type === 'CALCULATE_TRAJECTORIES') {
    const trajectories = [];
    const ids = noradIds || [];

    for (let i = 0; i < ids.length; i++) {
      trajectories.push(getTrajectory24h(ids[i]));
    }

    self.postMessage({ type: 'TRAJECTORIES_READY', trajectories });
    return;
  }

  if (type === 'CALCULATE_AR_TRAJECTORIES') {
    const ids = noradIds || [];
    const observer = e.data.observer || { latitude: 0, longitude: 0, altitude: 0 };
    const pointsPerSat = e.data.pointsPerSat || 120;
    const elevationCutoff = e.data.elevationCutoff != null ? e.data.elevationCutoff : 2;

    const trajectories = {};
    for (let i = 0; i < ids.length; i++) {
      trajectories[ids[i]] = getArTrajectory(ids[i], observer, pointsPerSat, elevationCutoff);
    }

    self.postMessage({ type: 'AR_TRAJECTORIES_READY', trajectories: trajectories });
  }
};
