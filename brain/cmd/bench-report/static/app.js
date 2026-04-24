// bench-report v2 — client-side interactivity. No external deps.
// Reads window.__CATALOG__ (injected by renderHTMLv2) and wires the
// searchable tool-explorer + category filter + result counter.
(function () {
  "use strict";
  var catalog = (window.__CATALOG__ || []).slice();
  var search = document.getElementById("tool-search");
  var catSel = document.getElementById("tool-category");
  var grid = document.getElementById("tool-grid");
  var countEl = document.getElementById("tool-explorer-count");
  if (!grid) return;

  // Populate category dropdown from the catalog (unique, sorted).
  var cats = {};
  catalog.forEach(function (t) { if (t.category) cats[t.category] = true; });
  var catList = Object.keys(cats).sort();
  if (catSel) {
    catList.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c;
      catSel.appendChild(o);
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function render() {
    var q = (search && search.value || "").trim().toLowerCase();
    var cat = (catSel && catSel.value) || "";
    var out = [];
    var shown = 0;
    for (var i = 0; i < catalog.length; i++) {
      var t = catalog[i];
      if (cat && t.category !== cat) continue;
      if (q) {
        var hay = (t.name + " " + (t.description || "") + " " + (t.plain_english || "")).toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }
      shown++;
      out.push(
        '<div class="tool-card">' +
          '<div><span class="tool-name">' + esc(t.name) + '</span>' +
          (t.category ? '<span class="tool-cat">' + esc(t.category) + '</span>' : '') +
          '</div>' +
          (t.plain_english ? '<div class="tool-plain">' + esc(t.plain_english) + '</div>' : '') +
          (t.description ? '<div class="tool-desc">' + esc(t.description) + '</div>' : '') +
        '</div>'
      );
    }
    grid.innerHTML = out.join("");
    if (countEl) {
      countEl.textContent = shown + " of " + catalog.length + " tools";
    }
  }

  if (search) search.addEventListener("input", render);
  if (catSel) catSel.addEventListener("change", render);
  render();
})();
