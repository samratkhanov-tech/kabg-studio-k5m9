/*
 * Songlap Kids Activity Book Generator — pure activity logic + art data.
 * Works in the browser (window.KAB) and in Node (module.exports) for tests.
 * No dependencies, no network, no DOM.
 *
 * Every generator returns a "page" object:
 *   { type, title, instructions, ...type-specific data }
 * Counting and Odd One Out pages carry a `problems` array; every problem
 * has an answerText computed at construction time, so the answer key
 * always matches the page exactly. Visual pages (maze, word search,
 * dot-to-dot) carry their full solution data (path / placements /
 * outline) so solution views are rendered from the same data.
 *
 * ART DATA MODEL: every coloring design and every small icon is a list
 * of shapes. A shape is { pts: [[x, y], ...], closed, smooth } in a
 * fixed viewBox (240x240 for designs, 100x100 for icons). The SAME
 * shape data drives the coloring page (stroked outline), the
 * dot-to-dot puzzle (points sampled along the outline shape) and the
 * PNG draw plans — designs are defined exactly once.
 */
(function (global) {
  'use strict';

  /* ---------------- RNG helpers (same as Puzzle / Math generators) ---------------- */

  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, n) { return Math.floor(rng() * n); }
  function randRange(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function pick(rng, arr) { return arr[randInt(rng, arr.length)]; }

  /* ---------------- Geometry helpers ---------------- */

  function circlePts(cx, cy, r, n) {
    n = n || 36;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function ellipsePts(cx, cy, rx, ry, rotDeg, n) {
    n = n || 36;
    var rot = (rotDeg || 0) * Math.PI / 180;
    var cosR = Math.cos(rot), sinR = Math.sin(rot);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var x = rx * Math.cos(a), y = ry * Math.sin(a);
      pts.push([cx + x * cosR - y * sinR, cy + x * sinR + y * cosR]);
    }
    return pts;
  }

  function starPts(cx, cy, rOuter, rInner, points, rotDeg) {
    points = points || 5;
    var rot = ((rotDeg == null ? -90 : rotDeg)) * Math.PI / 180;
    var pts = [];
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 === 0 ? rOuter : rInner;
      var a = rot + (i / (points * 2)) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  /* Classic parametric heart, centred at (cx, cy), `s` = scale. */
  function heartPts(cx, cy, s, n) {
    n = n || 44;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2;
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([cx + x * s, cy - y * s]);
    }
    return pts;
  }

  /* Wavy "flower silhouette" circle: radius modulated by k scallops. */
  function scallopPts(cx, cy, r, amp, k, n) {
    n = n || 56;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var rr = r + amp * Math.cos(k * a);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    return pts;
  }

  /* Crescent moon outline centred (cx, cy), radius r: the outer arc
   * of one circle joined to the inner arc of an offset circle; the two
   * tips are the circles' true intersection points. */
  function crescentPts(cx, cy, r, n) {
    n = n || 28;
    var d = r * 0.48, r2 = r * 0.86;
    var a = (d * d + r * r - r2 * r2) / (2 * d);       // C1 centre -> tip chord
    var h = Math.sqrt(Math.max(1, r * r - a * a));     // half tip distance
    var tTip = Math.asin(h / r);                        // tip angle (from +x axis)
    var pts = [], i, t;
    // outer arc: top tip, the long way round the left, to bottom tip
    var sweep = Math.PI * 2 - 2 * tTip;
    for (i = 0; i <= n; i++) {
      t = -tTip - (sweep * i) / n;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    // inner arc: bottom tip back to top tip, bulging toward the left
    var cx2 = cx + d;
    var psiB = Math.atan2(h, a - d);                    // bottom tip from C2
    var psiT = Math.atan2(-h, a - d);                   // top tip from C2
    var innerSweep = (Math.PI - psiB) * 2;              // via angle PI (leftmost)
    for (i = 1; i <= n; i++) {
      t = psiB + (innerSweep * i) / n;
      pts.push([cx2 + r2 * Math.cos(t), cy + r2 * Math.sin(t)]);
    }
    return pts;
  }

  function rectPts(x, y, w, h) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }

  function mirrorX(pts, axis) {
    return pts.map(function (p) { return [2 * axis - p[0], p[1]]; });
  }

  function rotatePts(pts, cx, cy, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return pts.map(function (p) {
      var x = p[0] - cx, y = p[1] - cy;
      return [cx + x * c - y * s, cy + x * s + y * c];
    });
  }

  /* Total length of a polyline; closed adds the last->first segment. */
  function polylineLength(pts, closed) {
    var len = 0;
    for (var i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    if (closed && pts.length > 1) {
      len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    }
    return len;
  }

  /*
   * Sample `count` points evenly by arc length along a closed polyline,
   * starting exactly at pts[0] and following the original vertex order.
   * Returns [{x, y, at}] where `at` is the arc-length position (strictly
   * increasing), so ordering can be verified in tests.
   */
  function sampleClosed(pts, count) {
    var total = polylineLength(pts, true);
    var cum = [0];
    for (var i = 1; i <= pts.length; i++) {
      var a = pts[i - 1], b = pts[i % pts.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    var out = [];
    for (var k = 0; k < count; k++) {
      var target = (total * k) / count;
      var seg = 0;
      while (seg < pts.length - 1 && cum[seg + 1] < target) seg++;
      // find segment containing target (wrap-safe)
      seg = 0;
      while (cum[seg + 1] < target && seg < pts.length - 1) seg++;
      var segLen = cum[seg + 1] - cum[seg] || 1;
      var f = (target - cum[seg]) / segLen;
      var p0 = pts[seg % pts.length], p1 = pts[(seg + 1) % pts.length];
      out.push({
        x: p0[0] + (p1[0] - p0[0]) * f,
        y: p0[1] + (p1[1] - p0[1]) * f,
        at: target
      });
    }
    return out;
  }

  /*
   * Convert a shape to abstract path commands in its own coordinates:
   * [['M',x,y], ['L',x,y] | ['C',...] | ['Q',...], ..., ['Z']?]
   * Smooth closed shapes use Catmull-Rom -> Bezier; smooth open shapes
   * use quadratic midpoint smoothing. Both render.js (SVG string) and
   * png.js (canvas) execute these same commands, so screen, print and
   * PNG output always match.
   */
  function shapePathCmds(shape) {
    var pts = shape.pts;
    if (!pts || pts.length === 0) return [];
    if (pts.length === 1) return [['M', pts[0][0], pts[0][1]]];
    var cmds = [['M', pts[0][0], pts[0][1]]];
    var i, p0, p1, p2, p3;
    if (shape.smooth && pts.length > 2) {
      if (shape.closed) {
        var n = pts.length;
        for (i = 0; i < n; i++) {
          p0 = pts[(i - 1 + n) % n]; p1 = pts[i]; p2 = pts[(i + 1) % n]; p3 = pts[(i + 2) % n];
          cmds.push(['C',
            p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
            p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
            p2[0], p2[1]]);
        }
        cmds.push(['Z']);
        return cmds;
      }
      // open smooth: quadratic through midpoints
      for (i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        cmds.push(['Q', pts[i][0], pts[i][1], mx, my]);
      }
      cmds.push(['L', pts[pts.length - 1][0], pts[pts.length - 1][1]]);
      return cmds;
    }
    for (i = 1; i < pts.length; i++) cmds.push(['L', pts[i][0], pts[i][1]]);
    if (shape.closed) cmds.push(['Z']);
    return cmds;
  }

  function shape(pts, closed, smooth, extra) {
    var s = { pts: pts, closed: !!closed, smooth: !!smooth };
    if (extra) for (var k in extra) s[k] = extra[k];
    return s;
  }

  /* ---------------- Maze (recursive backtracker, as in Puzzle Book Generator) ---------------- */

  // wall bits per cell: N=1, E=2, S=4, W=8 (bit set = wall present)
  var MAZE_DIRS = [
    { bit: 1, opp: 4, dr: -1, dc: 0 },
    { bit: 2, opp: 8, dr: 0, dc: 1 },
    { bit: 4, opp: 1, dr: 1, dc: 0 },
    { bit: 8, opp: 2, dr: 0, dc: -1 }
  ];

  function generateMazeData(cols, rows, rng) {
    rng = rng || Math.random;
    cols = Math.max(3, cols | 0); rows = Math.max(3, rows | 0);
    var total = cols * rows;
    var walls = new Array(total).fill(15);
    var visited = new Array(total).fill(false);
    var stack = [0];
    visited[0] = true;
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cr = Math.floor(cur / cols), cc = cur % cols;
      var options = [];
      MAZE_DIRS.forEach(function (d) {
        var nr = cr + d.dr, nc = cc + d.dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr * cols + nc]) {
          options.push({ d: d, idx: nr * cols + nc });
        }
      });
      if (!options.length) { stack.pop(); continue; }
      var chosen = options[randInt(rng, options.length)];
      walls[cur] &= ~chosen.d.bit;
      walls[chosen.idx] &= ~chosen.d.opp;
      visited[chosen.idx] = true;
      stack.push(chosen.idx);
    }
    return { cols: cols, rows: rows, walls: walls };
  }

  /* BFS solver: returns the cell-index path from cell 0 to the last
   * cell, or null. A perfect maze is a tree, so this path is the
   * UNIQUE route between start and finish. */
  function solveMaze(maze) {
    var cols = maze.cols, rows = maze.rows, walls = maze.walls;
    var total = cols * rows;
    var prev = new Array(total).fill(-1);
    var seen = new Array(total).fill(false);
    var queue = [0];
    seen[0] = true;
    var goal = total - 1;
    while (queue.length) {
      var cur = queue.shift();
      if (cur === goal) break;
      var cr = Math.floor(cur / cols), cc = cur % cols;
      for (var i = 0; i < 4; i++) {
        var d = MAZE_DIRS[i];
        if (walls[cur] & d.bit) continue;
        var nr = cr + d.dr, nc = cc + d.dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var nIdx = nr * cols + nc;
        if (!seen[nIdx]) { seen[nIdx] = true; prev[nIdx] = cur; queue.push(nIdx); }
      }
    }
    if (!seen[goal]) return null;
    var path = [];
    var cur2 = goal;
    while (cur2 !== -1) { path.push(cur2); cur2 = prev[cur2]; }
    path.reverse();
    return path;
  }

  /* Number of open passages (removed walls) in the maze — a perfect
   * maze on N cells has exactly N-1 passages and is fully connected,
   * which is what makes its solution unique. Exposed for tests. */
  function mazeOpenPassages(maze) {
    var count = 0;
    for (var i = 0; i < maze.walls.length; i++) {
      if (!(maze.walls[i] & 2)) count++; // E open
      if (!(maze.walls[i] & 4)) count++; // S open
    }
    return count;
  }

  var MAZE_SIZES = {
    easy: { cols: 10, rows: 10, label: 'Easy (10 × 10)' },
    medium: { cols: 14, rows: 14, label: 'Medium (14 × 14)' },
    hard: { cols: 18, rows: 18, label: 'Challenge (18 × 18)' }
  };

  function generateMazePage(sizeKey, rng) {
    rng = rng || Math.random;
    var spec = MAZE_SIZES[sizeKey] || MAZE_SIZES.easy;
    var data = generateMazeData(spec.cols, spec.rows, rng);
    var path = solveMaze(data);
    return {
      type: 'maze', title: 'Maze',
      instructions: 'Help the rocket 🚀 find its way to the star ⭐!',
      sizeKey: sizeKey || 'easy',
      cols: data.cols, rows: data.rows, walls: data.walls, path: path
    };
  }

  /* ---------------- Word Search ---------------- */

  var WS_THEMES = {
    animals: {
      label: 'Animals',
      words: ['CAT', 'DOG', 'LION', 'BEAR', 'FROG', 'DUCK', 'PIG', 'COW',
        'HORSE', 'SHEEP', 'GOAT', 'ZEBRA', 'PANDA', 'TIGER', 'RABBIT', 'MONKEY']
    },
    ocean: {
      label: 'Ocean',
      words: ['FISH', 'CRAB', 'SHARK', 'WHALE', 'SHELL', 'CORAL', 'WAVE',
        'SAND', 'BOAT', 'STAR', 'SEAL', 'REEF', 'PEARL', 'OCTOPUS', 'TURTLE']
    },
    space: {
      label: 'Space',
      words: ['SUN', 'MOON', 'STAR', 'ROCKET', 'PLANET', 'COMET', 'ORBIT',
        'MARS', 'VENUS', 'EARTH', 'ALIEN', 'ASTRO', 'LUNAR', 'SOLAR', 'SPACE']
    },
    food: {
      label: 'Food',
      words: ['APPLE', 'CAKE', 'MILK', 'EGG', 'BREAD', 'RICE', 'CORN',
        'PEAR', 'PLUM', 'GRAPE', 'LEMON', 'MELON', 'PIZZA', 'HONEY', 'SOUP']
    },
    sports: {
      label: 'Sports',
      words: ['BALL', 'BAT', 'KICK', 'RUN', 'JUMP', 'SWIM', 'GOAL',
        'TEAM', 'RACE', 'BIKE', 'TENNIS', 'SOCCER', 'SKATE', 'BOXING', 'GOLF']
    },
    nature: {
      label: 'Nature',
      words: ['TREE', 'LEAF', 'RAIN', 'SNOW', 'FLOWER', 'RIVER', 'ROCK',
        'CLOUD', 'GRASS', 'BIRD', 'LAKE', 'HILL', 'WIND', 'SUN', 'POND']
    }
  };

  function cleanWord(w) {
    return String(w).toUpperCase().replace(/[^A-Z]/g, '');
  }

  /*
   * Kids word search: words run left-to-right and top-to-bottom
   * (diagonals only when opts.diagonal is set). Words that cannot be
   * placed are reported in `unplaced` — never silently dropped.
   */
  function generateWordSearch(rawWords, size, opts, rng) {
    rng = rng || Math.random;
    opts = opts || {};
    size = Math.max(8, Math.min(15, size | 0)) || 10;
    var dirs = opts.diagonal
      ? [[0, 1], [1, 0], [1, 1], [1, -1]]
      : [[0, 1], [1, 0]];
    var seen = {}, words = [];
    (rawWords || []).forEach(function (w) {
      var cw = cleanWord(w);
      if (cw.length >= 2 && !seen[cw]) { seen[cw] = true; words.push(cw); }
    });
    words.sort(function (a, b) { return b.length - a.length; });

    var grid = [];
    for (var r = 0; r < size; r++) grid.push(new Array(size).fill(null));
    var placements = [], unplaced = [];

    words.forEach(function (word) {
      if (word.length > size) { unplaced.push(word); return; }
      var placed = false;
      for (var attempt = 0; attempt < 400 && !placed; attempt++) {
        var d = dirs[randInt(rng, dirs.length)];
        var dr = d[0], dc = d[1];
        var r0 = randInt(rng, size), c0 = randInt(rng, size);
        var rEnd = r0 + dr * (word.length - 1);
        var cEnd = c0 + dc * (word.length - 1);
        if (rEnd < 0 || rEnd >= size || cEnd < 0 || cEnd >= size) continue;
        var ok = true;
        for (var i = 0; i < word.length; i++) {
          var cell = grid[r0 + dr * i][c0 + dc * i];
          if (cell !== null && cell !== word[i]) { ok = false; break; }
        }
        if (!ok) continue;
        for (var j = 0; j < word.length; j++) {
          grid[r0 + dr * j][c0 + dc * j] = word[j];
        }
        placements.push({ word: word, row: r0, col: c0, dr: dr, dc: dc });
        placed = true;
      }
      if (!placed) unplaced.push(word);
    });

    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (var r2 = 0; r2 < size; r2++) {
      for (var c2 = 0; c2 < size; c2++) {
        if (grid[r2][c2] === null) grid[r2][c2] = letters[randInt(rng, 26)];
      }
    }
    return { size: size, grid: grid, placements: placements, unplaced: unplaced };
  }

  function generateWordSearchPage(themeKey, size, opts, rng) {
    rng = rng || Math.random;
    opts = opts || {};
    var rawWords, themeLabel;
    if (themeKey === 'custom') {
      rawWords = opts.customWords || [];
      themeLabel = 'Your Words';
    } else {
      var theme = WS_THEMES[themeKey] || WS_THEMES.animals;
      themeLabel = theme.label;
      // shuffle a copy so different pages hide different subsets/orders
      rawWords = shuffle(theme.words.slice(), rng);
    }
    var ws = generateWordSearch(rawWords, size || 10, opts, rng);
    return {
      type: 'wordsearch', title: 'Word Search — ' + themeLabel,
      instructions: 'Find the hidden words in the grid. Words run across → and down ↓' +
        (opts.diagonal ? ' and diagonally ↘ too' : '') + '.',
      theme: themeKey, themeLabel: themeLabel,
      size: ws.size, grid: ws.grid, placements: ws.placements, unplaced: ws.unplaced
    };
  }

  /* ---------------- Coloring designs + dot-to-dot outlines ---------------- */
  /*
   * Each design: { id, name, shapes: [...] } in a 240x240 viewBox.
   * Shapes are drawn back-to-front (white-filled closed shapes cover
   * what is behind them, e.g. a cat's head covers the base of its
   * ears). Exactly one shape per design is flagged `outline: true` —
   * that shape is the one dot-to-dot samples.
   */

  function design(id, name, shapes) {
    return { id: id, name: name, shapes: shapes };
  }

  function buildDesigns() {
    var D = [];

    /* ---- Cat ---- */
    D.push(design('cat', 'Cat', [
      shape([[76, 86], [64, 28], [114, 58]], true, true),
      shape(mirrorX([[76, 86], [64, 28], [114, 58]], 120), true, true),
      shape([[78, 74], [72, 44], [100, 60]], true, true),
      shape(mirrorX([[78, 74], [72, 44], [100, 60]], 120), true, true),
      shape(circlePts(120, 130, 66, 40), true, true, { outline: true }),
      shape(circlePts(96, 122, 9, 20), true, false),
      shape(circlePts(144, 122, 9, 20), true, false),
      shape([[120, 150], [109, 139], [131, 139]], true, true),
      shape([[120, 150], [120, 158], [107, 165]], false, true),
      shape([[120, 158], [133, 165]], false, true),
      shape([[28, 128], [76, 136]], false, false),
      shape([[30, 150], [76, 144]], false, false),
      shape([[212, 128], [164, 136]], false, false),
      shape([[210, 150], [164, 144]], false, false)
    ]));

    /* ---- Dog ---- */
    D.push(design('dog', 'Dog', [
      shape(ellipsePts(56, 112, 21, 46, 14, 28), true, true),
      shape(ellipsePts(184, 112, 21, 46, -14, 28), true, true),
      shape(circlePts(120, 126, 64, 40), true, true, { outline: true }),
      shape(circlePts(152, 88, 17, 24), true, true),
      shape(ellipsePts(120, 160, 34, 24, 0, 28), true, true),
      shape(ellipsePts(120, 148, 13, 9, 0, 20), true, true),
      shape([[108, 178], [132, 178], [128, 202], [112, 202]], true, true),
      shape(circlePts(94, 114, 8, 18), true, false),
      shape(circlePts(146, 114, 8, 18), true, false)
    ]));

    /* ---- Fish ---- */
    D.push(design('fish', 'Fish', [
      shape([[182, 120], [220, 86], [220, 154]], true, true),
      shape([[94, 78], [118, 50], [142, 80]], true, true),
      shape(ellipsePts(110, 120, 76, 47, 0, 40), true, true, { outline: true }),
      shape([[108, 84], [98, 120], [108, 156]], false, true),
      shape([[138, 88], [130, 120], [138, 152]], false, true),
      shape(circlePts(72, 110, 8, 18), true, false),
      shape(circlePts(34, 58, 10, 20), true, false),
      shape(circlePts(52, 32, 7, 16), true, false)
    ]));

    /* ---- Bird ---- */
    D.push(design('bird', 'Bird', [
      shape([[66, 118], [28, 96], [40, 130], [26, 150], [66, 152]], true, true),
      shape(ellipsePts(116, 140, 58, 48, 0, 36), true, true, { outline: true }),
      shape(circlePts(160, 84, 31, 32), true, true),
      shape([[186, 78], [218, 90], [186, 102]], true, true),
      shape(ellipsePts(104, 142, 30, 20, -20, 28), true, true),
      shape(circlePts(168, 78, 5, 12), true, false),
      shape([[150, 56], [144, 34], [160, 50], [166, 30]], false, true),
      shape([[104, 186], [104, 206]], false, false),
      shape([[132, 186], [132, 206]], false, false),
      shape([[94, 206], [114, 206]], false, false),
      shape([[122, 206], [142, 206]], false, false)
    ]));

    /* ---- Butterfly (silhouette outline + inner wing detail) ---- */
    D.push(design('butterfly', 'Butterfly', [
      shape([[120, 58], [148, 42], [194, 48], [208, 80], [190, 106], [208, 136],
        [198, 176], [162, 188], [130, 168], [120, 178], [110, 168], [78, 188],
        [42, 176], [32, 136], [50, 106], [32, 80], [46, 48], [92, 42]], true, true, { outline: true }),
      shape(ellipsePts(80, 88, 36, 25, -25, 28), true, true),
      shape(ellipsePts(160, 88, 36, 25, 25, 28), true, true),
      shape(ellipsePts(84, 154, 30, 21, 25, 28), true, true),
      shape(ellipsePts(156, 154, 30, 21, -25, 28), true, true),
      shape(ellipsePts(120, 126, 11, 44, 0, 24), true, true),
      shape(circlePts(120, 70, 13, 22), true, true),
      shape([[114, 60], [96, 34]], false, true),
      shape([[126, 60], [144, 34]], false, true),
      shape(circlePts(98, 32, 4, 10), true, false),
      shape(circlePts(142, 32, 4, 10), true, false),
      shape(circlePts(72, 84, 9, 16), true, false),
      shape(circlePts(168, 84, 9, 16), true, false)
    ]));

    /* ---- Flower (scalloped silhouette) ---- */
    D.push(design('flower', 'Flower', [
      shape([[120, 148], [118, 214]], false, true),
      shape(ellipsePts(94, 184, 23, 10, -28, 22), true, true),
      shape(ellipsePts(147, 196, 23, 10, 28, 22), true, true),
      shape(scallopPts(120, 94, 50, 11, 8, 56), true, true, { outline: true }),
      shape(circlePts(120, 94, 21, 28), true, true),
      shape([[36, 216], [204, 216]], false, false)
    ]));

    /* ---- Tree ---- */
    D.push(design('tree', 'Tree', [
      shape([[108, 138], [132, 138], [129, 208], [111, 208]], true, false),
      shape(circlePts(82, 118, 35, 30), true, true),
      shape(circlePts(158, 118, 35, 30), true, true),
      shape(circlePts(120, 82, 45, 36), true, true, { outline: true }),
      shape(circlePts(103, 76, 8, 16), true, false),
      shape(circlePts(143, 95, 8, 16), true, false),
      shape(circlePts(88, 122, 7, 14), true, false),
      shape([[34, 210], [206, 210]], false, false)
    ]));

    /* ---- House (single silhouette outline) ---- */
    D.push(design('house', 'House', [
      shape([[152, 62], [170, 62], [170, 98], [152, 98]], true, false),
      shape([[56, 122], [120, 54], [184, 122], [184, 210], [56, 210]], true, false, { outline: true }),
      shape(rectPts(102, 156, 36, 54), true, false),
      shape(circlePts(131, 184, 3.5, 10), true, false),
      shape(rectPts(70, 138, 24, 24), true, false),
      shape(rectPts(146, 138, 24, 24), true, false),
      shape([[70, 150], [94, 150]], false, false),
      shape([[82, 138], [82, 162]], false, false),
      shape([[146, 150], [170, 150]], false, false),
      shape([[158, 138], [158, 162]], false, false),
      shape(circlePts(120, 108, 11, 20), true, false)
    ]));

    /* ---- Car (silhouette outline + details) ---- */
    D.push(design('car', 'Car', [
      shape([[26, 166], [26, 134], [68, 134], [92, 92], [154, 92], [178, 134],
        [214, 134], [214, 166]], true, true, { outline: true }),
      shape([[100, 100], [122, 100], [122, 132], [80, 132]], true, false),
      shape([[130, 100], [146, 100], [168, 132], [130, 132]], true, false),
      shape([[98, 140], [98, 162], [142, 162], [142, 140]], false, false),
      shape(circlePts(64, 168, 21, 26), true, false),
      shape(circlePts(176, 168, 21, 26), true, false),
      shape(circlePts(64, 168, 8, 14), true, false),
      shape(circlePts(176, 168, 8, 14), true, false),
      shape(circlePts(205, 146, 6, 12), true, false)
    ]));

    /* ---- Rocket ---- */
    D.push(design('rocket', 'Rocket', [
      shape([[90, 138], [56, 192], [92, 182]], true, true),
      shape([[150, 138], [184, 192], [148, 182]], true, true),
      shape([[120, 24], [149, 62], [158, 118], [150, 170], [90, 170], [82, 118], [91, 62]], true, true, { outline: true }),
      shape(circlePts(120, 100, 18, 26), true, false),
      shape(circlePts(120, 100, 10, 18), true, false),
      shape([[104, 184], [120, 226], [136, 184], [128, 198], [120, 188], [112, 198]], true, true),
      shape(starPts(44, 52, 11, 4.6, 5), true, false),
      shape(starPts(198, 44, 9, 3.8, 5), true, false),
      shape(starPts(204, 120, 8, 3.4, 5), true, false)
    ]));

    /* ---- Star character ---- */
    D.push(design('star', 'Star', [
      shape(starPts(120, 122, 86, 37, 5), true, false, { outline: true }),
      shape(starPts(120, 122, 44, 19, 5), true, false),
      shape(circlePts(104, 106, 5, 12), true, false),
      shape(circlePts(136, 106, 5, 12), true, false),
      shape([[104, 132], [120, 142], [136, 132]], false, true)
    ]));

    /* ---- Heart ---- */
    D.push(design('heart', 'Heart', [
      shape(heartPts(120, 128, 4.9, 52), true, true, { outline: true }),
      shape(heartPts(120, 132, 2.7, 44), true, true),
      shape(circlePts(84, 82, 9, 16), true, false)
    ]));

    /* ---- Apple ---- */
    D.push(design('apple', 'Apple', [
      shape([[120, 86], [126, 56]], false, true),
      shape(ellipsePts(148, 62, 21, 9, -24, 22), true, true),
      shape(applePts(120, 142, 63, 56), true, true, { outline: true }),
      shape(circlePts(93, 122, 10, 16), true, false)
    ]));

    /* ---- Sun ---- */
    (function () {
      var shapes = [];
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        var a1 = a - 0.16, a2 = a + 0.16;
        shapes.push(shape([
          [120 + 56 * Math.cos(a1), 120 + 56 * Math.sin(a1)],
          [120 + 88 * Math.cos(a), 120 + 88 * Math.sin(a)],
          [120 + 56 * Math.cos(a2), 120 + 56 * Math.sin(a2)]
        ], true, false));
      }
      shapes.push(shape(circlePts(120, 120, 52, 40), true, true, { outline: true }));
      shapes.push(shape(circlePts(103, 110, 5, 12), true, false));
      shapes.push(shape(circlePts(137, 110, 5, 12), true, false));
      shapes.push(shape([[102, 130], [120, 141], [138, 130]], false, true));
      shapes.push(shape(circlePts(90, 128, 7, 14), true, false));
      shapes.push(shape(circlePts(150, 128, 7, 14), true, false));
      D.push(design('sun', 'Sun', shapes));
    })();

    /* ---- Mandalas (procedural rings of shapes) ---- */
    D.push(design('mandala1', 'Mandala Blooms', makeMandala({
      petals: 8, petalDist: 62, petalRx: 21, petalRy: 34,
      dots: 16, dotDist: 96, dotR: 7, outer: 108, centerR: 26
    })));
    D.push(design('mandala2', 'Mandala Sun', makeMandala({
      petals: 12, petalDist: 66, petalRx: 13, petalRy: 30,
      dots: 12, dotDist: 98, dotR: 9, outer: 110, centerR: 30, starCenter: true
    })));
    D.push(design('mandala3', 'Mandala Garden', makeMandala({
      petals: 6, petalDist: 58, petalRx: 26, petalRy: 38,
      dots: 18, dotDist: 94, dotR: 6, outer: 106, centerR: 22, midRing: true
    })));
    D.push(design('mandala4', 'Mandala Waves', makeMandala({
      petals: 10, petalDist: 64, petalRx: 16, petalRy: 32,
      dots: 20, dotDist: 97, dotR: 5.5, outer: 109, centerR: 24, scallopOuter: true
    })));

    return D;
  }

  /* Apple silhouette: plump ellipse with a dent pressed into the top. */
  function applePts(cx, cy, rx, ry, n) {
    n = n || 40;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var x = cx + rx * Math.sin(a);
      var y = cy - ry * Math.cos(a);
      var dx = (x - cx) / 20;
      y += 13 * Math.exp(-dx * dx) * Math.max(0, Math.cos(a));
      pts.push([x, y]);
    }
    return pts;
  }

  /* One mandala design from ring parameters. */
  function makeMandala(p) {
    var shapes = [];
    var i, a;
    if (p.scallopOuter) {
      shapes.push(shape(scallopPts(120, 120, p.outer - 4, 5, p.dots, 72), true, true, { outline: true }));
    } else {
      shapes.push(shape(circlePts(120, 120, p.outer, 56), true, true, { outline: true }));
    }
    for (i = 0; i < p.dots; i++) {
      a = (i / p.dots) * Math.PI * 2;
      shapes.push(shape(circlePts(120 + p.dotDist * Math.cos(a), 120 + p.dotDist * Math.sin(a), p.dotR, 14), true, false));
    }
    for (i = 0; i < p.petals; i++) {
      a = (i / p.petals) * 360;
      var px = 120 + p.petalDist * Math.cos(a * Math.PI / 180);
      var py = 120 + p.petalDist * Math.sin(a * Math.PI / 180);
      shapes.push(shape(ellipsePts(px, py, p.petalRy, p.petalRx, a, 24), true, true));
    }
    if (p.midRing) {
      shapes.push(shape(circlePts(120, 120, p.petalDist - p.petalRx - 8, 44), true, false));
    }
    shapes.push(shape(circlePts(120, 120, p.centerR, 32), true, true));
    if (p.starCenter) {
      shapes.push(shape(starPts(120, 120, p.centerR - 6, (p.centerR - 6) * 0.45, 6), true, false));
    } else {
      shapes.push(shape(circlePts(120, 120, p.centerR * 0.45, 20), true, false));
    }
    return shapes;
  }

  var DESIGNS = buildDesigns();
  var DESIGN_BY_ID = {};
  DESIGNS.forEach(function (d) { DESIGN_BY_ID[d.id] = d; });

  function getDesign(id) { return DESIGN_BY_ID[id] || null; }

  function outlineShape(designObj) {
    for (var i = 0; i < designObj.shapes.length; i++) {
      if (designObj.shapes[i].outline) return designObj.shapes[i];
    }
    return designObj.shapes[0];
  }

  /* ---------------- Coloring page ---------------- */

  function generateColoringPage(designId, rng) {
    rng = rng || Math.random;
    var d = designId && DESIGN_BY_ID[designId]
      ? DESIGN_BY_ID[designId]
      : DESIGNS[randInt(rng, DESIGNS.length)];
    return {
      type: 'coloring', title: 'Coloring — ' + d.name,
      instructions: 'Color the picture with your favorite colors!',
      designId: d.id, designName: d.name
    };
  }

  /* ---------------- Dot-to-Dot ---------------- */

  /*
   * Sample the design's outline shape into numbered dots. Dot count is
   * clamped to [10, maxDots] (maxDots defaults to 40), following the
   * outline's own point order, so connecting 1-2-3... redraws it.
   */
  function generateDotToDotPage(designId, maxDots, rng) {
    rng = rng || Math.random;
    var d = designId && DESIGN_BY_ID[designId]
      ? DESIGN_BY_ID[designId]
      : DESIGNS[randInt(rng, DESIGNS.length)];
    maxDots = Math.max(12, Math.min(40, maxDots || 30));
    var outline = outlineShape(d);
    var perimeter = polylineLength(outline.pts, true);
    var count = Math.round(perimeter / 17);
    count = Math.max(10, Math.min(maxDots, count));
    var points = sampleClosed(outline.pts, count).map(function (p, i) {
      return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, n: i + 1 };
    });
    return {
      type: 'dottodot', title: 'Dot-to-Dot — ' + d.name,
      instructions: 'Connect the dots in order — start at 1 and finish the picture!',
      designId: d.id, designName: d.name, points: points
    };
  }

  /* ---------------- Tracing ---------------- */

  var TRACING_WORDS = ['cat', 'dog', 'sun', 'pig', 'bus', 'egg', 'ant', 'bee',
    'cow', 'hen', 'fox', 'jam', 'web', 'zip', 'van', 'cup'];
  var TRACING_ROWS_PER_SHEET = 6;

  var TRACING_MODES = {
    upper: { label: 'Uppercase Letters', items: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), kind: 'char', repeats: 6 },
    lower: { label: 'Lowercase Letters', items: 'abcdefghijklmnopqrstuvwxyz'.split(''), kind: 'char', repeats: 6 },
    numbers: { label: 'Numbers', items: '0123456789'.split(''), kind: 'char', repeats: 6 },
    words: { label: 'Simple Words', items: TRACING_WORDS, kind: 'word', repeats: 3 }
  };

  /*
   * A tracing sheet covers TRACING_ROWS_PER_SHEET consecutive items of
   * the mode's full item list, starting at startIndex (wrapping). Each
   * row is one item: a solid example followed by traceable repeats.
   * Books advance startIndex per sheet, so a run of sheets covers the
   * whole alphabet / word list (verified in tests).
   */
  function generateTracingPage(mode, rng, startIndex) {
    var m = TRACING_MODES[mode] || TRACING_MODES.upper;
    var items = m.items;
    var start = ((startIndex || 0) % items.length + items.length) % items.length;
    var rows = [];
    for (var i = 0; i < TRACING_ROWS_PER_SHEET; i++) {
      var item = items[(start + i) % items.length];
      rows.push({ text: item, kind: m.kind, repeats: m.repeats });
    }
    return {
      type: 'tracing', title: 'Tracing — ' + m.label,
      instructions: 'Trace over the light letters with your pencil. Start with the dark one!',
      mode: mode, startIndex: start, rows: rows
    };
  }

  /* ---------------- Icons (counting + odd one out) ---------------- */
  /*
   * Icons live in a 100x100 box. Each shape has a `fill` role:
   * 'main' or 'accent', resolved through a color scheme so Odd One
   * Out's medium level can recolor the whole icon with one switch.
   */
  function iconShape(pts, closed, smooth, fill) {
    return { pts: pts, closed: !!closed, smooth: !!smooth, fill: fill || 'main' };
  }

  function buildIcons() {
    var I = {};
    I.star = { name: 'star', shapes: [iconShape(starPts(50, 52, 38, 16, 5), true, false, 'main')] };
    I.heart = { name: 'heart', shapes: [iconShape(heartPts(50, 54, 2.1, 36), true, true, 'main')] };
    I.apple = { name: 'apple', shapes: [
      iconShape([[50, 34], [53, 18]], false, true, 'accent'),
      iconShape(ellipsePts(64, 22, 11, 5, -24, 16), true, true, 'accent'),
      iconShape(applePts(50, 58, 30, 27), true, true, 'main')
    ] };
    I.fish = { name: 'fish', shapes: [
      iconShape([[74, 50], [94, 32], [94, 68]], true, true, 'accent'),
      iconShape(ellipsePts(44, 50, 32, 21, 0, 28), true, true, 'main'),
      iconShape(circlePts(30, 44, 4, 10), true, false, 'accent')
    ] };
    I.flower = { name: 'flower', shapes: [
      iconShape(scallopPts(50, 46, 26, 6, 6, 40), true, true, 'main'),
      iconShape(circlePts(50, 46, 10, 18), true, true, 'accent'),
      iconShape([[50, 70], [50, 92]], false, true, 'accent'),
      iconShape(ellipsePts(40, 84, 10, 4.5, -28, 14), true, true, 'accent')
    ] };
    I.sun = { name: 'sun', shapes: [
      iconShape(starPts(50, 50, 40, 30, 8), true, false, 'accent'),
      iconShape(circlePts(50, 50, 27, 26), true, true, 'main')
    ] };
    I.moon = { name: 'moon', shapes: [iconShape(crescentPts(50, 50, 34, 36), true, true, 'main')] };
    I.balloon = { name: 'balloon', shapes: [
      iconShape(ellipsePts(50, 38, 24, 29, 0, 28), true, true, 'main'),
      iconShape([[44, 66], [56, 66], [50, 76]], true, false, 'accent'),
      iconShape([[50, 76], [44, 84], [50, 92]], false, true, 'accent')
    ] };
    I.butterfly = { name: 'butterfly', shapes: [
      iconShape(ellipsePts(30, 36, 17, 12, -25, 20), true, true, 'main'),
      iconShape(ellipsePts(70, 36, 17, 12, 25, 20), true, true, 'main'),
      iconShape(ellipsePts(32, 62, 14, 10, 25, 20), true, true, 'accent'),
      iconShape(ellipsePts(68, 62, 14, 10, -25, 20), true, true, 'accent'),
      iconShape(ellipsePts(50, 50, 5.5, 19, 0, 16), true, true, 'accent')
    ] };
    I.tree = { name: 'tree', shapes: [
      iconShape([[45, 58], [55, 58], [53, 88], [47, 88]], true, false, 'accent'),
      iconShape(circlePts(36, 44, 17, 22), true, true, 'main'),
      iconShape(circlePts(64, 44, 17, 22), true, true, 'main'),
      iconShape(circlePts(50, 28, 20, 24), true, true, 'main')
    ] };
    return I;
  }

  var ICONS = buildIcons();
  var ICON_IDS = Object.keys(ICONS);

  /* Each icon has natural colors (ICON_DEFAULT_SCHEME). Odd One
   * Out cells carry scheme 'a' (= the icon's natural colors) or 'b'
   * (= the shared alternate colors) — the medium level's recolor. */
  var ICON_ALT_SCHEME = { main: '#4361ee', accent: '#f4a261' };
  var ICON_DEFAULT_SCHEME = {
    star: { main: '#ffb703', accent: '#fb8500' },
    heart: { main: '#ef476f', accent: '#c9184a' },
    apple: { main: '#e63946', accent: '#2a7f62' },
    fish: { main: '#fb8500', accent: '#0077b6' },
    flower: { main: '#f15bb5', accent: '#2a7f62' },
    sun: { main: '#ffd166', accent: '#fb8500' },
    moon: { main: '#ffd166', accent: '#e0aa2e' },
    balloon: { main: '#9b5de5', accent: '#5a189a' },
    butterfly: { main: '#c77dff', accent: '#5a189a' },
    tree: { main: '#40916c', accent: '#7f4f24' }
  };

  function iconColors(iconId, schemeKey) {
    if (schemeKey === 'b') return ICON_ALT_SCHEME;
    return ICON_DEFAULT_SCHEME[iconId] || ICON_ALT_SCHEME;
  }

  /* ---------------- Counting ---------------- */

  var COUNTING_PROBLEMS_PER_PAGE = 4;
  var COUNT_SCENE = { w: 400, h: 300 };

  /* Grid positions with a seeded jitter; stored on the problem so the
   * screen, print and PNG views all show the identical scene. */
  function countingPositions(count, rng) {
    var cols = count <= 5 ? count : count <= 10 ? 5 : 5;
    var rows = Math.ceil(count / cols);
    var cellW = COUNT_SCENE.w / cols, cellH = COUNT_SCENE.h / Math.max(rows, 2);
    var positions = [];
    for (var i = 0; i < count; i++) {
      var c = i % cols, r = Math.floor(i / cols);
      positions.push({
        x: Math.round((c + 0.5) * cellW + (rng() - 0.5) * cellW * 0.3),
        y: Math.round((r + 0.5) * cellH + (rng() - 0.5) * cellH * 0.3)
      });
    }
    return positions;
  }

  function generateCountingPage(rangeKey, rng) {
    rng = rng || Math.random;
    var max = rangeKey === '1-20' ? 20 : 10;
    var problems = [];
    var usedIcons = shuffle(ICON_IDS.slice(), rng);
    for (var i = 0; i < COUNTING_PROBLEMS_PER_PAGE; i++) {
      var icon = usedIcons[i % usedIcons.length];
      var count = randRange(rng, 1, max);
      problems.push({
        icon: icon, count: count,
        positions: countingPositions(count, rng),
        prompt: 'Count the pictures. Write the number in the box.',
        answerText: String(count)
      });
    }
    return {
      type: 'counting', title: 'Counting Fun',
      instructions: 'Count the pictures in each group and write how many there are.',
      rangeKey: rangeKey === '1-20' ? '1-20' : '1-10',
      problems: problems
    };
  }

  /* ---------------- Odd One Out ---------------- */

  var ODD_PROBLEMS_PER_PAGE = 4;

  /*
   * Levels: easy = the odd cell shows a DIFFERENT icon;
   * medium = same icon, different colors; hard = same icon and
   * colors, but rotated. Exactly one cell is odd, by construction.
   */
  function generateOddOneOutPage(level, gridSize, rng) {
    rng = rng || Math.random;
    level = ['easy', 'medium', 'hard'].indexOf(level) >= 0 ? level : 'easy';
    gridSize = gridSize === 4 ? 4 : 3;
    var problems = [];
    for (var i = 0; i < ODD_PROBLEMS_PER_PAGE; i++) {
      var baseIcon = ICON_IDS[randInt(rng, ICON_IDS.length)];
      var oddIcon = baseIcon;
      if (level === 'easy') {
        do { oddIcon = ICON_IDS[randInt(rng, ICON_IDS.length)]; } while (oddIcon === baseIcon);
      }
      var oddIndex = randInt(rng, gridSize * gridSize);
      var oddRot = level === 'hard' ? pick(rng, [90, 180, 270]) : 0;
      var cells = [];
      for (var j = 0; j < gridSize * gridSize; j++) {
        var isOdd = j === oddIndex;
        cells.push({
          icon: isOdd ? oddIcon : baseIcon,
          scheme: level === 'medium' && isOdd ? 'b' : 'a',
          rot: isOdd ? oddRot : 0
        });
      }
      var row = Math.floor(oddIndex / gridSize) + 1;
      var col = (oddIndex % gridSize) + 1;
      problems.push({
        size: gridSize, cells: cells, oddIndex: oddIndex,
        baseIcon: baseIcon, oddIcon: oddIcon, level: level,
        answerText: 'Picture ' + (oddIndex + 1) + ' (row ' + row + ', column ' + col + ')'
      });
    }
    return {
      type: 'oddoneout', title: 'Odd One Out',
      instructions: 'Look at each group. One picture is different — can you find it?',
      level: level, problems: problems
    };
  }

  /* ---------------- Answers, solutions, signatures ---------------- */

  /* Text answers for the types that have them (MWG-style alignment:
   * derived from the page itself, same order as printed). */
  function answerKey(page) {
    if (!page) return [];
    switch (page.type) {
      case 'counting':
      case 'oddoneout':
        return page.problems.map(function (p) { return p.answerText; });
      case 'wordsearch':
        return page.placements.map(function (p) { return p.word; });
      default:
        return [];
    }
  }

  /* Which page types get a solution page in a book's Solutions
   * section. Coloring and tracing have no answers by design. */
  function pageHasSolution(page) {
    return !!page && ['maze', 'wordsearch', 'dottodot', 'counting', 'oddoneout']
      .indexOf(page.type) >= 0;
  }

  /* A content fingerprint used to keep one book free of duplicates. */
  function pageSignature(page) {
    if (!page) return '';
    switch (page.type) {
      case 'maze':
        return 'maze:' + page.walls.join(',');
      case 'wordsearch':
        return 'ws:' + page.theme + ':' +
          page.grid.map(function (r) { return r.join(''); }).join('/');
      case 'coloring':
        return 'coloring:' + page.designId;
      case 'dottodot':
        return 'd2d:' + page.designId + ':' + page.points.length + ':' +
          (page.points[0] ? page.points[0].x + ',' + page.points[0].y : '');
      case 'tracing':
        return 'tracing:' + page.mode + ':' + page.startIndex;
      case 'counting':
        return 'counting:' + page.problems.map(function (p) {
          return p.icon + 'x' + p.count;
        }).join('|');
      case 'oddoneout':
        return 'odd:' + page.problems.map(function (p) {
          return p.baseIcon + '>' + p.oddIcon + '@' + p.oddIndex + ':' + p.level;
        }).join('|');
      default:
        return page.type + ':' + Math.random();
    }
  }

  /* ---------------- Book assembly (pure; used by book.js) ---------------- */

  var BOOK_TYPE_ORDER = ['maze', 'wordsearch', 'coloring', 'dottodot',
    'tracing', 'counting', 'oddoneout'];
  var WS_THEME_KEYS = Object.keys(WS_THEMES);
  var TRACING_MODE_KEYS = Object.keys(TRACING_MODES);

  /*
   * spec: { counts: {maze: n, wordsearch: n, ...} }
   * Returns an array of pages in BOOK_TYPE_ORDER. Makers cycle their
   * variant (maze size, WS theme, design, tracing mode/start, odd
   * level) per page, and every page is checked against the signatures
   * already in the book — duplicates are regenerated with fresh rng
   * draws (bounded attempts; fixed-content types like coloring fall
   * back to the next design in the cycle).
   */
  function assembleBook(spec, rng) {
    rng = rng || Math.random;
    spec = spec || {};
    var counts = spec.counts || {};
    var seen = {};
    var variant = {};
    BOOK_TYPE_ORDER.forEach(function (t) { variant[t] = 0; });

    function fresh(makeFn, type) {
      for (var attempt = 0; attempt < 60; attempt++) {
        var v = variant[type]++;
        var page = makeFn(v);
        var sig = pageSignature(page);
        if (!seen[sig]) { seen[sig] = true; return page; }
      }
      // pool genuinely exhausted (e.g. more coloring pages than
      // designs): accept the last variant rather than loop forever
      var last = makeFn(variant[type]++);
      seen[pageSignature(last)] = true;
      return last;
    }

    var makers = {
      maze: function (v) {
        return generateMazePage(['easy', 'medium', 'hard'][v % 3], rng);
      },
      wordsearch: function (v) {
        return generateWordSearchPage(WS_THEME_KEYS[v % WS_THEME_KEYS.length],
          v % 2 ? 12 : 10, { diagonal: v % 3 === 2 }, rng);
      },
      coloring: function (v) {
        return generateColoringPage(DESIGNS[v % DESIGNS.length].id, rng);
      },
      dottodot: function (v) {
        return generateDotToDotPage(DESIGNS[v % DESIGNS.length].id, 30, rng);
      },
      tracing: function (v) {
        var mode = TRACING_MODE_KEYS[v % TRACING_MODE_KEYS.length];
        var cycle = Math.floor(v / TRACING_MODE_KEYS.length);
        var items = TRACING_MODES[mode].items.length;
        return generateTracingPage(mode, rng,
          (cycle * TRACING_ROWS_PER_SHEET) % items);
      },
      counting: function () {
        return generateCountingPage(rng() < 0.5 ? '1-10' : '1-20', rng);
      },
      oddoneout: function (v) {
        return generateOddOneOutPage(['easy', 'medium', 'hard'][v % 3], v % 2 ? 4 : 3, rng);
      }
    };

    var pages = [];
    BOOK_TYPE_ORDER.forEach(function (type) {
      var n = Math.max(0, Math.min(100, counts[type] || 0));
      for (var i = 0; i < n; i++) pages.push(fresh(makers[type], type));
    });
    return pages;
  }

  /* ---------------- API ---------------- */

  var api = {
    makeRng: makeRng, randInt: randInt, randRange: randRange,
    shuffle: shuffle, pick: pick,
    circlePts: circlePts, ellipsePts: ellipsePts, starPts: starPts,
    heartPts: heartPts, scallopPts: scallopPts, crescentPts: crescentPts,
    rectPts: rectPts, mirrorX: mirrorX, rotatePts: rotatePts,
    polylineLength: polylineLength, sampleClosed: sampleClosed,
    shapePathCmds: shapePathCmds,
    generateMazeData: generateMazeData, solveMaze: solveMaze,
    mazeOpenPassages: mazeOpenPassages, MAZE_SIZES: MAZE_SIZES,
    generateMazePage: generateMazePage,
    WS_THEMES: WS_THEMES, cleanWord: cleanWord,
    generateWordSearch: generateWordSearch,
    generateWordSearchPage: generateWordSearchPage,
    DESIGNS: DESIGNS, getDesign: getDesign, outlineShape: outlineShape,
    generateColoringPage: generateColoringPage,
    generateDotToDotPage: generateDotToDotPage,
    TRACING_WORDS: TRACING_WORDS, TRACING_MODES: TRACING_MODES,
    TRACING_ROWS_PER_SHEET: TRACING_ROWS_PER_SHEET,
    generateTracingPage: generateTracingPage,
    ICONS: ICONS, ICON_IDS: ICON_IDS, ICON_ALT_SCHEME: ICON_ALT_SCHEME,
    ICON_DEFAULT_SCHEME: ICON_DEFAULT_SCHEME, iconColors: iconColors,
    COUNT_SCENE: COUNT_SCENE,
    generateCountingPage: generateCountingPage,
    generateOddOneOutPage: generateOddOneOutPage,
    answerKey: answerKey, pageHasSolution: pageHasSolution,
    pageSignature: pageSignature,
    assembleBook: assembleBook, BOOK_TYPE_ORDER: BOOK_TYPE_ORDER
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KAB = api;
})(typeof window !== 'undefined' ? window : globalThis);
