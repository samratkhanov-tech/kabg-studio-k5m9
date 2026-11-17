/*
 * Songlap Kids Activity Book Generator — PNG export.
 *
 * Each activity page is drawn from its DATA (never a DOM screenshot)
 * by a pure "draw plan" builder: buildPlan(page, opts) returns
 * { type, width, height, ops: [...] } where ops are abstract canvas
 * commands. renderPlan(canvas, plan) executes the ops on a 2D
 * context. Because the plan layer is pure, the Node tests can verify
 * geometry and content without a browser; only renderPlan /
 * downloadPNG need the DOM.
 *
 * Artwork ops execute the same abstract path commands
 * (KAB.shapePathCmds) that render.js turns into SVG, so the PNG
 * matches the screen and print views.
 *
 * Resolution: the canvas is 2550px wide = 8.5in at 300 DPI.
 */
(function (global) {
  'use strict';

  var INK = '#14232b';
  var FAINT = '#b9c6cc';
  var GOLD = '#ffd166';
  var GREEN = '#2a7f62';
  var RED = '#e63946';
  var GRAY = '#5a707a';
  var WIDTH = 2550;        // 8.5in at 300 DPI
  var MARGIN = 130;
  var FONT = 'Arial, Helvetica, sans-serif';
  var TRACE_FONT = "'Comic Sans MS','Chalkboard SE','Segoe Print',cursive";

  function newPlan(type, title) {
    return { type: type, title: title || '', width: WIDTH, height: 0, ops: [{ t: 'bg', color: '#ffffff' }] };
  }
  function text(plan, x, y, str, size, opts) {
    opts = opts || {};
    plan.ops.push({
      t: 'text', x: x, y: y, str: String(str), size: size, font: opts.font || FONT,
      weight: opts.weight || 400, color: opts.color || INK,
      align: opts.align || 'center'
    });
  }
  function line(plan, x1, y1, x2, y2, lw, color, extra) {
    var op = { t: 'line', x1: x1, y1: y1, x2: x2, y2: y2, lw: lw, color: color };
    if (extra) for (var k in extra) op[k] = extra[k];
    plan.ops.push(op);
  }
  /* A design/icon shape as a path op in canvas space. tx/ty/scale map
   * the shape's own coordinates onto the canvas; rot rotates about the
   * local centre (cx, cy) before scaling (matches render.js). */
  function pathOp(plan, shapeObj, tx, ty, scale, style) {
    var op = {
      t: 'path', cmds: KAB.shapePathCmds(shapeObj),
      tx: tx, ty: ty, scale: scale,
      fill: style.fill || null, stroke: style.stroke || null,
      lw: style.lw || 5.5
    };
    if (style.rot) { op.rot = style.rot; op.cx = style.cx == null ? 50 : style.cx; op.cy = style.cy == null ? 50 : style.cy; }
    plan.ops.push(op);
  }

  /* Title + Name/Date header. Returns the y where content starts. */
  function planHeader(plan, page, opts) {
    var title = page.title + (opts.solution ? ' — Solution' : '');
    text(plan, MARGIN, 105, title, 88, { weight: 800, align: 'left' });
    text(plan, MARGIN, 215,
      'Name: ______________________________        Date: ________________',
      54, { align: 'left', color: GRAY });
    line(plan, MARGIN, 268, WIDTH - MARGIN, 268, 6, INK);
    var y = 330;
    if (page.instructions) {
      text(plan, MARGIN, y + 26, page.instructions, 46, { align: 'left', color: GRAY });
      y += 92;
    }
    return y;
  }

  /* ---------- Maze ---------- */
  function planMaze(page, opts) {
    var plan = newPlan('maze', page.title);
    var y0 = planHeader(plan, page, opts);
    var cell = (WIDTH - MARGIN * 2) / page.cols;
    var mx = MARGIN, my = y0;
    if (opts.solution && page.path) {
      var pts = page.path.map(function (idx) {
        var r = Math.floor(idx / page.cols), c = idx % page.cols;
        return [mx + (c + 0.5) * cell, my + (r + 0.5) * cell];
      });
      plan.ops.push({ t: 'poly', pts: pts, stroke: RED, lw: cell * 0.32, alpha: 0.75 });
    }
    for (var r = 0; r < page.rows; r++) {
      for (var c = 0; c < page.cols; c++) {
        var w = page.walls[r * page.cols + c];
        var x = mx + c * cell, y = my + r * cell;
        if (w & 1) line(plan, x, y, x + cell, y, 7, INK);
        if (w & 8) line(plan, x, y, x, y + cell, 7, INK);
        if (c === page.cols - 1 && (w & 2)) line(plan, x + cell, y, x + cell, y + cell, 7, INK);
        if (r === page.rows - 1 && (w & 4)) line(plan, x, y + cell, x + cell, y + cell, 7, INK);
      }
    }
    plan.ops.push({ t: 'frame', x: mx, y: my, w: page.cols * cell, h: page.rows * cell, lw: 12, color: INK });
    text(plan, mx + cell * 0.5, my + cell * 0.52, '🚀', cell * 0.72, {});
    text(plan, mx + (page.cols - 0.5) * cell, my + (page.rows - 0.5) * cell + cell * 0.04, '⭐', cell * 0.72, {});
    plan.height = my + page.rows * cell + MARGIN;
    return plan;
  }

  /* ---------- Word Search ---------- */
  function planWordSearch(page, opts) {
    var plan = newPlan('wordsearch', page.title);
    var y0 = planHeader(plan, page, opts);
    var cell = (WIDTH - MARGIN * 2) / page.size;
    var gx = MARGIN, gy = y0;
    if (opts.solution) {
      page.placements.forEach(function (p) {
        line(plan,
          gx + (p.col + 0.5) * cell, gy + (p.row + 0.5) * cell,
          gx + (p.col + p.dc * (p.word.length - 1) + 0.5) * cell,
          gy + (p.row + p.dr * (p.word.length - 1) + 0.5) * cell,
          cell * 0.66, GOLD, { alpha: 0.65, cap: 'round' });
      });
    }
    for (var i = 0; i <= page.size; i++) {
      line(plan, gx + i * cell, gy, gx + i * cell, gy + page.size * cell, 4, FAINT);
      line(plan, gx, gy + i * cell, gx + page.size * cell, gy + i * cell, 4, FAINT);
    }
    for (var r = 0; r < page.size; r++) {
      for (var c = 0; c < page.size; c++) {
        text(plan, gx + (c + 0.5) * cell, gy + (r + 0.54) * cell, page.grid[r][c],
          cell * 0.52, { weight: 700 });
      }
    }
    plan.ops.push({ t: 'frame', x: gx, y: gy, w: page.size * cell, h: page.size * cell, lw: 9, color: INK });
    var y = gy + page.size * cell + 110;
    text(plan, MARGIN, y, 'Find these words:', 54, { align: 'left', weight: 700 });
    y += 84;
    var words = page.placements.map(function (p) { return p.word; });
    var perLine = 4, ln;
    for (var s = 0; s < words.length; s += perLine) {
      ln = words.slice(s, s + perLine).join('      ');
      text(plan, MARGIN, y, ln, 52, { align: 'left', weight: 600 });
      y += 78;
    }
    plan.height = y + MARGIN;
    return plan;
  }

  /* ---------- Coloring ---------- */
  function planDesign(plan, designObj, tx, ty, scale, strokeColor, lw) {
    designObj.shapes.forEach(function (s) {
      pathOp(plan, s, tx, ty, scale, {
        fill: s.closed ? '#ffffff' : null, stroke: strokeColor, lw: lw
      });
    });
  }

  function planColoring(page, opts) {
    var plan = newPlan('coloring', page.title);
    var y0 = planHeader(plan, page, opts);
    if (page.customImage && page.customImage.imageData) {
      // the buyer's own picture as line art, fitted to the printable
      // width and its own aspect ratio
      var iw = page.customImage.width, ih = page.customImage.height;
      var w = WIDTH - MARGIN * 2;
      var h = Math.round(w * ih / Math.max(1, iw));
      plan.ops.push({
        t: 'imagedata', imageData: page.customImage.imageData,
        x: MARGIN, y: y0, w: w, h: h
      });
      plan.height = y0 + h + MARGIN;
      return plan;
    }
    var scale = (WIDTH - MARGIN * 2) / 240;
    planDesign(plan, KAB.getDesign(page.designId), MARGIN, y0, scale, INK, 5.5);
    plan.height = y0 + 240 * scale + MARGIN;
    return plan;
  }

  /* ---------- "Your Own Picture" -> line art (pure pixel core) ----------
   * The DOM-thin pipeline behind the Coloring tab's uploader:
   * RGBA pixels -> grayscale -> 3x3 blur -> Sobel edges -> threshold
   * to pure black lines on white. Everything here works on raw arrays
   * so Node tests can exercise it without a browser; app.js only adds
   * FileReader / Image / canvas plumbing around it. */

  function imageGray(rgba, w, h) {
    var gray = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var a = rgba[i * 4 + 3] / 255;
      var lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      gray[i] = a * lum + (1 - a) * 255; // transparent pixels sit on white
    }
    return gray;
  }

  function blur3x3(gray, w, h) {
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = Math.min(h - 1, Math.max(0, y + dy));
          for (var dx = -1; dx <= 1; dx++) {
            var xx = Math.min(w - 1, Math.max(0, x + dx));
            sum += gray[yy * w + xx];
          }
        }
        out[y * w + x] = sum / 9;
      }
    }
    return out;
  }

  function sobelEdges(gray, w, h) {
    var out = new Float32Array(w * h);
    function px(x, y) {
      x = Math.min(w - 1, Math.max(0, x));
      y = Math.min(h - 1, Math.max(0, y));
      return gray[y * w + x];
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var gx = -px(x - 1, y - 1) - 2 * px(x - 1, y) - px(x - 1, y + 1)
               + px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1);
        var gy = -px(x - 1, y - 1) - 2 * px(x, y - 1) - px(x + 1, y - 1)
               + px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1);
        out[y * w + x] = Math.min(255, Math.hypot(gx, gy) / 4);
      }
    }
    return out;
  }

  /* Detail slider (0-100) -> edge threshold. More detail = a lower
     threshold = more lines kept. The DEFAULT is 70: at the old
     default of 50 only the strongest-contrast edges of a typical
     colourful picture survived the threshold, so a buyer's first
     render showed only part of their picture; 70 sits at the foot
     of the range where the whole picture appears. */
  function thresholdFromDetail(detail) {
    var d = Math.max(0, Math.min(100, detail == null ? 70 : detail));
    return Math.round(235 - d * 2.05);
  }

  function edgesToLineArt(edge, w, h, threshold) {
    var out = new Uint8ClampedArray(w * h * 4);
    for (var i = 0; i < w * h; i++) {
      var v = edge[i] >= threshold ? 0 : 255;
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    return out;
  }

  /* Full pipeline split in two so the Detail slider can re-threshold
     from the cached edge map without re-reading the file. */
  function processImageData(rgba, w, h) {
    var gray = imageGray(rgba, w, h);
    var edge = sobelEdges(blur3x3(gray, w, h), w, h);
    return { gray: gray, edge: edge, width: w, height: h };
  }

  function imageToLineArt(rgba, w, h, detail) {
    var p = processImageData(rgba, w, h);
    var t = thresholdFromDetail(detail);
    return { data: edgesToLineArt(p.edge, w, h, t), width: w, height: h, threshold: t };
  }

  /* Working-canvas size for an uploaded picture: cap the long side
   * at maxSide, never upscale, keep the aspect ratio. A pure function
   * of the source's natural size ONLY — the same file always yields
   * the same canvas size (and therefore the same line art) on every
   * run, regardless of decode timing. */
  function fitImageSize(w, h, maxSide) {
    w = Math.max(1, Math.round(w) || 1);
    h = Math.max(1, Math.round(h) || 1);
    var cap = Math.max(1, maxSide || 1200);
    var scale = Math.min(1, cap / Math.max(w, h));
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale))
    };
  }

  /* ---------- Dot-to-Dot ---------- */
  function planDotToDot(page, opts) {
    var plan = newPlan('dottodot', page.title);
    var y0 = planHeader(plan, page, opts);
    var scale = (WIDTH - MARGIN * 2) / 240;
    if (opts.solution) {
      planDesign(plan, KAB.getDesign(page.designId), MARGIN, y0, scale, '#48626e', 3);
    }
    page.points.forEach(function (p, i) {
      var x = MARGIN + p.x * scale, y = y0 + p.y * scale;
      if (i === 0) {
        plan.ops.push({ t: 'ring', x: x, y: y, r: 7.5 * scale, lw: 6, color: GREEN });
      }
      plan.ops.push({ t: 'circle', x: x, y: y, r: 3.1 * scale, color: INK });
      var dx = p.x - 120, dy = p.y - 120;
      var len = Math.hypot(dx, dy) || 1;
      text(plan, x + (dx / len) * 10 * scale, y + (dy / len) * 10 * scale, p.n,
        10.5 * scale, { weight: 700, color: opts.solution ? '#8aa0a9' : '#33505c' });
    });
    plan.height = y0 + 240 * scale + MARGIN;
    return plan;
  }

  /* ---------- Tracing ---------- */
  function planTracing(page, opts) {
    var plan = newPlan('tracing', page.title);
    var y0 = planHeader(plan, page, opts);
    var S = (WIDTH - MARGIN * 2) / 800;
    var rowH = 118 * S;
    page.rows.forEach(function (row, ri) {
      var y = y0 + ri * rowH;
      line(plan, MARGIN + 8 * S, y + 6 * S, MARGIN + 792 * S, y + 6 * S, 4, FAINT);
      line(plan, MARGIN + 8 * S, y + 46 * S, MARGIN + 792 * S, y + 46 * S, 3.5, FAINT, { dash: [18, 15] });
      line(plan, MARGIN + 8 * S, y + 86 * S, MARGIN + 792 * S, y + 86 * S, 4.5, '#8aa0a9');
      var isWord = row.kind === 'word';
      var size = (isWord ? 52 : 78) * S;
      var baseY = y + 84 * S;
      plan.ops.push({
        t: 'textbase', x: MARGIN + 18 * S, y: baseY, str: row.text, size: size,
        font: TRACE_FONT, weight: 700, color: INK, align: 'left'
      });
      var startX = (isWord ? 250 : 140) * S, step = (isWord ? 250 : 106) * S;
      for (var i = 0; i < row.repeats; i++) {
        plan.ops.push({
          t: 'textstroke', x: MARGIN + startX + i * step, y: baseY, str: row.text,
          size: size, font: TRACE_FONT, weight: 700, color: '#a7bcc4',
          lw: 2.6 * S, dash: [0.1, 8 * S]
        });
      }
    });
    plan.height = y0 + page.rows.length * rowH + MARGIN;
    return plan;
  }

  /* ---------- Counting ---------- */
  function planIcon(plan, iconId, schemeKey, x, y, sizePx, rot) {
    var icon = KAB.ICONS[iconId];
    if (!icon) return;
    var colors = KAB.iconColors(iconId, schemeKey);
    var scale = sizePx / 100;
    icon.shapes.forEach(function (sh) {
      pathOp(plan, sh, x, y, scale, {
        fill: sh.closed ? colors[sh.fill] : null,
        stroke: sh.closed ? 'rgba(20,35,43,0.28)' : colors[sh.fill],
        lw: sh.closed ? 2.4 : 4, rot: rot || 0, cx: 50, cy: 50
      });
    });
  }

  function planCounting(page, opts) {
    var plan = newPlan('counting', page.title);
    var y0 = planHeader(plan, page, opts);
    var cols = 2;
    var cellW = (WIDTH - MARGIN * 2) / cols;
    var sceneScale = (cellW - 60) / KAB.COUNT_SCENE.w;
    var sceneH = KAB.COUNT_SCENE.h * sceneScale;
    var blockH = sceneH + 190;
    page.problems.forEach(function (p, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var x = MARGIN + col * cellW + 10;
      var y = y0 + row * blockH;
      text(plan, x + 4, y + 26, (i + 1) + ')', 52, { align: 'left', color: GRAY });
      plan.ops.push({ t: 'rect', x: x + 30, y: y + 56, w: KAB.COUNT_SCENE.w * sceneScale, h: sceneH, color: '#fdfefe' });
      plan.ops.push({ t: 'frame', x: x + 30, y: y + 56, w: KAB.COUNT_SCENE.w * sceneScale, h: sceneH, lw: 5, color: FAINT });
      p.positions.forEach(function (pos) {
        planIcon(plan, p.icon, 'a',
          x + 30 + (pos.x - 27) * sceneScale, y + 56 + (pos.y - 27) * sceneScale,
          54 * sceneScale, 0);
      });
      var ay = y + 56 + sceneH + 88;
      text(plan, x + 34, ay, 'How many? ', 56, { align: 'left', weight: 600 });
      text(plan, x + 330, ay, opts.solution ? p.answerText : '______', 60,
        { align: 'left', weight: 700, color: opts.solution ? GREEN : INK });
    });
    var rows = Math.ceil(page.problems.length / cols);
    plan.height = y0 + rows * blockH + MARGIN;
    return plan;
  }

  /* ---------- Odd One Out ---------- */
  function planOddOneOut(page, opts) {
    var plan = newPlan('oddoneout', page.title);
    var y0 = planHeader(plan, page, opts);
    var cols = 2;
    var cellW = (WIDTH - MARGIN * 2) / cols;
    page.problems.forEach(function (p, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var gridW = cellW - 70;
      var cellPx = gridW / p.size;
      var blockH = gridW + 200;
      var x = MARGIN + col * cellW + 10;
      var y = y0 + row * blockH;
      text(plan, x + 4, y + 26, (i + 1) + ')', 52, { align: 'left', color: GRAY });
      var gx = x + 35, gy = y + 56;
      plan.ops.push({ t: 'rect', x: gx, y: gy, w: gridW, h: gridW, color: '#fdfefe' });
      plan.ops.push({ t: 'frame', x: gx, y: gy, w: gridW, h: gridW, lw: 5, color: FAINT });
      p.cells.forEach(function (cellObj, ci) {
        var cx = gx + (ci % p.size) * cellPx, cy = gy + Math.floor(ci / p.size) * cellPx;
        if (opts.solution && ci === p.oddIndex) {
          plan.ops.push({ t: 'ring', x: cx + cellPx / 2, y: cy + cellPx / 2, r: cellPx / 2 - 12, lw: 12, color: RED });
        }
        planIcon(plan, cellObj.icon, cellObj.scheme,
          cx + cellPx * 0.14, cy + cellPx * 0.14, cellPx * 0.72, cellObj.rot);
      });
      if (opts.solution) {
        text(plan, gx + 4, gy + gridW + 76, 'Answer: ' + p.answerText, 50,
          { align: 'left', weight: 600, color: GREEN });
      }
    });
    var rows = Math.ceil(page.problems.length / cols);
    var gridW2 = cellW - 70;
    plan.height = y0 + rows * (gridW2 + 200) + MARGIN;
    return plan;
  }

  /* ---------- Reading Strips ---------- */
  function planReading(page, opts) {
    var plan = newPlan('reading', page.title);
    var y0 = planHeader(plan, page, opts);
    var gap = 60;
    var picW = (WIDTH - MARGIN * 2 - gap * 2) / 3;
    var picH = picW * 0.92;
    var y = y0;
    page.strips.forEach(function (s, i) {
      text(plan, MARGIN, y + 30, (i + 1) + ')  ' + s.sentence, 62,
        { align: 'left', weight: 700 });
      var py = y + 78;
      s.choices.forEach(function (cid, ci) {
        var x = MARGIN + ci * (picW + gap);
        var d = KAB.getDesign(cid);
        if (d) planDesign(plan, d, x + picW * 0.14, py, (picW * 0.72) / 240, INK, 6);
        if (opts.solution && ci === s.answerIndex) {
          plan.ops.push({
            t: 'ring', x: x + picW / 2, y: py + picH / 2,
            r: picW * 0.46, lw: 13, color: RED
          });
        }
        if (page.style === 'bubble') {
          var bx = x + picW / 2, by = py + picH + 52;
          if (opts.solution && ci === s.answerIndex) {
            plan.ops.push({ t: 'circle', x: bx, y: by, r: 26, color: INK });
          } else {
            plan.ops.push({ t: 'ring', x: bx, y: by, r: 26, lw: 6, color: INK });
          }
        }
      });
      y = py + picH + (page.style === 'bubble' ? 130 : 56);
    });
    plan.height = y + MARGIN;
    return plan;
  }

  /* ---------- KDP wrap cover (single full-wrap page, ~300 DPI) ----------
   * cover: { title, subtitle, author, ages, theme (id or object),
   *          activityCount, activityLine, dims (KAB.wrapCoverDims),
   *          summary (KAB.bookSectionSummary), thumbDesigns: [ids] }
   * The canvas is dims.width x dims.height INCHES at 300 px/in, laid
   * out as [back | spine | front] with the bleed inside the dims.
   * Colours come from the SAME KAB cover theme that drives the HTML
   * covers, so the PNG and the printed wrap always match. */
  function planWrapCover(cover) {
    var dims = cover.dims;
    var theme = (cover.theme && typeof cover.theme === 'object')
      ? cover.theme : KAB.getCoverTheme(cover.theme);
    var S = 300; // px per inch
    var plan = {
      type: 'wrapcover', title: cover.title || '',
      width: Math.round(dims.width * S), height: Math.round(dims.height * S),
      ops: [{ t: 'bg', color: '#ffffff' }]
    };
    var B = dims.bleed * S;
    var trimW = dims.trimW * S, trimH = dims.trimH * S;
    var spineW = dims.spine * S;
    var backX = B, spineX = B + trimW, frontX = spineX + spineW;
    var top = B;

    // themed blocks: back paper, spine, front
    plan.ops.push({ t: 'rect', x: backX, y: 0, w: trimW, h: plan.height, color: theme.backBg });
    plan.ops.push({ t: 'rect', x: spineX, y: 0, w: spineW, h: plan.height, color: theme.spineBg });
    plan.ops.push({ t: 'rect', x: frontX, y: 0, w: plan.width - frontX, h: plan.height, color: theme.frontFlat });
    plan.ops.push({ t: 'rect', x: frontX, y: 0, w: plan.width - frontX, h: 26, color: theme.band });

    // back cover: "Inside this book" from the book's real sections
    var by = top + 130;
    text(plan, backX + 110, by, 'Inside this book', 92, { align: 'left', weight: 800, color: theme.backHeading });
    by += 120;
    (cover.summary || []).forEach(function (s) {
      var lineStr = '•  ' + s.count + ' ' + s.label +
        (s.levels && s.levels.length ? ' (' + s.levels.join(', ') + ')' : '');
      text(plan, backX + 110, by, lineStr, 62, { align: 'left', color: theme.backText });
      by += 92;
    });
    by += 40;
    text(plan, backX + 110, by, 'Create complete kids activity books in minutes —', 56, { align: 'left', color: theme.backText });
    text(plan, backX + 110, by + 76, 'print-ready pages with all solutions included.', 56, { align: 'left', color: theme.backText });
    if (cover.author) {
      text(plan, backX + 110, by + 190, 'by ' + cover.author, 60, { align: 'left', weight: 700, color: theme.backHeading });
    }
    text(plan, backX + 110, by + 290, 'SONGLAP DEALS', 54, { align: 'left', weight: 800, color: '#b98a1d' });
    // barcode placeholder: 2in x 1.2in at the back cover's bottom-right
    var bcW = 2 * S, bcH = 1.2 * S;
    var bcX = backX + trimW - 0.25 * S - bcW, bcY = top + trimH - 0.25 * S - bcH;
    plan.ops.push({ t: 'rect', x: bcX, y: bcY, w: bcW, h: bcH, color: '#ffffff' });
    plan.ops.push({ t: 'frame', x: bcX, y: bcY, w: bcW, h: bcH, lw: 5, color: '#8aa0a9' });
    text(plan, bcX + bcW / 2, bcY + bcH / 2, 'BARCODE', 64, { weight: 700, color: '#48626e' });

    // spine text (only when the spine is wide enough — see wrapCoverDims)
    if (dims.spineText) {
      plan.ops.push({
        t: 'textrot', x: spineX + spineW / 2, y: plan.height / 2,
        str: (cover.title || '') + (cover.author ? '  ·  ' + cover.author : ''),
        size: Math.min(64, spineW * 0.52), font: FONT, weight: 800,
        color: theme.spineColor, align: 'center', rot: -90
      });
    }

    // front cover decorations: faceless star / moon / heart motifs
    var decoFill = theme.badgeBg;
    [[0.06, 0.06, 60], [0.94, 0.30, 48], [0.08, 0.78, 52], [0.93, 0.88, 58]].forEach(function (st) {
      pathOp(plan, { pts: KAB.starPts(frontX + st[0] * trimW, st[1] * plan.height, st[2], st[2] * 0.48, 5), closed: true },
        0, 0, 1, { fill: decoFill });
    });

    // front cover
    var fx = frontX + (plan.width - frontX) / 2;
    var fy = top + 300;
    var titleStr = cover.title || 'My Kids Activity Book';
    var titleSize = titleStr.length <= 22 ? 170 : (titleStr.length <= 40 ? 140 : 112);
    if (theme.titleColors.length > 1) {
      // rainbow title: one op per word, laid out side by side from an
      // estimated total width (bold Arial ≈ 0.56 x size per char)
      var words = titleStr.split(/\s+/).filter(Boolean);
      var charW = titleSize * 0.56;
      var totalW = words.reduce(function (acc, w) { return acc + w.length * charW; }, 0) +
        (words.length - 1) * charW * 0.9;
      var wx = fx - totalW / 2;
      words.forEach(function (w, i) {
        text(plan, wx, fy, w, titleSize, {
          weight: 800, align: 'left', color: theme.titleColors[i % theme.titleColors.length]
        });
        wx += w.length * charW + charW * 0.9;
      });
    } else {
      text(plan, fx, fy, titleStr, titleSize, { weight: 800, color: theme.titleColors[0] });
    }
    fy += 130;
    if (cover.subtitle) {
      text(plan, fx, fy, cover.subtitle, 66, { color: theme.subtitleColor });
      fy += 110;
    }
    if (cover.activityLine) {
      text(plan, fx, fy, cover.activityLine, 54, { weight: 700, color: theme.lineColor });
      fy += 110;
    }
    // starburst badges: ages (top-right), activity count (bottom-left)
    if (cover.ages) {
      var ax = frontX + trimW - 300, ay = top + 300;
      pathOp(plan, { pts: KAB.starPts(ax, ay, 215, 165, 12), closed: true }, 0, 0, 1, { fill: theme.ageBadgeBg });
      text(plan, ax, ay - 42, 'Ages', 52, { weight: 700, color: theme.ageBadgeColor });
      text(plan, ax, ay + 48, cover.ages, 84, { weight: 800, color: theme.ageBadgeColor });
    }
    var badge = KAB.coverBadgeText(cover.activityCount || 0);
    if (badge) {
      var bx = frontX + 330, byy = top + trimH - 330;
      pathOp(plan, { pts: KAB.starPts(bx, byy, 250, 192, 12), closed: true }, 0, 0, 1, { fill: theme.badgeBg });
      text(plan, bx, byy - 40, badge.big, 96, { weight: 800, color: theme.badgeColor });
      text(plan, bx, byy + 62, badge.small, 56, { weight: 700, color: theme.badgeColor });
    }
    var thumbs = (cover.thumbDesigns || []).slice(0, 3);
    var tw = Math.min(trimW * 0.62, 640), th = tw;
    thumbs.forEach(function (id, i) {
      var d = KAB.getDesign(id);
      if (!d) return;
      var tx = fx - tw / 2, ty = fy + i * (th * 0.52);
      plan.ops.push({ t: 'rect', x: tx, y: ty, w: tw, h: th * 0.48, color: '#ffffff' });
      planDesign(plan, d, tx + tw * 0.3, ty + th * 0.03, (tw * 0.4) / 240, INK, 6);
    });
    if (cover.author) {
      text(plan, fx, top + trimH - 150, 'by ' + cover.author, 72,
        { weight: 700, color: theme.authorColor });
    }
    return plan;
  }

  function downloadWrapCoverPNG(cover) {
    var plan = planWrapCover(cover);
    var canvas = document.createElement('canvas');
    renderPlan(canvas, plan);
    function save(href) {
      var a = document.createElement('a');
      a.href = href;
      a.download = 'wrap-cover.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        save(url);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }, 'image/png');
    } else {
      save(canvas.toDataURL('image/png'));
    }
    return plan;
  }

  /* ---------- dispatch ---------- */
  function buildPlan(page, opts) {
    opts = opts || {};
    switch (page.type) {
      case 'maze': return planMaze(page, opts);
      case 'wordsearch': return planWordSearch(page, opts);
      case 'coloring': return planColoring(page, opts);
      case 'dottodot': return planDotToDot(page, opts);
      case 'tracing': return planTracing(page, opts);
      case 'counting': return planCounting(page, opts);
      case 'oddoneout': return planOddOneOut(page, opts);
      case 'reading': return planReading(page, opts);
      default: return newPlan(page.type, page.title);
    }
  }

  /* ---------- canvas execution (browser only) ---------- */

  function tracePath(ctx, cmds) {
    cmds.forEach(function (c) {
      switch (c[0]) {
        case 'M': ctx.moveTo(c[1], c[2]); break;
        case 'L': ctx.lineTo(c[1], c[2]); break;
        case 'C': ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
        case 'Q': ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
        case 'Z': ctx.closePath(); break;
      }
    });
  }

  function renderPlan(canvas, plan) {
    canvas.width = plan.width;
    canvas.height = plan.height;
    var ctx = canvas.getContext('2d');
    plan.ops.forEach(function (op) {
      ctx.globalAlpha = op.alpha == null ? 1 : op.alpha;
      ctx.setLineDash(op.dash || []);
      switch (op.t) {
        case 'bg':
          ctx.fillStyle = op.color;
          ctx.fillRect(0, 0, plan.width, plan.height);
          break;
        case 'rect':
          ctx.fillStyle = op.color;
          ctx.fillRect(op.x, op.y, op.w, op.h);
          break;
        case 'frame':
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.lw;
          ctx.strokeRect(op.x, op.y, op.w, op.h);
          break;
        case 'ring':
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.lw;
          ctx.beginPath();
          ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'line':
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.lw;
          ctx.lineCap = op.cap || 'butt';
          ctx.beginPath();
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(op.x2, op.y2);
          ctx.stroke();
          break;
        case 'poly':
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.lw;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          op.pts.forEach(function (p, i) {
            if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          });
          ctx.stroke();
          break;
        case 'circle':
          ctx.fillStyle = op.color;
          ctx.beginPath();
          ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'path':
          ctx.save();
          ctx.translate(op.tx, op.ty);
          if (op.rot) {
            ctx.translate(op.cx * op.scale, op.cy * op.scale);
            ctx.rotate(op.rot * Math.PI / 180);
            ctx.translate(-op.cx * op.scale, -op.cy * op.scale);
          }
          ctx.scale(op.scale, op.scale);
          ctx.beginPath();
          tracePath(ctx, op.cmds);
          if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
          if (op.stroke) {
            ctx.strokeStyle = op.stroke;
            ctx.lineWidth = op.lw;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
          }
          ctx.restore();
          break;
        case 'text':
          if (!op.str) break;
          ctx.fillStyle = op.color;
          ctx.font = op.weight + ' ' + op.size + 'px ' + op.font;
          ctx.textAlign = op.align;
          ctx.textBaseline = 'middle';
          ctx.fillText(op.str, op.x, op.y);
          break;
        case 'textrot':
          if (!op.str) break;
          ctx.save();
          ctx.translate(op.x, op.y);
          ctx.rotate((op.rot || 0) * Math.PI / 180);
          ctx.fillStyle = op.color;
          ctx.font = op.weight + ' ' + op.size + 'px ' + op.font;
          ctx.textAlign = op.align;
          ctx.textBaseline = 'middle';
          ctx.fillText(op.str, 0, 0);
          ctx.restore();
          break;
        case 'imagedata': {
          var tmp = document.createElement('canvas');
          tmp.width = op.imageData.width;
          tmp.height = op.imageData.height;
          tmp.getContext('2d').putImageData(
            new ImageData(op.imageData.data, op.imageData.width, op.imageData.height), 0, 0);
          ctx.drawImage(tmp, op.x, op.y, op.w, op.h);
          break;
        }
        case 'textbase':
          if (!op.str) break;
          ctx.fillStyle = op.color;
          ctx.font = op.weight + ' ' + op.size + 'px ' + op.font;
          ctx.textAlign = op.align;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(op.str, op.x, op.y);
          break;
        case 'textstroke':
          if (!op.str) break;
          ctx.font = op.weight + ' ' + op.size + 'px ' + op.font;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.lw;
          ctx.lineCap = 'round';
          ctx.setLineDash(op.dash || []);
          ctx.strokeText(op.str, op.x, op.y);
          break;
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
    return canvas;
  }

  function downloadPNG(page, opts) {
    opts = opts || {};
    var plan = buildPlan(page, opts);
    var canvas = document.createElement('canvas');
    renderPlan(canvas, plan);
    var filename = page.type + (opts.solution ? '-solution.png' : '-page.png');
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }, 'image/png');
    } else {
      var a2 = document.createElement('a');
      a2.href = canvas.toDataURL('image/png');
      a2.download = filename;
      document.body.appendChild(a2);
      a2.click();
      a2.remove();
    }
    return plan;
  }

  var api = {
    buildPlan: buildPlan,
    renderPlan: renderPlan,
    downloadPNG: downloadPNG,
    planMaze: planMaze,
    planWordSearch: planWordSearch,
    planColoring: planColoring,
    planDotToDot: planDotToDot,
    planTracing: planTracing,
    planCounting: planCounting,
    planOddOneOut: planOddOneOut,
    planReading: planReading,
    planWrapCover: planWrapCover,
    downloadWrapCoverPNG: downloadWrapCoverPNG,
    imageGray: imageGray,
    blur3x3: blur3x3,
    sobelEdges: sobelEdges,
    thresholdFromDetail: thresholdFromDetail,
    edgesToLineArt: edgesToLineArt,
    processImageData: processImageData,
    imageToLineArt: imageToLineArt,
    fitImageSize: fitImageSize,
    WIDTH: WIDTH
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PNGExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
