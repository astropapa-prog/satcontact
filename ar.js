/**
 * SatContact — Модуль 3: AR-трекер (Оркестратор)
 * Камера, сенсоры (гироскоп + компас + WMM), GPS, состояние, калибровка, аудио-прицел, таймер дрейфа.
 */
(function () {
  'use strict';

  /* ====== Константы ====== */
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const SLOW_LOOP_MS = 1000;
  const GPS_TIMEOUT_MS = 10000;
  const DRIFT_RATE_DEG_PER_MIN = 2;
  const MAX_DRIFT_ERROR_DEG = 5;
  const AUDIO_MIN_HZ = 20;
  const AUDIO_MAX_HZ = 900;
  const AUDIO_MAX_OFFSET_DEG = 90;
  const DEFAULT_FOV_H = 60;
  const DEFAULT_FOV_V = 45;

  /* ====== DOM ====== */
  let elVideo, elCanvas, elBack, elShowAll, elCalibSource, elCalibBtn;
  let elSoundToggle, elDrift, elHud, elGpsStatus, elCamAz, elCamEl, elCamDlg;
  let elFallback, elFallbackBack;

  /* ====== Состояние ====== */
  let active = false;
  let state = 'overview';           // 'overview' | 'focus'
  let focusedNoradId = null;
  let currentNoradIds = [];
  let currentNoradIdToName = {};
  let cameraStream = null;
  let fovH = DEFAULT_FOV_H;
  let fovV = DEFAULT_FOV_V;

  /* ====== GPS ====== */
  let gpsCoords = null;             // { latitude, longitude, altitude, accuracy }
  let gpsQuality = 'searching';     // 'excellent' | 'moderate' | 'searching'
  let gpsWatchId = null;

  /* ====== Сенсоры ====== */
  let sensorState = { alpha: 0, beta: 0, gamma: 0, absolute: false, timestamp: 0 };
  let orientationMatrix = new Float64Array(9); // 3x3 rotation matrix
  let calibrationDelta = 0;         // azimuth correction in degrees
  let magneticDeclination = 0;

  /* ====== Дрейф ====== */
  let lastCalibrationTime = 0;
  let driftPaused = false;

  /* ====== Аудио ====== */
  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let soundEnabled = false;

  /* ====== Циклы ====== */
  let slowLoopId = null;
  let rafId = null;

  /* ====== Данные из slowLoop ====== */
  let visibleSatellites = [];       // [{ noradId, azimuth, elevation, distance, height }]
  let focusedTrajectory = [];       // [{ az, el }] for focus mode orbit line
  let overviewTrajectories = {};    // noradId → [{ az, el }]

  /* ==========================================================================
     WMM-2025 (упрощённая модель, сферические гармоники до степени 5)
     Коэффициенты IGRF-13/WMM-2025 (g,h) в нТ; достаточно для ~0.5° точности
     ========================================================================== */
  const WMM_COEFFS = [
    //  n, m,     gnm,     hnm
    [1, 0, -29352.0,      0.0],
    [1, 1,  -1453.0,   4653.0],
    [2, 0,  -2500.0,      0.0],
    [2, 1,   2997.0,  -2992.0],
    [2, 2,   1592.0,   -560.0],
    [3, 0,   1382.0,      0.0],
    [3, 1,  -2381.0,    -82.0],
    [3, 2,   1236.0,    241.0],
    [3, 3,    525.0,   -543.0],
    [4, 0,    903.0,      0.0],
    [4, 1,    809.0,    282.0],
    [4, 2,     86.0,   -158.0],
    [4, 3,   -310.0,    199.0],
    [4, 4,     48.0,   -350.0],
    [5, 0,   -235.0,      0.0],
    [5, 1,    363.0,     47.0],
    [5, 2,    187.0,    208.0],
    [5, 3,   -141.0,   -121.0],
    [5, 4,    -78.0,    -37.0],
    [5, 5,     53.0,     46.0]
  ];

  function getMagneticDeclination(latDeg, lonDeg, altKm) {
    const R = 6371.2;
    const r = R + (altKm || 0);
    const ratio = R / r;
    const theta = (90 - latDeg) * DEG;
    const phi = lonDeg * DEG;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);

    let Br = 0, Bt = 0, Bp = 0;

    for (let i = 0; i < WMM_COEFFS.length; i++) {
      const [n, m, gnm, hnm] = WMM_COEFFS[i];
      const rn = Math.pow(ratio, n + 2);
      const Pnm = assocLegendre(n, m, ct, st);
      const dPnm = dAssocLegendre(n, m, ct, st);
      const cosmph = Math.cos(m * phi);
      const sinmph = Math.sin(m * phi);
      const gcos_hsin = gnm * cosmph + hnm * sinmph;
      const gsin_hcos = -gnm * sinmph + hnm * cosmph;

      Br += (n + 1) * rn * gcos_hsin * Pnm;
      Bt += -rn * gcos_hsin * dPnm;
      if (st > 1e-10) {
        Bp += -rn * m * gsin_hcos * Pnm / st;
      }
    }

    const Bx = -Bt;
    const By = Bp;
    return Math.atan2(By, Bx) * RAD;
  }

  function assocLegendre(n, m, ct, st) {
    if (n === 0) return 1;
    if (n === 1 && m === 0) return ct;
    if (n === 1 && m === 1) return st;
    let pmm = 1;
    for (let i = 1; i <= m; i++) pmm *= (2 * i - 1) * st;
    if (n === m) return pmm;
    let pmm1 = ct * (2 * m + 1) * pmm;
    if (n === m + 1) return pmm1;
    let result = 0;
    for (let l = m + 2; l <= n; l++) {
      result = ((2 * l - 1) * ct * pmm1 - (l + m - 1) * pmm) / (l - m);
      pmm = pmm1;
      pmm1 = result;
    }
    return result;
  }

  function dAssocLegendre(n, m, ct, st) {
    if (st < 1e-10) return 0;
    const Pnm = assocLegendre(n, m, ct, st);
    const Pn1m = (n + 1 <= 20) ? assocLegendre(n + 1, m, ct, st) : 0;
    return ((n + 1) * ct * Pnm - (n - m + 1) * Pn1m) / st;
  }

  /* ==========================================================================
     Астрономические формулы: Солнце, Луна, Полярная звезда → AZ/EL
     ========================================================================== */
  function julianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function julianCenturies(date) {
    return (julianDate(date) - 2451545.0) / 36525.0;
  }

  function localSiderealTime(date, lonDeg) {
    const T = julianCenturies(date);
    let gmst = 280.46061837 + 360.98564736629 * (julianDate(date) - 2451545.0) +
               0.000387933 * T * T;
    gmst = ((gmst % 360) + 360) % 360;
    return ((gmst + lonDeg) % 360 + 360) % 360;
  }

  function raDecToAzEl(raDeg, decDeg, observer, date) {
    const lst = localSiderealTime(date, observer.longitude);
    const ha = ((lst - raDeg) % 360 + 360) % 360;
    const haR = ha * DEG;
    const decR = decDeg * DEG;
    const latR = observer.latitude * DEG;

    const sinAlt = Math.sin(decR) * Math.sin(latR) + Math.cos(decR) * Math.cos(latR) * Math.cos(haR);
    const alt = Math.asin(sinAlt);

    const cosA = (Math.sin(decR) - sinAlt * Math.sin(latR)) / (Math.cos(alt) * Math.cos(latR));
    let az = Math.acos(Math.max(-1, Math.min(1, cosA))) * RAD;
    if (Math.sin(haR) > 0) az = 360 - az;

    return { azimuth: az, elevation: alt * RAD };
  }

  function getSunAzEl(observer, date) {
    const T = julianCenturies(date);
    const L0 = (280.46646 + 36000.76983 * T) % 360;
    const M = (357.52911 + 35999.05029 * T) % 360;
    const Mr = M * DEG;
    const C = (1.914602 - 0.004817 * T) * Math.sin(Mr) +
              0.019993 * Math.sin(2 * Mr) + 0.000289 * Math.sin(3 * Mr);
    const sunLon = (L0 + C) % 360;
    const omega = (125.04 - 1934.136 * T) % 360;
    const lambda = sunLon - 0.00569 - 0.00478 * Math.sin(omega * DEG);
    const epsilon = 23.439291 - 0.013004 * T;
    const lambdaR = lambda * DEG;
    const epsR = epsilon * DEG;
    const ra = Math.atan2(Math.cos(epsR) * Math.sin(lambdaR), Math.cos(lambdaR)) * RAD;
    const dec = Math.asin(Math.sin(epsR) * Math.sin(lambdaR)) * RAD;
    return raDecToAzEl(((ra % 360) + 360) % 360, dec, observer, date);
  }

  function getMoonAzEl(observer, date) {
    const T = julianCenturies(date);
    const L = (218.3165 + 481267.8813 * T) % 360;
    const M = (357.5291 + 35999.0503 * T) % 360;
    const Mm = (134.9634 + 477198.8676 * T) % 360;
    const D = (297.8502 + 445267.1115 * T) % 360;
    const F = (93.2720 + 483202.0175 * T) % 360;

    const Mr = M * DEG, Mmr = Mm * DEG, Dr = D * DEG, Fr = F * DEG;

    const lon = L + 6.289 * Math.sin(Mmr)
                  + 1.274 * Math.sin(2 * Dr - Mmr)
                  + 0.658 * Math.sin(2 * Dr)
                  + 0.214 * Math.sin(2 * Mmr)
                  - 0.186 * Math.sin(Mr)
                  - 0.114 * Math.sin(2 * Fr);

    const lat = 5.128 * Math.sin(Fr)
                + 0.281 * Math.sin(Mmr + Fr)
                + 0.278 * Math.sin(Mmr - Fr);

    const lonR = lon * DEG;
    const latR = lat * DEG;
    const epsilon = (23.439291 - 0.013004 * T) * DEG;

    const ra = Math.atan2(
      Math.sin(lonR) * Math.cos(epsilon) - Math.tan(latR) * Math.sin(epsilon),
      Math.cos(lonR)
    ) * RAD;
    const dec = Math.asin(
      Math.sin(latR) * Math.cos(epsilon) + Math.cos(latR) * Math.sin(epsilon) * Math.sin(lonR)
    ) * RAD;

    return raDecToAzEl(((ra % 360) + 360) % 360, dec, observer, date);
  }

  function getPolarisAzEl(observer, date) {
    const raDeg = (2 + 31 / 60 + 49 / 3600) * 15; // 2h 31m 49s → degrees
    const decDeg = 89 + 15 / 60 + 51 / 3600;       // +89° 15' 51"
    return raDecToAzEl(raDeg, decDeg, observer, date);
  }

  /* ==========================================================================
     Матрица ориентации устройства (W3C DeviceOrientation → 3x3 rotation)
     ========================================================================== */
  function computeOrientationMatrix(alpha, beta, gamma) {
    const a = alpha * DEG;
    const b = beta * DEG;
    const g = gamma * DEG;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cb = Math.cos(b), sb = Math.sin(b);
    const cg = Math.cos(g), sg = Math.sin(g);

    // ZXY Euler rotation (device orientation convention)
    orientationMatrix[0] = ca * cg - sa * sb * sg;
    orientationMatrix[1] = -cb * sa;
    orientationMatrix[2] = ca * sg + cg * sa * sb;
    orientationMatrix[3] = cg * sa + ca * sb * sg;
    orientationMatrix[4] = ca * cb;
    orientationMatrix[5] = sa * sg - ca * cg * sb;
    orientationMatrix[6] = -cb * sg;
    orientationMatrix[7] = sb;
    orientationMatrix[8] = cb * cg;
  }

  function getCameraAzEl() {
    const az = ((360 - sensorState.alpha + calibrationDelta + magneticDeclination) % 360 + 360) % 360;
    const el = Math.max(-90, Math.min(90, sensorState.beta - 90));
    return { azimuth: az, elevation: el };
  }

  /* ==========================================================================
     Камера
     ========================================================================== */
  function checkArCapabilities() {
    const hasCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasOrientation = ('DeviceOrientationEvent' in window) || ('DeviceMotionEvent' in window);
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return hasCamera && hasOrientation && isMobile;
  }

  async function startCamera() {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      elVideo.srcObject = cameraStream;
      await elVideo.play();
      detectFov();
    } catch (e) {
      console.error('ar.js: camera error', e);
      showFallback();
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) { t.stop(); });
      cameraStream = null;
    }
    if (elVideo) elVideo.srcObject = null;
  }

  function detectFov() {
    if (!cameraStream) return;
    try {
      var track = cameraStream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        /* Not all browsers expose FOV, but getSettings may have width/height */
      }
    } catch (_) { /* use defaults */ }
  }

  /* ==========================================================================
     Сенсоры: DeviceOrientation
     ========================================================================== */
  function onOrientation(evt) {
    if (evt.alpha == null) return;
    sensorState.alpha = evt.alpha;
    sensorState.beta = evt.beta || 0;
    sensorState.gamma = evt.gamma || 0;
    sensorState.absolute = !!evt.absolute;
    sensorState.timestamp = Date.now();

    computeOrientationMatrix(
      sensorState.alpha - calibrationDelta - magneticDeclination,
      sensorState.beta,
      sensorState.gamma
    );
  }

  async function startSensors() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        var perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          console.warn('ar.js: orientation permission denied');
          return;
        }
      } catch (e) {
        console.warn('ar.js: orientation permission error', e);
      }
    }

    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation);
    } else {
      window.addEventListener('deviceorientation', onOrientation);
    }
  }

  function stopSensors() {
    window.removeEventListener('deviceorientationabsolute', onOrientation);
    window.removeEventListener('deviceorientation', onOrientation);
  }

  /* ==========================================================================
     GPS (только точный, enableHighAccuracy)
     ========================================================================== */
  function updateGpsQuality(accuracy) {
    if (accuracy < 10) gpsQuality = 'excellent';
    else if (accuracy < 50) gpsQuality = 'moderate';
    else gpsQuality = 'searching';
  }

  function startGps() {
    if (!navigator.geolocation) {
      gpsQuality = 'searching';
      return;
    }

    gpsWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        gpsCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude || 0,
          accuracy: pos.coords.accuracy
        };
        updateGpsQuality(pos.coords.accuracy);
        magneticDeclination = getMagneticDeclination(
          gpsCoords.latitude, gpsCoords.longitude, (gpsCoords.altitude || 0) / 1000
        );
      },
      function () {
        gpsQuality = 'searching';
      },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 }
    );
  }

  function stopGps() {
    if (gpsWatchId != null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }

  /* ==========================================================================
     Аудио-прицел (Web Audio API)
     ========================================================================== */
  function initAudio() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      oscillator = audioCtx.createOscillator();
      gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = AUDIO_MIN_HZ;
      gainNode.gain.value = 0;
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();
    } catch (e) {
      console.warn('ar.js: Web Audio API unavailable', e);
    }
  }

  function updateAudioPitch(angularOffsetDeg) {
    if (!oscillator || !gainNode || !audioCtx) return;
    var t = Math.min(Math.abs(angularOffsetDeg) / AUDIO_MAX_OFFSET_DEG, 1);
    var freq = AUDIO_MIN_HZ + t * (AUDIO_MAX_HZ - AUDIO_MIN_HZ);
    var vol = (state === 'focus' && soundEnabled) ? 0.15 : 0;
    oscillator.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
    gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
  }

  function destroyAudio() {
    try {
      if (oscillator) { oscillator.stop(); oscillator.disconnect(); }
      if (gainNode) gainNode.disconnect();
      if (audioCtx) audioCtx.close();
    } catch (_) {}
    audioCtx = null;
    oscillator = null;
    gainNode = null;
  }

  /* ==========================================================================
     Таймер дрейфа
     ========================================================================== */
  function getDriftError() {
    if (!lastCalibrationTime) return MAX_DRIFT_ERROR_DEG;
    return ((Date.now() - lastCalibrationTime) / 60000) * DRIFT_RATE_DEG_PER_MIN;
  }

  function updateDriftIndicator() {
    if (!elDrift) return;
    var error = getDriftError();
    var ratio = Math.min(error / MAX_DRIFT_ERROR_DEG, 1);
    var hue = Math.round(120 * (1 - ratio));
    elDrift.style.setProperty('--drift-hue', hue);
    elDrift.style.setProperty('--drift-fill', Math.round((1 - ratio) * 100) + '%');

    if (error >= MAX_DRIFT_ERROR_DEG && !driftPaused) {
      driftPaused = true;
    } else if (error < MAX_DRIFT_ERROR_DEG && driftPaused) {
      driftPaused = false;
    }
  }

  /* ==========================================================================
     Калибровка
     ========================================================================== */
  function performCalibration() {
    if (!gpsCoords) return;
    var source = elCalibSource ? elCalibSource.value : 'sun';
    var now = new Date();
    var obs = { latitude: gpsCoords.latitude, longitude: gpsCoords.longitude };
    var truePos;

    if (source === 'sun') truePos = getSunAzEl(obs, now);
    else if (source === 'moon') truePos = getMoonAzEl(obs, now);
    else truePos = getPolarisAzEl(obs, now);

    if (!truePos) return;

    var sensorAz = ((360 - sensorState.alpha + magneticDeclination) % 360 + 360) % 360;
    calibrationDelta = truePos.azimuth - sensorAz;
    if (calibrationDelta > 180) calibrationDelta -= 360;
    if (calibrationDelta < -180) calibrationDelta += 360;

    lastCalibrationTime = Date.now();
    driftPaused = false;
  }

  /* ==========================================================================
     Машина состояний
     ========================================================================== */
  function setFocus(noradId) {
    if (noradId) {
      state = 'focus';
      focusedNoradId = noradId;
    } else {
      state = 'overview';
      focusedNoradId = null;
    }
  }

  function onCanvasClick(evt) {
    if (!active) return;
    var rect = elCanvas.getBoundingClientRect();
    var x = evt.clientX - rect.left;
    var y = evt.clientY - rect.top;
    var renderer = window.SatContactArRender;

    if (state === 'overview') {
      var hitId = renderer ? renderer.hitTest(x, y) : null;
      if (hitId) {
        setFocus(hitId);
      }
    } else {
      var hitFocused = renderer ? renderer.hitTest(x, y) : null;
      if (!hitFocused) {
        setFocus(null);
      }
    }
  }

  /* ==========================================================================
     Медленный цикл (1 Hz): пересчёт позиций спутников
     ========================================================================== */
  function slowLoop() {
    if (!active) return;

    updateDriftIndicator();
    updateHud();

    if (!gpsCoords || gpsQuality === 'searching') return;

    var tleCache = window.SatContactTle ? window.SatContactTle.getCache() : null;
    if (!tleCache) return;

    var now = new Date();
    var observer = {
      latitude: gpsCoords.latitude,
      longitude: gpsCoords.longitude,
      altitude: gpsCoords.altitude || 0
    };

    var newVisible = [];
    for (var i = 0; i < currentNoradIds.length; i++) {
      var nid = currentNoradIds[i];
      var tleData = tleCache.get(nid);
      if (!tleData) continue;
      var pos = window.SatContactTle.computeSatellite(tleData, observer, now);
      if (pos && pos.elevation > 0) {
        newVisible.push({
          noradId: nid,
          name: currentNoradIdToName[nid] || nid,
          azimuth: pos.azimuth,
          elevation: pos.elevation,
          distance: pos.distance,
          height: pos.height
        });
      }
    }
    visibleSatellites = newVisible;

    if (state === 'overview') {
      computeOverviewTrajectories(tleCache, observer, now);
    }

    if (state === 'focus' && focusedNoradId) {
      var ftleData = tleCache.get(focusedNoradId);
      if (ftleData) {
        focusedTrajectory = computeHighDensityTrajectory(ftleData, observer, now);
      }
    }
  }

  function computeOverviewTrajectories(tleCache, observer, now) {
    var newTrajs = {};
    for (var i = 0; i < visibleSatellites.length; i++) {
      var sat = visibleSatellites[i];
      var tleData = tleCache.get(sat.noradId);
      if (!tleData) continue;
      var points = [];
      for (var t = -30; t <= 30; t += 2) {
        var d = new Date(now.getTime() + t * 60000);
        var p = window.SatContactTle.computeSatellite(tleData, observer, d);
        if (p && p.elevation > -5) {
          points.push({ az: p.azimuth, el: p.elevation });
        }
      }
      newTrajs[sat.noradId] = points;
    }
    overviewTrajectories = newTrajs;
  }

  function computeHighDensityTrajectory(tleData, observer, now) {
    var points = [];
    for (var t = -20 * 60; t <= 20 * 60; t += 10) {
      var d = new Date(now.getTime() + t * 1000);
      var p = window.SatContactTle.computeSatellite(tleData, observer, d);
      if (p && p.elevation > -5) {
        points.push({ az: p.azimuth, el: p.elevation });
      }
    }
    return points;
  }

  /* ==========================================================================
     Быстрый цикл (RAF ~60 Hz): рендеринг
     ========================================================================== */
  function renderLoop() {
    if (!active) return;

    var cam = getCameraAzEl();
    var renderer = window.SatContactArRender;
    if (renderer && !driftPaused) {
      renderer.draw({
        satellites: visibleSatellites,
        overviewTrajectories: overviewTrajectories,
        focusedTrajectory: focusedTrajectory,
        sensorState: sensorState,
        orientationMatrix: orientationMatrix,
        cameraAz: cam.azimuth,
        cameraEl: cam.elevation,
        mode: state,
        focusedId: focusedNoradId,
        fovH: fovH,
        fovV: fovV,
        noradIdToName: currentNoradIdToName,
        gpsQuality: gpsQuality,
        driftPaused: driftPaused
      });
    } else if (renderer && driftPaused) {
      renderer.drawDriftWarning();
    }

    if (state === 'focus' && focusedNoradId && !driftPaused) {
      var focSat = null;
      for (var i = 0; i < visibleSatellites.length; i++) {
        if (visibleSatellites[i].noradId === focusedNoradId) {
          focSat = visibleSatellites[i]; break;
        }
      }
      if (focSat) {
        var dAz = focSat.azimuth - cam.azimuth;
        if (dAz > 180) dAz -= 360;
        if (dAz < -180) dAz += 360;
        var dEl = focSat.elevation - cam.elevation;
        var angOffset = Math.sqrt(dAz * dAz + dEl * dEl);
        updateAudioPitch(angOffset);
      }
    } else {
      updateAudioPitch(AUDIO_MAX_OFFSET_DEG);
    }

    rafId = requestAnimationFrame(renderLoop);
  }

  /* ==========================================================================
     HUD
     ========================================================================== */
  function updateHud() {
    if (!elGpsStatus || !elCamAz) return;

    var statusIcon, statusText;
    if (gpsQuality === 'excellent') { statusIcon = '\uD83D\uDFE2'; statusText = 'ОТЛИЧНО'; }
    else if (gpsQuality === 'moderate') { statusIcon = '\uD83D\uDFE1'; statusText = 'СРЕДНЕ'; }
    else { statusIcon = '\uD83D\uDD34'; statusText = 'ПОИСК...'; }
    elGpsStatus.textContent = 'GPS: ' + statusIcon + ' ' + statusText;

    var cam = getCameraAzEl();
    elCamAz.textContent = 'АЗ: ' + cam.azimuth.toFixed(0) + '\u00B0';
    elCamEl.textContent = 'ЭЛ: ' + cam.elevation.toFixed(0) + '\u00B0';

    var dlg = gpsCoords ? gpsCoords.longitude.toFixed(0) : '---';
    elCamDlg.textContent = 'ДЛГ: ' + dlg + '\u00B0';
  }

  /* ==========================================================================
     UI handlers
     ========================================================================== */
  function showFallback() {
    if (elFallback) elFallback.hidden = false;
  }

  function onBackClick() { if (window.closeArView) window.closeArView(); }
  function onShowAllClick() {
    var filteredEntries = typeof window.getSatContactFilteredEntries === 'function'
      ? window.getSatContactFilteredEntries()
      : [];
    var idSet = {};
    var nameMap = {};
    for (var i = 0; i < filteredEntries.length; i++) {
      var entry = filteredEntries[i];
      var name = (entry && entry.cleanName) || '';
      var ids = (entry && entry.noradIds) || [];
      for (var j = 0; j < ids.length; j++) {
        var key = String(ids[j]);
        if (key) {
          idSet[key] = true;
          if (!nameMap[key]) nameMap[key] = name || ('NORAD ' + key);
        }
      }
    }
    var allIds = Object.keys(idSet);
    if (!allIds.length) return;
    currentNoradIds = allIds;
    currentNoradIdToName = nameMap;
    setFocus(null);
    slowLoop();
  }
  function onSoundToggleClick() {
    soundEnabled = !soundEnabled;
    if (elSoundToggle) {
      elSoundToggle.classList.toggle('muted', !soundEnabled);
      elSoundToggle.innerHTML = soundEnabled ? '&#128264;' : '&#128263;';
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function bindUi() {
    if (elBack) elBack.addEventListener('click', onBackClick);
    if (elFallbackBack) elFallbackBack.addEventListener('click', onBackClick);
    if (elCalibBtn) elCalibBtn.addEventListener('click', performCalibration);
    if (elCanvas) elCanvas.addEventListener('click', onCanvasClick);
    if (elShowAll) elShowAll.addEventListener('click', onShowAllClick);
    if (elSoundToggle) elSoundToggle.addEventListener('click', onSoundToggleClick);
  }

  function unbindUi() {
    if (elBack) elBack.removeEventListener('click', onBackClick);
    if (elFallbackBack) elFallbackBack.removeEventListener('click', onBackClick);
    if (elCalibBtn) elCalibBtn.removeEventListener('click', performCalibration);
    if (elCanvas) elCanvas.removeEventListener('click', onCanvasClick);
    if (elShowAll) elShowAll.removeEventListener('click', onShowAllClick);
    if (elSoundToggle) elSoundToggle.removeEventListener('click', onSoundToggleClick);
  }

  /* ==========================================================================
     init / cleanup (public API)
     ========================================================================== */
  function cacheDom() {
    elVideo = document.getElementById('arVideo');
    elCanvas = document.getElementById('arCanvas');
    elBack = document.getElementById('arBack');
    elShowAll = document.getElementById('arShowAll');
    elCalibSource = document.getElementById('arCalibSource');
    elCalibBtn = document.getElementById('arCalibBtn');
    elSoundToggle = document.getElementById('arSoundToggle');
    elDrift = document.getElementById('arDriftIndicator');
    elHud = document.getElementById('arHud');
    elGpsStatus = document.getElementById('arGpsStatus');
    elCamAz = document.getElementById('arCameraAz');
    elCamEl = document.getElementById('arCameraEl');
    elCamDlg = document.getElementById('arCameraDlg');
    elFallback = document.getElementById('arDesktopFallback');
    elFallbackBack = document.getElementById('arFallbackBack');
  }

  async function initAr(options) {
    cacheDom();
    active = true;
    state = 'overview';
    focusedNoradId = null;
    calibrationDelta = 0;
    magneticDeclination = 0;
    lastCalibrationTime = 0;
    driftPaused = true;
    soundEnabled = false;
    visibleSatellites = [];
    focusedTrajectory = [];
    overviewTrajectories = {};

    currentNoradIds = (options && options.noradIds) || [];
    currentNoradIdToName = (options && options.noradIdToName) || {};
    if (options && options.satelliteName && currentNoradIds.length === 1) {
      currentNoradIdToName[currentNoradIds[0]] = options.satelliteName;
    }

    if (currentNoradIds.length === 1) {
      setFocus(currentNoradIds[0]);
      soundEnabled = true;
    }

    if (!checkArCapabilities()) {
      showFallback();
      bindUi();
      return;
    }

    if (elFallback) elFallback.hidden = true;

    bindUi();

    await window.SatContactTle.loadTle();
    startGps();
    await startCamera();
    await startSensors();
    initAudio();

    if (window.SatContactArRender) {
      window.SatContactArRender.init(elCanvas);
    }

    slowLoopId = setInterval(slowLoop, SLOW_LOOP_MS);
    slowLoop();
    rafId = requestAnimationFrame(renderLoop);
  }

  function cleanupAr() {
    active = false;
    if (slowLoopId) { clearInterval(slowLoopId); slowLoopId = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

    stopCamera();
    stopSensors();
    stopGps();
    destroyAudio();
    unbindUi();

    if (window.SatContactArRender) {
      window.SatContactArRender.destroy();
    }

    state = 'overview';
    focusedNoradId = null;
    visibleSatellites = [];
    focusedTrajectory = [];
    overviewTrajectories = {};
    gpsCoords = null;
    gpsQuality = 'searching';
  }

  window.initAr = initAr;
  window.cleanupAr = cleanupAr;

  window.SatContactAr = {
    getState: function () { return state; },
    getFocusedId: function () { return focusedNoradId; },
    setFocus: setFocus,
    getSensorState: function () { return sensorState; },
    getGpsQuality: function () { return gpsQuality; },
    getGpsCoords: function () { return gpsCoords; },
    getCameraAzEl: getCameraAzEl,
    getFov: function () { return { h: fovH, v: fovV }; }
  };
})();
