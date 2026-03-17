/**
 * SatContact — Модуль 2: D3-картография (map-render.js)
 * Отрисовка Земли, орбит, footprint, маркеров спутников
 */

(function () {
  'use strict';

  const WORLD_URLS = ['data/world-50m.json', 'data/countries-50m.json'];
  const EARTH_RADIUS_KM = 6378.135;
  const COLORS = {
    ocean: '#1c242d',
    land: '#212d3b',
    border: 'rgba(255,255,255,0.1)',
    orbit: 'rgba(82, 136, 193, 0.6)',
    footprint: 'rgba(82, 136, 193, 0.15)',
    marker: '#5288c1',
    observer: '#81c784',
    // Дневная карта (светлая)
    dayOcean: '#5b9bd5',
    dayLand: '#e8e0d0',
    dayBorder: 'rgba(0,0,0,0.12)',
    // Ночная тень (Telegram Dark Theme)
    nightOverlay: '#1c242d',
    terminatorLine: 'rgba(255,255,255,0.35)'
  };

  let svg, g, projection, path;
  let oceanRect, landPath, bordersPath, terminatorNightGroup, terminatorLineGroup;
  let orbitsGroup, footprintGroup, markersGroup, observerMarker;
  let resizeObserver = null;
  let topology = null;
  let terminatorIntervalId = null;

  /**
   * Вычисление подсолнечной точки (где Солнце в зените) по системному времени UTC.
   * Без внешних API и TLE. Математика: вращение Земли + наклон оси.
   * @param {Date} date — текущее время (UTC)
   * @returns {{ lon: number, lat: number }} подсолнечная точка в градусах
   */
  function getSubsolarPoint(date) {
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const lon = 180 - 15 * utcHours;
    const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
    const dayOfYear = Math.floor((date - startOfYear) / 86400000);
    const declination = 23.45 * Math.sin((2 * Math.PI / 365.25) * (dayOfYear - 81));
    return { lon: ((lon + 540) % 360) - 180, lat: declination };
  }

  /**
   * Антисолнечная точка (центр ночного полушария)
   */
  function getAntisolarPoint(subsolar) {
    return {
      lon: subsolar.lon + 180 > 180 ? subsolar.lon - 180 : subsolar.lon + 180,
      lat: -subsolar.lat
    };
  }

  /**
   * Радиус footprint в градусах (половина угла видимости с орбиты)
   * height_km — высота спутника в км
   */
  function footprintRadiusDeg(heightKm) {
    if (!heightKm || heightKm <= 0) return 0;
    const halfAngle = Math.asin(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + heightKm));
    return (halfAngle * 180) / Math.PI;
  }

  /**
   * TopoJSON → GeoJSON (поддержка topojson и topojson-client)
   */
  function topoToGeo(topology, objectName) {
    const obj = topology.objects[objectName];
    if (!obj) return null;
    const topo = window.topojson || window.topojsonClient || {};
    const featureFn = typeof topo === 'function' ? topo : topo.feature;
    if (!featureFn) return null;
    return featureFn(topology, obj);
  }

  /**
   * Инициализация D3-карты
   */
  async function initMapRender(container) {
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

    g = svg.append('g');

    // Океан (дневной фон — светлый)
    oceanRect = g.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', COLORS.dayOcean);

    // Загрузка TopoJSON (пробуем world-50m и countries-50m)
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
    if (!topology) console.warn('map-render: не удалось загрузить карту (world-50m.json или countries-50m.json)');

    if (topology) {
      const countries = topoToGeo(topology, 'countries') || topoToGeo(topology, 'land');
      if (countries) {
        landPath = g.append('path')
          .datum(countries)
          .attr('fill', COLORS.dayLand)
          .attr('d', path);

        bordersPath = g.append('path')
          .datum(countries)
          .attr('fill', 'none')
          .attr('stroke', COLORS.dayBorder)
          .attr('stroke-width', 0.5)
          .attr('d', path);
      }
    }

    // Терминатор: ночная тень + линия границы день/ночь
    terminatorNightGroup = g.append('g').attr('class', 'terminator-night');
    terminatorLineGroup = g.append('g').attr('class', 'terminator-line');

    orbitsGroup = g.append('g').attr('class', 'orbits');
    footprintGroup = g.append('g').attr('class', 'footprints');
    markersGroup = g.append('g').attr('class', 'markers');

    observerMarker = markersGroup.append('circle')
      .attr('r', 4)
      .attr('fill', COLORS.observer)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('display', 'none');

    resizeObserver = new ResizeObserver(() => updateMapRender());
    resizeObserver.observe(container);

    updateMapRender();
    updateTerminatorPaths();

    terminatorIntervalId = setInterval(updateTerminatorPaths, 500);
  }

  /**
   * Обновление терминатора (ночная тень + линия). Вызывается при resize и по таймеру.
   */
  function updateTerminatorPaths() {
    if (!path || !terminatorNightGroup || !terminatorLineGroup) return;

    const subsolar = getSubsolarPoint(new Date());
    const antisolar = getAntisolarPoint(subsolar);

    const nightCap = d3.geoCircle()
      .center([antisolar.lon, antisolar.lat])
      .radius(90)
      .precision(2)();

    const terminatorCircle = d3.geoCircle()
      .center([subsolar.lon, subsolar.lat])
      .radius(90)
      .precision(2)();

    terminatorNightGroup.selectAll('path').remove();
    terminatorNightGroup.append('path')
      .datum(nightCap)
      .attr('d', path)
      .attr('fill', COLORS.nightOverlay)
      .attr('stroke', 'none');

    terminatorLineGroup.selectAll('path').remove();
    terminatorLineGroup.append('path')
      .datum(terminatorCircle)
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', COLORS.terminatorLine)
      .attr('stroke-width', 1);
  }

  /**
   * Обновление карты (орбиты, footprint, маркеры)
   */
  function updateMapRender() {
    if (!svg || !g || !projection || !path) return;

    const container = svg.node().parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    projection
      .scale(width / (2 * Math.PI))
      .translate([width / 2, height / 2]);

    svg.attr('width', width).attr('height', height);
    if (oceanRect) oceanRect.attr('width', width).attr('height', height);

    if (landPath) landPath.attr('d', path);
    if (bordersPath) bordersPath.attr('d', path);
    updateTerminatorPaths();

    const noradIds = typeof window.getMapNoradIds === 'function' ? window.getMapNoradIds() : [];
    const observer = typeof window.getMapObserver === 'function' ? window.getMapObserver() : null;
    const isAllMode = noradIds.length > 1;

    // Маркер наблюдателя
    if (observer) {
      const xy = projection([observer.longitude, observer.latitude]);
      if (xy) {
        observerMarker
          .attr('cx', xy[0])
          .attr('cy', xy[1])
          .style('display', 'block');
      }
    } else {
      observerMarker.style('display', 'none');
    }

    // Очистка старых орбит, footprint, маркеров
    orbitsGroup.selectAll('*').remove();
    footprintGroup.selectAll('*').remove();
    markersGroup.selectAll('.sat-marker').remove();

    if (!window.SatContactTle || !noradIds.length) return;

    noradIds.forEach((noradId) => {
      const pos = typeof window.getSatellitePosition === 'function'
        ? window.getSatellitePosition(noradId)
        : null;

      if (isAllMode) {
        // Режим «ВСЕ»: только маркер
        if (pos) {
          const xy = projection([pos.lon, pos.lat]);
          if (xy) {
            markersGroup.append('circle')
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
        // Один спутник: орбита, footprint, маркер
        const trajectory = window.SatContactTle.getTrajectory24h(noradId);
        if (trajectory.length > 0) {
          const lineString = { type: 'LineString', coordinates: trajectory };
          orbitsGroup.append('path')
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
            footprintGroup.append('path')
              .datum(circle)
              .attr('d', path)
              .attr('fill', COLORS.footprint)
              .attr('stroke', COLORS.orbit)
              .attr('stroke-width', 0.5);
          }

          const xy = projection([pos.lon, pos.lat]);
          if (xy) {
            markersGroup.append('circle')
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
   * Уничтожение карты
   */
  function destroyMapRender() {
    if (terminatorIntervalId) {
      clearInterval(terminatorIntervalId);
      terminatorIntervalId = null;
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
    oceanRect = null;
    landPath = null;
    bordersPath = null;
    terminatorNightGroup = null;
    terminatorLineGroup = null;
    projection = null;
    path = null;
    topology = null;
  }

  window.SatContactMapRender = {
    init: initMapRender,
    update: updateMapRender,
    destroy: destroyMapRender
  };
})();
