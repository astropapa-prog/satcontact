/**
 * SatContact — Модуль 3: AR-трекер (Оркестратор)
 * Камера, сенсоры: компасный режим (DeviceOrientation + WMM),
 * координаты из SatContactGps, калибровка по небесным телам, аудио-прицел.
 */
(function () {
  'use strict';

  /* ====== Константы ====== */
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const SLOW_LOOP_MS = 1000;
  const AUDIO_MIN_HZ = 20;
  const AUDIO_MAX_HZ = 900;
  const AUDIO_MAX_OFFSET_DEG = 90;
  const DEFAULT_FOV_H = 60;
  const DEFAULT_FOV_V = 45;
  const CELESTIAL_ELEVATION_THRESHOLD = 5;
  const CELESTIAL_AVAILABILITY_INTERVAL_MS = 10000;

  /* ====== DOM ====== */
  let elVideo, elCanvas, elCanvasGL, elBack, elShowAll;
  let elSoundToggle, elHud;
  let elTelemetryRow, elTelAz, elTelEl, elTelDist;
  let elFallback, elFallbackBack, elCrosshair, elCalibCrosshair;
  let elCalibPhase2;
  let elCalibSun, elCalibMoon, elCalibPolaris;
  let elCalibVenus, elCalibJupiter, elCalibSirius;
  let elCalibFixBtn, elPhase2NoBodies;
  let elCalibSensorStatus;
  let elRecalibBtn;
  let elArGpsIndicator, elArGpsCoords, elArGpsAge, elArGpsNetBtn;

  /* ====== Состояние ====== */
  let active = false;
  let state = 'overview';           // 'overview' | 'focus'
  let focusedNoradId = null;
  let currentNoradIds = [];
  let currentNoradIdToName = {};
  let initialNoradIds = [];
  let initialNoradIdToName = {};
  let currentNoradIdToFreq = {};
  let showAllActive = false;
  let cameraStream = null;
  let fovH = DEFAULT_FOV_H;
  let fovV = DEFAULT_FOV_V;

  /* ====== Сенсоры ====== */
  let sensorState = { alpha: 0, beta: 0, gamma: 0, absolute: false, timestamp: 0 };
  let sensorReady = false;
  let orientationMatrix = new Float64Array(9); // 3x3 rotation matrix
  let calibrationDelta = 0;         // azimuth correction in degrees
  let magneticDeclination = 0;

  /* ====== Калибровочная машина состояний ====== */
  let calibState = 'calibrating';  // 'calibrating' | 'rendering'
  let selectedCalibBody = null;    // 'sun' | 'moon' | 'polaris' | 'venus' | 'jupiter' | 'sirius'
  let celestialAvailTimerId = null;

  /* ====== Аудио ====== */
  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let soundEnabled = false;

  /* ====== Циклы ====== */
  let slowLoopId = null;
  let rafId = null;
  let renderingStarted = false;

  /* ====== Данные ====== */
  let visibleSatellites = [];       // [{ noradId, azimuth, elevation, distance, height }]
  let allTrajectories = {};         // noradId → [{ az, el }] from Worker
  let prevPositions = {};           // noradId → { az, el, time }
  let currentPositions = {};        // noradId → { az, el, time }
  let trajectoryTimerId = null;     // ~1.3s Worker request timer
  const TRAJECTORY_INTERVAL_MS = 1300;

  let arNetBtnFeedbackTimerId = null;

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

  function getSiriusAzEl(observer, date) {
    const raDeg = (6 + 45 / 60 + 9 / 3600) * 15;  // 6h 45m 09s → degrees
    const decDeg = -(16 + 42 / 60 + 58 / 3600);    // −16° 42' 58"
    return raDecToAzEl(raDeg, decDeg, observer, date);
  }

  function getVenusAzEl(observer, date) {
    const T = julianCenturies(date);
    const Le = ((280.46646 + 36000.76983 * T) % 360 + 360) % 360;
    const Me = ((357.52911 + 35999.05029 * T) % 360 + 360) % 360;
    const MeR = Me * DEG;
    const earthLon = Le + (1.9146 - 0.004817 * T) * Math.sin(MeR)
                        + 0.019993 * Math.sin(2 * MeR);

    const Lv = ((181.97973 + 58517.81539 * T) % 360 + 360) % 360;
    const Mv = ((210.33628 + 58517.49325 * T) % 360 + 360) % 360;
    const MvR = Mv * DEG;
    const venusLon = Lv + (0.7758 - 0.0033 * T) * Math.sin(MvR)
                        + 0.0033 * Math.sin(2 * MvR);

    const Re = 1.00014 - 0.01671 * Math.cos(MeR) - 0.00014 * Math.cos(2 * MeR);
    const Rv = 0.72333 - 0.00489 * Math.cos(MvR) - 0.00002 * Math.cos(2 * MvR);

    const earthLonR = earthLon * DEG;
    const venusLonR = venusLon * DEG;

    const xh = Rv * Math.cos(venusLonR) - Re * Math.cos(earthLonR);
    const yh = Rv * Math.sin(venusLonR) - Re * Math.sin(earthLonR);
    const zh = 0;

    const epsilon = (23.439291 - 0.013004 * T) * DEG;
    const xeq = xh;
    const yeq = yh * Math.cos(epsilon) - zh * Math.sin(epsilon);
    const zeq = yh * Math.sin(epsilon) + zh * Math.cos(epsilon);

    const ra = ((Math.atan2(yeq, xeq) * RAD) % 360 + 360) % 360;
    const dec = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)) * RAD;

    return raDecToAzEl(ra, dec, observer, date);
  }

  function getJupiterAzEl(observer, date) {
    const T = julianCenturies(date);
    const Le = ((280.46646 + 36000.76983 * T) % 360 + 360) % 360;
    const Me = ((357.52911 + 35999.05029 * T) % 360 + 360) % 360;
    const MeR = Me * DEG;
    const earthLon = Le + (1.9146 - 0.004817 * T) * Math.sin(MeR)
                        + 0.019993 * Math.sin(2 * MeR);

    const Lj = ((34.35148 + 3034.90567 * T) % 360 + 360) % 360;
    const Mj = ((20.02032 + 3034.69202 * T) % 360 + 360) % 360;
    const MjR = Mj * DEG;
    const jupLon = Lj + (5.5549 - 0.0125 * T) * Math.sin(MjR)
                      + 0.1683 * Math.sin(2 * MjR)
                      - 0.0066 * Math.sin(3 * MjR);

    const jupLatDeg = -1.3064 + 0.0537 * Math.cos(MjR);
    const jupLatR = jupLatDeg * DEG;

    const Re = 1.00014 - 0.01671 * Math.cos(MeR) - 0.00014 * Math.cos(2 * MeR);
    const Rj = 5.20260 - 0.25130 * Math.cos(MjR) - 0.00610 * Math.cos(2 * MjR);

    const earthLonR = earthLon * DEG;
    const jupLonR = jupLon * DEG;

    const xh = Rj * Math.cos(jupLatR) * Math.cos(jupLonR) - Re * Math.cos(earthLonR);
    const yh = Rj * Math.cos(jupLatR) * Math.sin(jupLonR) - Re * Math.sin(earthLonR);
    const zh = Rj * Math.sin(jupLatR);

    const epsilon = (23.439291 - 0.013004 * T) * DEG;
    const xeq = xh;
    const yeq = yh * Math.cos(epsilon) - zh * Math.sin(epsilon);
    const zeq = yh * Math.sin(epsilon) + zh * Math.cos(epsilon);

    const ra = ((Math.atan2(yeq, xeq) * RAD) % 360 + 360) % 360;
    const dec = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)) * RAD;

    return raDecToAzEl(ra, dec, observer, date);
  }

  /* ==========================================================================
     Матрица ориентации: R^T (world→device), row-major, ZXY Euler
     ========================================================================== */
  function computeOrientationMatrix(alpha, beta, gamma) {
    const a = alpha * DEG;
    const b = beta * DEG;
    const g = gamma * DEG;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cb = Math.cos(b), sb = Math.sin(b);
    const cg = Math.cos(g), sg = Math.sin(g);

    // R = Rz(α)·Rx(β)·Ry(γ) — device→world (ZXY Euler).
    // Хранится R^T (world→device) row-major: Row_i · v_world = (R^T · v)[i].
    // Проекция, шейдер и aiming используют m[row]·v напрямую.
    orientationMatrix[0] =  ca * cg - sa * sb * sg;
    orientationMatrix[1] =  sa * cg + ca * sb * sg;
    orientationMatrix[2] = -cb * sg;
    orientationMatrix[3] = -sa * cb;
    orientationMatrix[4] =  ca * cb;
    orientationMatrix[5] =  sb;
    orientationMatrix[6] =  ca * sg + sa * sb * cg;
    orientationMatrix[7] =  sa * sg - ca * sb * cg;
    orientationMatrix[8] =  cb * cg;
  }


  function refreshOrientationMatrix() {
    var alpha = sensorState.alpha - calibrationDelta - magneticDeclination;
    computeOrientationMatrix(alpha, sensorState.beta, sensorState.gamma);
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
     Сенсоры: DeviceOrientation (компасный режим)
     ========================================================================== */
  function onOrientation(evt) {
    if (evt.alpha == null) return;
    sensorState.alpha = evt.alpha;
    sensorState.beta = evt.beta || 0;
    sensorState.gamma = evt.gamma || 0;
    sensorState.absolute = !!evt.absolute;
    sensorState.timestamp = Date.now();
    refreshOrientationMatrix();

    if (!sensorReady) {
      sensorReady = true;
      if (calibState === 'calibrating') updateCalibButtons();
    }
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
     GPS-сервис: чтение координат из кеша
     ========================================================================== */
  function getGpsCoords() {
    return window.SatContactGps ? window.SatContactGps.getCoords() : null;
  }

  /* ==========================================================================
     Калибровочная машина состояний: переходы
     ========================================================================== */
  function areSensorsReady() {
    return getGpsCoords() !== null && sensorReady && cameraStream;
  }

  function updateCalibButtons() {
    var ready = areSensorsReady();
    if (elCalibFixBtn) elCalibFixBtn.disabled = !ready || !selectedCalibBody;
    if (elCalibSensorStatus) {
      if (!ready) {
        var msg;
        if (!getGpsCoords()) msg = 'Нет координат \u2014 обновите по сети или введите вручную в Модуле 2';
        else if (!sensorReady) msg = '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0441\u0435\u043D\u0441\u043E\u0440\u043E\u0432\u2026';
        else if (!cameraStream) msg = '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u043A\u0430\u043C\u0435\u0440\u044B\u2026';
        else msg = '';
        elCalibSensorStatus.textContent = msg;
        elCalibSensorStatus.hidden = false;
      } else {
        elCalibSensorStatus.hidden = true;
      }
    }
    var coords = getGpsCoords();
    if (coords) updateCelestialBodiesAvailability();
  }

  function showCalibPanel(visible) {
    if (elCalibPhase2) elCalibPhase2.hidden = !visible;
    if (elRecalibBtn) elRecalibBtn.hidden = visible;
  }

  function clearCelestialAvailTimer() {
    if (celestialAvailTimerId) { clearInterval(celestialAvailTimerId); celestialAvailTimerId = null; }
  }

  function updateCelestialBodiesAvailability() {
    var coords = getGpsCoords();
    if (!coords) return;
    var obs = { latitude: coords.latitude, longitude: coords.longitude };
    var now = new Date();
    var sunEl = getSunAzEl(obs, now).elevation;
    var moonEl = getMoonAzEl(obs, now).elevation;
    var polarisEl = getPolarisAzEl(obs, now).elevation;
    var venusEl = getVenusAzEl(obs, now).elevation;
    var jupiterEl = getJupiterAzEl(obs, now).elevation;
    var siriusEl = getSiriusAzEl(obs, now).elevation;

    var sunOk = sunEl > CELESTIAL_ELEVATION_THRESHOLD;
    var moonOk = moonEl > CELESTIAL_ELEVATION_THRESHOLD;
    var polarisOk = polarisEl > CELESTIAL_ELEVATION_THRESHOLD;
    var venusOk = venusEl > CELESTIAL_ELEVATION_THRESHOLD;
    var jupiterOk = jupiterEl > CELESTIAL_ELEVATION_THRESHOLD;
    var siriusOk = siriusEl > CELESTIAL_ELEVATION_THRESHOLD;

    if (elCalibSun) elCalibSun.disabled = !sunOk;
    if (elCalibMoon) elCalibMoon.disabled = !moonOk;
    if (elCalibPolaris) elCalibPolaris.disabled = !polarisOk;
    if (elCalibVenus) elCalibVenus.disabled = !venusOk;
    if (elCalibJupiter) elCalibJupiter.disabled = !jupiterOk;
    if (elCalibSirius) elCalibSirius.disabled = !siriusOk;

    if (selectedCalibBody === 'sun' && !sunOk) selectedCalibBody = null;
    if (selectedCalibBody === 'moon' && !moonOk) selectedCalibBody = null;
    if (selectedCalibBody === 'polaris' && !polarisOk) selectedCalibBody = null;
    if (selectedCalibBody === 'venus' && !venusOk) selectedCalibBody = null;
    if (selectedCalibBody === 'jupiter' && !jupiterOk) selectedCalibBody = null;
    if (selectedCalibBody === 'sirius' && !siriusOk) selectedCalibBody = null;
    syncBodySelection();
    updateCalibCrosshair();

    var noneAvailable = !sunOk && !moonOk && !polarisOk && !venusOk && !jupiterOk && !siriusOk;
    if (elPhase2NoBodies) elPhase2NoBodies.hidden = !noneAvailable;
    updatePhase2FixButton();
  }

  function syncBodySelection() {
    [elCalibSun, elCalibMoon, elCalibPolaris, elCalibVenus, elCalibJupiter, elCalibSirius].forEach(function (btn) {
      if (btn) btn.classList.toggle('selected', btn.dataset.body === selectedCalibBody);
    });
  }

  function onSelectCelestialBody(evt) {
    var btn = evt.currentTarget;
    if (!btn || btn.disabled) return;
    var body = btn.dataset.body;
    selectedCalibBody = (selectedCalibBody === body) ? null : body;
    syncBodySelection();
    updatePhase2FixButton();
    updateCalibCrosshair();
  }

  function updatePhase2FixButton() {
    if (!elCalibFixBtn) return;
    elCalibFixBtn.disabled = !selectedCalibBody || !areSensorsReady();
  }

  function updateCalibCrosshair() {
    if (!elCalibCrosshair) return;
    if (calibState !== 'calibrating' || !selectedCalibBody) {
      elCalibCrosshair.classList.remove('visible');
      return;
    }
    elCalibCrosshair.className =
      'ar-view__calib-crosshair visible ar-view__calib-crosshair--' + selectedCalibBody;
  }

  function onFixCalibration() {
    if (!areSensorsReady() || !selectedCalibBody) return;
    var coords = getGpsCoords();
    if (!coords) return;
    if (navigator.vibrate) navigator.vibrate(50);
    var now = new Date();
    var obs = { latitude: coords.latitude, longitude: coords.longitude };
    var bodyFn = {
      sun: getSunAzEl, moon: getMoonAzEl, polaris: getPolarisAzEl,
      venus: getVenusAzEl, jupiter: getJupiterAzEl, sirius: getSiriusAzEl
    };
    var fn = bodyFn[selectedCalibBody];
    if (!fn) return;
    var truePos = fn(obs, now);
    if (!truePos) return;

    var sensorAz = ((360 - sensorState.alpha + magneticDeclination) % 360 + 360) % 360;
    calibrationDelta = truePos.azimuth - sensorAz;
    if (calibrationDelta > 180) calibrationDelta -= 360;
    if (calibrationDelta < -180) calibrationDelta += 360;

    refreshOrientationMatrix();
    clearCelestialAvailTimer();
    enterRendering();
  }

  function enterRendering() {
    calibState = 'rendering';
    showCalibPanel(false);
    updateCalibCrosshair();

    if (!renderingStarted) {
      startRendering();
    } else {
      startTrajectoryTimer();
      lastRenderTime = 0;
      rafId = requestAnimationFrame(renderLoop);
    }

    if (focusedNoradId) {
      setFocus(focusedNoradId);
      soundEnabled = true;
    } else if (currentNoradIds.length === 1) {
      setFocus(currentNoradIds[0]);
      soundEnabled = true;
    }

    slowLoop();
  }

  function triggerRecalibration() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    stopTrajectoryTimer();
    if (gainNode && audioCtx) {
      gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    }

    var renderer = window.SatContactArRender;
    if (renderer && renderer.clear) renderer.clear();
    if (elCrosshair) elCrosshair.classList.remove('visible');

    calibrationDelta = 0;
    calibState = 'calibrating';
    selectedCalibBody = null;
    updateCalibCrosshair();
    showCalibPanel(true);
    updateCelestialBodiesAvailability();
    updateCalibButtons();
    clearCelestialAvailTimer();
    celestialAvailTimerId = setInterval(updateCelestialBodiesAvailability, CELESTIAL_AVAILABILITY_INTERVAL_MS);
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
    if (elCrosshair) elCrosshair.classList.toggle('visible', state === 'focus');
    document.dispatchEvent(new CustomEvent('satcontact:ar-focus', {
      detail: { focusedIds: noradId ? [noradId] : [] }
    }));
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
     Медленный цикл (1 Hz): пересчёт позиций спутников (ТАКТ 2)
     ========================================================================== */
  function slowLoop() {
    if (!active) return;

    updateHud();
    updateArGpsStatusRow();

    if (calibState === 'calibrating') {
      updateCalibButtons();
    }

    var coords = getGpsCoords();
    if (!coords) return;

    var tleCache = window.SatContactTle ? window.SatContactTle.getCache() : null;
    if (!tleCache) return;

    var now = new Date();
    var nowMs = now.getTime();
    var observer = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude || 0
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

        if (currentPositions[nid]) {
          prevPositions[nid] = currentPositions[nid];
        }
        currentPositions[nid] = { az: pos.azimuth, el: pos.elevation, time: nowMs };
      }
    }
    visibleSatellites = newVisible;
  }

  /* ==========================================================================
     Worker trajectory requests (ТАКТ 3, ~1.3s)
     ========================================================================== */
  function requestWorkerTrajectories() {
    var coords = getGpsCoords();
    if (!active || !coords) return;
    if (!window.SatContactTle || !window.SatContactTle.requestArTrajectories) return;

    var observer = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude || 0
    };

    window.SatContactTle.requestArTrajectories(currentNoradIds, observer, 120)
      .then(function (trajectories) {
        if (!active) return;
        allTrajectories = trajectories || {};
        var renderer = window.SatContactArRender;
        if (renderer && renderer.updateTrajectories) {
          renderer.updateTrajectories(allTrajectories);
        }
      })
      .catch(function (err) {
        console.warn('ar.js: Worker trajectory error', err);
      });
  }

  function startTrajectoryTimer() {
    if (trajectoryTimerId) return;
    requestWorkerTrajectories();
    trajectoryTimerId = setInterval(requestWorkerTrajectories, TRAJECTORY_INTERVAL_MS);
  }

  function stopTrajectoryTimer() {
    if (trajectoryTimerId) {
      clearInterval(trajectoryTimerId);
      trajectoryTimerId = null;
    }
  }

  /* ==========================================================================
     Быстрый цикл (RAF, target ~30 FPS): рендеринг (ТАКТ 1)
     ========================================================================== */
  var lastRenderTime = 0;
  var RENDER_INTERVAL_MS = 33; // ~30 FPS

  function interpolateSatellites() {
    var now = Date.now();
    var interpolated = [];
    for (var i = 0; i < visibleSatellites.length; i++) {
      var sat = visibleSatellites[i];
      var curr = currentPositions[sat.noradId];
      var prev = prevPositions[sat.noradId];
      if (curr && prev) {
        var fraction = Math.min((now - curr.time) / 1000, 1);
        var dAz = curr.az - prev.az;
        if (dAz > 180) dAz -= 360;
        if (dAz < -180) dAz += 360;
        interpolated.push({
          noradId: sat.noradId,
          name: sat.name,
          azimuth: prev.az + dAz * fraction,
          elevation: prev.el + (curr.el - prev.el) * fraction,
          distance: sat.distance,
          height: sat.height
        });
      } else {
        interpolated.push(sat);
      }
    }
    return interpolated;
  }

  function renderLoop() {
    if (!active || calibState !== 'rendering') return;
    rafId = requestAnimationFrame(renderLoop);

    var now = Date.now();
    if (now - lastRenderTime < RENDER_INTERVAL_MS) return;
    lastRenderTime = now;

    var renderer = window.SatContactArRender;
    var interpSats = interpolateSatellites();

    if (renderer) {
      renderer.draw({
        satellites: interpSats,
        allTrajectories: allTrajectories,
        orientationMatrix: orientationMatrix,
        mode: state,
        focusedId: focusedNoradId,
        fovH: fovH,
        fovV: fovV,
        noradIdToFreq: currentNoradIdToFreq
      });
    }

    if (state === 'focus' && focusedNoradId) {
      var focSat = null;
      for (var i = 0; i < interpSats.length; i++) {
        if (interpSats[i].noradId === focusedNoradId) {
          focSat = interpSats[i]; break;
        }
      }
      if (focSat) {
        var angOffset = AUDIO_MAX_OFFSET_DEG;
        if (renderer && renderer.computeAimingAngularErrorDeg) {
          var computed = renderer.computeAimingAngularErrorDeg(
            focSat.azimuth,
            focSat.elevation,
            orientationMatrix
          );
          if (computed != null) angOffset = computed;
        }
        updateAudioPitch(angOffset);
      }
    } else {
      updateAudioPitch(AUDIO_MAX_OFFSET_DEG);
    }
  }

  /* ==========================================================================
     GPS Status Row (AR HUD)
     ========================================================================== */
  function formatCacheAge(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < 60000) return '';
    if (ageMs < 3600000) {
      var m = Math.floor(ageMs / 60000);
      var s = Math.floor((ageMs % 60000) / 1000);
      return '(кеш ' + m + ':' + String(s).padStart(2, '0') + ')';
    }
    if (ageMs < 86400000) return '(кеш ' + Math.floor(ageMs / 3600000) + 'ч)';
    return '(кеш ' + Math.floor(ageMs / 86400000) + 'д)';
  }

  function updateArGpsStatusRow() {
    var gps = window.SatContactGps;
    if (!gps) return;

    var coords = gps.getCoords();
    var status = gps.getReceiverStatus();
    var ageMs = gps.getCacheAgeMs();

    if (elArGpsIndicator) {
      if (status === 'fix')          elArGpsIndicator.textContent = '\uD83D\uDFE2 GPS';
      else if (status === 'searching') elArGpsIndicator.textContent = '\uD83D\uDFE1 ПОИСК';
      else if (status === 'denied')  elArGpsIndicator.textContent = '\uD83D\uDD34 ЗАПРЕЩЁН';
      else                           elArGpsIndicator.textContent = '\u26AA ВЫКЛ';
    }

    if (elArGpsCoords) {
      elArGpsCoords.textContent = coords
        ? coords.latitude.toFixed(2) + '\u00B0, ' + coords.longitude.toFixed(2) + '\u00B0'
        : 'НЕТ ДАННЫХ';
    }

    if (elArGpsAge) {
      elArGpsAge.textContent = coords ? formatCacheAge(ageMs) : '';
    }
  }

  function onArNetworkBtnClick() {
    if (!elArGpsNetBtn || !window.SatContactGps) return;
    var savedText = elArGpsNetBtn.textContent;
    elArGpsNetBtn.textContent = '...';
    elArGpsNetBtn.disabled = true;

    window.SatContactGps.updateFromNetwork().then(function (ok) {
      elArGpsNetBtn.textContent = ok ? '\u2713' : 'Сеть недоступна';
      if (arNetBtnFeedbackTimerId) clearTimeout(arNetBtnFeedbackTimerId);
      arNetBtnFeedbackTimerId = setTimeout(function () {
        elArGpsNetBtn.textContent = savedText;
        elArGpsNetBtn.disabled = false;
        arNetBtnFeedbackTimerId = null;
      }, 2000);
    });
  }

  /* ==========================================================================
     HUD (satellite telemetry only)
     ========================================================================== */
  function updateHud() {
    var showTel = (state === 'focus' && focusedNoradId);
    if (elTelemetryRow) elTelemetryRow.hidden = !showTel;

    if (showTel) {
      var focSat = null;
      for (var i = 0; i < visibleSatellites.length; i++) {
        if (visibleSatellites[i].noradId === focusedNoradId) { focSat = visibleSatellites[i]; break; }
      }
      if (focSat) {
        var fmtAz = window.SatContactTle ? window.SatContactTle.formatAzimuth(focSat.azimuth) : focSat.azimuth.toFixed(1) + '\u00B0';
        var fmtEl = window.SatContactTle ? window.SatContactTle.formatElevation(focSat.elevation) : focSat.elevation.toFixed(1) + '\u00B0';
        if (elTelAz) elTelAz.textContent = 'АЗ: ' + fmtAz;
        if (elTelEl) elTelEl.textContent = 'ЭЛ: ' + fmtEl;
        if (elTelDist) elTelDist.textContent = 'ДИСТ: ' + Math.round(focSat.distance) + ' км';
      }
    }
  }

  /* ==========================================================================
     GPS onChange handler
     ========================================================================== */
  function arGpsChangeHandler(payload) {
    if (payload && payload.coords) {
      var c = payload.coords;
      magneticDeclination = getMagneticDeclination(c.latitude, c.longitude, (c.altitude || 0) / 1000);
      refreshOrientationMatrix();
    }
    if (calibState === 'calibrating') {
      updateCalibButtons();
      updateCelestialBodiesAvailability();
    }
    updateArGpsStatusRow();
  }

  /* ==========================================================================
     UI handlers
     ========================================================================== */
  function showFallback() {
    if (elFallback) elFallback.hidden = false;
  }

  function onBackClick() { if (window.closeArView) window.closeArView(); }
  function onShowAllClick() {
    showAllActive = !showAllActive;
    if (elShowAll) elShowAll.classList.toggle('active', showAllActive);

    if (showAllActive) {
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
      if (!allIds.length) { showAllActive = false; return; }
      currentNoradIds = allIds;
      currentNoradIdToName = nameMap;
    } else {
      if (focusedNoradId && currentNoradIdToName[focusedNoradId]) {
        var keepId = focusedNoradId;
        var keepName = currentNoradIdToName[keepId];
        currentNoradIds = [keepId];
        currentNoradIdToName = {};
        currentNoradIdToName[keepId] = keepName;
      } else {
        currentNoradIds = initialNoradIds.slice();
        currentNoradIdToName = Object.assign({}, initialNoradIdToName);
      }
    }

    var keepFocus = !showAllActive && focusedNoradId && currentNoradIds.indexOf(String(focusedNoradId)) !== -1;
    if (!keepFocus) setFocus(null);
    allTrajectories = {};
    prevPositions = {};
    currentPositions = {};
    if (renderingStarted) {
      requestWorkerTrajectories();
    }
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
    if (elCanvas) elCanvas.addEventListener('click', onCanvasClick);
    if (elShowAll) elShowAll.addEventListener('click', onShowAllClick);
    if (elSoundToggle) elSoundToggle.addEventListener('click', onSoundToggleClick);
    if (elCalibFixBtn) elCalibFixBtn.addEventListener('click', onFixCalibration);
    if (elRecalibBtn) elRecalibBtn.addEventListener('click', triggerRecalibration);
    if (elCalibSun) elCalibSun.addEventListener('click', onSelectCelestialBody);
    if (elCalibMoon) elCalibMoon.addEventListener('click', onSelectCelestialBody);
    if (elCalibPolaris) elCalibPolaris.addEventListener('click', onSelectCelestialBody);
    if (elCalibVenus) elCalibVenus.addEventListener('click', onSelectCelestialBody);
    if (elCalibJupiter) elCalibJupiter.addEventListener('click', onSelectCelestialBody);
    if (elCalibSirius) elCalibSirius.addEventListener('click', onSelectCelestialBody);
    if (elArGpsNetBtn) elArGpsNetBtn.addEventListener('click', onArNetworkBtnClick);
  }

  function unbindUi() {
    if (elBack) elBack.removeEventListener('click', onBackClick);
    if (elFallbackBack) elFallbackBack.removeEventListener('click', onBackClick);
    if (elCanvas) elCanvas.removeEventListener('click', onCanvasClick);
    if (elShowAll) elShowAll.removeEventListener('click', onShowAllClick);
    if (elSoundToggle) elSoundToggle.removeEventListener('click', onSoundToggleClick);
    if (elCalibFixBtn) elCalibFixBtn.removeEventListener('click', onFixCalibration);
    if (elRecalibBtn) elRecalibBtn.removeEventListener('click', triggerRecalibration);
    if (elCalibSun) elCalibSun.removeEventListener('click', onSelectCelestialBody);
    if (elCalibMoon) elCalibMoon.removeEventListener('click', onSelectCelestialBody);
    if (elCalibPolaris) elCalibPolaris.removeEventListener('click', onSelectCelestialBody);
    if (elCalibVenus) elCalibVenus.removeEventListener('click', onSelectCelestialBody);
    if (elCalibJupiter) elCalibJupiter.removeEventListener('click', onSelectCelestialBody);
    if (elCalibSirius) elCalibSirius.removeEventListener('click', onSelectCelestialBody);
    if (elArGpsNetBtn) elArGpsNetBtn.removeEventListener('click', onArNetworkBtnClick);
  }

  /* ==========================================================================
     init / cleanup (public API)
     ========================================================================== */
  function cacheDom() {
    elVideo = document.getElementById('arVideo');
    elCanvas = document.getElementById('arCanvas');
    elCanvasGL = document.getElementById('arCanvasGL');
    elBack = document.getElementById('arBack');
    elShowAll = document.getElementById('arShowAll');
    elSoundToggle = document.getElementById('arSoundToggle');
    elHud = document.getElementById('arHud');
    elTelemetryRow = document.getElementById('arTelemetryRow');
    elTelAz = document.getElementById('arTelAz');
    elTelEl = document.getElementById('arTelEl');
    elTelDist = document.getElementById('arTelDist');
    elFallback = document.getElementById('arDesktopFallback');
    elFallbackBack = document.getElementById('arFallbackBack');
    elCrosshair = document.getElementById('arCrosshair');
    elCalibCrosshair = document.getElementById('arCalibCrosshair');
    elCalibPhase2 = document.getElementById('arCalibPanel');
    elCalibSun = document.getElementById('arCalibSun');
    elCalibMoon = document.getElementById('arCalibMoon');
    elCalibPolaris = document.getElementById('arCalibPolaris');
    elCalibVenus = document.getElementById('arCalibVenus');
    elCalibJupiter = document.getElementById('arCalibJupiter');
    elCalibSirius = document.getElementById('arCalibSirius');
    elCalibFixBtn = document.getElementById('arCalibFixBtn');
    elCalibSensorStatus = document.getElementById('arCalibSensorStatus');
    elPhase2NoBodies = document.getElementById('arPhase2NoBodies');
    elRecalibBtn = document.getElementById('arRecalibBtn');
    elArGpsIndicator = document.getElementById('arGpsIndicator');
    elArGpsCoords = document.getElementById('arGpsCoords');
    elArGpsAge = document.getElementById('arGpsAge');
    elArGpsNetBtn = document.getElementById('arGpsNetBtn');
  }

  function startRendering() {
    if (renderingStarted) return;
    renderingStarted = true;

    if (window.SatContactArRender) {
      window.SatContactArRender.init(elCanvasGL, elCanvas);
    }

    slowLoop();
    startTrajectoryTimer();
    lastRenderTime = 0;
    rafId = requestAnimationFrame(renderLoop);
  }

  async function initAr(options) {
    cacheDom();
    active = true;
    state = 'overview';
    focusedNoradId = null;
    calibrationDelta = 0;
    magneticDeclination = 0;
    calibState = 'calibrating';
    renderingStarted = false;
    sensorState = { alpha: 0, beta: 0, gamma: 0, absolute: false, timestamp: 0 };
    sensorReady = false;
    selectedCalibBody = null;
    soundEnabled = false;
    visibleSatellites = [];
    allTrajectories = {};
    prevPositions = {};
    currentPositions = {};

    currentNoradIds = (options && options.noradIds) || [];
    currentNoradIdToName = (options && options.noradIdToName) || {};
    if (options && options.satelliteName && currentNoradIds.length === 1) {
      currentNoradIdToName[currentNoradIds[0]] = options.satelliteName;
    }
    currentNoradIdToFreq = (options && options.noradIdToFreq) || {};
    initialNoradIds = currentNoradIds.slice();
    initialNoradIdToName = Object.assign({}, currentNoradIdToName);
    showAllActive = false;

    if (currentNoradIds.length === 1) {
      focusedNoradId = currentNoradIds[0];
      soundEnabled = true;
    }

    if (!checkArCapabilities()) {
      showFallback();
      bindUi();
      return;
    }

    if (elFallback) elFallback.hidden = true;

    bindUi();

    if (window.SatContactGps) {
      window.SatContactGps.start();
      window.SatContactGps.onChange(arGpsChangeHandler);
    }

    var initCoords = getGpsCoords();
    if (initCoords) {
      magneticDeclination = getMagneticDeclination(initCoords.latitude, initCoords.longitude, (initCoords.altitude || 0) / 1000);
    }

    updateArGpsStatusRow();

    await Promise.all([
      window.SatContactTle.loadTle(),
      startCamera(),
      startSensors()
    ]);

    initAudio();

    slowLoopId = setInterval(slowLoop, SLOW_LOOP_MS);

    showCalibPanel(true);
    updateCalibButtons();
    clearCelestialAvailTimer();
    celestialAvailTimerId = setInterval(updateCelestialBodiesAvailability, CELESTIAL_AVAILABILITY_INTERVAL_MS);

    slowLoop();
  }

  function cleanupAr() {
    active = false;
    if (slowLoopId) { clearInterval(slowLoopId); slowLoopId = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    stopTrajectoryTimer();
    clearCelestialAvailTimer();
    if (arNetBtnFeedbackTimerId) { clearTimeout(arNetBtnFeedbackTimerId); arNetBtnFeedbackTimerId = null; }

    stopCamera();
    stopSensors();
    destroyAudio();
    unbindUi();

    if (window.SatContactGps) {
      window.SatContactGps.enterCooldown();
      window.SatContactGps.offChange(arGpsChangeHandler);
    }

    if (window.SatContactArRender) {
      window.SatContactArRender.destroy();
    }

    state = 'overview';
    focusedNoradId = null;
    renderingStarted = false;
    showAllActive = false;
    calibState = 'calibrating';
    selectedCalibBody = null;
    updateCalibCrosshair();
    sensorReady = false;
    visibleSatellites = [];
    allTrajectories = {};
    prevPositions = {};
    currentPositions = {};
  }

  window.initAr = initAr;
  window.cleanupAr = cleanupAr;

  window.SatContactAr = {
    getState: function () { return state; },
    getFocusedId: function () { return focusedNoradId; },
    setFocus: setFocus,
    getSensorState: function () { return sensorState; },
    getFov: function () { return { h: fovH, v: fovV }; }
  };
})();
