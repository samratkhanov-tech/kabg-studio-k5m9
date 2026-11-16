/*
 * ============================================================
 *  Songlap Kids Activity Book Generator — main app
 * ============================================================
 *  LICENSING CONFIG
 *  Each buyer has a UNIQUE code, registered to their name by
 *  the license server (Google Apps Script + Google Sheet).
 *  The app sends { name, code } to LICENSE_API_URL and unlocks
 *  only when the server says ok.
 *  >> After deploying the Apps Script web app, paste its URL
 *     in place of the placeholder below. That is the ONLY
 *     change needed to go live. <<
 * ============================================================
 */
const LICENSE_API_URL = "https://script.google.com/macros/s/AKfycbz9xBV4BVvKFcFfxxddhLowYuOIIoi3QOIUhkQHEO3dWAz3ko-jMhxCHgElv-MDS0df/exec";

/* ---------- License response handling (pure, unit-tested) ---------- */

var LICENSE_ERROR_MESSAGES = {
  invalid_code: 'This code was not found. Please check the code from your purchase.',
  code_registered_to_another_name: 'This code is already registered to another buyer. If this is your code, please contact support.',
  missing_fields: 'Please enter both your name and your code.',
  network: 'Could not verify your code. Please check your internet connection and try again.'
};

function licenseErrorMessage(errorCode) {
  return LICENSE_ERROR_MESSAGES[errorCode] || LICENSE_ERROR_MESSAGES.network;
}

/* Turn a parsed license-server response into an app decision. */
function interpretLicenseResponse(data) {
  if (!data || typeof data !== 'object') {
    return { action: 'error', message: licenseErrorMessage('network') };
  }
  if (data.ok === true) {
    return { action: 'unlock', test: data.test === true };
  }
  return { action: 'error', message: licenseErrorMessage(data.error) };
}

/* Allow the Node test suite to exercise the pure logic above. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LICENSE_API_URL: LICENSE_API_URL,
    LICENSE_ERROR_MESSAGES: LICENSE_ERROR_MESSAGES,
    licenseErrorMessage: licenseErrorMessage,
    interpretLicenseResponse: interpretLicenseResponse
  };
}

(function () {
  'use strict';

  /* ---------- License gate ---------- */

  var NAME_KEY = 'kabg_license_name';
  var CODE_KEY = 'kabg_license_code';
  var appStarted = false;

  function unlock() {
    document.getElementById('lock-screen').hidden = true;
    document.getElementById('app').hidden = false;
    if (!appStarted) { appStarted = true; initApp(); }
  }

  function showLicenseBar(name, code) {
    document.getElementById('license-name').textContent = name;
    document.getElementById('license-code').textContent = code;
    document.getElementById('license-bar').hidden = false;
  }

  function storedLicense() {
    try {
      var name = localStorage.getItem(NAME_KEY);
      var code = localStorage.getItem(CODE_KEY);
      if (name && code) return { name: name, code: code };
    } catch (e) { /* private mode */ }
    return null;
  }

  function initGate() {
    var saved = storedLicense();
    if (saved) { showLicenseBar(saved.name, saved.code); unlock(); return; }

    var form = document.getElementById('lock-form');
    var nameInput = document.getElementById('lock-name');
    var codeInput = document.getElementById('lock-input');
    var button = document.getElementById('lock-submit');
    var errorEl = document.getElementById('lock-error');

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    function setChecking(checking) {
      button.disabled = checking;
      nameInput.disabled = checking;
      codeInput.disabled = checking;
      button.textContent = checking ? 'Checking…' : 'Unlock';
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = nameInput.value.trim().replace(/\s+/g, ' ');
      var code = codeInput.value.trim().toUpperCase();
      if (!name || !code) { showError(licenseErrorMessage('missing_fields')); return; }
      errorEl.hidden = true;
      setChecking(true);
      // text/plain keeps this a "simple request" (no CORS preflight),
      // which is what the Apps Script web app expects.
      fetch(LICENSE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ name: name, code: code })
      }).then(function (resp) {
        return resp.json();
      }).then(function (data) {
        var result = interpretLicenseResponse(data);
        setChecking(false);
        if (result.action === 'unlock') {
          try {
            localStorage.setItem(NAME_KEY, name);
            localStorage.setItem(CODE_KEY, code);
          } catch (e) { /* ignore */ }
          showLicenseBar(name, code);
          unlock();
        } else {
          showError(result.message);
        }
      }).catch(function () {
        setChecking(false);
        showError(licenseErrorMessage('network'));
      });
    });
  }

  /* ---------- App ---------- */

  function $(id) { return document.getElementById(id); }
  function seedRng() { return KAB.makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0); }

  var state = {}; // key -> { page, showSolution }

  /* Fill a design <select>. opts: { ids: [design ids to offer],
     filter: name substring (case-insensitive) }. Keeps the current
     selection when it is still in the list. */
  function fillDesignSelect(id, opts) {
    opts = opts || {};
    var sel = $(id);
    var prev = sel.value;
    var f = (opts.filter || '').toLowerCase();
    var h = '<option value="">🎲 Random design</option>';
    var any = false;
    KAB.DESIGNS.forEach(function (d) {
      if (opts.ids && opts.ids.indexOf(d.id) === -1) return;
      if (f && d.name.toLowerCase().indexOf(f) === -1) return;
      any = true;
      h += '<option value="' + d.id + '">' + d.name + '</option>';
    });
    if (!any) h += '<option value="" disabled>No match — try the upload below</option>';
    sel.innerHTML = h;
    if (prev && sel.querySelector('option[value="' + prev + '"]')) sel.value = prev;
    return any;
  }

  /* ---------- Coloring extras: name search + "Your Own Picture" ---------- */

  var customImg = null; // { edge, width, height, name, dataUrl, imageData }

  function customColoringPage() {
    return {
      type: 'coloring', title: 'Coloring — Your Picture',
      instructions: 'Color the picture with your favorite colors!',
      designId: 'custom-upload', designName: 'Your Picture',
      customImage: {
        dataUrl: customImg.dataUrl, imageData: customImg.imageData,
        width: customImg.width, height: customImg.height, name: customImg.name
      }
    };
  }

  function showCustomPage() {
    state.coloring.page = customColoringPage();
    state.coloring.showSolution = false;
    $('coloring-print').disabled = false;
    $('coloring-png').disabled = false;
    $('coloring-add-book').disabled = false;
    draw('coloring');
  }

  /* Re-threshold from the cached edge map — the file is never re-read
     when the Detail slider moves. */
  function applyCustomDetail() {
    if (!customImg) return;
    var detail = parseInt($('coloring-detail').value, 10);
    var threshold = PNGExport.thresholdFromDetail(isNaN(detail) ? 50 : detail);
    var rgba = PNGExport.edgesToLineArt(customImg.edge, customImg.width, customImg.height, threshold);
    var canvas = document.createElement('canvas');
    canvas.width = customImg.width;
    canvas.height = customImg.height;
    canvas.getContext('2d').putImageData(new ImageData(rgba, customImg.width, customImg.height), 0, 0);
    customImg.dataUrl = canvas.toDataURL('image/png');
    customImg.imageData = { data: rgba, width: customImg.width, height: customImg.height };
    showCustomPage();
  }

  function initColoringExtras() {
    // Part A — search the built-in library by name
    $('coloring-search').addEventListener('input', function () {
      var q = $('coloring-search').value;
      var any = fillDesignSelect('coloring-design', { filter: q });
      $('coloring-nomatch').hidden = any || !q.trim();
    });

    // Part B — upload a picture and turn it into a coloring page
    $('coloring-file').addEventListener('change', function () {
      var file = $('coloring-file').files && $('coloring-file').files[0];
      if (!file) return;
      var status = $('coloring-custom-status');
      status.textContent = 'Loading your picture…';
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maxSide = 1200;
          var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var pixels;
          try {
            pixels = ctx.getImageData(0, 0, w, h);
          } catch (e) {
            status.textContent = 'That picture could not be read. Please try another image file.';
            return;
          }
          var processed = PNGExport.processImageData(pixels.data, w, h);
          customImg = {
            edge: processed.edge, width: w, height: h,
            name: file.name || 'Your Picture', dataUrl: '', imageData: null
          };
          applyCustomDetail();
          status.textContent = 'Your picture is now a coloring page! Move the Detail slider ' +
            'for more or fewer lines, print it, download the PNG, or add it to your book.';
        };
        img.onerror = function () {
          status.textContent = 'That file does not look like a picture. Please try a JPG or PNG.';
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    $('coloring-detail').addEventListener('input', applyCustomDetail);

    $('coloring-add-book').addEventListener('click', function () {
      if (!customImg || !window.BookBuilder) return;
      var n = BookBuilder.addCustomColoringPage(customColoringPage());
      $('coloring-custom-status').textContent = 'Added to your book (' + n +
        ' own-picture page' + (n === 1 ? '' : 's') + ' waiting). ' +
        'It will appear in the Coloring section the next time you build the book in the Book Builder tab.';
    });
  }

  function initApp() {
    initTabs();
    fillDesignSelect('coloring-design');
    // dot-to-dot offers the silhouette pool (mandalas excluded — their
    // outline is only the plain outer ring)
    fillDesignSelect('dottodot-design', { ids: KAB.D2D_POOL });
    initColoringExtras();

    wireActivity('mazes', {
      solution: true,
      make: function (rng) {
        return KAB.generateMazePage($('mazes-size').value, rng);
      },
      status: function (page) {
        return 'A fresh maze with one single solution path (' +
          (page.path ? page.path.length : 0) + ' steps). Print it, or peek at the solution.';
      }
    });

    wireActivity('wordsearch', {
      solution: true,
      make: function (rng) {
        var theme = $('wordsearch-theme').value;
        return KAB.generateWordSearchPage(theme,
          parseInt($('wordsearch-size').value, 10) || 10,
          {
            diagonal: $('wordsearch-diagonal').checked,
            customWords: $('wordsearch-custom').value.split(/[\n,]+/)
          }, rng);
      },
      status: function (page) {
        var msg = page.placements.length + ' words hidden in the grid.';
        if (page.unplaced.length) {
          msg += ' Could not fit: ' + page.unplaced.join(', ') + ' (try a bigger grid).';
        }
        return msg;
      }
    });

    wireActivity('coloring', {
      solution: false,
      make: function (rng) {
        return KAB.generateColoringPage($('coloring-design').value || null, rng);
      },
      status: function (page) {
        return '“' + page.designName + '” is ready — print it or download the PNG to color digitally.';
      }
    });

    wireActivity('dottodot', {
      solution: true,
      make: function (rng) {
        return KAB.generateDotToDotPage($('dottodot-design').value || null,
          parseInt($('dottodot-dots').value, 10) || 30, rng);
      },
      status: function (page) {
        return page.points.length + ' dots to connect. The solution shows the finished picture.';
      }
    });

    var tracingStart = 0;
    wireActivity('tracing', {
      solution: false,
      make: function (rng) {
        var mode = $('tracing-mode').value;
        var page = KAB.generateTracingPage(mode, rng, tracingStart);
        tracingStart += KAB.TRACING_ROWS_PER_SHEET;
        return page;
      },
      status: function () {
        return 'Click Generate again for the next letters in the set.';
      }
    });

    wireActivity('counting', {
      solution: true,
      make: function (rng) {
        return KAB.generateCountingPage($('counting-range').value, rng);
      },
      status: function () {
        return 'Four counting groups per page. Answers stay hidden until you show the solution.';
      }
    });

    wireActivity('oddoneout', {
      solution: true,
      make: function (rng) {
        return KAB.generateOddOneOutPage($('oddoneout-level').value,
          parseInt($('oddoneout-grid').value, 10) || 3, rng);
      },
      status: function () {
        return 'Four groups per page — one picture in each group is different.';
      }
    });

    wireActivity('reading', {
      solution: true,
      make: function (rng) {
        return KAB.generateReadingStripsPage({
          level: $('reading-level').value,
          perPage: parseInt($('reading-perpage').value, 10) || 6,
          style: $('reading-style').value,
          customText: $('reading-custom').value
        }, rng);
      },
      status: function (page) {
        if (page.custom) {
          if (!page.strips.length) {
            return 'None of your sentences names a picture from the library (' +
              page.skippedCount + ' skipped). Try words like cat, rocket, whale or cake.';
          }
          return 'Made ' + page.usedCount + ' strip' + (page.usedCount === 1 ? '' : 's') +
            ' from your sentences' +
            (page.skippedCount ? ' — ' + page.skippedCount +
              ' line' + (page.skippedCount === 1 ? '' : 's') +
              ' skipped (no picture word found).' : '.');
        }
        return page.strips.length + ' reading strips at ' + page.levelLabel +
          ' level — each sentence matches exactly one picture.';
      }
    });

    if (window.BookBuilder) BookBuilder.init(seedRng);
    // friendly first screen: pre-generate a maze
    $('mazes-generate').click();
  }

  function initTabs() {
    $('tabs').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.panel').forEach(function (p) { p.hidden = true; });
      $('panel-' + btn.dataset.tab).hidden = false;
    });
  }

  /* One activity tab: Generate / solution toggle / Print-PDF / PNG. */
  function wireActivity(key, cfg) {
    state[key] = { page: null, showSolution: false };

    $(key + '-generate').addEventListener('click', function () {
      state[key].page = cfg.make(seedRng());
      state[key].showSolution = false;
      $(key + '-print').disabled = false;
      $(key + '-png').disabled = false;
      if (cfg.solution) {
        $(key + '-key').disabled = false;
        $(key + '-key').textContent = 'Show Solution';
      }
      $(key + '-status').textContent = cfg.status ? cfg.status(state[key].page) : '';
      draw(key);
    });

    if (cfg.solution) {
      $(key + '-key').addEventListener('click', function () {
        state[key].showSolution = !state[key].showSolution;
        $(key + '-key').textContent = state[key].showSolution ? 'Hide Solution' : 'Show Solution';
        draw(key);
      });
    }

    $(key + '-print').addEventListener('click', function () {
      if (state[key].page && window.BookBuilder) BookBuilder.printWorksheet(state[key].page);
    });

    $(key + '-png').addEventListener('click', function () {
      if (state[key].page) PNGExport.downloadPNG(state[key].page, { solution: state[key].showSolution });
    });
  }

  function draw(key) {
    var s = state[key];
    if (!s || !s.page) return;
    var html = Render.pageHTML(s.page, { solution: s.showSolution });
    if (s.showSolution &&
        (s.page.type === 'counting' || s.page.type === 'oddoneout')) {
      html += Render.answerKeyHTML(s.page);
    }
    $(key + '-output').innerHTML = html;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initGate);
  }
})();
