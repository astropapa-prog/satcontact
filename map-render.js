/**
 * SatContact — Модуль 2: D3-картография (map-render.js)
 * Отрисовка Земли, огней городов, орбит, маркеров.
 * Оптимизировано для слабых мобильных устройств, оффлайн.
 */

(function () {
  'use strict';

  const WORLD_URLS = ['data/world-50m.json', 'data/countries-50m.json'];
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
    orbit: 'rgba(82, 136, 193, 0.6)',
    footprint: 'rgba(82, 136, 193, 0.15)',
    marker: '#5288c1',
    observer: '#81c784'
  };

  let svg, g, projection, path;
  let layerOcean, layerLand, layerLandBorders;
  let layerLights, layerOrbits, layerFootprint, layerMarkers;
  let landPath, bordersPath;
  let observerMarker, cityLightElements;
  let resizeObserver = null;
  let topology = null;
  let countriesGeo = null;
  let fastLoopId = null;
  let slowLoopId = null;

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

  /**
   * Инициализация D3-карты (initD3Map)
   */
  async function initD3Map(container) {
    if (!container || !window.d3) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    projection = d3.geoMercator()
      .scale(width / (2 * Math.PI))
      .translate([width / 2, height / 2]);

    path = d3.geoPath().projection(projection);

    svg = d3.select(container)
      .selectAll('svg')
      .data([1])
      .join('svg')
      .attr('width', width)
      .attr('height', height)
      .style('display', 'block');

    const defs = svg.append('defs');
    defs.append('radialGradient')
      .attr('id', 'city-glow')
      .selectAll('stop')
      .data([
        { offset: '0%', color: '#ffde6b', opacity: 1 },
        { offset: '40%', color: '#ffde6b', opacity: 0.6 },
        { offset: '100%', color: '#ffde6b', opacity: 0 }
      ])
      .join('stop')
      .attr('offset', d => d.offset)
      .attr('stop-color', d => d.color)
      .attr('stop-opacity', d => d.opacity);

    g = svg.append('g');

    layerOcean = g.append('g').attr('class', 'layer-ocean');
    layerOcean.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', COLORS.dayOcean);

    layerLand = g.append('g').attr('class', 'layer-land');
    layerLandBorders = g.append('g').attr('class', 'layer-land-borders');
    layerLights = g.append('g').attr('class', 'layer-lights').style('pointer-events', 'none');
    layerOrbits = g.append('g').attr('class', 'layer-orbits');
    layerFootprint = g.append('g').attr('class', 'layer-footprint');
    layerMarkers = g.append('g').attr('class', 'layer-markers');

    for (const url of WORLD_URLS) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          topology = await res.json();
          break;
        }
      } catch (e) {
        continue;
      }
    }
    if (!topology) console.warn('map-render: не удалось загрузить карту');

    if (topology) {
      countriesGeo = topoToGeo(topology, 'countries') || topoToGeo(topology, 'land');
      if (countriesGeo) {
        landPath = layerLand.append('path')
          .datum(countriesGeo)
          .attr('fill', COLORS.dayLand)
          .attr('d', path);

        bordersPath = layerLandBorders.append('path')
          .datum(countriesGeo)
          .attr('fill', 'none')
          .attr('stroke', COLORS.dayBorder)
          .attr('stroke-width', 0.5)
          .attr('d', path);
      }
    }

    initCityLights();
    observerMarker = layerMarkers.append('circle')
      .attr('r', 4)
      .attr('fill', COLORS.observer)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('display', 'none');

    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(container);

    onResize();
    fastLoop();
    slowLoop();
    fastLoopId = setInterval(fastLoop, FAST_LOOP_MS);
    slowLoopId = setInterval(slowLoop, SLOW_LOOP_MS);
  }

  function onResize() {
    if (!svg || !g || !projection || !path) return;
    const container = svg.node().parentElement;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    projection.scale(width / (2 * Math.PI)).translate([width / 2, height / 2]);
    svg.attr('width', width).attr('height', height);
    layerOcean.select('rect').attr('width', width).attr('height', height);

    if (landPath) landPath.attr('d', path);
    if (bordersPath) bordersPath.attr('d', path);

    updateCityLights();
    fastLoop();
  }

  /**
   * Инициализация огней городов
   */
  function initCityLights() {
    if (!layerLights || !projection) return;
    layerLights.selectAll('circle').remove();
    cityLightElements = [];
    MAJOR_CITIES.forEach((city) => {
      const circle = layerLights.append('circle')
        .attr('r', 2.5)
        .attr('fill', 'url(#city-glow)')
        .attr('opacity', 0)
        .style('pointer-events', 'none');
      cityLightElements.push({ city, circle });
    });
  }

  /**
   * Обновление видимости огней (день/ночь по d3.geoDistance)
   * d3.geoDistance принимает [lon, lat] в градусах, возвращает радианы
   */
  function updateCityLights() {
    if (!projection || !cityLightElements) return;
    const geoDist = d3.geoDistance || geoDistanceFallback;
    if (!geoDist) return;

    const sun = getSunPosition(new Date());
    const sunPt = [sun.lon, sun.lat];
    const nightThreshold = Math.PI / 2;

    cityLightElements.forEach(({ city, circle }) => {
      const cityPt = [city.lon, city.lat];
      const dist = geoDist(cityPt, sunPt);
      const isNight = dist > nightThreshold;
      const xy = projection([city.lon, city.lat]);
      if (xy) {
        circle.attr('cx', xy[0]).attr('cy', xy[1]);
      }
      circle.attr('opacity', isNight ? 0.85 : 0);
    });
  }

  /**
   * Быстрый цикл (1 с): наблюдатель, спутник, орбиты, footprint
   */
  function fastLoop() {
    if (!svg || !g || !projection || !path) return;

    const noradIds = typeof window.getMapNoradIds === 'function' ? window.getMapNoradIds() : [];
    const observer = typeof window.getMapObserver === 'function' ? window.getMapObserver() : null;
    const isAllMode = noradIds.length > 1;

    if (observer) {
      const xy = projection([observer.longitude, observer.latitude]);
      if (xy) {
        observerMarker.attr('cx', xy[0]).attr('cy', xy[1]).style('display', 'block');
      }
    } else {
      observerMarker.style('display', 'none');
    }

    layerOrbits.selectAll('*').remove();
    layerFootprint.selectAll('*').remove();
    layerMarkers.selectAll('.sat-marker').remove();

    if (!window.SatContactTle || !noradIds.length) return;

    noradIds.forEach((noradId) => {
      const pos = typeof window.getSatellitePosition === 'function'
        ? window.getSatellitePosition(noradId)
        : null;

      if (isAllMode) {
        if (pos) {
          const xy = projection([pos.lon, pos.lat]);
          if (xy) {
            layerMarkers.append('circle')
              .attr('class', 'sat-marker')
              .attr('cx', xy[0])
              .attr('cy', xy[1])
              .attr('r', 5)
              .attr('fill', COLORS.marker)
              .attr('stroke', '#fff')
              .attr('stroke-width', 1);
          }
        }
      } else {
        const trajectory = window.SatContactTle.getTrajectory24h(noradId);
        if (trajectory && trajectory.length > 0) {
          const lineString = { type: 'LineString', coordinates: trajectory };
          layerOrbits.append('path')
            .datum(lineString)
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', COLORS.orbit)
            .attr('stroke-width', 1.5);
        }

        if (pos) {
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
            const circle = d3.geoCircle()
              .center([pos.lon, pos.lat])
              .radius(radiusDeg)();
            layerFootprint.append('path')
              .datum(circle)
              .attr('d', path)
              .attr('fill', COLORS.footprint)
              .attr('stroke', COLORS.orbit)
              .attr('stroke-width', 0.5);
          }

          const xy = projection([pos.lon, pos.lat]);
          if (xy) {
            layerMarkers.append('circle')
              .attr('class', 'sat-marker')
              .attr('cx', xy[0])
              .attr('cy', xy[1])
              .attr('r', 6)
              .attr('fill', COLORS.marker)
              .attr('stroke', '#fff')
              .attr('stroke-width', 2);
          }
        }
      }
    });
  }

  /**
   * Медленный цикл (60 с): огни городов
   */
  function slowLoop() {
    updateCityLights();
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
    if (resizeObserver && svg && svg.node()) {
      resizeObserver.unobserve(svg.node().parentElement);
    }
    resizeObserver = null;
    if (svg) {
      svg.remove();
      svg = null;
    }
    g = null;
    layerOcean = null;
    layerLand = null;
    layerLandBorders = null;
    layerLights = null;
    layerOrbits = null;
    layerFootprint = null;
    layerMarkers = null;
    landPath = null;
    bordersPath = null;
    projection = null;
    path = null;
    topology = null;
    countriesGeo = null;
    cityLightElements = null;
  }

  window.SatContactMapRender = {
    init: initD3Map,
    update: fastLoop,
    destroy: destroyMapRender
  };
})();
