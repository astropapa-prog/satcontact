/**
 * SatContact — Модуль 3: AR-рендерер (WebGL orbit lines + Canvas2D overlay)
 * Единый Real 3D пайплайн для до 30 спутников.
 */
(function () {
  'use strict';

  var DEG = Math.PI / 180;

  /* ====== DOM / контексты ====== */
  var canvasGL, gl;
  var canvas2D, ctx;
  var width = 0, height = 0, dpr = 1;
  var webglAvailable = false;

  /* ====== Палитра ====== */
  var PALETTE = [];

  /* ====== Константы отрисовки ====== */
  var MARKER_SIZE = 26;
  var HIT_RADIUS = 34;
  var LABEL_FONT = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  /* ====== Состояние маркеров для hit-test ====== */
  var lastMarkerPositions = [];

  /* ====== WebGL: шейдеры, программа, буферы ====== */
  var glProgram = null;
  var glVBO = null;
  var uOrientation, uFocal, uResolution, uColor, uAlpha;
  var aAzEl;
  var MAX_POINTS = 30 * 130;
  var orbitSegments = [];

  /* ==========================================================================
     WebGL Шейдеры (inline)
     ========================================================================== */
  var VERT_SRC = [
    'attribute vec2 a_azEl;',
    'uniform mat3 u_orientation;',
    'uniform vec2 u_focal;',
    'uniform vec2 u_resolution;',
    'varying float v_behind;',
    'void main() {',
    '  float az = a_azEl.x * 0.017453292519943295;',
    '  float el = a_azEl.y * 0.017453292519943295;',
    '  float cosEl = cos(el);',
    '  vec3 world = vec3(cosEl * sin(az), cosEl * cos(az), sin(el));',
    '  vec3 cam = u_orientation * world;',
    '  float cz = -cam.z;',
    '  v_behind = step(cz, 0.01);',
    '  if (cz <= 0.01) {',
    '    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);',
    '    return;',
    '  }',
    '  float ndcX = (cam.x / cz) * u_focal.x / (u_resolution.x * 0.5);',
    '  float ndcY = (cam.y / cz) * u_focal.y / (u_resolution.y * 0.5);',
    '  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG_SRC = [
    'precision mediump float;',
    'uniform vec4 u_color;',
    'uniform float u_alpha;',
    'varying float v_behind;',
    'void main() {',
    '  if (v_behind > 0.5) discard;',
    '  gl_FragColor = vec4(u_color.rgb, u_color.a * u_alpha);',
    '}'
  ].join('\n');

  /* ==========================================================================
     WebGL: инициализация
     ========================================================================== */
  function compileShader(type, src) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('AR Shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function initGL(canvasElement) {
    canvasGL = canvasElement;
    if (!canvasGL) return false;
    try {
      gl = canvasGL.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
        || canvasGL.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    } catch (_) { gl = null; }
    if (!gl) return false;

    var vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    var fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) { gl = null; return false; }

    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vs);
    gl.attachShader(glProgram, fs);
    gl.linkProgram(glProgram);
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
      console.error('AR Program link error:', gl.getProgramInfoLog(glProgram));
      gl = null;
      return false;
    }

    aAzEl = gl.getAttribLocation(glProgram, 'a_azEl');
    uOrientation = gl.getUniformLocation(glProgram, 'u_orientation');
    uFocal = gl.getUniformLocation(glProgram, 'u_focal');
    uResolution = gl.getUniformLocation(glProgram, 'u_resolution');
    uColor = gl.getUniformLocation(glProgram, 'u_color');
    uAlpha = gl.getUniformLocation(glProgram, 'u_alpha');

    glVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glVBO);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_POINTS * 2 * 4, gl.DYNAMIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return true;
  }

  function destroyGL() {
    if (gl && glVBO) gl.deleteBuffer(glVBO);
    if (gl && glProgram) gl.deleteProgram(glProgram);
    glVBO = null;
    glProgram = null;
    gl = null;
  }

  /* ==========================================================================
     Проекция Real 3D (JS — для Canvas2D маркеров + WebGL fallback)
     ========================================================================== */
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

  function isOrientationMatrixValid(m) {
    if (!m || m.length < 9) return false;
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += Math.abs(m[i]);
    return sum > 0.01;
  }

  /* ==========================================================================
     Обновление VBO из данных траекторий Worker
     ========================================================================== */
  function updateTrajectories(allTrajectories) {
    orbitSegments = [];
    if (!allTrajectories) return;

    var floats = [];
    var offset = 0;
    var ids = Object.keys(allTrajectories);

    for (var i = 0; i < ids.length; i++) {
      var pts = allTrajectories[ids[i]];
      if (!pts || pts.length < 2) continue;
      var count = Math.min(pts.length, 130);
      for (var j = 0; j < count; j++) {
        floats.push(pts[j].az, pts[j].el);
      }
      orbitSegments.push({ noradId: ids[i], offset: offset, count: count, colorIdx: i });
      offset += count;
    }

    if (webglAvailable && gl && glVBO) {
      var data = new Float32Array(floats);
      gl.bindBuffer(gl.ARRAY_BUFFER, glVBO);
      if (data.length <= MAX_POINTS * 2) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      } else {
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      }
    }
  }

  /* ==========================================================================
     Рисование: иконка спутника (из map-render.js)
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
     Рисование Canvas2D: маркер + подпись (без shadowBlur для glow)
     ========================================================================== */
  function drawMarker(x, y, sat, colorIdx, isFocused, freqMhz) {
    var pal = PALETTE[colorIdx % PALETTE.length] || PALETTE[0];
    var sz = isFocused ? MARKER_SIZE + 4 : MARKER_SIZE;

    drawSatelliteIcon(x, y, sz, pal.marker, 'rgba(255,255,255,0.7)');

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
     Canvas2D fallback: orbit lines (when WebGL unavailable)
     ========================================================================== */
  function drawOrbitLineFallback(points, orientationMatrix, fovH, fovV, color) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.75;

    ctx.beginPath();
    var started = false;
    for (var i = 0; i < points.length; i++) {
      var p = projectReal3D(points[i].az, points[i].el, orientationMatrix, fovH, fovV, width, height);
      if (!p.visible) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ==========================================================================
     WebGL: отрисовка орбитных линий
     ========================================================================== */
  function drawGLOrbits(params) {
    if (!gl || !glProgram) return;

    var om = params.orientationMatrix;
    if (!isOrientationMatrixValid(om)) return;

    gl.viewport(0, 0, canvasGL.width, canvasGL.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(glProgram);

    gl.uniformMatrix3fv(uOrientation, false, new Float32Array([
      om[0], om[1], om[2],
      om[3], om[4], om[5],
      om[6], om[7], om[8]
    ]));

    var focalX = (width / 2) / Math.tan((params.fovH / 2) * DEG);
    var focalY = (height / 2) / Math.tan((params.fovV / 2) * DEG);
    gl.uniform2f(uFocal, focalX, focalY);
    gl.uniform2f(uResolution, width, height);

    gl.bindBuffer(gl.ARRAY_BUFFER, glVBO);
    gl.enableVertexAttribArray(aAzEl);
    gl.vertexAttribPointer(aAzEl, 2, gl.FLOAT, false, 0, 0);

    var focusedId = params.focusedId;
    var isFocusMode = params.mode === 'focus' && focusedId;

    for (var i = 0; i < orbitSegments.length; i++) {
      var seg = orbitSegments[i];
      if (isFocusMode && seg.noradId !== focusedId) continue;

      var pal = PALETTE[seg.colorIdx % PALETTE.length] || PALETTE[0];
      var rgb = parseColor(pal.orbit);

      // Pass 1: wide glow line
      gl.lineWidth(1);
      gl.uniform4f(uColor, rgb[0], rgb[1], rgb[2], 0.3);
      gl.uniform1f(uAlpha, 1.0);
      gl.drawArrays(gl.LINE_STRIP, seg.offset, seg.count);

      // Pass 2: bright core
      gl.uniform4f(uColor, rgb[0], rgb[1], rgb[2], 0.85);
      gl.drawArrays(gl.LINE_STRIP, seg.offset, seg.count);
    }

    gl.disableVertexAttribArray(aAzEl);
  }

  var colorCache = {};
  function parseColor(rgbaStr) {
    if (colorCache[rgbaStr]) return colorCache[rgbaStr];
    var m = rgbaStr.match(/[\d.]+/g);
    if (!m || m.length < 3) return [1, 1, 1];
    var result = [parseFloat(m[0]) / 255, parseFloat(m[1]) / 255, parseFloat(m[2]) / 255];
    colorCache[rgbaStr] = result;
    return result;
  }

  /* ==========================================================================
     Canvas2D overlay: маркеры + подписи
     ========================================================================== */
  function drawOverlay(params) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    var sats = params.satellites || [];
    var om = params.orientationMatrix;
    var fw = params.fovH;
    var fv = params.fovV;
    var focusedId = params.focusedId;
    var isFocusMode = params.mode === 'focus' && focusedId;
    var freqMap = params.noradIdToFreq || {};
    var hasMatrix = isOrientationMatrixValid(om);

    if (!hasMatrix) return;

    lastMarkerPositions = [];

    // In fallback mode (no WebGL), draw orbit lines on Canvas2D
    if (!webglAvailable) {
      var allTrajs = params.allTrajectories || {};
      var ids = Object.keys(allTrajs);
      for (var t = 0; t < ids.length; t++) {
        if (isFocusMode && ids[t] !== focusedId) continue;
        var pal = PALETTE[t % PALETTE.length] || PALETTE[0];
        drawOrbitLineFallback(allTrajs[ids[t]], om, fw, fv, pal.orbit);
      }
    }

    for (var i = 0; i < sats.length; i++) {
      var sat = sats[i];
      if (isFocusMode && sat.noradId !== focusedId) continue;

      var sp = projectReal3D(sat.azimuth, sat.elevation, om, fw, fv, width, height);
      if (sp.visible) {
        var isFocused = (sat.noradId === focusedId);
        drawMarker(sp.x, sp.y, sat, i, isFocused, freqMap[sat.noradId]);
        lastMarkerPositions.push({ noradId: sat.noradId, x: sp.x, y: sp.y });
      }
    }
  }

  /* ==========================================================================
     Drift Warning overlay
     ========================================================================== */
  function drawDriftWarning() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (webglAvailable && gl) {
      gl.viewport(0, 0, canvasGL.width, canvasGL.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

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

  /* ==========================================================================
     Hit-test
     ========================================================================== */
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

  /* ==========================================================================
     Resize
     ========================================================================== */
  function onResize() {
    dpr = window.devicePixelRatio || 1;

    if (canvas2D) {
      var rect2d = canvas2D.getBoundingClientRect();
      width = rect2d.width;
      height = rect2d.height;
      canvas2D.width = width * dpr;
      canvas2D.height = height * dpr;
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (canvasGL) {
      var rectGL = canvasGL.getBoundingClientRect();
      canvasGL.width = rectGL.width * dpr;
      canvasGL.height = rectGL.height * dpr;
    }
  }

  /* ==========================================================================
     Public API
     ========================================================================== */
  function init(canvasGLEl, canvas2DEl) {
    canvas2D = canvas2DEl;
    if (canvas2D) {
      ctx = canvas2D.getContext('2d');
    }

    PALETTE = window.SatContactOrbitPalette || [
      { orbit: 'rgba(82, 136, 193, 0.75)', marker: '#5288c1' }
    ];

    webglAvailable = initGL(canvasGLEl);
    if (!webglAvailable) {
      console.warn('ar-render: WebGL unavailable, using Canvas2D fallback for orbit lines');
    }

    onResize();
    window.addEventListener('resize', onResize);
  }

  function destroy() {
    window.removeEventListener('resize', onResize);
    lastMarkerPositions = [];
    orbitSegments = [];
    destroyGL();
    canvas2D = null;
    ctx = null;
    canvasGL = null;
  }

  function draw(params) {
    if (!params) return;

    if (params.driftPaused) {
      drawDriftWarning();
      return;
    }

    if (webglAvailable) {
      drawGLOrbits(params);
    }
    drawOverlay(params);
  }

  window.SatContactArRender = {
    init: init,
    destroy: destroy,
    draw: draw,
    drawDriftWarning: drawDriftWarning,
    hitTest: hitTest,
    updateTrajectories: updateTrajectories
  };
})();
