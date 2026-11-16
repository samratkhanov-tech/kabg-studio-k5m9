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

  function init(seedRng) {
    $('bk-build').addEventListener('click', function () { buildBook(seedRng); });
    $('bk-print').addEventListener('click', function () { window.print(); });
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
        var pages = KAB.assembleBook({ counts: counts }, rng);
        var pageCount = renderBook(title, author, size, pages);
        $('bk-print').disabled = false;
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

    // solutions divider
    var solvedCount = pages.filter(function (p) { return KAB.pageHasSolution(p); }).length;
    out.push(
      '<div class="book-page divider-page" style="' + ps + '">' +
        '<div class="cover-inner"><h1 class="cover-title">Solutions</h1>' +
        '<p class="cover-count">Answers for ' + solvedCount + ' activity pages</p>' +
        '<p class="cover-count">Coloring and tracing pages have no answers — just have fun!</p></div>' +
      '</div>');

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

  window.BookBuilder = { init: init, printWorksheet: printWorksheet, _renderBook: renderBook };
})();
