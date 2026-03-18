/**
 * SatContact — Модуль 2: D3-картография (map-render.js)
 * Отрисовка Земли, линии терминатора, огней городов, орбит, маркеров.
 * Canvas-рендер для 60 FPS на слабых мобильных устройствах, оффлайн.
 */

(function () {
  'use strict';

  const WORLD_URL = 'data/countries-50m.json';
  const EARTH_RADIUS_KM = 6378.135;
  const FAST_LOOP_MS = 1000;
  const SLOW_LOOP_MS = 60000;

  const MAJOR_CITIES = [
    { name: 'Moscow', lat: 55.75, lon: 37.61 },
    { name: 'London', lat: 51.51, lon: -0.13 },
    { name: 'Paris', lat: 48.86, lon: 2.35 },
    { name: 'Berlin', lat: 52.52, lon: 13.41 },
    { name: 'Madrid', lat: 40.42, lon: -3.70 },
    { name: 'Rome', lat: 41.90, lon: 12.50 },
    { name: 'Amsterdam', lat: 52.37, lon: 4.89 },
    { name: 'Brussels', lat: 50.85, lon: 4.35 },
    { name: 'Vienna', lat: 48.21, lon: 16.37 },
    { name: 'Warsaw', lat: 52.23, lon: 21.01 },
    { name: 'Prague', lat: 50.08, lon: 14.44 },
    { name: 'Budapest', lat: 47.50, lon: 19.04 },
    { name: 'Athens', lat: 37.98, lon: 23.73 },
    { name: 'Istanbul', lat: 41.01, lon: 28.95 },
    { name: 'Cairo', lat: 30.04, lon: 31.24 },
    { name: 'Tehran', lat: 35.69, lon: 51.39 },
    { name: 'Baghdad', lat: 33.31, lon: 44.36 },
    { name: 'Riyadh', lat: 24.71, lon: 46.68 },
    { name: 'Dubai', lat: 25.20, lon: 55.27 },
    { name: 'Mumbai', lat: 19.08, lon: 72.88 },
    { name: 'Delhi', lat: 28.61, lon: 77.21 },
    { name: 'Bangalore', lat: 12.97, lon: 77.59 },
    { name: 'Chennai', lat: 13.08, lon: 80.27 },
    { name: 'Kolkata', lat: 22.57, lon: 88.36 },
    { name: 'Karachi', lat: 24.86, lon: 67.01 },
    { name: 'Lahore', lat: 31.55, lon: 74.36 },
    { name: 'Dhaka', lat: 23.81, lon: 90.41 },
    { name: 'Bangkok', lat: 13.76, lon: 100.50 },
    { name: 'Singapore', lat: 1.35, lon: 103.82 },
    { name: 'Jakarta', lat: -6.21, lon: 106.85 },
    { name: 'Manila', lat: 14.60, lon: 120.98 },
    { name: 'Ho Chi Minh', lat: 10.82, lon: 106.63 },
    { name: 'Hanoi', lat: 21.03, lon: 105.85 },
    { name: 'Hong Kong', lat: 22.28, lon: 114.16 },
    { name: 'Shanghai', lat: 31.23, lon: 121.47 },
    { name: 'Beijing', lat: 39.90, lon: 116.41 },
    { name: 'Tokyo', lat: 35.68, lon: 139.69 },
    { name: 'Osaka', lat: 34.69, lon: 135.50 },
    { name: 'Seoul', lat: 37.57, lon: 126.98 },
    { name: 'Sydney', lat: -33.87, lon: 151.21 },
    { name: 'Melbourne', lat: -37.81, lon: 144.96 },
    { name: 'Auckland', lat: -36.85, lon: 174.76 },
    { name: 'New York', lat: 40.71, lon: -74.01 },
    { name: 'Los Angeles', lat: 34.05, lon: -118.24 },
    { name: 'Chicago', lat: 41.88, lon: -87.63 },
    { name: 'Houston', lat: 29.76, lon: -95.37 },
    { name: 'Phoenix', lat: 33.45, lon: -112.07 },
    { name: 'Philadelphia', lat: 39.95, lon: -75.17 },
    { name: 'San Antonio', lat: 29.42, lon: -98.49 },
    { name: 'San Diego', lat: 32.72, lon: -117.16 },
    { name: 'Dallas', lat: 32.78, lon: -96.80 },
    { name: 'San Francisco', lat: 37.77, lon: -122.42 },
    { name: 'Washington', lat: 38.91, lon: -77.04 },
    { name: 'Boston', lat: 42.36, lon: -71.06 },
    { name: 'Miami', lat: 25.76, lon: -80.19 },
    { name: 'Atlanta', lat: 33.75, lon: -84.39 },
    { name: 'Seattle', lat: 47.61, lon: -122.33 },
    { name: 'Denver', lat: 39.74, lon: -104.99 },
    { name: 'Toronto', lat: 43.65, lon: -79.38 },
    { name: 'Montreal', lat: 45.50, lon: -73.57 },
    { name: 'Vancouver', lat: 49.28, lon: -123.12 },
    { name: 'Mexico City', lat: 19.43, lon: -99.13 },
    { name: 'Lima', lat: -12.05, lon: -77.04 },
    { name: 'Bogota', lat: 4.71, lon: -74.07 },
    { name: 'Buenos Aires', lat: -34.60, lon: -58.38 },
    { name: 'Sao Paulo', lat: -23.55, lon: -46.63 },
    { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17 },
    { name: 'Santiago', lat: -33.45, lon: -70.67 },
    { name: 'Caracas', lat: 10.48, lon: -66.90 },
    { name: 'Lagos', lat: 6.45, lon: 3.40 },
    { name: 'Johannesburg', lat: -26.20, lon: 28.04 },
    { name: 'Nairobi', lat: -1.29, lon: 36.82 },
    { name: 'Casablanca', lat: 33.59, lon: -7.62 },
    { name: 'Algiers', lat: 36.75, lon: 3.04 },
    { name: 'Kiev', lat: 50.45, lon: 30.52 },
    { name: 'Minsk', lat: 53.90, lon: 27.56 },
    { name: 'Almaty', lat: 43.22, lon: 76.85 },
    { name: 'Tashkent', lat: 41.31, lon: 69.24 },
    { name: 'Baku', lat: 40.41, lon: 49.87 },
    { name: 'Tbilisi', lat: 41.72, lon: 44.83 },
    { name: 'Yerevan', lat: 40.18, lon: 44.51 }
  ];

  const COLORS = {
    dayOcean: '#6b9bc2',
    dayLand: '#c6dbe8',
    dayBorder: 'rgba(0,0,0,0.1)',
    nightOverlay: 'rgba(28, 36, 45, 0.55)',
    nightBorder: 'rgba(255,255,255,0.12)',
    terminatorLine: 'rgba(255,255,255,0.35)',
    orbit: 'rgba(82, 136, 193, 0.6)',
    footprint: 'rgba(82, 136, 193, 0.15)',
    marker: '#5288c1',
    observer: '#81c784'
  };

  let canvas, ctx, projection, path;
  let resizeObserver = null;
  let topology = null;
  let countriesGeo = null;
  let fastLoopId = null;
  let slowLoopId = null;
  let lastNoradIds = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let currentTransform = d3.zoomIdentity;
  let zoomBehavior = null;

  /** Состояние для рендера (обновляется в циклах) */
  let currentSunPos = null;
  let terminatorShadowGeo = null;
  let terminatorLineGeo = null;
  let activeSatellites = [];
  let cachedOrbitGeos = [];
  let observerPos = null;

  let cachedLandPath2D = null;
  let cachedTerminatorShadowPath2D = null;
  let cachedTerminatorLinePath2D = null;
  let observerBaseXY = null;
  let focusedNoradIds = new Set();

  /**
   * Позиция Солнца (подсолнечная точка) по UTC. Без API, чистая математика.
   */
  function getSunPosition(date) {
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const lon = 180 - 15 * utcHours;
    const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
    const dayOfYear = Math.floor((date - startOfYear) / 86400000);
    const lat = 23.45 * Math.sin((2 * Math.PI / 365.25) * (dayOfYear - 81));
    return { lon: ((lon + 540) % 360) - 180, lat };
  }

  /**
   * Радиус footprint в градусах
   */
  function footprintRadiusDeg(heightKm) {
    if (!heightKm || heightKm <= 0) return 0;
    const halfAngle = Math.asin(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + heightKm));
    return (halfAngle * 180) / Math.PI;
  }

  /** Fallback: угловое расстояние в радианах (вход в градусах) */
  function geoDistanceFallback(a, b) {
    const λ1 = a[0] * Math.PI / 180, φ1 = a[1] * Math.PI / 180;
    const λ2 = b[0] * Math.PI / 180, φ2 = b[1] * Math.PI / 180;
    const Δφ = φ2 - φ1, Δλ = λ2 - λ1;
    const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function topoToGeo(topology, objectName) {
    const obj = topology.objects[objectName];
    if (!obj) return null;
    const topo = window.topojson || window.topojsonClient || {};
    const featureFn = typeof topo === 'function' ? topo : topo.feature;
    if (!featureFn) return null;
    return featureFn(topology, obj);
  }

  /** Сравнение массивов noradIds (состав и порядок) */
  function noradIdsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Инициализация Canvas-карты
   */
  function resolveUrl(relativePath) {
    const baseEl = document.querySelector('base');
    const base = baseEl ? (baseEl.href.replace(/\/?$/, '/') || './') : './';
    return base + (relativePath || '').replace(/^\//, '');
  }

  async function initD3Map(container) {
    if (!container || !window.d3) return;

    width = Math.max(container.clientWidth, 1);
    height = Math.max(container.clientHeight, 1);

    dpr = Math.min(window.devicePixelRatio || 1, 2);

    projection = d3.geoMercator()
      .scale(width / (2 * Math.PI))
      .translate([width / 2, height / 2]);

    canvas = d3.select(container)
      .selectAll('canvas')
      .data([1])
      .join('canvas')
      .attr('width', width * dpr)
      .attr('height', height * dpr)
      .style('width', width + 'px')
      .style('height', height + 'px')
      .style('display', 'block');

    ctx = canvas.node().getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    path = d3.geoPath().projection(projection);

    function zoomed(event) {
      currentTransform = event.transform;
      renderFrame();
    }
    function onCanvasClick(event) {
      if (event.defaultPrevented) return;
      if (!activeSatellites.length) return;

      const [mouseX, mouseY] = d3.pointer(event);

      let clickedSatId = null;

      for (const sat of activeSatellites) {
        if (!sat.baseXY) continue;
        const [screenX, screenY] = currentTransform.apply(sat.baseXY);
        const dist = Math.hypot(mouseX - screenX, mouseY - screenY);

        if (dist < 20) {
          clickedSatId = sat.noradId;
          break;
        }
      }

      if (clickedSatId) {
        if (focusedNoradIds.has(clickedSatId)) {
          focusedNoradIds.delete(clickedSatId);
        } else {
          focusedNoradIds.add(clickedSatId);
        }
      } else {
        focusedNoradIds.clear();
      }

      fastLoop();
    }
    zoomBehavior = d3.zoom().scaleExtent([1, 8]).on('zoom', zoomed);
    d3.select(canvas.node())
      .call(zoomBehavior)
      .on('click', onCanvasClick); // Клик на canvas, а не на zoom (d3.zoom не имеет события click)

    try {
      const res = await fetch(resolveUrl(WORLD_URL));
      if (res.ok) topology = await res.json();
    } catch (e) {
      console.warn('map-render: не удалось загрузить карту', e);
    }

    if (topology) {
      countriesGeo = topoToGeo(topology, 'countries') || topoToGeo(topology, 'land');
    }

    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(container);

    onResize();
    slowLoop();
    fastLoop();
    fastLoopId = setInterval(fastLoop, FAST_LOOP_MS);
    slowLoopId = setInterval(slowLoop, SLOW_LOOP_MS);
  }

  function onResize() {
    if (!canvas || !ctx || !projection || !path) return;
    const container = canvas.node().parentElement;
    if (!container) return;
    width = Math.max(container.clientWidth, 1);
    height = Math.max(container.clientHeight, 1);

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    projection.scale(width / (2 * Math.PI)).translate([width / 2, height / 2]);

    canvas
      .attr('width', width * dpr)
      .attr('height', height * dpr)
      .style('width', width + 'px')
      .style('height', height + 'px');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    path = d3.geoPath().projection(projection);

    if (countriesGeo) {
      cachedLandPath2D = new Path2D(path(countriesGeo));
    }

    MAJOR_CITIES.forEach((city) => {
      city.baseXY = projection([city.lon, city.lat]);
    });

    if (zoomBehavior) {
      zoomBehavior.extent([[0, 0], [width, height]]);
    }

    slowLoop();
    fastLoop();
  }

  /**
   * Рендер кадра: Painter's algorithm (снизу вверх)
   */
  function renderFrame() {
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(currentTransform.x, currentTransform.y);
    ctx.scale(currentTransform.k, currentTransform.k);

    const k = currentTransform.k;

    ctx.fillStyle = COLORS.dayOcean;
    ctx.fillRect(0, 0, width, height);

    if (cachedLandPath2D) {
      ctx.fillStyle = COLORS.dayLand;
      ctx.fill(cachedLandPath2D);

      ctx.strokeStyle = COLORS.dayBorder;
      ctx.lineWidth = 0.5 / k;
      ctx.stroke(cachedLandPath2D);
    }

    if (cachedTerminatorShadowPath2D) {
      ctx.fillStyle = COLORS.nightOverlay;
      ctx.fill(cachedTerminatorShadowPath2D);

      ctx.strokeStyle = COLORS.nightBorder;
      ctx.lineWidth = 0.5 / k;
      ctx.stroke(cachedLandPath2D);
    }

    if (cachedTerminatorLinePath2D) {
      ctx.strokeStyle = COLORS.terminatorLine;
      ctx.lineWidth = 1 / k;
      ctx.stroke(cachedTerminatorLinePath2D);
    }

    MAJOR_CITIES.forEach((city) => {
      if (!city.isNight || !city.baseXY) return;

      const xy = city.baseXY;
      const r = 2.5 / k;
      const grad = ctx.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], r);
      grad.addColorStop(0, 'rgba(255, 222, 107, 1)');
      grad.addColorStop(0.4, 'rgba(255, 222, 107, 0.6)');
      grad.addColorStop(1, 'rgba(255, 222, 107, 0)');

      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    cachedOrbitGeos.forEach((p) => {
      ctx.strokeStyle = COLORS.orbit;
      ctx.lineWidth = 1.5 / k;
      ctx.stroke(p);
    });

    activeSatellites.forEach((sat) => {
      if (sat.footprintPath2D) {
        ctx.fillStyle = COLORS.footprint;
        ctx.fill(sat.footprintPath2D);
        ctx.strokeStyle = COLORS.orbit;
        ctx.lineWidth = 0.5 / k;
        ctx.stroke(sat.footprintPath2D);
      }
    });

    activeSatellites.forEach((sat) => {
      const xy = sat.baseXY;
      if (xy) {
        ctx.fillStyle = COLORS.marker;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = (sat.markerRadius === 6 ? 2 : 1) / k;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], sat.markerRadius / k, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    });

    if (observerBaseXY) {
      const xy = observerBaseXY;
      ctx.fillStyle = COLORS.observer;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 4 / k, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Медленный цикл (60 с): обновление терминатора
   */
  function slowLoop() {
    if (!projection) return;

    const sun = getSunPosition(new Date());
    currentSunPos = sun;

    const geoDist = d3.geoDistance || geoDistanceFallback;
    const sunPt = [sun.lon, sun.lat];
    const nightThreshold = Math.PI / 2;
    MAJOR_CITIES.forEach((city) => {
      const dist = geoDist([city.lon, city.lat], sunPt);
      city.isNight = dist > nightThreshold;
    });

    let antiLon = sun.lon + 180;
    if (antiLon > 180) antiLon -= 360;
    const antiLat = -sun.lat;

    terminatorShadowGeo = d3.geoCircle()
      .center([antiLon, antiLat])
      .radius(90)
      .precision(2)();

    terminatorLineGeo = d3.geoCircle()
      .center([sun.lon, sun.lat])
      .radius(90)
      .precision(2)();

    cachedTerminatorShadowPath2D = new Path2D(path(terminatorShadowGeo));
    cachedTerminatorLinePath2D = new Path2D(path(terminatorLineGeo));

    renderFrame();
  }

  /**
   * Быстрый цикл (1 с): наблюдатель, спутники, орбиты, footprints
   */
  function fastLoop() {
    if (!projection || !path) return;

    const noradIds = typeof window.getMapNoradIds === 'function' ? window.getMapNoradIds() : [];
    const observer = typeof window.getMapObserver === 'function' ? window.getMapObserver() : null;
    const noradIdsChanged = !noradIdsEqual(noradIds, lastNoradIds);

    observerPos = observer ? { lon: observer.longitude, lat: observer.latitude } : null;
    observerBaseXY = observerPos ? projection([observerPos.lon, observerPos.lat]) : null;

    if (noradIdsChanged) {
      focusedNoradIds.clear();
      lastNoradIds = noradIds.slice();
      cachedOrbitGeos = [];

      if (window.SatContactTle && typeof window.SatContactTle.requestTrajectories === 'function' && noradIds.length > 0) {
        const requestedNoradIds = noradIds.slice();
        window.SatContactTle.requestTrajectories(requestedNoradIds).then((trajectories) => {
          if (!noradIdsEqual(lastNoradIds, requestedNoradIds)) return;
          (trajectories || []).forEach((segments) => {
            if (segments && segments.length > 0) {
              cachedOrbitGeos.push(new Path2D(path({ type: 'MultiLineString', coordinates: segments })));
            }
          });
          renderFrame();
        });
      }
    }

    activeSatellites = [];

    if (!window.SatContactTle || !noradIds.length) {
      renderFrame();
      return;
    }

    noradIds.forEach((noradId) => {
      const pos = typeof window.getSatellitePosition === 'function'
        ? window.getSatellitePosition(noradId)
        : null;
      const showFootprint = focusedNoradIds.has(noradId);

      let footprintPath2D = null;
      if (showFootprint && pos) {
        const tleMap = window.SatContactTle.getCache();
        const tleData = tleMap && tleMap.get(noradId);
        let heightKm = 0;
        if (tleData) {
          const r = window.SatContactTle.computeSatellite(
            tleData,
            observer || { latitude: 0, longitude: 0, altitude: 0 },
            new Date()
          );
          if (r && r.height != null) heightKm = r.height;
        }
        const radiusDeg = footprintRadiusDeg(heightKm);
        if (radiusDeg > 0) {
          const footprintGeo = d3.geoCircle()
            .center([pos.lon, pos.lat])
            .radius(radiusDeg)();
          footprintPath2D = new Path2D(path(footprintGeo));
        }
      }

      activeSatellites.push({
        noradId: noradId,
        pos: pos,
        baseXY: pos ? projection([pos.lon, pos.lat]) : null,
        footprintPath2D: footprintPath2D,
        markerRadius: showFootprint ? 6 : 5
      });
    });

    renderFrame();
  }

  function destroyMapRender() {
    if (fastLoopId) {
      clearInterval(fastLoopId);
      fastLoopId = null;
    }
    if (slowLoopId) {
      clearInterval(slowLoopId);
      slowLoopId = null;
    }
    if (resizeObserver && canvas && canvas.node()) {
      resizeObserver.unobserve(canvas.node().parentElement);
    }
    resizeObserver = null;
    if (canvas) {
      canvas.remove();
      canvas = null;
    }
    ctx = null;
    projection = null;
    path = null;
    topology = null;
    countriesGeo = null;
    lastNoradIds = [];
    currentSunPos = null;
    terminatorShadowGeo = null;
    terminatorLineGeo = null;
    activeSatellites = [];
    cachedOrbitGeos = [];
    observerPos = null;
    observerBaseXY = null;
    focusedNoradIds.clear();
    currentTransform = d3.zoomIdentity;
    zoomBehavior = null;
    cachedLandPath2D = null;
    cachedTerminatorShadowPath2D = null;
    cachedTerminatorLinePath2D = null;
  }

  window.SatContactMapRender = {
    init: initD3Map,
    update: fastLoop,
    destroy: destroyMapRender
  };
})();
