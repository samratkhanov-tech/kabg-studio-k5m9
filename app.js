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

  function fillDesignSelect(id) {
    var sel = $(id);
    var h = '<option value="">🎲 Random design</option>';
    KAB.DESIGNS.forEach(function (d) {
      h += '<option value="' + d.id + '">' + d.name + '</option>';
    });
    sel.innerHTML = h;
  }

  function initApp() {
    initTabs();
    fillDesignSelect('coloring-design');
    fillDesignSelect('dottodot-design');

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
