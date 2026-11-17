/*
 * Songlap Kids Activity Book Generator — Book Builder + single-page
 * printing. Assembles a print-ready book (title page, numbered
 * activity pages, and a Solutions section at the back) into
 * #book-preview, which is what the browser prints. @page size is set
 * to the chosen trim size. The same preview area prints a single
 * activity page + its solution (for the types that have one).
 */
(function () {
  'use strict';

  var SIZES = {
    'letter': { w: 8.5, h: 11, unit: 'in', cssSize: '8.5in 11in', label: '8.5 × 11 in', pad: 0.6 },
    'kdp810': { w: 8.5, h: 10, unit: 'in', cssSize: '8.5in 10in', label: '8.5 × 10 in', pad: 0.6 }
  };

  function $(id) { return document.getElementById(id); }

  function setPageSize(size) {
    var old = document.getElementById('page-style');
    if (old) old.remove();
    var st = document.createElement('style');
    st.id = 'page-style';
    st.textContent = '@page { size: ' + size.cssSize + '; margin: 0; }';
    document.head.appendChild(st);
  }

  function pageStyle(size) {
    return 'width:' + size.w + size.unit + ';height:' + size.h + size.unit +
      ';padding:' + size.pad + size.unit + ';';
  }

  function footer(text) {
    return '<p class="page-footer">' + Render.esc(text) + '</p>';
  }

  /* ---------- Single page printing ---------- */

  function printWorksheet(page) {
    var size = SIZES.letter;
    setPageSize(size);
    var ps = pageStyle(size);
    var pages = [];
    pages.push(
      '<div class="book-page" style="' + ps + '">' +
        '<div class="page-body">' + Render.pageHTML(page) + '</div>' +
        footer('Kids Activity Book Generator · Songlap Deals') + '</div>');
    if (KAB.pageHasSolution(page)) {
      pages.push(
        '<div class="book-page" style="' + ps + '">' +
          '<div class="page-body">' + Render.pageHTML(page, { solution: true }) + '</div>' +
          footer('Solution · Kids Activity Book Generator · Songlap Deals') + '</div>');
    }
    var preview = $('book-preview');
    preview.innerHTML = pages.join('');
    preview.hidden = false;
    // let the preview paint before the print dialog opens
    setTimeout(function () { window.print(); }, 60);
  }

  /* ---------- Book Builder ---------- */

  /* Session state: the last built book (for the wrap cover) and the
     buyer's own-picture coloring pages waiting to join the next book. */
  var lastBook = null;
  var customColoringPages = [];

  function addCustomColoringPage(page) {
    customColoringPages.push(page);
    return customColoringPages.length;
  }

  function init(seedRng) {
    $('bk-build').addEventListener('click', function () { buildBook(seedRng); });
    $('bk-print').addEventListener('click', function () { window.print(); });
    var coverBtn = $('bk-cover');
    if (coverBtn) coverBtn.addEventListener('click', buildWrapCover);
    var coverPngBtn = $('bk-cover-png');
    if (coverPngBtn) coverPngBtn.addEventListener('click', downloadWrapCover);
    initCoverDesigner(seedRng);
  }

  /* ---------- Cover Designer: persistence + live preview ----------
   * Cover settings (book title, subtitle, author, ages badge, theme,
   * "designed cover as page 1") persist in localStorage, like the
   * license does, so a buyer designs once and reuses the cover. */

  var COVER_KEYS = {
    title: 'kabg_book_title', subtitle: 'kabg_book_subtitle',
    author: 'kabg_book_author', ages: 'kabg_cover_ages',
    theme: 'kabg_cover_theme', page1: 'kabg_cover_page1'
  };

  function storeGet(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, value);
    } catch (e) { /* private mode — settings just don't persist */ }
  }

  function coverSettingsFromInputs() {
    var themeEl = document.querySelector('input[name="bk-theme"]:checked');
    return {
      title: $('bk-title') ? $('bk-title').value.trim() : '',
      subtitle: $('bk-subtitle') ? $('bk-subtitle').value.trim() : '',
      author: $('bk-author') ? $('bk-author').value.trim() : '',
      ages: $('bk-ages') ? $('bk-ages').value.trim() : '',
      theme: themeEl ? themeEl.value : 'rainbow',
      useCover: $('bk-cover-page1') ? $('bk-cover-page1').checked : true
    };
  }

  function saveCoverSettings() {
    var s = coverSettingsFromInputs();
    storeSet(COVER_KEYS.title, s.title);
    storeSet(COVER_KEYS.subtitle, s.subtitle);
    storeSet(COVER_KEYS.author, s.author);
    storeSet(COVER_KEYS.ages, s.ages);
    storeSet(COVER_KEYS.theme, s.theme);
    storeSet(COVER_KEYS.page1, s.useCover ? '1' : '0');
  }

  function restoreCoverSettings() {
    var map = [
      ['bk-title', COVER_KEYS.title], ['bk-subtitle', COVER_KEYS.subtitle],
      ['bk-author', COVER_KEYS.author], ['bk-ages', COVER_KEYS.ages]
    ];
    map.forEach(function (pair) {
      var v = storeGet(pair[1]);
      if (v !== null && $(pair[0])) $(pair[0]).value = v;
    });
    var theme = storeGet(COVER_KEYS.theme);
    if (theme) {
      var radio = document.querySelector('input[name="bk-theme"][value="' + theme + '"]');
      if (radio) radio.checked = true;
    }
    var page1 = storeGet(COVER_KEYS.page1);
    if (page1 !== null && $('bk-cover-page1')) $('bk-cover-page1').checked = page1 === '1';
  }

  function previewBookShape() {
    // what the book WILL contain, from the count inputs — the live
    // preview's badges and activity strip are honest before building
    var counts = {}, total = 0;
    KAB.BOOK_TYPE_ORDER.forEach(function (type) {
      var el = $('bk-count-' + type);
      counts[type] = el ? clampCount(el.value) : 0;
      total += counts[type];
    });
    var summary = KAB.BOOK_TYPE_ORDER.filter(function (t) { return counts[t] > 0; })
      .map(function (t) { return { type: t, label: KAB.SECTION_LABELS[t], count: counts[t] }; });
    return { total: total, summary: summary };
  }

  function previewThumbs(seedRng) {
    // sample art for the preview collage: real pages from the tool's
    // own library (the same art buyers will find inside their book)
    var rng = seedRng ? seedRng() : KAB.makeRng(7);
    return ['rocket', 'cat', 'butterfly'].map(function (id) {
      return KAB.generateColoringPage(id, rng);
    });
  }

  function renderCoverPreview(seedRng) {
    var host = $('bk-cover-preview');
    if (!host) return;
    var s = coverSettingsFromInputs();
    var shape = previewBookShape();
    host.innerHTML = frontCoverHTML(
      { title: s.title || 'My Kids Activity Book', subtitle: s.subtitle, author: s.author, ages: s.ages, theme: s.theme },
      { context: 'preview', activityCount: shape.total, activityLine: KAB.coverActivityLine(shape.summary), thumbs: previewThumbs(seedRng) });
  }

  function initCoverDesigner(seedRng) {
    if (!$('bk-cover-preview')) return; // older markup / tests
    restoreCoverSettings();
    var refresh = function () { saveCoverSettings(); renderCoverPreview(seedRng); };
    ['bk-title', 'bk-subtitle', 'bk-author', 'bk-ages'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', refresh);
    });
    document.querySelectorAll('input[name="bk-theme"]').forEach(function (r) {
      r.addEventListener('change', refresh);
    });
    if ($('bk-cover-page1')) $('bk-cover-page1').addEventListener('change', saveCoverSettings);
    KAB.BOOK_TYPE_ORDER.forEach(function (type) {
      var el = $('bk-count-' + type);
      if (el) el.addEventListener('input', function () { renderCoverPreview(seedRng); });
    });
    renderCoverPreview(seedRng);
  }

  function clampCount(v) {
    var n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return 0;
    return Math.min(n, 100);
  }

  function buildBook(seedRng) {
    var title = $('bk-title').value.trim() || 'My Kids Activity Book';
    var author = $('bk-author').value.trim();
    var size = SIZES[$('bk-size').value] || SIZES.letter;
    var counts = {};
    var totalPages = 0;
    KAB.BOOK_TYPE_ORDER.forEach(function (type) {
      counts[type] = clampCount($('bk-count-' + type).value);
      totalPages += counts[type];
    });
    if (totalPages === 0) {
      $('bk-status').textContent = 'Set at least one activity count above zero.';
      return;
    }
    $('bk-status').textContent = 'Building your book…';
    $('bk-build').disabled = true;

    setTimeout(function () {
      try {
        var rng = seedRng();
        var readingLevel = $('bk-reading-level') ? $('bk-reading-level').value : 'prek';
        var countingRange = $('bk-counting-range') ? $('bk-counting-range').value : '1-10';
        var pages = KAB.assembleBook(
          { counts: counts, readingLevel: readingLevel, countingRange: countingRange }, rng);
        pages = KAB.insertCustomPages(pages, customColoringPages);
        var cover = coverSettingsFromInputs();
        var pageCount = renderBook(title, author, size, pages, {
          subtitle: cover.subtitle, ages: cover.ages, theme: cover.theme,
          useCover: cover.useCover
        });
        lastBook = { title: title, author: author, size: size, pages: pages, totalPages: pageCount };
        $('bk-print').disabled = false;
        var coverBtn = $('bk-cover');
        if (coverBtn) coverBtn.disabled = false;
        $('bk-status').textContent = 'Book ready: ' + pages.length + ' activity pages, ' +
          pageCount + ' pages total (' + (cover.useCover ? 'designed cover' : 'title page') +
          ' + activity pages + solutions section). ' +
          'Scroll down to preview, then click Download / Print PDF.';
        $('bk-output').innerHTML = '<p class="placeholder">✅ Book generated — preview is below the tool. ' +
          'Click <strong>Download / Print PDF</strong> to save it at ' + size.label + '.</p>';
      } catch (err) {
        $('bk-status').textContent = 'Something went wrong while building the book: ' + err.message;
      } finally {
        $('bk-build').disabled = false;
      }
    }, 30);
  }

  function renderBook(title, author, size, pages, coverOpts) {
    setPageSize(size);
    var ps = pageStyle(size);
    var out = [];

    /* Defensive: a page whose body renders to nothing must never
       reach the book as a blank sheet. Every current generator
       produces a body, so this only guards future page types; the
       same filtered list drives the activity AND solution loops so
       the "Page N" numbering stays aligned. */
    pages = pages.filter(function (p) {
      return Render.pageBodyHTML(p).trim().length > 0;
    });

    // page 1: the buyer's designed front cover (themed), or the plain
    // title page when they untick "designed cover as page 1"
    if (coverOpts && coverOpts.useCover) {
      var coverStyle = 'width:' + size.w + size.unit + ';height:' + size.h + size.unit + ';padding:0;';
      out.push(
        '<div class="book-page cover-design" style="' + coverStyle + '">' +
          frontCoverHTML(
            { title: title, subtitle: coverOpts.subtitle || '', author: author, ages: coverOpts.ages || '', theme: coverOpts.theme },
            { context: 'page', activityCount: pages.length, activityLine: KAB.coverActivityLine(KAB.bookSectionSummary(pages)), thumbs: pickThumbs(pages) }) +
        '</div>');
    } else {
      out.push(
        '<div class="book-page cover-page" style="' + ps + '">' +
          '<div class="cover-inner">' +
            '<div class="cover-puzzle-icon">🧩</div>' +
            '<h1 class="cover-title">' + Render.esc(title) + '</h1>' +
            (author ? '<p class="cover-author">by ' + Render.esc(author) + '</p>' : '') +
            '<p class="cover-count">' + pages.length + ' fun activity pages with solutions</p>' +
            '<p class="cover-brand">SONGLAP DEALS</p>' +
          '</div>' +
        '</div>');
    }

    // activity pages, numbered
    pages.forEach(function (page, idx) {
      out.push(
        '<div class="book-page" style="' + ps + '">' +
          '<p class="worksheet-label">Page ' + (idx + 1) + ' — ' + Render.esc(page.title) + '</p>' +
          '<div class="page-body">' + Render.pageHTML(page) + '</div>' +
          footer(title + ' · Page ' + (idx + 1)) +
        '</div>');
    });

    // solutions divider — only when the book actually has answers;
    // with none it would be a nearly-blank sheet ("Answers for 0
    // activity pages") in books of just coloring / tracing pages
    var solvedCount = pages.filter(function (p) { return KAB.pageHasSolution(p); }).length;
    if (solvedCount > 0) {
      out.push(
        '<div class="book-page divider-page" style="' + ps + '">' +
          '<div class="cover-inner"><h1 class="cover-title">Solutions</h1>' +
          '<p class="cover-count">Answers for ' + solvedCount + ' activity pages</p>' +
          '<p class="cover-count">Coloring and tracing pages have no answers — just have fun!</p></div>' +
        '</div>');
    }

    // solution pages, keyed to the activity page numbers
    pages.forEach(function (page, idx) {
      if (!KAB.pageHasSolution(page)) return;
      out.push(
        '<div class="book-page" style="' + ps + '">' +
          '<p class="worksheet-label">Solutions — Page ' + (idx + 1) + ' (' + Render.esc(page.title) + ')</p>' +
          '<div class="page-body">' + Render.pageHTML(page, { solution: true }) + '</div>' +
          footer(title + ' · Solutions for Page ' + (idx + 1)) +
        '</div>');
    });

    var preview = $('book-preview');
    preview.innerHTML = out.join('');
    preview.hidden = false;
    return out.length;
  }

  /* ---------- Designed front cover (shared by book page 1, the wrap
     cover and the live preview) ----------
   * Modelled on the bestselling KDP kids' activity-book covers: huge
   * chunky title, one dominant saturated theme colour, an "Ages …"
   * badge, a starburst "N+ Activities!" badge, the activity-types
   * strip, a collage of real sample pages, author name at the bottom.
   * Decorations are faceless geometric motifs (stars, hearts, moons,
   * rainbows, leaves, planets) drawn as inline SVG from the tool's
   * own geometry helpers — no characters, no faces, no images. */

  function cmdsToD(cmds) {
    return cmds.map(function (c) { return c.join(' '); }).join(' ');
  }
  function shapeSVG(pts, closed, smooth, attrs) {
    return '<path d="' + cmdsToD(KAB.shapePathCmds({ pts: pts, closed: closed, smooth: smooth })) +
      '" ' + attrs + '/>';
  }
  function polySVG(pts, attrs) {
    return '<polygon points="' + pts.map(function (p) {
      return Math.round(p[0]) + ',' + Math.round(p[1]);
    }).join(' ') + '" ' + attrs + '/>';
  }

  /* Decoration layer per theme, in a 850x1100 viewBox (the trim
     aspect), positioned around the edges so it never fights the
     title. Filled shapes sit at low opacity over the background. */
  function coverDecoSVG(theme) {
    var F = 'fill="', S = 'stroke="', parts = [];
    function star(cx, cy, r, fill, opacity) {
      parts.push(polySVG(KAB.starPts(cx, cy, r, r * 0.48, 5),
        F + fill + '" opacity="' + opacity + '"'));
    }
    function dot(cx, cy, r, fill, opacity) {
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' +
        F + fill + '" opacity="' + opacity + '"/>');
    }
    if (theme.deco === 'rainbow') {
      // rainbow corner rings, top-left
      var bands = ['#e63946', '#f4840b', '#ffd166', '#1e9e52', '#2470c2'];
      bands.forEach(function (c, i) {
        parts.push('<circle cx="0" cy="0" r="' + (118 + i * 36) + '" fill="none" ' +
          S + c + '" stroke-width="30" opacity="0.85"/>');
      });
      // sun, bottom-right
      parts.push('<circle cx="770" cy="1010" r="58" ' + F + '#ffd166" opacity="0.9"/>');
      for (var a = 0; a < 8; a++) {
        var ang = a * Math.PI / 4;
        parts.push('<line x1="' + Math.round(770 + 72 * Math.cos(ang)) + '" y1="' +
          Math.round(1010 + 72 * Math.sin(ang)) + '" x2="' + Math.round(770 + 96 * Math.cos(ang)) +
          '" y2="' + Math.round(1010 + 96 * Math.sin(ang)) + '" ' + S + '#f4840b" stroke-width="10" stroke-linecap="round"/>');
      }
      star(700, 130, 34, '#f4840b', 0.9); star(120, 880, 28, '#2470c2', 0.8);
      star(760, 620, 22, '#1e9e52', 0.8); dot(90, 560, 13, '#e63946', 0.75);
      dot(660, 300, 11, '#7b2dbe', 0.7); dot(180, 180, 9, '#1e9e52', 0.7);
    } else if (theme.deco === 'space') {
      star(110, 120, 30, '#ffd166', 0.95); star(720, 90, 22, '#ffffff', 0.9);
      star(770, 480, 26, '#ffd166', 0.85); star(80, 700, 20, '#ffffff', 0.8);
      star(150, 980, 24, '#ffd166', 0.9); star(620, 1020, 18, '#ffffff', 0.85);
      // crescent moon, top-right
      parts.push(shapeSVG(KAB.crescentPts(735, 210, 62), true, false,
        F + '#ffd166" opacity="0.95"'));
      // ringed planet, bottom-left
      parts.push('<circle cx="130" cy="900" r="46" ' + F + '#ff8c1a" opacity="0.9"/>');
      parts.push(shapeSVG(KAB.ellipsePts(130, 900, 84, 24, -18), false, false,
        'fill="none" ' + S + '#ffd166" stroke-width="9" opacity="0.9"'));
      dot(420, 70, 7, '#ffffff', 0.8); dot(300, 1030, 7, '#ffffff', 0.8);
      dot(560, 160, 6, '#aebfff', 0.9); dot(60, 380, 6, '#aebfff', 0.9);
    } else if (theme.deco === 'jungle') {
      // leaves in the corners (rotated ellipses, two greens)
      [[40, 60, -35], [810, 40, 35], [30, 1050, -120], [820, 1060, 120], [70, 560, -70], [790, 600, 70]]
        .forEach(function (L, i) {
          parts.push(shapeSVG(KAB.ellipsePts(L[0], L[1], 26, 74, L[2]), true, false,
            F + (i % 2 ? '#ffd166' : '#0d3d1e') + '" opacity="' + (i % 2 ? '0.55' : '0.5') + '"'));
        });
      star(700, 130, 26, '#ffd166', 0.9); star(130, 200, 20, '#f4840b', 0.9);
      dot(730, 950, 12, '#ffd166', 0.8); dot(120, 830, 10, '#ffffff', 0.7);
    } else { // candy
      parts.push(shapeSVG(KAB.heartPts(105, 130, 2.6), true, true,
        F + '#ffd6e7" opacity="0.9"'));
      parts.push(shapeSVG(KAB.heartPts(745, 980, 2.1), true, true,
        F + '#ffd166" opacity="0.9"'));
      parts.push(shapeSVG(KAB.scallopPts(745, 130, 40, 9, 7), true, false,
        'fill="none" ' + S + '#ffffff" stroke-width="7" opacity="0.75"'));
      parts.push(shapeSVG(KAB.scallopPts(105, 990, 30, 7, 7), true, false,
        'fill="none" ' + S + '#ffd6e7" stroke-width="6" opacity="0.8"'));
      star(700, 560, 24, '#ffd166', 0.9); star(120, 620, 20, '#ffffff', 0.85);
      dot(420, 80, 9, '#ffd6e7', 0.9); dot(640, 240, 8, '#ffffff', 0.8);
    }
    return '<svg class="fc-deco" viewBox="0 0 850 1100" preserveAspectRatio="xMidYMid slice" ' +
      'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + parts.join('') + '</svg>';
  }

  /* Longer titles step down a size class so the cover never spills:
     classes are locked to the layout model in tests/test_cover.js. */
  function coverTitleClass(title) {
    var n = (title || '').length;
    if (n <= 22) return 'fc-t-xl';
    if (n <= 40) return 'fc-t-lg';
    if (n <= 64) return 'fc-t-md';
    return 'fc-t-sm';
  }

  function coloredTitle(title, theme) {
    return title.split(/\s+/).filter(Boolean).map(function (w, i) {
      return '<span style="color:' + theme.titleColors[i % theme.titleColors.length] + '">' +
        Render.esc(w) + '</span>';
    }).join(' ');
  }

  /* The front-cover face. meta: { title, subtitle, author, ages,
     theme }; opts: { context: 'page'|'wrap'|'preview', activityCount,
     activityLine, thumbs: [page objects for the collage] }. */
  function frontCoverHTML(meta, opts) {
    opts = opts || {};
    var theme = KAB.getCoverTheme(meta.theme);
    var title = (meta.title || '').trim() || 'My Kids Activity Book';
    var badge = KAB.coverBadgeText(opts.activityCount || 0);
    var h = '<div class="fc fc-' + (opts.context || 'page') + ' theme-' + theme.id +
      '" style="background:' + theme.frontBg + '">';
    h += coverDecoSVG(theme);
    if (meta.ages) {
      h += '<div class="fc-badge fc-badge-ages" style="background:' + theme.ageBadgeBg +
        ';color:' + theme.ageBadgeColor + '"><span class="fc-badge-small">Ages</span>' +
        '<span class="fc-badge-big">' + Render.esc(meta.ages) + '</span></div>';
    }
    if (badge) {
      h += '<div class="fc-badge fc-badge-count" style="background:' + theme.badgeBg +
        ';color:' + theme.badgeColor + '"><span class="fc-badge-big">' + badge.big + '</span>' +
        '<span class="fc-badge-small">' + badge.small + '</span></div>';
    }
    h += '<div class="fc-main">';
    h += '<h1 class="fc-title ' + coverTitleClass(title) + '">' + coloredTitle(title, theme) + '</h1>';
    if (meta.subtitle) {
      h += '<p class="fc-subtitle" style="color:' + theme.subtitleColor + '">' +
        Render.esc(meta.subtitle) + '</p>';
    }
    if (opts.activityLine) {
      h += '<p class="fc-line" style="color:' + theme.lineColor + '">' +
        Render.esc(opts.activityLine) + '</p>';
    }
    if (opts.thumbs && opts.thumbs.length) {
      h += '<div class="fc-thumbs">';
      opts.thumbs.slice(0, 3).forEach(function (p) {
        h += '<div class="fc-thumb' + (opts.context === 'wrap' ? ' wc-thumb' : '') + '">' +
          Render.pageBodyHTML(p) + '</div>';
      });
      h += '</div>';
    }
    if (meta.author) {
      h += '<p class="fc-author" style="color:' + theme.authorColor + '">by ' +
        Render.esc(meta.author) + '</p>';
    }
    h += '</div></div>';
    return h;
  }

  /* Sample pages for a cover collage: first maze / coloring / reading
     page in the book (same pick as the wrap cover has always made). */
  function pickThumbs(pages) {
    var thumbs = [];
    ['maze', 'coloring', 'reading', 'dottodot', 'counting'].forEach(function (t) {
      if (thumbs.length >= 3) return;
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].type === t) { thumbs.push(pages[i]); break; }
      }
    });
    if (!thumbs.length && pages.length) thumbs.push(pages[0]);
    return thumbs;
  }

  /* ---------- KDP Wrap Cover Builder ---------- */

  function fmtIn(n) { return String(Math.round(n * 10000) / 10000); }

  /* Renders the full wrap (back | spine | front) as ONE page at the
     exact computed size into #book-preview. Returns the dims used. */
  function renderWrapCover(meta, pages, totalPages) {
    var dims = KAB.wrapCoverDims(meta.trimW, meta.trimH, totalPages);
    setPageSize({ cssSize: dims.width + 'in ' + dims.height + 'in' });
    var summary = KAB.bookSectionSummary(pages);
    var theme = KAB.getCoverTheme(meta.theme);
    var thumbs = pickThumbs(pages);

    var h = '<div class="wrap-cover theme-' + theme.id + '" style="width:' + dims.width + 'in;height:' + dims.height +
      'in;padding:' + dims.bleed + 'in;">';

    // back cover (themed paper, the book's real sections, and the
    // author's own name alongside the brand)
    h += '<div class="wc-back" style="width:' + dims.trimW + 'in;background:' + theme.backBg + ';">' +
      '<h2 class="wc-h" style="color:' + theme.backHeading + '">Inside this book</h2><ul class="wc-list" style="color:' + theme.backText + '">';
    summary.forEach(function (s) {
      h += '<li>' + s.count + ' ' + Render.esc(s.label) +
        (s.levels && s.levels.length ? ' (' + s.levels.map(Render.esc).join(', ') + ')' : '') + '</li>';
    });
    h += '</ul><p class="wc-blurb">Create complete kids activity books in minutes — ' +
      'print-ready pages with all solutions included.</p>';
    if (meta.author) {
      h += '<p class="wc-back-author" style="color:' + theme.backHeading + '">by ' + Render.esc(meta.author) + '</p>';
    }
    h += '<p class="wc-brand">SONGLAP DEALS</p>' +
      '<div class="wc-barcode">BARCODE</div></div>';

    // spine (themed colour; title + author once it is wide enough)
    h += '<div class="wc-spine" style="width:' + dims.spine + 'in;background:' + theme.spineBg + ';">';
    if (dims.spineText) {
      h += '<span style="color:' + theme.spineColor + '">' + Render.esc(meta.title) +
        (meta.author ? ' · ' + Render.esc(meta.author) : '') + '</span>';
    }
    h += '</div>';

    // front cover — the same designed face as book page 1 (the cell
    // itself carries the theme background too, so the face's colour
    // fills the trim even in renderers with weak flex sizing)
    h += '<div class="wc-front" style="width:' + dims.trimW + 'in;background:' + theme.frontBg + '">' +
      frontCoverHTML(meta, {
        context: 'wrap', activityCount: pages.length,
        activityLine: KAB.coverActivityLine(summary), thumbs: thumbs
      }) +
      '</div></div>';

    var preview = $('book-preview');
    preview.innerHTML = h;
    preview.hidden = false;
    return dims;
  }

  function coverMeta() {
    var s = coverSettingsFromInputs();
    return {
      title: s.title || 'My Kids Activity Book',
      subtitle: s.subtitle,
      author: s.author,
      ages: s.ages,
      theme: s.theme,
      trimW: lastBook.size.w, trimH: lastBook.size.h
    };
  }

  function buildWrapCover() {
    var status = $('bk-cover-status');
    if (!lastBook) {
      if (status) status.textContent = 'Build your book first — the wrap cover is sized from the finished book (trim + total pages).';
      return;
    }
    var meta = coverMeta();
    var dims = renderWrapCover(meta, lastBook.pages, lastBook.totalPages);
    $('bk-print').disabled = false;
    var pngBtn = $('bk-cover-png');
    if (pngBtn) pngBtn.disabled = false;
    if (status) {
      var msg = 'Wrap cover ready: ' + fmtIn(dims.width) + ' × ' + fmtIn(dims.height) +
        ' in total, spine ' + fmtIn(dims.spine) + ' in (' + dims.pageCount + ' pages, ' +
        fmtIn(dims.bleed) + ' in bleed). ';
      msg += dims.spineText
        ? 'The spine is wide enough, so it carries the title and author. '
        : 'The spine is narrower than 0.35 in, so it stays a solid brand color (KDP spine text would not fit). ';
      if (dims.belowMinPages) {
        msg += '⚠ This book has fewer than 24 pages — KDP paperbacks need at least 24 pages, so add more activity pages before uploading.';
      }
      status.textContent = msg;
    }
  }

  function downloadWrapCover() {
    if (!lastBook) return;
    var meta = coverMeta();
    var dims = KAB.wrapCoverDims(meta.trimW, meta.trimH, lastBook.totalPages);
    var seen = {};
    var thumbDesigns = [];
    lastBook.pages.forEach(function (p) {
      var id = (p.type === 'coloring' || p.type === 'dottodot') ? p.designId : null;
      if (id && !seen[id] && KAB.getDesign(id)) { seen[id] = true; thumbDesigns.push(id); }
    });
    ['cat', 'rocket', 'butterfly'].forEach(function (id) {
      if (thumbDesigns.length < 3 && !seen[id]) { seen[id] = true; thumbDesigns.push(id); }
    });
    var summary = KAB.bookSectionSummary(lastBook.pages);
    PNGExport.downloadWrapCoverPNG({
      title: meta.title, subtitle: meta.subtitle, author: meta.author,
      ages: meta.ages, theme: meta.theme,
      activityCount: lastBook.pages.length,
      activityLine: KAB.coverActivityLine(summary),
      dims: dims, summary: summary,
      thumbDesigns: thumbDesigns.slice(0, 3)
    });
  }

  window.BookBuilder = {
    init: init, printWorksheet: printWorksheet, _renderBook: renderBook,
    _renderWrapCover: renderWrapCover, _frontCoverHTML: frontCoverHTML,
    _coverDecoSVG: coverDecoSVG, _coverTitleClass: coverTitleClass,
    addCustomColoringPage: addCustomColoringPage,
    getCustomPages: function () { return customColoringPages.slice(); },
    getLastBook: function () { return lastBook; }
  };
})();
