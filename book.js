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
        var pageCount = renderBook(title, author, size, pages);
        lastBook = { title: title, author: author, size: size, pages: pages, totalPages: pageCount };
        $('bk-print').disabled = false;
        var coverBtn = $('bk-cover');
        if (coverBtn) coverBtn.disabled = false;
        $('bk-status').textContent = 'Book ready: ' + pages.length + ' activity pages, ' +
          pageCount + ' pages total (title + activity pages + solutions section). ' +
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

  function renderBook(title, author, size, pages) {
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

    // title page
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

  /* ---------- KDP Wrap Cover Builder ---------- */

  function fmtIn(n) { return String(Math.round(n * 10000) / 10000); }

  /* Renders the full wrap (back | spine | front) as ONE page at the
     exact computed size into #book-preview. Returns the dims used. */
  function renderWrapCover(meta, pages, totalPages) {
    var dims = KAB.wrapCoverDims(meta.trimW, meta.trimH, totalPages);
    setPageSize({ cssSize: dims.width + 'in ' + dims.height + 'in' });
    var summary = KAB.bookSectionSummary(pages);

    // sample thumbnails: first maze / coloring / reading page in the book
    var thumbs = [];
    ['maze', 'coloring', 'reading', 'dottodot', 'counting'].forEach(function (t) {
      if (thumbs.length >= 3) return;
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].type === t) { thumbs.push(pages[i]); break; }
      }
    });
    if (!thumbs.length && pages.length) thumbs.push(pages[0]);

    var h = '<div class="wrap-cover" style="width:' + dims.width + 'in;height:' + dims.height +
      'in;padding:' + dims.bleed + 'in;">';

    // back cover
    h += '<div class="wc-back" style="width:' + dims.trimW + 'in;">' +
      '<h2 class="wc-h">Inside this book</h2><ul class="wc-list">';
    summary.forEach(function (s) {
      h += '<li>' + s.count + ' ' + Render.esc(s.label) +
        (s.levels && s.levels.length ? ' (' + s.levels.map(Render.esc).join(', ') + ')' : '') + '</li>';
    });
    h += '</ul><p class="wc-blurb">Create complete kids activity books in minutes — ' +
      'print-ready pages with all solutions included.</p>' +
      '<p class="wc-brand">SONGLAP DEALS</p>' +
      '<div class="wc-barcode">BARCODE</div></div>';

    // spine
    h += '<div class="wc-spine" style="width:' + dims.spine + 'in;">';
    if (dims.spineText) {
      h += '<span>' + Render.esc(meta.title) +
        (meta.author ? ' · ' + Render.esc(meta.author) : '') + '</span>';
    }
    h += '</div>';

    // front cover
    h += '<div class="wc-front" style="width:' + dims.trimW + 'in;">' +
      '<h1 class="wc-title">' + Render.esc(meta.title) + '</h1>';
    if (meta.subtitle) h += '<p class="wc-subtitle">' + Render.esc(meta.subtitle) + '</p>';
    thumbs.forEach(function (p) {
      h += '<div class="wc-thumb">' + Render.pageBodyHTML(p) + '</div>';
    });
    if (meta.author) h += '<p class="wc-author">by ' + Render.esc(meta.author) + '</p>';
    h += '</div></div>';

    var preview = $('book-preview');
    preview.innerHTML = h;
    preview.hidden = false;
    return dims;
  }

  function coverMeta() {
    return {
      title: $('bk-title').value.trim() || 'My Kids Activity Book',
      subtitle: $('bk-subtitle') ? $('bk-subtitle').value.trim() : '',
      author: $('bk-author').value.trim(),
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
    PNGExport.downloadWrapCoverPNG({
      title: meta.title, subtitle: meta.subtitle, author: meta.author,
      dims: dims, summary: KAB.bookSectionSummary(lastBook.pages),
      thumbDesigns: thumbDesigns.slice(0, 3)
    });
  }

  window.BookBuilder = {
    init: init, printWorksheet: printWorksheet, _renderBook: renderBook,
    _renderWrapCover: renderWrapCover, addCustomColoringPage: addCustomColoringPage,
    getCustomPages: function () { return customColoringPages.slice(); },
    getLastBook: function () { return lastBook; }
  };
})();
