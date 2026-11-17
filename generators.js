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

  /* A deck deals every item once before reshuffling — used by the Book
     Builder so a whole book spreads across the full picture library
     instead of reusing the first few designs. Deterministic under rng. */
  function makeDeck(items, rng) {
    var order = shuffle(items.slice(), rng);
    var cursor = 0;
    return {
      take: function () {
        if (cursor >= order.length) { order = shuffle(items.slice(), rng); cursor = 0; }
        return order[cursor++];
      },
      size: items.length
    };
  }

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

    /* ---- Frog ---- */
    D.push(design('frog', 'Frog', [
      shape(circlePts(88, 64, 17, 24), true, true),
      shape(circlePts(152, 64, 17, 24), true, true),
      shape(ellipsePts(120, 138, 66, 52, 0, 40), true, true, { outline: true }),
      shape(ellipsePts(120, 158, 40, 32, 0, 32), true, true),
      shape(circlePts(88, 64, 7, 16), true, false),
      shape(circlePts(152, 64, 7, 16), true, false),
      shape([[84, 118], [120, 136], [156, 118]], false, true),
      shape(ellipsePts(52, 176, 20, 12, -20, 24), true, true),
      shape(ellipsePts(188, 176, 20, 12, 20, 24), true, true),
      shape(circlePts(76, 150, 6, 14), true, false),
      shape(circlePts(168, 140, 5, 12), true, false)
    ]));

    /* ---- Duck ---- */
    D.push(design('duck', 'Duck', [
      shape([[66, 128], [34, 106], [46, 148]], true, true),
      shape(ellipsePts(112, 146, 64, 44, 0, 40), true, true, { outline: true }),
      shape(ellipsePts(104, 150, 34, 20, -15, 28), true, true),
      shape(circlePts(172, 86, 32, 32), true, true),
      shape([[198, 78], [230, 90], [198, 102]], true, true),
      shape(circlePts(180, 80, 5, 12), true, false),
      shape([[26, 206], [58, 197], [90, 206], [122, 197], [154, 206], [186, 197], [214, 204]], false, true)
    ]));

    /* ---- Owl ---- */
    D.push(design('owl', 'Owl', [
      shape([[78, 66], [68, 28], [106, 50]], true, true),
      shape([[162, 66], [172, 28], [134, 50]], true, true),
      shape(ellipsePts(58, 140, 14, 40, 10, 24), true, true),
      shape(ellipsePts(182, 140, 14, 40, -10, 24), true, true),
      shape(ellipsePts(120, 130, 56, 70, 0, 40), true, true, { outline: true }),
      shape(circlePts(120, 102, 40, 36), true, true),
      shape(circlePts(104, 100, 12, 20), true, false),
      shape(circlePts(136, 100, 12, 20), true, false),
      shape(circlePts(104, 100, 5, 12), true, false),
      shape(circlePts(136, 100, 5, 12), true, false),
      shape([[120, 118], [111, 109], [129, 109]], true, true),
      shape(ellipsePts(120, 160, 32, 40, 0, 32), true, true),
      shape([[100, 142], [120, 150], [140, 142]], false, true),
      shape([[100, 204], [100, 216]], false, false),
      shape([[140, 204], [140, 216]], false, false)
    ]));

    /* ---- Elephant ---- */
    D.push(design('elephant', 'Elephant', [
      shape([[52, 112], [38, 148]], false, true),
      shape(rectPts(66, 166, 18, 38), true, false),
      shape(rectPts(128, 166, 18, 38), true, false),
      shape(ellipsePts(112, 134, 62, 48, 0, 40), true, true, { outline: true }),
      shape(ellipsePts(146, 108, 26, 34, 0, 28), true, true),
      shape(circlePts(176, 102, 36, 36), true, true),
      shape([[196, 114], [207, 148], [199, 182], [183, 191]], false, true),
      shape([[170, 126], [157, 146], [174, 141]], true, true),
      shape(circlePts(183, 95, 5, 12), true, false)
    ]));

    /* ---- Lion ---- */
    D.push(design('lion', 'Lion', [
      shape(scallopPts(120, 118, 76, 11, 12, 64), true, true, { outline: true }),
      shape(circlePts(82, 58, 12, 20), true, true),
      shape(circlePts(158, 58, 12, 20), true, true),
      shape(circlePts(120, 118, 50, 40), true, true),
      shape(circlePts(100, 106, 6, 14), true, false),
      shape(circlePts(140, 106, 6, 14), true, false),
      shape(ellipsePts(120, 140, 26, 18, 0, 24), true, true),
      shape([[120, 130], [110, 121], [130, 121]], true, true),
      shape([[120, 130], [120, 138], [110, 145]], false, true),
      shape([[120, 138], [130, 145]], false, true),
      shape([[62, 130], [94, 135]], false, false),
      shape([[178, 130], [146, 135]], false, false)
    ]));

    /* ---- Penguin ---- */
    D.push(design('penguin', 'Penguin', [
      shape(ellipsePts(56, 140, 13, 38, 18, 24), true, true),
      shape(ellipsePts(184, 140, 13, 38, -18, 24), true, true),
      shape(ellipsePts(120, 126, 54, 72, 0, 40), true, true, { outline: true }),
      shape(ellipsePts(120, 144, 36, 52, 0, 36), true, true),
      shape(circlePts(104, 84, 6, 14), true, false),
      shape(circlePts(136, 84, 6, 14), true, false),
      shape([[120, 102], [108, 93], [132, 93]], true, true),
      shape(ellipsePts(94, 206, 18, 8, 0, 20), true, true),
      shape(ellipsePts(146, 206, 18, 8, 0, 20), true, true)
    ]));

    /* ---- Rabbit ---- */
    D.push(design('rabbit', 'Rabbit', [
      shape(ellipsePts(94, 54, 15, 40, -6, 28), true, true),
      shape(ellipsePts(146, 54, 15, 40, 6, 28), true, true),
      shape(ellipsePts(94, 58, 7, 26, -6, 22), true, true),
      shape(ellipsePts(146, 58, 7, 26, 6, 22), true, true),
      shape(circlePts(120, 140, 58, 44), true, true, { outline: true }),
      shape(circlePts(98, 128, 7, 16), true, false),
      shape(circlePts(142, 128, 7, 16), true, false),
      shape([[120, 150], [112, 143], [128, 143]], true, true),
      shape(rectPts(112, 160, 16, 14), true, false),
      shape(circlePts(84, 158, 9, 16), true, false),
      shape(circlePts(156, 158, 9, 16), true, false),
      shape([[38, 140], [84, 146]], false, false),
      shape([[202, 140], [156, 146]], false, false),
      shape([[40, 160], [84, 155]], false, false),
      shape([[200, 160], [156, 155]], false, false)
    ]));

    /* ---- Turtle ---- */
    D.push(design('turtle', 'Turtle', [
      shape([[42, 138], [20, 150], [44, 156]], true, true),
      shape(rectPts(60, 174, 20, 18), true, false),
      shape(rectPts(138, 174, 20, 18), true, false),
      shape(ellipsePts(108, 134, 66, 48, 0, 40), true, true, { outline: true }),
      shape(ellipsePts(108, 134, 44, 31, 0, 32), true, true),
      shape(circlePts(108, 134, 20, 6), true, false),
      shape(circlePts(194, 114, 24, 28), true, true),
      shape(circlePts(199, 108, 4.5, 10), true, false),
      shape([[16, 200], [224, 200]], false, false)
    ]));

    /* ---- Banana (rotated crescent silhouette) ---- */
    (function () {
      var outer = rotatePts(crescentPts(120, 128, 82, 40), 120, 128, -38);
      var inner = rotatePts(crescentPts(120, 128, 58, 30).slice(0, 16), 120, 128, -38);
      D.push(design('banana', 'Banana', [
        shape(outer, true, true, { outline: true }),
        shape([[103, 32], [119, 35], [114, 54], [105, 51]], true, true),
        shape(inner, false, true),
        shape(rotatePts(crescentPts(120, 128, 70, 34).slice(0, 13), 120, 128, -38), false, true)
      ]));
    })();

    /* ---- Carrot ---- */
    D.push(design('carrot', 'Carrot', [
      shape(ellipsePts(103, 44, 9, 26, -18, 20), true, true),
      shape(ellipsePts(122, 38, 9, 28, 0, 20), true, true),
      shape(ellipsePts(141, 44, 9, 26, 18, 20), true, true),
      shape([[96, 74], [148, 74], [125, 194], [119, 194]], true, true, { outline: true }),
      shape([[103, 110], [141, 110]], false, false),
      shape([[107, 142], [137, 142]], false, false),
      shape([[112, 170], [131, 170]], false, false)
    ]));

    /* ---- Cake ---- */
    D.push(design('cake', 'Cake', [
      shape(ellipsePts(120, 202, 88, 10, 0, 36), true, true),
      shape(rectPts(54, 128, 132, 66), true, false, { outline: true }),
      shape(rectPts(76, 84, 88, 44), true, false),
      shape(rectPts(94, 54, 7, 26), true, false),
      shape(rectPts(117, 50, 7, 26), true, false),
      shape(rectPts(140, 54, 7, 26), true, false),
      shape(ellipsePts(97, 44, 5, 9, 0, 16), true, true),
      shape(ellipsePts(120, 40, 5, 9, 0, 16), true, true),
      shape(ellipsePts(143, 44, 5, 9, 0, 16), true, true),
      shape(circlePts(96, 106, 7, 14), true, false),
      shape(circlePts(144, 106, 7, 14), true, false),
      shape(circlePts(84, 158, 6, 12), true, false),
      shape(circlePts(120, 166, 6, 12), true, false),
      shape(circlePts(156, 158, 6, 12), true, false)
    ]));

    /* ---- Cookie ---- */
    D.push(design('cookie', 'Cookie', [
      shape(circlePts(120, 120, 74, 44), true, true, { outline: true }),
      shape(circlePts(120, 120, 59, 40), true, false),
      shape(circlePts(92, 96, 9, 16), true, false),
      shape(circlePts(142, 88, 8, 14), true, false),
      shape(circlePts(160, 128, 9, 16), true, false),
      shape(circlePts(102, 148, 8, 14), true, false),
      shape(circlePts(74, 130, 7, 12), true, false),
      shape(circlePts(134, 162, 8, 14), true, false)
    ]));

    /* ---- Boat ---- */
    D.push(design('boat', 'Boat', [
      shape([[120, 140], [120, 48]], false, false),
      shape([[128, 58], [128, 134], [174, 134]], true, true),
      shape([[112, 76], [112, 134], [76, 134]], true, true),
      shape([[120, 48], [144, 57], [120, 66]], true, true),
      shape([[44, 142], [196, 142], [172, 186], [68, 186]], true, false, { outline: true }),
      shape([[58, 156], [182, 156]], false, false),
      shape(circlePts(94, 170, 6, 12), true, false),
      shape(circlePts(124, 170, 6, 12), true, false),
      shape(circlePts(154, 170, 6, 12), true, false),
      shape([[24, 210], [52, 201], [80, 210], [108, 201], [136, 210], [164, 201], [192, 210], [216, 203]], false, true)
    ]));

    /* ---- Train (side view) ---- */
    D.push(design('train', 'Train', [
      shape(circlePts(62, 56, 12, 20), true, true),
      shape(circlePts(79, 38, 9, 16), true, true),
      shape(rectPts(52, 76, 20, 34), true, false),
      shape(circlePts(104, 100, 14, 20), true, true),
      shape(rectPts(148, 62, 58, 100), true, false),
      shape(rectPts(160, 74, 34, 30), true, false),
      shape(rectPts(34, 108, 150, 54), true, false, { outline: true }),
      shape([[184, 160], [216, 190], [184, 190]], true, true),
      shape(circlePts(64, 178, 19, 24), true, false),
      shape(circlePts(116, 178, 19, 24), true, false),
      shape(circlePts(172, 176, 23, 28), true, false),
      shape(circlePts(64, 178, 7, 12), true, false),
      shape(circlePts(116, 178, 7, 12), true, false),
      shape(circlePts(172, 176, 8, 14), true, false),
      shape([[14, 206], [226, 206]], false, false)
    ]));

    /* ---- Plane (side view) ---- */
    D.push(design('plane', 'Plane', [
      shape([[170, 106], [198, 60], [209, 106]], true, true),
      shape([[178, 128], [206, 143], [179, 148]], true, true),
      shape(ellipsePts(118, 122, 80, 27, 0, 40), true, true, { outline: true }),
      shape([[102, 130], [140, 170], [110, 172], [82, 136]], true, true),
      shape(ellipsePts(52, 113, 12, 9, 0, 20), true, true),
      shape(circlePts(86, 115, 6, 12), true, false),
      shape(circlePts(112, 112, 6, 12), true, false),
      shape(circlePts(138, 112, 6, 12), true, false),
      shape(circlePts(162, 115, 6, 12), true, false),
      shape([[46, 134], [190, 134]], false, true)
    ]));

    /* ---- Leaf ---- */
    D.push(design('leaf', 'Leaf', [
      shape([[120, 34], [172, 92], [120, 204], [68, 92]], true, true, { outline: true }),
      shape([[120, 50], [120, 218]], false, true),
      shape([[120, 96], [149, 79]], false, true),
      shape([[120, 96], [91, 79]], false, true),
      shape([[120, 142], [151, 125]], false, true),
      shape([[120, 142], [89, 125]], false, true)
    ]));

    /* ---- Cloud (flattened scallop silhouette + rain) ---- */
    (function () {
      var blob = scallopPts(120, 116, 58, 13, 6, 64).map(function (p) {
        return [p[0], 116 + (p[1] - 116) * 0.74];
      });
      D.push(design('cloud', 'Cloud', [
        shape(blob, true, true, { outline: true }),
        shape([[74, 128], [102, 139], [140, 137], [168, 124]], false, true),
        shape(ellipsePts(84, 184, 5, 10, 0, 14), true, true),
        shape(ellipsePts(120, 194, 5, 10, 0, 14), true, true),
        shape(ellipsePts(156, 184, 5, 10, 0, 14), true, true)
      ]));
    })();

    /* ---- Moon ---- */
    D.push(design('moon', 'Moon', [
      shape(crescentPts(122, 120, 80, 40), true, true, { outline: true }),
      shape(starPts(170, 82, 15, 6.2, 5), true, false),
      shape(starPts(188, 142, 10, 4.2, 5), true, false),
      shape([[90, 108], [103, 115], [116, 108]], false, true),
      shape(circlePts(98, 132, 7, 14), true, false)
    ]));

    /* ---- Ball ---- */
    D.push(design('ball', 'Ball', [
      shape(circlePts(120, 120, 75, 44), true, true, { outline: true }),
      shape(circlePts(120, 120, 27, 5), true, false),
      shape([[98, 102], [68, 82], [52, 58]], false, true),
      shape([[142, 102], [172, 82], [188, 58]], false, true),
      shape([[95, 133], [66, 152], [50, 178]], false, true),
      shape([[145, 133], [174, 152], [190, 178]], false, true),
      shape([[120, 147], [120, 182]], false, true)
    ]));

    /* ---- Kite ---- */
    D.push(design('kite', 'Kite', [
      shape([[120, 36], [178, 114], [120, 210], [62, 114]], true, false, { outline: true }),
      shape([[62, 114], [178, 114]], false, false),
      shape([[120, 36], [120, 210]], false, false),
      shape([[120, 210], [107, 224], [126, 231], [113, 240]], false, true),
      shape([[98, 220], [115, 227], [99, 234]], true, true)
    ]));

    /* ---- Balloon ---- */
    D.push(design('balloon', 'Balloon', [
      shape(ellipsePts(120, 102, 54, 66, 0, 40), true, true, { outline: true }),
      shape(ellipsePts(98, 78, 12, 20, -16, 22), true, true),
      shape([[110, 170], [130, 170], [120, 186]], true, true),
      shape([[120, 186], [108, 204], [127, 217], [114, 234]], false, true)
    ]));

    /* ---- Book ---- */
    D.push(design('book', 'Book', [
      shape(rectPts(64, 50, 112, 140), true, false, { outline: true }),
      shape(rectPts(72, 58, 96, 124), true, false),
      shape([[140, 50], [156, 50], [156, 98], [148, 85], [140, 98]], true, true),
      shape([[94, 94], [132, 94]], false, false),
      shape([[94, 112], [126, 112]], false, false),
      shape(starPts(112, 152, 14, 5.8, 5), true, false)
    ]));

    /* ---- Whale ---- */
    D.push(design('whale', 'Whale', [
      shape(ellipsePts(98, 50, 7, 13, 0, 16), true, true),
      shape(ellipsePts(118, 38, 7, 14, 0, 16), true, true),
      shape(ellipsePts(138, 50, 7, 13, 0, 16), true, true),
      shape([[178, 112], [212, 84], [214, 126], [188, 140]], true, true),
      shape(ellipsePts(108, 128, 72, 44, 0, 40), true, true, { outline: true }),
      shape([[58, 150], [108, 168], [158, 148]], false, true),
      shape([[96, 162], [118, 188], [130, 160]], true, true),
      shape(circlePts(62, 118, 5.5, 12), true, false),
      shape([[44, 138], [74, 149]], false, true)
    ]));

    /* ---- Octopus ---- */
    D.push(design('octopus', 'Octopus', [
      shape(ellipsePts(74, 158, 13, 30, 10, 22), true, true),
      shape(ellipsePts(103, 168, 13, 32, 3, 22), true, true),
      shape(ellipsePts(133, 168, 13, 32, -3, 22), true, true),
      shape(ellipsePts(162, 158, 13, 30, -10, 22), true, true),
      shape(circlePts(120, 94, 48, 40), true, true, { outline: true }),
      shape(circlePts(102, 92, 10, 18), true, false),
      shape(circlePts(138, 92, 10, 18), true, false),
      shape(circlePts(102, 92, 4.5, 10), true, false),
      shape(circlePts(138, 92, 4.5, 10), true, false),
      shape([[110, 116], [120, 123], [130, 116]], false, true),
      shape(circlePts(86, 62, 6, 12), true, false),
      shape(circlePts(148, 56, 5, 10), true, false)
    ]));

    /* ---- Shell ---- */
    D.push(design('shell', 'Shell', [
      shape(scallopPts(120, 116, 68, 11, 7, 64), true, true, { outline: true }),
      shape([[120, 170], [74, 82]], false, false),
      shape([[120, 170], [103, 60]], false, false),
      shape([[120, 170], [137, 60]], false, false),
      shape([[120, 170], [166, 82]], false, false),
      shape([[84, 168], [156, 168], [146, 190], [94, 190]], true, true)
    ]));

    /* ---- Planet ---- */
    D.push(design('planet', 'Planet', [
      shape(ellipsePts(120, 120, 90, 25, -16, 48), true, true),
      shape(circlePts(120, 120, 55, 40), true, true, { outline: true }),
      shape(circlePts(100, 104, 10, 18), true, false),
      shape(circlePts(138, 134, 8, 14), true, false),
      shape(circlePts(112, 144, 6, 12), true, false)
    ]));

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

  /* The pictured-noun library: every design except the mandalas. Each id
     doubles as the one-word lowercase pictured noun (reading strips,
     counting and odd-one-out all speak this same vocabulary). */
  var NOUN_DESIGNS = DESIGNS.filter(function (d) { return d.id.indexOf('mandala') !== 0; });
  var PICTURE_WORDS = NOUN_DESIGNS.map(function (d) { return d.id; });

  /* Dot-to-Dot pool: designs whose outline is their real silhouette.
     The mandalas are excluded — their outline is only the plain outer
     ring, so connecting the dots would reveal none of the pattern.
     (An excluded design can still be requested explicitly by id.) */
  var D2D_EXCLUDED = ['mandala1', 'mandala2', 'mandala3', 'mandala4'];
  var D2D_POOL = DESIGNS.filter(function (d) { return D2D_EXCLUDED.indexOf(d.id) === -1; })
    .map(function (d) { return d.id; });

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
      : getDesign(D2D_POOL[randInt(rng, D2D_POOL.length)]);
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
    I.cat = { name: 'cat', shapes: [
      iconShape([[26, 36], [21, 12], [45, 25]], true, true, 'main'),
      iconShape([[74, 36], [79, 12], [55, 25]], true, true, 'main'),
      iconShape(circlePts(50, 57, 30, 28), true, true, 'main'),
      iconShape(circlePts(39, 54, 3.5, 10), true, false, 'accent'),
      iconShape(circlePts(61, 54, 3.5, 10), true, false, 'accent'),
      iconShape([[50, 64], [45, 60], [55, 60]], true, true, 'accent')
    ] };
    I.dog = { name: 'dog', shapes: [
      iconShape(ellipsePts(23, 46, 9, 21, 12, 18), true, true, 'accent'),
      iconShape(ellipsePts(77, 46, 9, 21, -12, 18), true, true, 'accent'),
      iconShape(circlePts(50, 54, 30, 28), true, true, 'main'),
      iconShape(ellipsePts(50, 67, 15, 10, 0, 18), true, true, 'accent'),
      iconShape(ellipsePts(50, 62, 6, 4, 0, 12), true, true, 'accent'),
      iconShape(circlePts(39, 50, 3.5, 10), true, false, 'accent'),
      iconShape(circlePts(61, 50, 3.5, 10), true, false, 'accent')
    ] };
    I.bird = { name: 'bird', shapes: [
      iconShape(ellipsePts(45, 59, 27, 21, 0, 24), true, true, 'main'),
      iconShape(circlePts(69, 36, 14, 20), true, true, 'main'),
      iconShape([[81, 33], [96, 38], [81, 44]], true, true, 'accent'),
      iconShape(ellipsePts(42, 59, 14, 9, -20, 16), true, true, 'accent'),
      iconShape(circlePts(72, 34, 2.5, 8), true, false, 'accent'),
      iconShape([[40, 80], [40, 90]], false, false, 'accent'),
      iconShape([[54, 80], [54, 90]], false, false, 'accent')
    ] };
    I.house = { name: 'house', shapes: [
      iconShape(rectPts(63, 28, 8, 15), true, false, 'accent'),
      iconShape([[22, 52], [50, 25], [78, 52], [78, 84], [22, 84]], true, false, 'main'),
      iconShape(rectPts(44, 63, 12, 21), true, false, 'accent')
    ] };
    I.car = { name: 'car', shapes: [
      iconShape([[13, 66], [17, 49], [35, 46], [45, 31], [63, 31], [73, 46], [86, 49], [89, 66]], true, true, 'main'),
      iconShape([[39, 47], [48, 35], [53, 35], [53, 47]], true, true, 'accent'),
      iconShape([[57, 47], [57, 35], [62, 35], [70, 47]], true, true, 'accent'),
      iconShape(circlePts(29, 68, 9, 16), true, false, 'accent'),
      iconShape(circlePts(73, 68, 9, 16), true, false, 'accent')
    ] };
    I.rocket = { name: 'rocket', shapes: [
      iconShape([[38, 54], [25, 74], [40, 68]], true, true, 'accent'),
      iconShape([[62, 54], [75, 74], [60, 68]], true, true, 'accent'),
      iconShape([[50, 8], [62, 27], [64, 49], [58, 68], [42, 68], [36, 49], [38, 27]], true, true, 'main'),
      iconShape(circlePts(50, 39, 7, 14), true, false, 'accent'),
      iconShape([[44, 72], [50, 90], [56, 72]], true, true, 'accent')
    ] };
    I.frog = { name: 'frog', shapes: [
      iconShape(circlePts(50, 56, 30, 28), true, true, 'main'),
      iconShape(circlePts(31, 30, 10, 16), true, true, 'main'),
      iconShape(circlePts(69, 30, 10, 16), true, true, 'main'),
      iconShape(circlePts(31, 30, 4, 10), true, false, 'accent'),
      iconShape(circlePts(69, 30, 4, 10), true, false, 'accent'),
      iconShape([[36, 60], [50, 68], [64, 60]], false, true, 'accent')
    ] };
    I.duck = { name: 'duck', shapes: [
      iconShape(ellipsePts(43, 61, 29, 20, 0, 24), true, true, 'main'),
      iconShape(circlePts(72, 36, 15, 20), true, true, 'main'),
      iconShape([[85, 33], [98, 38], [85, 43]], true, true, 'accent'),
      iconShape(circlePts(75, 34, 2.5, 8), true, false, 'accent'),
      iconShape(ellipsePts(40, 62, 15, 9, -15, 16), true, true, 'accent')
    ] };
    I.owl = { name: 'owl', shapes: [
      iconShape(ellipsePts(50, 54, 26, 33, 0, 26), true, true, 'main'),
      iconShape(circlePts(50, 42, 19, 22), true, true, 'accent'),
      iconShape(circlePts(42, 42, 5, 12), true, false, 'main'),
      iconShape(circlePts(58, 42, 5, 12), true, false, 'main'),
      iconShape([[50, 52], [45, 47], [55, 47]], true, true, 'main'),
      iconShape(ellipsePts(50, 68, 14, 17, 0, 18), true, true, 'accent')
    ] };
    I.elephant = { name: 'elephant', shapes: [
      iconShape(rectPts(28, 68, 8, 16), true, false, 'main'),
      iconShape(rectPts(52, 68, 8, 16), true, false, 'main'),
      iconShape(ellipsePts(44, 55, 28, 22, 0, 24), true, true, 'main'),
      iconShape(circlePts(74, 43, 17, 22), true, true, 'main'),
      iconShape(ellipsePts(65, 45, 10, 14, 0, 16), true, true, 'accent'),
      iconShape([[85, 51], [89, 66], [83, 76]], false, true, 'accent'),
      iconShape(circlePts(77, 40, 2.5, 8), true, false, 'accent')
    ] };
    I.lion = { name: 'lion', shapes: [
      iconShape(scallopPts(50, 50, 34, 5, 10, 48), true, true, 'accent'),
      iconShape(circlePts(50, 50, 23, 26), true, true, 'main'),
      iconShape(circlePts(42, 47, 2.5, 8), true, false, 'accent'),
      iconShape(circlePts(58, 47, 2.5, 8), true, false, 'accent'),
      iconShape([[50, 56], [45, 52], [55, 52]], true, true, 'accent')
    ] };
    I.penguin = { name: 'penguin', shapes: [
      iconShape(ellipsePts(50, 52, 24, 33, 0, 26), true, true, 'main'),
      iconShape(ellipsePts(50, 61, 16, 24, 0, 22), true, true, 'accent'),
      iconShape(circlePts(43, 38, 3, 8), true, false, 'accent'),
      iconShape(circlePts(57, 38, 3, 8), true, false, 'accent'),
      iconShape([[50, 47], [44, 42], [56, 42]], true, true, 'accent'),
      iconShape(ellipsePts(38, 87, 9, 4, 0, 12), true, true, 'accent'),
      iconShape(ellipsePts(62, 87, 9, 4, 0, 12), true, true, 'accent')
    ] };
    I.rabbit = { name: 'rabbit', shapes: [
      iconShape(ellipsePts(38, 19, 7, 16, -5, 16), true, true, 'main'),
      iconShape(ellipsePts(62, 19, 7, 16, 5, 16), true, true, 'main'),
      iconShape(ellipsePts(38, 21, 3, 10, -5, 12), true, true, 'accent'),
      iconShape(ellipsePts(62, 21, 3, 10, 5, 12), true, true, 'accent'),
      iconShape(circlePts(50, 61, 26, 26), true, true, 'main'),
      iconShape(circlePts(41, 57, 3, 8), true, false, 'accent'),
      iconShape(circlePts(59, 57, 3, 8), true, false, 'accent'),
      iconShape([[50, 66], [46, 62], [54, 62]], true, true, 'accent')
    ] };
    I.turtle = { name: 'turtle', shapes: [
      iconShape(rectPts(30, 72, 10, 9), true, false, 'main'),
      iconShape(rectPts(56, 72, 10, 9), true, false, 'main'),
      iconShape(ellipsePts(46, 55, 30, 21, 0, 24), true, true, 'main'),
      iconShape(ellipsePts(46, 55, 19, 13, 0, 18), true, true, 'accent'),
      iconShape(circlePts(83, 49, 10, 14), true, true, 'main'),
      iconShape(circlePts(86, 47, 2, 6), true, false, 'accent')
    ] };
    I.banana = { name: 'banana', shapes: [
      iconShape(rotatePts(crescentPts(50, 53, 34, 30), 50, 53, -32), true, true, 'main'),
      iconShape(rectPts(40, 10, 7, 10), true, false, 'accent')
    ] };
    I.carrot = { name: 'carrot', shapes: [
      iconShape(ellipsePts(43, 18, 4.5, 12, -16, 12), true, true, 'accent'),
      iconShape(ellipsePts(52, 15, 4.5, 13, 0, 12), true, true, 'accent'),
      iconShape(ellipsePts(61, 18, 4.5, 12, 16, 12), true, true, 'accent'),
      iconShape([[38, 32], [64, 32], [52, 86], [50, 86]], true, true, 'main'),
      iconShape([[43, 50], [60, 50]], false, false, 'accent'),
      iconShape([[46, 66], [57, 66]], false, false, 'accent')
    ] };
    I.cake = { name: 'cake', shapes: [
      iconShape(rectPts(21, 57, 58, 27), true, false, 'main'),
      iconShape(rectPts(31, 39, 38, 18), true, false, 'accent'),
      iconShape(rectPts(40, 24, 4, 12), true, false, 'accent'),
      iconShape(rectPts(56, 24, 4, 12), true, false, 'accent'),
      iconShape(ellipsePts(42, 19, 3, 5, 0, 10), true, true, 'main'),
      iconShape(ellipsePts(58, 19, 3, 5, 0, 10), true, true, 'main'),
      iconShape(circlePts(50, 70, 4, 10), true, false, 'accent')
    ] };
    I.cookie = { name: 'cookie', shapes: [
      iconShape(circlePts(50, 50, 33, 30), true, true, 'main'),
      iconShape(circlePts(38, 40, 4.5, 10), true, false, 'accent'),
      iconShape(circlePts(60, 36, 4, 10), true, false, 'accent'),
      iconShape(circlePts(64, 56, 4.5, 10), true, false, 'accent'),
      iconShape(circlePts(42, 60, 4, 10), true, false, 'accent'),
      iconShape(circlePts(54, 70, 3.5, 8), true, false, 'accent')
    ] };
    I.boat = { name: 'boat', shapes: [
      iconShape([[16, 58], [84, 58], [74, 79], [26, 79]], true, true, 'accent'),
      iconShape([[50, 56], [50, 14]], false, false, 'accent'),
      iconShape([[54, 20], [54, 52], [74, 52]], true, true, 'main'),
      iconShape([[46, 30], [46, 52], [30, 52]], true, true, 'main')
    ] };
    I.train = { name: 'train', shapes: [
      iconShape(rectPts(24, 30, 8, 14), true, false, 'accent'),
      iconShape(rectPts(62, 25, 23, 43), true, false, 'main'),
      iconShape(rectPts(68, 31, 12, 12), true, false, 'accent'),
      iconShape(rectPts(14, 44, 60, 24), true, false, 'main'),
      iconShape(circlePts(27, 72, 9, 14), true, false, 'accent'),
      iconShape(circlePts(50, 72, 9, 14), true, false, 'accent'),
      iconShape(circlePts(74, 72, 9, 14), true, false, 'accent')
    ] };
    I.plane = { name: 'plane', shapes: [
      iconShape([[70, 42], [84, 22], [90, 42]], true, true, 'accent'),
      iconShape(ellipsePts(48, 52, 35, 12, 0, 26), true, true, 'main'),
      iconShape([[40, 56], [56, 76], [44, 77], [30, 59]], true, true, 'accent'),
      iconShape(circlePts(36, 49, 3, 8), true, false, 'accent'),
      iconShape(circlePts(50, 47, 3, 8), true, false, 'accent'),
      iconShape(circlePts(64, 47, 3, 8), true, false, 'accent')
    ] };
    I.leaf = { name: 'leaf', shapes: [
      iconShape([[50, 8], [73, 36], [50, 90], [27, 36]], true, true, 'main'),
      iconShape([[50, 18], [50, 84]], false, true, 'accent')
    ] };
    I.cloud = { name: 'cloud', shapes: [
      iconShape(scallopPts(50, 46, 26, 6, 6, 44).map(function (p) {
        return [p[0], 46 + (p[1] - 46) * 0.74];
      }), true, true, 'main'),
      iconShape(ellipsePts(36, 82, 3, 6, 0, 10), true, true, 'accent'),
      iconShape(ellipsePts(52, 88, 3, 6, 0, 10), true, true, 'accent'),
      iconShape(ellipsePts(68, 82, 3, 6, 0, 10), true, true, 'accent')
    ] };
    I.ball = { name: 'ball', shapes: [
      iconShape(circlePts(50, 50, 33, 30), true, true, 'main'),
      iconShape(circlePts(50, 50, 12, 5), true, false, 'accent'),
      iconShape([[41, 42], [28, 30]], false, true, 'accent'),
      iconShape([[59, 42], [72, 30]], false, true, 'accent'),
      iconShape([[50, 62], [50, 80]], false, true, 'accent')
    ] };
    I.kite = { name: 'kite', shapes: [
      iconShape([[50, 10], [77, 44], [50, 86], [23, 44]], true, false, 'main'),
      iconShape([[23, 44], [77, 44]], false, false, 'accent'),
      iconShape([[50, 10], [50, 86]], false, false, 'accent'),
      iconShape([[50, 86], [44, 94], [54, 97]], false, true, 'accent')
    ] };
    I.book = { name: 'book', shapes: [
      iconShape(rectPts(29, 15, 42, 66), true, false, 'main'),
      iconShape([[58, 15], [66, 15], [66, 38], [62, 31], [58, 38]], true, true, 'accent'),
      iconShape([[37, 32], [56, 32]], false, false, 'accent'),
      iconShape([[37, 44], [52, 44]], false, false, 'accent')
    ] };
    I.whale = { name: 'whale', shapes: [
      iconShape(ellipsePts(42, 22, 3.5, 7, 0, 10), true, true, 'accent'),
      iconShape(ellipsePts(52, 17, 3.5, 7, 0, 10), true, true, 'accent'),
      iconShape([[74, 46], [90, 32], [91, 54], [80, 60]], true, true, 'main'),
      iconShape(ellipsePts(45, 54, 32, 20, 0, 26), true, true, 'main'),
      iconShape(circlePts(28, 50, 2.5, 8), true, false, 'accent'),
      iconShape([[38, 66], [52, 78], [58, 64]], true, true, 'accent')
    ] };
    I.octopus = { name: 'octopus', shapes: [
      iconShape(ellipsePts(30, 66, 6, 14, 8, 14), true, true, 'main'),
      iconShape(ellipsePts(44, 71, 6, 15, 2, 14), true, true, 'main'),
      iconShape(ellipsePts(58, 71, 6, 15, -2, 14), true, true, 'main'),
      iconShape(ellipsePts(71, 66, 6, 14, -8, 14), true, true, 'main'),
      iconShape(circlePts(50, 40, 22, 26), true, true, 'main'),
      iconShape(circlePts(43, 39, 3.5, 8), true, false, 'accent'),
      iconShape(circlePts(57, 39, 3.5, 8), true, false, 'accent')
    ] };
    I.shell = { name: 'shell', shapes: [
      iconShape(scallopPts(50, 47, 29, 5, 7, 44), true, true, 'main'),
      iconShape([[50, 70], [33, 32]], false, false, 'accent'),
      iconShape([[50, 70], [50, 24]], false, false, 'accent'),
      iconShape([[50, 70], [67, 32]], false, false, 'accent'),
      iconShape([[36, 70], [64, 70], [60, 82], [40, 82]], true, true, 'accent')
    ] };
    I.planet = { name: 'planet', shapes: [
      iconShape(ellipsePts(50, 50, 39, 11, -16, 32), true, true, 'accent'),
      iconShape(circlePts(50, 50, 24, 26), true, true, 'main'),
      iconShape(circlePts(43, 44, 4.5, 10), true, false, 'accent'),
      iconShape(circlePts(58, 58, 3.5, 8), true, false, 'accent')
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
    tree: { main: '#40916c', accent: '#7f4f24' },
    cat: { main: '#f4a261', accent: '#264653' },
    dog: { main: '#bc6c25', accent: '#606c38' },
    bird: { main: '#4cc9f0', accent: '#f72585' },
    house: { main: '#e07a5f', accent: '#3d405b' },
    car: { main: '#e63946', accent: '#ffd166' },
    rocket: { main: '#adb5bd', accent: '#e63946' },
    frog: { main: '#70e000', accent: '#007200' },
    duck: { main: '#ffd60a', accent: '#fb8500' },
    owl: { main: '#8338ec', accent: '#ffbe0b' },
    elephant: { main: '#8d99ae', accent: '#ef476f' },
    lion: { main: '#ffb703', accent: '#fb8500' },
    penguin: { main: '#343a40', accent: '#ffd166' },
    rabbit: { main: '#ced4da', accent: '#ff8fab' },
    turtle: { main: '#40916c', accent: '#95d5b2' },
    banana: { main: '#ffe600', accent: '#2a7f62' },
    carrot: { main: '#fb8500', accent: '#2a7f62' },
    cake: { main: '#f15bb5', accent: '#4cc9f0' },
    cookie: { main: '#dda15e', accent: '#6f4518' },
    boat: { main: '#ffd166', accent: '#0077b6' },
    train: { main: '#6a4c93', accent: '#ffd166' },
    plane: { main: '#48cae4', accent: '#023e8a' },
    leaf: { main: '#38b000', accent: '#007200' },
    cloud: { main: '#a2d2ff', accent: '#0077b6' },
    ball: { main: '#ef476f', accent: '#ffffff' },
    kite: { main: '#ff70a6', accent: '#ffd670' },
    book: { main: '#2a9d8f', accent: '#ffd166' },
    whale: { main: '#4cc9f0', accent: '#3a0ca3' },
    octopus: { main: '#b5179e', accent: '#560bad' },
    shell: { main: '#ffb4a2', accent: '#e5989b' },
    planet: { main: '#ffa62b', accent: '#6a4c93' }
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

  function generateCountingPage(rangeKey, rng, deck) {
    rng = rng || Math.random;
    var max = rangeKey === '1-20' ? 20 : 10;
    var problems = [];
    /* With a deck (Book Builder) the page deals the next pictures from
       the book-wide rotation; standalone pages shuffle the full pool.
       Either way the 4 groups on one page use 4 different pictures. */
    var usedIcons;
    if (deck) {
      usedIcons = [];
      for (var k = 0; k < COUNTING_PROBLEMS_PER_PAGE; k++) usedIcons.push(deck.take());
    } else {
      usedIcons = shuffle(ICON_IDS.slice(), rng);
    }
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
  function generateOddOneOutPage(level, gridSize, rng, deck) {
    rng = rng || Math.random;
    level = ['easy', 'medium', 'hard'].indexOf(level) >= 0 ? level : 'easy';
    gridSize = gridSize === 4 ? 4 : 3;
    var problems = [];
    /* Base pictures are dealt without repetition across the page (from
       the book deck when building a book, else a fresh pool shuffle),
       so one page never shows the same base picture twice. */
    var baseOrder = deck ? null : shuffle(ICON_IDS.slice(), rng);
    for (var i = 0; i < ODD_PROBLEMS_PER_PAGE; i++) {
      var baseIcon = deck ? deck.take() : baseOrder[i % baseOrder.length];
      var oddIcon = baseIcon;
      if (level === 'easy') {
        if (deck) {
          var guard = 0;
          do { oddIcon = deck.take(); guard++; } while (oddIcon === baseIcon && guard < 8);
          if (oddIcon === baseIcon) {
            oddIcon = ICON_IDS[(ICON_IDS.indexOf(baseIcon) + 1) % ICON_IDS.length];
          }
        } else {
          do { oddIcon = ICON_IDS[randInt(rng, ICON_IDS.length)]; } while (oddIcon === baseIcon);
        }
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

  /* ---------------- Reading Strips ---------------- */
  /*
   * Each strip is one short sentence with exactly ONE pictured noun,
   * plus 3 pictures (the matching one + 2 different distractors), so
   * exactly one picture is correct — guaranteed by construction.
   * Templates carry a single {word} slot, and no template uses any
   * other library noun (verified in tests for every word), so the
   * pictured word is always the only library noun in the sentence.
   */
  var READING_LEVELS = {
    prek: { label: 'Pre-K', templates: [
      'I see the {word}.',
      'Look at the {word}!',
      'The {word} is here.',
      'Here is the {word}.',
      'I like the {word}.',
      'See the {word} go.',
      'The {word} is big.',
      'My {word} is red.',
      'Can you see the {word}?',
      'The {word} is up high.'
    ] },
    kinder: { label: 'Kindergarten', templates: [
      'The {word} is on the mat.',
      'I can see the {word}.',
      'The {word} is happy today.',
      'Look! The {word} can run.',
      'My {word} is little and cute.',
      'The {word} sits with me.',
      'We see the {word} at the park.',
      'The {word} is big and red.',
      'Can the {word} jump up?',
      'This is my {word}.'
    ] },
    grade1: { label: 'Grade 1', templates: [
      'The {word} is playing in the yard.',
      'Sam and I saw the {word} at school.',
      'The big {word} ran to the gate.',
      'My {word} likes to play all day.',
      'We found the {word} under the bench.',
      'The {word} is the best one here.',
      'Did you see the {word} this morning?',
      'The little {word} went up the hill.',
      'Mom said the {word} is coming home.',
      'The {word} is fast and fun.'
    ] },
    grade2: { label: 'Grade 2', templates: [
      'Yesterday we watched the {word} near the river.',
      'The {word} was hiding behind the fence, so we looked twice.',
      'My friend Mia thinks the {word} is the funniest one.',
      'First we drew the {word}, and then we colored it in.',
      'The {word} moved slowly across the garden path.',
      'When the rain stopped, the {word} came out again.',
      'Grandpa told us a story about the {word} last night.',
      'The {word} looked at us, and we all laughed.',
      'Please put the {word} back where it belongs.',
      'The {word} is bigger than the one we saw before.'
    ] }
  };

  var PICTURE_WORD_SET = {};
  PICTURE_WORDS.forEach(function (w) { PICTURE_WORD_SET[w] = true; });

  /* First library noun used as a whole word in the sentence
     (case-insensitive), or null when the sentence has none. */
  function findPictureWord(sentence) {
    var tokens = String(sentence || '').toLowerCase().split(/[^a-z]+/);
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] && PICTURE_WORD_SET[tokens[i]]) return tokens[i];
    }
    return null;
  }

  function makeStrip(sentence, word, rng) {
    var pool = shuffle(PICTURE_WORDS.filter(function (w) { return w !== word; }), rng);
    var choices = shuffle([word, pool[0], pool[1]], rng);
    return {
      sentence: sentence, targetWord: word, choices: choices,
      answerIndex: choices.indexOf(word), answerText: word
    };
  }

  /*
   * opts: { level, perPage (4|6), style ('circle'|'bubble'),
   *         customText (buyer's own sentences, one per line),
   *         deck (book rotation deck over PICTURE_WORDS) }
   * In custom mode each line with a known picture word becomes a
   * strip; lines without one are skipped and counted on the page
   * (usedCount / skippedCount) so the UI can report them.
   */
  function generateReadingStripsPage(opts, rng) {
    opts = opts || {};
    rng = rng || Math.random;
    var levelKey = READING_LEVELS[opts.level] ? opts.level : 'prek';
    var level = READING_LEVELS[levelKey];
    var perPage = opts.perPage === 4 ? 4 : 6;
    var style = opts.style === 'bubble' ? 'bubble' : 'circle';
    var strips = [];
    var used = 0, skipped = 0, custom = false;

    if (opts.customText && String(opts.customText).trim()) {
      custom = true;
      String(opts.customText).split(/\r?\n/).forEach(function (line) {
        var s = line.trim();
        if (!s) return;
        var w = findPictureWord(s);
        if (!w) { skipped++; return; }
        strips.push(makeStrip(s, w, rng));
        used++;
      });
    } else {
      var words = shuffle(PICTURE_WORDS.slice(), rng);
      for (var i = 0; i < perPage; i++) {
        var word = opts.deck ? opts.deck.take() : words[i % words.length];
        var sentence = pick(rng, level.templates).split('{word}').join(word);
        strips.push(makeStrip(sentence, word, rng));
      }
      used = strips.length;
    }

    return {
      type: 'reading',
      title: 'Reading Strips — ' + level.label,
      instructions: style === 'bubble'
        ? 'Read each sentence. Fill in the bubble under the picture that matches!'
        : 'Read each sentence. Circle the picture that matches!',
      level: levelKey, levelLabel: level.label, style: style,
      strips: strips, usedCount: used, skippedCount: skipped, custom: custom
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
      case 'reading':
        return page.strips.map(function (s) { return s.targetWord; });
      default:
        return [];
    }
  }

  /* Which page types get a solution page in a book's Solutions
   * section. Coloring and tracing have no answers by design. */
  function pageHasSolution(page) {
    return !!page && ['maze', 'wordsearch', 'dottodot', 'counting', 'oddoneout', 'reading']
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
        if (page.customImage) {
          return 'coloring:custom:' + (page.customImage.name || 'picture') + ':' +
            page.customImage.width + 'x' + page.customImage.height;
        }
        return 'coloring:' + page.designId;
      case 'reading':
        return 'reading:' + page.level + ':' + page.strips.map(function (s) {
          return s.targetWord + ':' + s.sentence;
        }).join('|');
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
    'tracing', 'reading', 'counting', 'oddoneout'];
  var WS_THEME_KEYS = Object.keys(WS_THEMES);
  var TRACING_MODE_KEYS = Object.keys(TRACING_MODES);

  /*
   * spec: { counts: {maze: n, wordsearch: n, ...}, readingLevel,
   *         countingRange }
   * Returns an array of pages in BOOK_TYPE_ORDER. Makers cycle their
   * variant (maze size, WS theme, tracing mode/start, odd level) per
   * page, and every page is checked against the signatures already in
   * the book — duplicates are regenerated with fresh rng draws
   * (bounded attempts). Picture-based sections (coloring, dot-to-dot,
   * counting, odd one out, reading) deal from per-book shuffled decks,
   * so a whole book rotates across the full picture library instead of
   * reusing the first few designs.
   */
  function assembleBook(spec, rng) {
    rng = rng || Math.random;
    spec = spec || {};
    var counts = spec.counts || {};
    var seen = {};
    var variant = {};
    BOOK_TYPE_ORDER.forEach(function (t) { variant[t] = 0; });

    var coloringDeck = makeDeck(DESIGNS.map(function (d) { return d.id; }), rng);
    var d2dDeck = makeDeck(D2D_POOL.slice(), rng);
    var iconDeck = makeDeck(ICON_IDS.slice(), rng);
    var wordDeck = makeDeck(PICTURE_WORDS.slice(), rng);

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
      coloring: function () {
        return generateColoringPage(coloringDeck.take(), rng);
      },
      dottodot: function () {
        return generateDotToDotPage(d2dDeck.take(), 30, rng);
      },
      tracing: function (v) {
        var mode = TRACING_MODE_KEYS[v % TRACING_MODE_KEYS.length];
        var cycle = Math.floor(v / TRACING_MODE_KEYS.length);
        var items = TRACING_MODES[mode].items.length;
        return generateTracingPage(mode, rng,
          (cycle * TRACING_ROWS_PER_SHEET) % items);
      },
      reading: function () {
        /* 4 strips per book page: at the printed-sheet strip sizing
           (styles.css .strips-roomy) 4 strips fit one sheet at both
           trims; 6 would overflow the shorter 8.5x10 sheet. The
           single-page tab still offers 4 or 6 (compact sizing). */
        return generateReadingStripsPage({
          level: spec.readingLevel || 'prek', perPage: 4,
          style: 'circle', deck: wordDeck
        }, rng);
      },
      counting: function () {
        /* One range for the whole book, chosen in the Book Builder —
           the same choice the Counting tab offers, with the same
           default ('1-10'). (Was: a per-page coin flip between the
           two ranges, so books silently mixed ranges the buyer had
           never picked.) */
        return generateCountingPage(
          spec.countingRange === '1-20' ? '1-20' : '1-10', rng, iconDeck);
      },
      oddoneout: function (v) {
        return generateOddOneOutPage(['easy', 'medium', 'hard'][v % 3], v % 2 ? 4 : 3, rng, iconDeck);
      }
    };

    var pages = [];
    BOOK_TYPE_ORDER.forEach(function (type) {
      var n = Math.max(0, Math.min(100, counts[type] || 0));
      for (var i = 0; i < n; i++) pages.push(fresh(makers[type], type));
    });
    return pages;
  }

  /* ---------------- KDP wrap cover (pure math + book summary) ---------------- */

  /* KDP paperback, white paper: 0.125" bleed on every outer edge,
     spine width = page count x 0.002252", and KDP needs at least
     24 pages; spine text only fits once the spine is ~0.35"+ wide. */
  var KDP_BLEED = 0.125;
  var KDP_SPINE_PER_PAGE = 0.002252;
  var KDP_MIN_PAGES = 24;
  var KDP_SPINE_TEXT_MIN = 0.35;

  function wrapCoverDims(trimW, trimH, pageCount) {
    var pages = Math.max(0, pageCount | 0);
    var spine = pages * KDP_SPINE_PER_PAGE;
    return {
      trimW: trimW, trimH: trimH, pageCount: pages,
      bleed: KDP_BLEED, spinePerPage: KDP_SPINE_PER_PAGE,
      spine: spine,
      width: KDP_BLEED + trimW + spine + trimW + KDP_BLEED,
      height: trimH + 2 * KDP_BLEED,
      spineText: spine >= KDP_SPINE_TEXT_MIN,
      belowMinPages: pages < KDP_MIN_PAGES
    };
  }

  var SECTION_LABELS = {
    maze: 'Mazes', wordsearch: 'Word Searches', coloring: 'Coloring Pages',
    dottodot: 'Dot-to-Dot Puzzles', tracing: 'Tracing Sheets',
    reading: 'Reading Strips', counting: 'Counting Pages',
    oddoneout: 'Odd One Out Puzzles'
  };

  /* "Inside this book" data for the wrap cover's back: the sections
     actually present in the assembled book, with counts (and the
     reading levels used), in book order. */
  function bookSectionSummary(pages) {
    var byType = {};
    var order = [];
    (pages || []).forEach(function (p) {
      if (!byType[p.type]) {
        byType[p.type] = { type: p.type, label: SECTION_LABELS[p.type] || p.type, count: 0, levels: [] };
        order.push(p.type);
      }
      byType[p.type].count++;
      if (p.type === 'reading' && p.levelLabel &&
          byType[p.type].levels.indexOf(p.levelLabel) === -1) {
        byType[p.type].levels.push(p.levelLabel);
      }
    });
    return order.map(function (t) { return byType[t]; });
  }

  /* Buyer's own-picture coloring pages join the book right after the
     generated coloring section (or at the end when the book has no
     coloring section). Pure: returns a new array. */
  function insertCustomPages(pages, customPages) {
    var out = (pages || []).slice();
    if (!customPages || !customPages.length) return out;
    var lastColoring = -1;
    out.forEach(function (p, i) { if (p.type === 'coloring') lastColoring = i; });
    var at = lastColoring === -1 ? out.length : lastColoring + 1;
    return out.slice(0, at).concat(customPages, out.slice(at));
  }

  /* ---------------- API ---------------- */

  var api = {
    makeRng: makeRng, randInt: randInt, randRange: randRange,
    shuffle: shuffle, pick: pick, makeDeck: makeDeck,
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
    NOUN_DESIGNS: NOUN_DESIGNS, PICTURE_WORDS: PICTURE_WORDS,
    D2D_POOL: D2D_POOL, D2D_EXCLUDED: D2D_EXCLUDED,
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
    READING_LEVELS: READING_LEVELS, findPictureWord: findPictureWord,
    generateReadingStripsPage: generateReadingStripsPage,
    answerKey: answerKey, pageHasSolution: pageHasSolution,
    pageSignature: pageSignature,
    assembleBook: assembleBook, BOOK_TYPE_ORDER: BOOK_TYPE_ORDER,
    KDP_BLEED: KDP_BLEED, KDP_SPINE_PER_PAGE: KDP_SPINE_PER_PAGE,
    KDP_MIN_PAGES: KDP_MIN_PAGES, KDP_SPINE_TEXT_MIN: KDP_SPINE_TEXT_MIN,
    wrapCoverDims: wrapCoverDims, SECTION_LABELS: SECTION_LABELS,
    bookSectionSummary: bookSectionSummary,
    insertCustomPages: insertCustomPages
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KAB = api;
})(typeof window !== 'undefined' ? window : globalThis);
