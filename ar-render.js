/**
 * SatContact — Модуль 3: AR Canvas-рендерер
 * Pseudo-3D (overview) и Real-3D (focus) проекция, маркеры, орбитные линии, HUD-оверлей.
 */
(function () {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  var canvas, ctx;
  var width = 0, height = 0, dpr = 1;

  var PALETTE = [];
  var MARKER_SIZE = 26;
  var HIT_RADIUS = 34;
  var ORBIT_LINE_WIDTH_OVERVIEW = 1.5;
  var ORBIT_LINE_WIDTH_FOCUS = 2.5;
  var LABEL_FONT = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  var HUD_FONT = '11px "Courier New", Consolas, monospace';
  var GLOW_RADIUS = 18;

  var lastMarkerPositions = [];

  /* ==========================================================================
     Проекция AZ/EL → экранные координаты
     ========================================================================== */

  /**
   * Pseudo-3D: простое линейное отображение дельты AZ/EL на экран.
   * Допускает небольшие искажения по краям (by design).
   */
  function projectPseudo3D(satAz, satEl, camAz, camEl, fovH, fovV, w, h) {
    var dAz = satAz - camAz;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    var dEl = satEl - camEl;

    var x = w / 2 + (dAz / fovH) * w;
    var y = h / 2 - (dEl / fovV) * h;
    var visible = Math.abs(dAz) < fovH * 1.2 && Math.abs(dEl) < fovV * 1.2;
    return { x: x, y: y, visible: visible };
  }

  /**
   * Real-3D: строгая трансформация через матрицу ориентации устройства + перспективная проекция.
   */
  function projectReal3D(satAz, satEl, orientationMatrix, fovH, fovV, w, h) {
    var azR = satAz * DEG;
    var elR = satEl * DEG;
    var cosEl = Math.cos(elR);

    var ex = cosEl * Math.sin(azR);
    var ey = cosEl * Math.cos(azR);
    var ez = Math.sin(elR);

    var m = orientationMatrix;
    var dx = m[0] * ex + m[3] * ey + m[6] * ez;
    var dy = m[1] * ex + m[4] * ey + m[7] * ez;
    var dz = m[2] * ex + m[5] * ey + m[8] * ez;

    var cz = -dz;
    if (cz <= 0.01) return { x: 0, y: 0, visible: false };

    var focalX = (w / 2) / Math.tan((fovH / 2) * DEG);
    var focalY = (h / 2) / Math.tan((fovV / 2) * DEG);
    var x = w / 2 + (dx / cz) * focalX;
    var y = h / 2 - (dy / cz) * focalY;
    var visible = x > -100 && x < w + 100 && y > -100 && y < h + 100;
    return { x: x, y: y, visible: visible };
  }

  /* ==========================================================================
     Рисование: иконка спутника (адаптация drawSatelliteIcon из map-render.js)
     ========================================================================== */
  function drawSatelliteIcon(cx, cy, size, fillColor, strokeColor) {
    var half = size / 2;
    var bw = size * 0.3;
    var bh = size * 0.5;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';

    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

    var pw = size * 0.38;
    var ph = size * 0.22;
    ctx.fillRect(-half, -ph / 2, pw, ph);
    ctx.strokeRect(-half, -ph / 2, pw, ph);
    ctx.fillRect(half - pw, -ph / 2, pw, ph);
    ctx.strokeRect(half - pw, -ph / 2, pw, ph);

    ctx.beginPath();
    ctx.arc(0, -bh / 2 - size * 0.12, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /* ==========================================================================
     Рисование: маркер + подпись
     ========================================================================== */
  function drawMarker(x, y, sat, colorIdx, isFocused, freqMhz) {
    var pal = PALETTE[colorIdx % PALETTE.length] || PALETTE[0];
    var sz = isFocused ? MARKER_SIZE + 4 : MARKER_SIZE;

    ctx.save();
    ctx.shadowColor = pal.marker;
    ctx.shadowBlur = GLOW_RADIUS;
    drawSatelliteIcon(x, y, sz, pal.marker, 'rgba(255,255,255,0.7)');
    ctx.restore();

    var label = sat.name || sat.noradId;
    var dist = sat.distance ? Math.round(sat.distance) + ' \u043A\u043C' : '';
    var text;
    if (isFocused) {
      var freqStr = freqMhz ? freqMhz + ' MHz' : '';
      text = '[' + label + ']' + (freqStr ? ' ' + freqStr : '') + (dist ? ' (' + dist + ')' : '');
    } else {
      text = label + (dist ? '  (' + dist + ')' : '');
    }

    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.fillText(text, x + sz / 2 + 6, y);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  /* ==========================================================================
     Рисование: орбитная линия
     ========================================================================== */
  function drawOrbitLine(points, projFn, color, lineWidth) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;

    ctx.beginPath();
    var started = false;
    for (var i = 0; i < points.length; i++) {
      var p = projFn(points[i].az, points[i].el);
      if (!p.visible) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ==========================================================================
     Главные функции отрисовки
     ========================================================================== */

  function drawOverview(params) {
    var sats = params.satellites;
    var trajs = params.overviewTrajectories;
    var camAz = params.cameraAz;
    var camEl = params.cameraEl;
    var fw = params.fovH;
    var fv = params.fovV;

    function proj(az, el) {
      return projectPseudo3D(az, el, camAz, camEl, fw, fv, width, height);
    }

    lastMarkerPositions = [];

    for (var i = 0; i < sats.length; i++) {
      var sat = sats[i];
      var traj = trajs[sat.noradId];
      if (traj) {
        var pal = PALETTE[i % PALETTE.length] || PALETTE[0];
        drawOrbitLine(traj, proj, pal.orbit, ORBIT_LINE_WIDTH_OVERVIEW);
      }
    }

    for (var j = 0; j < sats.length; j++) {
      var s = sats[j];
      var sp = proj(s.azimuth, s.elevation);
      if (sp.visible) {
        drawMarker(sp.x, sp.y, s, j, false);
        lastMarkerPositions.push({ noradId: s.noradId, x: sp.x, y: sp.y });
      }
    }
  }

  function drawFocusMode(params) {
    var sats = params.satellites;
    var traj = params.focusedTrajectory;
    var fid = params.focusedId;
    var om = params.orientationMatrix;
    var fw = params.fovH;
    var fv = params.fovV;
    var camAz = params.cameraAz;
    var camEl = params.cameraEl;
    var freqMap = params.noradIdToFreq || {};

    lastMarkerPositions = [];

    function proj(az, el) {
      return projectReal3D(az, el, om, fw, fv, width, height);
    }

    function projFallback(az, el) {
      return projectPseudo3D(az, el, camAz, camEl, fw, fv, width, height);
    }

    var usedProj = isOrientationMatrixValid(om) ? proj : projFallback;

    var focSat = null;
    var focIdx = 0;
    for (var i = 0; i < sats.length; i++) {
      if (sats[i].noradId === fid) { focSat = sats[i]; focIdx = i; break; }
    }

    if (traj && traj.length > 1) {
      var pal = PALETTE[focIdx % PALETTE.length] || PALETTE[0];
      drawOrbitLine(traj, usedProj, pal.orbit, ORBIT_LINE_WIDTH_FOCUS);
    }

    if (focSat) {
      var sp = usedProj(focSat.azimuth, focSat.elevation);
      if (sp.visible) {
        drawMarker(sp.x, sp.y, focSat, focIdx, true, freqMap[focSat.noradId]);
        lastMarkerPositions.push({ noradId: focSat.noradId, x: sp.x, y: sp.y });
      }
    }
  }

  function isOrientationMatrixValid(m) {
    if (!m || m.length < 9) return false;
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += Math.abs(m[i]);
    return sum > 0.01;
  }

  /* ==========================================================================
     Public API
     ========================================================================== */

  function init(canvasEl) {
    canvas = canvasEl;
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    PALETTE = window.SatContactOrbitPalette || [
      { orbit: 'rgba(82, 136, 193, 0.75)', marker: '#5288c1' }
    ];
    onResize();
    window.addEventListener('resize', onResize);
  }

  function destroy() {
    window.removeEventListener('resize', onResize);
    lastMarkerPositions = [];
    canvas = null;
    ctx = null;
  }

  function onResize() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(params) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (params.mode === 'overview') {
      drawOverview(params);
    } else if (params.mode === 'focus') {
      drawFocusMode(params);
    }
  }

  function drawDriftWarning() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, width, height);

    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 200, 50, 0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.fillText('\u26A0 \u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0430', width / 2, height / 2 - 14);

    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('\u041D\u0430\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u0430\u043C\u0435\u0440\u0443 \u043D\u0430 \u0421\u043E\u043B\u043D\u0446\u0435, \u041B\u0443\u043D\u0443 \u0438\u043B\u0438 \u041F\u043E\u043B\u044F\u0440\u043D\u0443\u044E \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u041A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u0430\u0442\u044C\u00BB', width / 2, height / 2 + 14);
    ctx.restore();
  }

  function hitTest(x, y) {
    for (var i = 0; i < lastMarkerPositions.length; i++) {
      var m = lastMarkerPositions[i];
      var dx = x - m.x;
      var dy = y - m.y;
      if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
        return m.noradId;
      }
    }
    return null;
  }

  window.SatContactArRender = {
    init: init,
    destroy: destroy,
    draw: draw,
    drawDriftWarning: drawDriftWarning,
    hitTest: hitTest
  };
})();
