/*
 * Songlap Kids Activity Book Generator — HTML/SVG renderers.
 * Pure string builders: used by the single-page tabs (app.js) and the
 * Book Builder (book.js) so screen and print output look identical.
 * All artwork is drawn from the shape data in generators.js (window.KAB)
 * — the same data the PNG exporter draws from.
 */
(function (global) {
  'use strict';

  var INK = '#14232b';
  var FAINT = '#b9c6cc';
  var GOLD = '#ffd166';
  var GREEN = '#2a7f62';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    var r = Math.round(n * 10) / 10;
    return String(r);
  }

  /* Abstract path commands (from KAB.shapePathCmds) -> SVG path string. */
  function cmdsToPath(cmds) {
    var out = [];
    cmds.forEach(function (c) {
      if (c[0] === 'Z') { out.push('Z'); return; }
      var nums = [];
      for (var i = 1; i < c.length; i++) nums.push(fmt(c[i]));
      out.push(c[0] + nums.join(' '));
    });
    return out.join(' ');
  }

  function shapePath(shapeObj, attrs) {
    return '<path d="' + cmdsToPath(KAB.shapePathCmds(shapeObj)) + '" ' + attrs + '/>';
  }

  /* ---------- Page shell: title + Name / Date header ---------- */

  function pageHeaderHTML(page) {
    return '<div class="ws-head">' +
      '<h3 class="ws-title">' + esc(page.title) + '</h3>' +
      '<div class="ws-meta">' +
        '<span>Name: <span class="fill-line fill-name"></span></span>' +
        '<span>Date: <span class="fill-line fill-date"></span></span>' +
      '</div></div>' +
      (page.instructions ? '<p class="ws-instructions">' + esc(page.instructions) + '</p>' : '');
  }

  /* ---------- Maze ---------- */

  function mazeCell(page) {
    return Math.max(24, Math.floor(540 / Math.max(page.cols, page.rows)));
  }

  function mazeSVG(page, opts) {
    opts = opts || {};
    var cell = mazeCell(page);
    var W = page.cols * cell, H = page.rows * cell;
    var parts = [];
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>');
    if (opts.solution && page.path) {
      var pts = page.path.map(function (idx) {
        var r = Math.floor(idx / page.cols), c = idx % page.cols;
        return fmt((c + 0.5) * cell) + ',' + fmt((r + 0.5) * cell);
      });
      parts.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#e63946" ' +
        'stroke-width="' + fmt(cell * 0.32) + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>');
    }
    var d = '';
    for (var r = 0; r < page.rows; r++) {
      for (var c = 0; c < page.cols; c++) {
        var w = page.walls[r * page.cols + c];
        var x = c * cell, y = r * cell;
        if (w & 1) d += 'M' + x + ' ' + y + 'H' + (x + cell);
        if (w & 8) d += 'M' + x + ' ' + y + 'V' + (y + cell);
        if (c === page.cols - 1 && (w & 2)) d += 'M' + (x + cell) + ' ' + y + 'V' + (y + cell);
        if (r === page.rows - 1 && (w & 4)) d += 'M' + x + ' ' + (y + cell) + 'H' + (x + cell);
      }
    }
    parts.push('<path d="' + d + '" stroke="' + INK + '" stroke-width="2.4" fill="none"/>');
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none" stroke="' + INK + '" stroke-width="4"/>');
    var fs = fmt(cell * 0.72);
    parts.push('<text x="' + fmt(cell * 0.5) + '" y="' + fmt(cell * 0.54) + '" font-size="' + fs +
      '" text-anchor="middle" dominant-baseline="middle">🚀</text>');
    var gx = (page.cols - 0.5) * cell, gy = (page.rows - 0.5) * cell;
    parts.push('<text x="' + fmt(gx) + '" y="' + fmt(gy + cell * 0.04) + '" font-size="' + fs +
      '" text-anchor="middle" dominant-baseline="middle">⭐</text>');
    return '<svg class="maze-svg" viewBox="0 0 ' + W + ' ' + H +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Maze">' + parts.join('') + '</svg>';
  }

  /* ---------- Word Search ---------- */

  function wordSearchSVG(page, opts) {
    opts = opts || {};
    var cell = page.size <= 10 ? 44 : 38;
    var W = page.size * cell;
    var parts = [];
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + W + '" fill="#ffffff"/>');
    if (opts.solution) {
      page.placements.forEach(function (p) {
        var x1 = (p.col + 0.5) * cell, y1 = (p.row + 0.5) * cell;
        var x2 = (p.col + p.dc * (p.word.length - 1) + 0.5) * cell;
        var y2 = (p.row + p.dr * (p.word.length - 1) + 0.5) * cell;
        parts.push('<line x1="' + fmt(x1) + '" y1="' + fmt(y1) + '" x2="' + fmt(x2) + '" y2="' + fmt(y2) +
          '" stroke="' + GOLD + '" stroke-width="' + fmt(cell * 0.66) + '" stroke-linecap="round" opacity="0.65"/>');
      });
    }
    var d = '';
    for (var i = 0; i <= page.size; i++) {
      d += 'M' + (i * cell) + ' 0V' + W + 'M0 ' + (i * cell) + 'H' + W;
    }
    parts.push('<path d="' + d + '" stroke="' + FAINT + '" stroke-width="1.4" fill="none"/>');
    for (var r = 0; r < page.size; r++) {
      for (var c = 0; c < page.size; c++) {
        parts.push('<text x="' + fmt((c + 0.5) * cell) + '" y="' + fmt((r + 0.54) * cell) +
          '" font-size="' + fmt(cell * 0.52) + '" font-weight="700" text-anchor="middle" ' +
          'dominant-baseline="middle" fill="' + INK + '">' + esc(page.grid[r][c]) + '</text>');
      }
    }
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + W + '" fill="none" stroke="' + INK + '" stroke-width="3"/>');
    return '<svg class="ws-svg" viewBox="0 0 ' + W + ' ' + W +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Word search grid">' + parts.join('') + '</svg>';
  }

  function wordSearchBodyHTML(page, opts) {
    var h = '<div class="ws-wrap">' + wordSearchSVG(page, opts) + '</div>';
    h += '<div class="word-bank"><h4>Find these words:</h4><div class="word-chips">';
    page.placements.forEach(function (p) { h += '<span class="chip">' + esc(p.word) + '</span>'; });
    h += '</div>';
    if (page.unplaced && page.unplaced.length) {
      h += '<p class="unplaced-note">Not hidden in this grid (too long or no room): ' +
        page.unplaced.map(esc).join(', ') + '</p>';
    }
    return h + '</div>';
  }

  /* ---------- Coloring designs ---------- */

  function designSVG(designObj, opts) {
    opts = opts || {};
    var lw = opts.lw || 5.5;
    var stroke = opts.stroke || INK;
    var parts = [];
    designObj.shapes.forEach(function (s) {
      var attrs = 'fill="' + (s.closed ? '#ffffff' : 'none') + '" stroke="' + stroke +
        '" stroke-width="' + lw + '" stroke-linejoin="round" stroke-linecap="round"';
      parts.push(shapePath(s, attrs));
    });
    if (opts.inner) return parts.join('');
    return '<svg class="design-svg" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="' + esc(designObj.name) + '">' + parts.join('') + '</svg>';
  }

  function coloringBodyHTML(page) {
    if (page.customImage) {
      // the buyer's own picture, converted to line art (Workstream 4)
      return '<div class="coloring-wrap"><img class="custom-coloring-img" src="' +
        page.customImage.dataUrl + '" alt="Your picture as a coloring page"></div>';
    }
    var d = KAB.getDesign(page.designId);
    return '<div class="coloring-wrap">' + designSVG(d) + '</div>';
  }

  /* ---------- Dot-to-Dot ---------- */

  function dotToDotSVG(page, opts) {
    opts = opts || {};
    var parts = [];
    parts.push('<rect x="0" y="0" width="240" height="240" fill="#ffffff"/>');
    if (opts.solution) {
      var d = KAB.getDesign(page.designId);
      parts.push('<g opacity="0.9">' + designSVG(d, { lw: 3, stroke: '#48626e', inner: true }) + '</g>');
    }
    page.points.forEach(function (p, i) {
      var dx = p.x - 120, dy = p.y - 120;
      var len = Math.hypot(dx, dy) || 1;
      var nx = p.x + (dx / len) * 10, ny = p.y + (dy / len) * 10;
      if (i === 0) {
        parts.push('<circle cx="' + fmt(p.x) + '" cy="' + fmt(p.y) + '" r="7.5" fill="none" stroke="' + GREEN + '" stroke-width="2.2"/>');
      }
      parts.push('<circle cx="' + fmt(p.x) + '" cy="' + fmt(p.y) + '" r="3.1" fill="' + INK + '"/>');
      parts.push('<text x="' + fmt(nx) + '" y="' + fmt(ny) + '" font-size="10.5" font-weight="700" ' +
        'text-anchor="middle" dominant-baseline="middle" fill="' + (opts.solution ? '#8aa0a9' : '#33505c') + '">' + p.n + '</text>');
    });
    return '<svg class="d2d-svg" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="Dot to dot">' + parts.join('') + '</svg>';
  }

  /* ---------- Tracing ---------- */

  var TRACE_FONT = "'Comic Sans MS','Chalkboard SE','Segoe Print',cursive";

  function tracingSVG(page) {
    var W = 800, rowH = 118, H = page.rows.length * rowH + 8;
    var parts = [];
    page.rows.forEach(function (row, ri) {
      var y = ri * rowH + 8;
      parts.push('<line x1="8" y1="' + (y + 6) + '" x2="' + (W - 8) + '" y2="' + (y + 6) + '" stroke="' + FAINT + '" stroke-width="1.6"/>');
      parts.push('<line x1="8" y1="' + (y + 46) + '" x2="' + (W - 8) + '" y2="' + (y + 46) + '" stroke="' + FAINT + '" stroke-width="1.4" stroke-dasharray="7 6"/>');
      parts.push('<line x1="8" y1="' + (y + 86) + '" x2="' + (W - 8) + '" y2="' + (y + 86) + '" stroke="#8aa0a9" stroke-width="1.8"/>');
      var isWord = row.kind === 'word';
      var size = isWord ? 52 : 78;
      var baseY = y + 84;
      parts.push('<text x="18" y="' + baseY + '" font-family="' + TRACE_FONT + '" font-size="' + size +
        '" font-weight="700" fill="' + INK + '">' + esc(row.text) + '</text>');
      var startX = isWord ? 250 : 140;
      var step = isWord ? 250 : 106;
      for (var i = 0; i < row.repeats; i++) {
        parts.push('<text x="' + (startX + i * step) + '" y="' + baseY + '" font-family="' + TRACE_FONT +
          '" font-size="' + size + '" font-weight="700" fill="none" stroke="#a7bcc4" stroke-width="2.6" ' +
          'stroke-dasharray="0.1 8" stroke-linecap="round">' + esc(row.text) + '</text>');
      }
    });
    return '<svg class="tracing-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="Tracing practice">' + parts.join('') + '</svg>';
  }

  /* ---------- Icons ---------- */

  /* One icon as an SVG group at (x, y) with the given pixel size,
   * resolved colors, and optional rotation (degrees, about centre). */
  function iconGroup(iconId, schemeKey, x, y, size, rot) {
    var icon = KAB.ICONS[iconId];
    if (!icon) return '';
    var colors = KAB.iconColors(iconId, schemeKey);
    var s = size / 100;
    var parts = ['<g transform="translate(' + fmt(x) + ' ' + fmt(y) + ')'];
    if (rot) parts[0] += ' rotate(' + rot + ' ' + fmt(size / 2) + ' ' + fmt(size / 2) + ')';
    parts[0] += ' scale(' + fmt(s) + ')">';
    icon.shapes.forEach(function (sh) {
      var attrs = 'fill="' + colors[sh.fill] + '" stroke="rgba(20,35,43,0.28)" stroke-width="2.4" ' +
        'stroke-linejoin="round" stroke-linecap="round"';
      if (!sh.closed) attrs = 'fill="none" stroke="' + colors[sh.fill] + '" stroke-width="4" stroke-linecap="round"';
      parts.push(shapePath(sh, attrs));
    });
    parts.push('</g>');
    return parts.join('');
  }

  function iconSVG(iconId, schemeKey, size) {
    return '<svg viewBox="0 0 100 100" width="' + (size || 60) + '" height="' + (size || 60) +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(iconId) + '">' +
      iconGroup(iconId, schemeKey, 0, 0, 100, 0) + '</svg>';
  }

  /* ---------- Counting ---------- */

  function countingBodyHTML(page, opts) {
    opts = opts || {};
    var h = '<div class="count-grid">';
    page.problems.forEach(function (p, i) {
      var scene = ['<svg class="count-svg" viewBox="0 0 ' + KAB.COUNT_SCENE.w + ' ' + KAB.COUNT_SCENE.h +
        '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Counting pictures">'];
      scene.push('<rect x="1" y="1" width="' + (KAB.COUNT_SCENE.w - 2) + '" height="' +
        (KAB.COUNT_SCENE.h - 2) + '" fill="#fdfefe" stroke="' + FAINT + '" stroke-width="2" rx="10"/>');
      p.positions.forEach(function (pos) {
        scene.push(iconGroup(p.icon, 'a', pos.x - 27, pos.y - 27, 54, 0));
      });
      scene.push('</svg>');
      h += '<div class="count-prob"><span class="prob-num">' + (i + 1) + ')</span>' +
        scene.join('') +
        '<p class="count-prompt">' + esc(p.prompt) +
        ' <span class="answer-box">' + (opts.solution ? esc(p.answerText) : '&nbsp;') + '</span></p></div>';
    });
    return h + '</div>';
  }

  /* ---------- Odd One Out ---------- */

  function oddBodyHTML(page, opts) {
    opts = opts || {};
    var h = '<div class="odd-grid">';
    page.problems.forEach(function (p, pi) {
      var cell = 92, W = p.size * cell;
      var parts = ['<svg class="odd-svg" viewBox="0 0 ' + W + ' ' + W +
        '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Odd one out group">'];
      parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (W - 2) + '" fill="#fdfefe" stroke="' + FAINT + '" stroke-width="2" rx="10"/>');
      p.cells.forEach(function (cellObj, ci) {
        var cx = (ci % p.size) * cell, cy = Math.floor(ci / p.size) * cell;
        if (opts.solution && ci === p.oddIndex) {
          parts.push('<circle cx="' + (cx + cell / 2) + '" cy="' + (cy + cell / 2) + '" r="' +
            (cell / 2 - 5) + '" fill="none" stroke="#e63946" stroke-width="4.5"/>');
        }
        parts.push(iconGroup(cellObj.icon, cellObj.scheme, cx + 13, cy + 13, cell - 26, cellObj.rot));
      });
      parts.push('</svg>');
      h += '<div class="odd-prob"><span class="prob-num">' + (pi + 1) + ')</span>' + parts.join('') +
        (opts.solution ? '<p class="odd-answer">Answer: ' + esc(p.answerText) + '</p>' : '') + '</div>';
    });
    return h + '</div>';
  }

  /* ---------- Reading Strips ---------- */

  function readingBodyHTML(page, opts) {
    opts = opts || {};
    /* The count class lets the printed-sheet CSS size the pictures
       so a full page of strips fits one sheet (see styles.css):
       <=4 strips get roomy pictures, 5+ get compact ones. */
    var h = '<div class="strips ' +
      (page.strips.length >= 5 ? 'strips-compact' : 'strips-roomy') + '">';
    page.strips.forEach(function (s, i) {
      h += '<div class="strip"><p class="strip-sentence"><span class="prob-num">' +
        (i + 1) + ')</span> ' + esc(s.sentence) + '</p><div class="strip-pics">';
      s.choices.forEach(function (cid, ci) {
        var d = KAB.getDesign(cid);
        var correct = opts.solution && ci === s.answerIndex;
        h += '<div class="strip-choice' + (correct ? ' correct' : '') + '">' +
          '<div class="strip-pic">' + (d ? designSVG(d, { lw: 6 }) : '') + '</div>';
        if (page.style === 'bubble') {
          h += '<span class="bubble' + (correct ? ' filled' : '') + '"></span>';
        }
        h += '</div>';
      });
      h += '</div></div>';
    });
    return h + '</div>';
  }

  /* ---------- Dispatch + answer key ---------- */

  function pageBodyHTML(page, opts) {
    opts = opts || {};
    switch (page.type) {
      case 'maze':
        return '<div class="maze-wrap">' + mazeSVG(page, opts) +
          '<p class="maze-legend">🚀 <strong>Start</strong> — follow the path — <strong>Finish</strong> ⭐</p></div>';
      case 'wordsearch': return wordSearchBodyHTML(page, opts);
      case 'coloring': return coloringBodyHTML(page, opts);
      case 'dottodot': return '<div class="d2d-wrap">' + dotToDotSVG(page, opts) + '</div>';
      case 'tracing': return '<div class="tracing-wrap">' + tracingSVG(page) + '</div>';
      case 'counting': return countingBodyHTML(page, opts);
      case 'oddoneout': return oddBodyHTML(page, opts);
      case 'reading': return readingBodyHTML(page, opts);
      default: return '';
    }
  }

  function pageHTML(page, opts) {
    opts = opts || {};
    return '<div class="wsheet">' + pageHeaderHTML(page) + pageBodyHTML(page, opts) + '</div>';
  }

  /* Text answer key block (counting / odd one out / word search). */
  function answerKeyHTML(page) {
    var key = KAB.answerKey(page);
    if (!key.length) return '';
    var h = '<div class="akey"><h3>Answers — ' + esc(page.title) + '</h3><ol class="akey-list">';
    key.forEach(function (a) { h += '<li>' + esc(a) + '</li>'; });
    return h + '</ol></div>';
  }

  var api = {
    esc: esc, fmt: fmt, cmdsToPath: cmdsToPath, shapePath: shapePath,
    pageHeaderHTML: pageHeaderHTML,
    mazeSVG: mazeSVG, wordSearchSVG: wordSearchSVG,
    designSVG: designSVG, dotToDotSVG: dotToDotSVG, tracingSVG: tracingSVG,
    iconGroup: iconGroup, iconSVG: iconSVG, readingBodyHTML: readingBodyHTML,
    pageBodyHTML: pageBodyHTML, pageHTML: pageHTML,
    answerKeyHTML: answerKeyHTML
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Render = api;
})(typeof window !== 'undefined' ? window : globalThis);
