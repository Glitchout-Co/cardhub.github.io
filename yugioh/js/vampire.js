/* =========================================================================
   Yu-Gi-Oh! Page Logic
   - deck loading, filtering, rendering
   - hand tester with “hide drawn” projection
   - life point counter
   - export (.YDK / .TXT) and import (.YDK -> your JSON template)
   ========================================================================= */


/* =========================
   1) LOADER (page-level)
   What: show loader as soon as HTML is parsed; hide after assets load
   Why: avoids “flash of blank page”
========================= */

// Start with loader visible while the page parses CSS/fonts/etc.
document.addEventListener("DOMContentLoaded", () => showLoader());
// Hide it once the page’s static assets are done (even if no deck is chosen)
window.addEventListener("load", () => hideLoader());

// Loader helpers
function showLoader() { document.getElementById("loading")?.removeAttribute("hidden"); }
function hideLoader() { document.getElementById("loading")?.setAttribute("hidden", ""); }

/* ===== END: LOADER ===== */



/* =========================
   2) GLOBAL STATE + UTILS
========================= */

// Last loaded deck (canonical source)
let CURRENT_DECK = null;

// Optional mutated copy (used when we want to “spend” quantities)
let WORKING_DECK = null;

// Latest hand (hand tester)
let CURRENT_HAND = [];

// LocalStorage key for saved hands
const SAVED_KEY = "ygo.savedHands.v1";

// Track how many copies of each card have been drawn (affects list projection)
const DRAWN = { counts: new Map() };

// Deep-clone simple objects
const cloneDeck = (deck) => JSON.parse(JSON.stringify(deck));

// Unique identity for a card
const cardIdOf = (card) => card.id ?? card.name;

// If a working deck exists, use it; otherwise the current deck
const activeDeck = () => WORKING_DECK || CURRENT_DECK;

// Small wait helper (crossfades, etc.)
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Lowercase normalize (for case-insensitive matching)
const norm = (s) => String(s || "").toLowerCase();

// Accepts "Monster / Zombie" OR ["Monster","Zombie"] → array
const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return String(v).split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
};

// Join tokens back for display: ["Monster","Zombie"] → "Monster / Zombie"
const joinSlash = (arr) => arr.join(" / ");

// For text search: stringify card.type no matter its shape.
const typesArrToString = (v) => joinSlash(asArray(v));

// Normalized “function” tags per card (if any)
function getFunctionTags(card) {
  const raw = card.function ?? card.functions ?? [];
  return asArray(raw).map(s => s.toLowerCase());
}

// Update drawn counters
function cardKey(card) { return (card.id != null) ? `id:${card.id}` : `name:${card.name}`; }
function incDrawn(card, n = 1) { const k = cardKey(card); DRAWN.counts.set(k, (DRAWN.counts.get(k) || 0) + n); }
function clearDrawn() { DRAWN.counts.clear(); }

// Remaining qty after subtracting drawn count
function remainingQtyFor(card) {
  const have = Number(card.qty) || 1;
  const used = DRAWN.counts.get(cardKey(card)) || 0;
  return Math.max(0, have - used);
}

// Project a section so .qty becomes “remaining”, drop depleted
function projectCardsForDisplay(list) {
  return (list || [])
    .map(c => ({ ...c, qty: remainingQtyFor(c) }))
    .filter(c => c.qty > 0);
}

/* ===== END: GLOBAL STATE + UTILS ===== */



/* =========================
   3) DATA ACCESS (deck + API)
========================= */

// Load a local JSON deck (your decks)
async function loadDeck(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load: ${path} (${res.status})`);
  return await res.json();
}

// YGOPRODeck: fetch cards by ids (in chunks)
async function fetchCardsByIds(ids = []) {
  const unique = [...new Set(ids)];
  const chunks = [];
  const CHUNK = 50; // API supports multiple IDs; chunk conservatively

  for (let i = 0; i < unique.length; i += CHUNK) {
    chunks.push(unique.slice(i, i + CHUNK));
  }

  const out = new Map(); // id -> apiCard
  for (const chunk of chunks) {
    const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${chunk.join(",")}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`YGOPRODeck fetch failed (${res.status})`);
    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];
    for (const c of list) out.set(Number(c.id), c);
  }
  return out;
}

/* ===== END: DATA ACCESS ===== */



/* =========================
   4) NORMALIZERS (API -> your card shape)
========================= */

/**
 * Convert a YGOPRO apiCard into your card format,
 * and inject qty (passed in), image, and type array.
 */
function toOurCardFromYGOPRO(apiCard, qty = 1) {
  // image
  const images = apiCard.card_images || [];
  const img = images[0]?.image_url || "../assets/back.jpg";

  // type array (Monster/Spell/Trap + race/subtypes)
  const typeArr = [];
  const t = String(apiCard.type || "");

  if (t.includes("Monster")) {
    typeArr.push("Monster");
    if (apiCard.race) typeArr.push(apiCard.race);          // e.g. Zombie / Warrior
    if (t.includes("Tuner"))   typeArr.push("Tuner");
    if (t.includes("Synchro")) typeArr.push("Synchro");
    if (t.includes("Xyz"))     typeArr.push("XYZ");
    if (t.includes("Link"))    typeArr.push("Link");
  } else if (t.includes("Spell")) {
    typeArr.push("Spell");
    if (apiCard.race) typeArr.push(apiCard.race);          // Normal, Quick-Play, Field...
  } else if (t.includes("Trap")) {
    typeArr.push("Trap");
    if (apiCard.race) typeArr.push(apiCard.race);          // Normal, Counter, Continuous
  }

  const isLink = t.includes("Link");
  const isXyz  = t.includes("Xyz");

  // Build your shape
  const card = {
    id: Number(apiCard.id),
    name: apiCard.name,
    archetype: apiCard.archetype || undefined,
    function: [],                             // unknown from API — leave empty; you can annotate later
    qty: Number(qty) || 1,
    attribute: apiCard.attribute || undefined,
    type: typeArr,
    level: (!isXyz && !isLink) ? (apiCard.level ?? undefined) : undefined,
    rank:  isXyz ? (apiCard.level ?? undefined) : undefined,
    link:  isLink ? (apiCard.linkval ?? undefined) : undefined,
    atk: apiCard.atk ?? undefined,
    def: isLink ? undefined : (apiCard.def ?? undefined),
    desc: apiCard.desc || undefined,
    img,
  };

  // Clean undefined keys (keeps your JSON neat)
  Object.keys(card).forEach(k => card[k] === undefined && delete card[k]);
  return card;
}

/* ===== END: NORMALIZERS ===== */



/* =========================
   5) EXPORTERS (.ydk / .txt) + download
========================= */

// Sum qty helper
function sumQty(list) { return (list || []).reduce((n, c) => n + (Number(c.qty) || 1), 0); }

// Build .ydk text from current deck
function buildYdk(deck, author = "Unknown") {
  let out = `#created by ${author}\n#main\n`;
  (deck.sections?.main || []).forEach(c => {
    const id = c.id;
    const qty = Number(c.qty) || 1;
    for (let i = 0; i < qty; i++) out += id + "\n";
  });
  out += "#extra\n";
  (deck.sections?.extra || []).forEach(c => {
    const id = c.id;
    const qty = Number(c.qty) || 1;
    for (let i = 0; i < qty; i++) out += id + "\n";
  });
  out += "!side\n";
  (deck.sections?.side || []).forEach(c => {
    const id = c.id;
    const qty = Number(c.qty) || 1;
    for (let i = 0; i < qty; i++) out += id + "\n";
  });
  return out;
}

// Build .txt (readable list)
function buildTxt(deck) {
  const parts = [];
  function add(label, list) {
    if (!list?.length) return;
    parts.push(`=== ${label} ===`);
    list.forEach(c => parts.push(`${c.name} ×${Number(c.qty) || 1}`));
    parts.push("");
  }
  add("Main", deck.sections?.main);
  add("Extra", deck.sections?.extra);
  add("Side", deck.sections?.side);
  return parts.join("\n");
}

// Trigger download of a text file
function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

/* ===== END: EXPORTERS ===== */



/* =========================
   6) .YDK IMPORT ➜ Your JSON template
========================= */

// IMPORT .YDK → JSON (download + load immediately)
const btnImport = root.querySelector("#btnImportYdk");
const inputYdk  = root.querySelector("#importYdkInput");
if (btnImport && inputYdk && !btnImport.dataset.wired) {
  btnImport.addEventListener("click", () => inputYdk.click());

  inputYdk.addEventListener("change", async () => {
    const file = inputYdk.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      showLoader();

      // Build your deck object from the .ydk
      const deckJson = await importYdkToJson(text);

      // 1) Offer the JSON as a download (keeps things portable/versionable)
      const pretty = JSON.stringify(deckJson, null, 2);
      const safeName = (deckJson.name || "imported-deck").replace(/[^\w\-]+/g, "_");
      downloadFile(`${safeName}.json`, pretty);

      // 2) Load it into the app immediately
      CURRENT_DECK = deckJson;
      WORKING_DECK = null;
      CURRENT_HAND = [];
      clearDrawn();
      render(deckJson);

      // Optional: ensure the page is in the right theme (generic import tag)
      document.body.classList.forEach(cls => { if (cls.endsWith("-deck")) document.body.classList.remove(cls); });
      document.body.classList.add("imported-deck");

      // Optional UX: scroll to top so the user sees the header + filters
      window.scrollTo({ top: 0, behavior: "smooth" });

    } catch (err) {
      console.error(err);
      alert("Import failed. Check the .YDK file and try again.");
    } finally {
      hideLoader();
      inputYdk.value = ""; // allow re-selecting the same file
    }
  });

  btnImport.dataset.wired = "1";
}


/* ===== END: .YDK IMPORT ===== */



/* =========================
   7) LIFE POINT COUNTER (tap player panel to apply amount)
========================= */

function wireLifePoints(root = document) {
  const wrap   = root.querySelector("#lpRoot");
  if (!wrap || wrap.dataset.wired) return;
  wrap.dataset.wired = "1";

  const elA    = wrap.querySelector("#lpA");
  const elB    = wrap.querySelector("#lpB");
  const presets= wrap.querySelectorAll(".lp-btn.preset");
  const steppers= wrap.querySelectorAll(".lp-btn.step");
  const mode   = wrap.querySelector("#lpMode");
  const reset  = wrap.querySelector("#lpReset");
  const input  = wrap.querySelector("#lpAmt");

  let lpA = 8000, lpB = 8000;
  let isDamage = true; // Damage=subtract, Heal=add

  const clampLP = (v) => Math.max(0, Math.min(999999, v|0));
  const readAmt = () => Math.max(0, Math.abs(parseInt(input.value || "0", 10) || 0));
  const render  = () => { elA.textContent = lpA; elB.textContent = lpB; };
  render();

  // Tap/click a player panel to apply amount
  wrap.querySelectorAll(".lp-player").forEach(panel => {
    panel.addEventListener("click", () => {
      const amt = readAmt();
      if (!amt) return;
      const toA = (panel.dataset.player === "A");
      if (toA) lpA = clampLP(isDamage ? lpA - amt : lpA + amt);
      else     lpB = clampLP(isDamage ? lpB - amt : lpB + amt);
      render();
    });
  });

  // Presets
  presets.forEach(b => {
    b.addEventListener("click", () => {
      input.value = b.dataset.amt || "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // +/- steppers
  steppers.forEach(b => {
    b.addEventListener("click", () => {
      const step = parseInt(b.dataset.step || "0", 10) || 0;
      const next = Math.max(0, (parseInt(input.value || "0", 10) || 0) + step);
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // Damage/Heal toggle
  mode.addEventListener("click", () => {
    isDamage = !isDamage;
    mode.setAttribute("aria-pressed", isDamage ? "true" : "false");
    mode.textContent = isDamage ? "Damage" : "Heal";
  });

  // Reset
  reset.addEventListener("click", () => {
    lpA = 8000; lpB = 8000;
    input.value = "0";
    isDamage = true;
    mode.setAttribute("aria-pressed", "true");
    mode.textContent = "Damage";
    render();
  });

  // Enter in amount applies to last-hovered/last-focused player (defaults to A)
  let lastPlayer = "A";
  wrap.querySelectorAll(".lp-player").forEach(p => {
    const set = () => { lastPlayer = p.dataset.player === "B" ? "B" : "A"; };
    p.addEventListener("focus", set);
    p.addEventListener("mouseenter", set);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const amt = readAmt();
      if (!amt) return;
      if (lastPlayer === "A") lpA = clampLP(isDamage ? lpA - amt : lpA + amt);
      else                    lpB = clampLP(isDamage ? lpB - amt : lpB + amt);
      render();
    }
  });
}

/* ===== END: LIFE POINT COUNTER ===== */



/* =========================
   8) RENDERING (cards, sections, deck, hand grid)
========================= */

// Tiny info line under card name
function smallInfo(card) {
  const inline = [], req = [], below = [];
  if (card.level != null)      inline.push(`⭐ ${card.level}`);
  else if (card.rank != null)  inline.push(`⤴️ ${card.rank}`);
  else if (card.link != null)  inline.push(`🔗 ${card.link}`);
  if (card.subtype) inline.push(String(card.subtype).toUpperCase());
  if (card.attribute) inline.push(card.attribute.toUpperCase());
  if (card.requirements) req.push(`<em>"${card.requirements}"</em>`);
  if (card.atk != null && card.def != null) below.push(`⚔️ ${card.atk} / 🛡️ ${card.def}`);
  else if (card.atk != null)                below.push(`⚔️ ${card.atk}`);

  let html = "";
  if (inline.length) html += inline.join(" • ");
  if (req.length)    html += `<br>${req.join(" ")}`;
  if (below.length)  html += `<br>${below.join(" • ")}`;
  return html ? `<small>${html}</small>` : "";
}

// One card tile
function cardItem(card) {
  const qty   = Number(card.qty) || 1;
  const full  = card.img || "../assets/back.jpg";
  const thumb = (typeof full === "string" && full.includes("/images/cards/"))
    ? full.replace("/images/cards/", "/images/cards_small/")
    : full;

  const typeDisplay = joinSlash(asArray(card.type));
  const title = `${card.name} ×${qty}`;

  return `
    <li class="card-tile" title="${title}">
      <div class="thumb">
        <img class="card-img" src="${thumb}" data-fullsrc="${full}" alt="${card.name}" loading="lazy">
        <span class="qty">×${qty}</span>
      </div>
      <div class="meta">
        <strong>${card.name}</strong>
        <div>${typeDisplay}</div>
        ${smallInfo(card)}
      </div>
    </li>
  `;
}

// One deck section (collapsible) — with “remaining qty” projection applied
function sectionBlock(label, cards, collapsed = false) {
  const visible = projectCardsForDisplay(cards);
  if (!visible || !visible.length) return "";
  const count = sumQty(visible);
  const cls   = collapsed ? " is-collapsed" : "";
  const show  = collapsed ? 'style="display:none"' : "";

  return `
    <section class="deck-section${cls}">
      <button class="deck-toggle" type="button" aria-expanded="${collapsed ? "false" : "true"}">
        ${label} <span class="count">(${count})</span>
      </button>
      <div class="deck-content">
        <ul class="card-grid" ${show}>
          ${visible.map(cardItem).join("")}
        </ul>
      </div>
    </section>
  `;
}

// Build Hand Tester visual block (grid version)
function handTesterBlock() {
  return `
    <section class="hand-tester" id="handTester">
      <header>
        <strong>Hand Tester</strong>
        <div class="toggles">
          <label><input type="checkbox" id="htIncludeSide"> Include Side</label>
          <label><input type="checkbox" id="htIncludeExtra"> Include Extra</label>
        </div>
        <div class="controls">
          <button type="button" class="btn btn-sm" id="htDraw5">Draw 5</button>
          <button type="button" class="btn btn-sm" id="htDraw6">Draw 6</button>
          <button type="button" class="btn btn-sm" id="htPlus1">+1</button>
          <button type="button" class="btn btn-sm" id="htShuffle">Reshuffle</button>
          <button type="button" class="btn btn-sm" id="htClear">Clear</button>
          <button type="button" class="btn btn-sm" id="htSave">Save Hand (.txt)</button>
        </div>
      </header>
      <ul class="card-grid hand-grid" id="handList"></ul>
      <div class="stats">Hand: 0 • Deck remaining: 0 • Total pool: 0</div>
    </section>
  `;
}

/** Render the full deck (header + controls + hand tester + sections) */
function render(deck) {
  const root = document.getElementById("deck-root");
  if (!root) return;

  const deckStyle = deck.deckstyle || "Unknown Style";
  const main  = deck.sections?.main  ?? [];
  const extra = deck.sections?.extra ?? [];
  const side  = deck.sections?.side  ?? [];
  const total = sumQty(main) + sumQty(extra) + sumQty(side);

  root.innerHTML = `
    <header class="deck-header">
      <div class="deck-header-actions">
        <button id="collapseAllBtn" class="btn btn-sm" type="button">Collapse All</button>
        <button id="expandAllBtn"   class="btn btn-sm" type="button">Expand All</button>
      </div>

      <h1>${deck.name || "Deck"}</h1>
      <p class="muted">Author: ${deck.author || "Unknown"} • Total: ${total} • Style: ${deckStyle}</p>

      <div class="deck-controls" id="deckControls">
        <!-- Filters -->
        <input id="filterText" type="search" placeholder="Filter cards… (name, type, attribute)" aria-label="Filter cards" />
        <div class="toggle" role="group" aria-label="Card kinds">
          <label><input type="checkbox" id="kindMonster" checked> Monster</label>
          <label><input type="checkbox" id="kindSpell"   checked> Spell</label>
          <label><input type="checkbox" id="kindTrap"    checked> Trap</label>
        </div>
        <div class="level-filter">
          <label>Lv ≥ <input type="number" id="levelMin" min="1" max="12" step="1" value=""></label>
          <label>Lv ≤ <input type="number" id="levelMax" min="1" max="12" step="1" value=""></label>
        </div>
        <button class="btn btn-sm btn-clear" id="filterClear" type="button">Clear Filter</button>
      </div>

      <div class="export-controls">
        <button id="btnExportYdk" class="btn btn-sm" type="button">Export .YDK</button>
        <button id="btnExportTxt" class="btn btn-sm" type="button">Export .TXT</button>
        <input id="importYdkInput" type="file" accept=".ydk,text/plain" hidden>
        <button id="btnImportYdk" class="btn btn-sm" type="button">Import .YDK</button>
      </div>
    </header>

    ${handTesterBlock()}

    ${sectionBlock("Main Deck",  main)}
    ${sectionBlock("Extra Deck", extra)}
    ${sectionBlock("Side Deck",  side)}
  `;

  // Wire everything for this render, scoped to this root.
  wireUI(root, deck);
  wireHandTester(root, deck);
}

/* ===== END: RENDERING ===== */



/* =========================
   9) FILTERING
========================= */

// Build filters object from a root (safe for multiple mount points)
function readFilters(root = document) {
  const q = (sel) => root.querySelector(sel);

  const text = norm(q("#filterText")?.value || "");
  const kinds = {
    Monster: q("#kindMonster")?.checked !== false,
    Spell:   q("#kindSpell")?.checked   !== false,
    Trap:    q("#kindTrap")?.checked    !== false,
  };
  const levelMin = Number(q("#levelMin")?.value) || null;
  const levelMax = Number(q("#levelMax")?.value) || null;
  const fnTag    = norm(q("#functionFilter")?.value || "");

  return { text, kinds, levelMin, levelMax, fnTag };
}

// Card predicate against current filters
function cardMatches(card, f) {
  const typeTokens = asArray(card.type).map(t => t.toLowerCase());

  const isMonster = typeTokens.some(t => t.includes("monster"));
  const isSpell   = typeTokens.some(t => t.includes("spell"));
  const isTrap    = typeTokens.some(t => t.includes("trap"));

  if (isMonster && !f.kinds.Monster) return false;
  if (isSpell   && !f.kinds.Spell)   return false;
  if (isTrap    && !f.kinds.Trap)    return false;

  const lvl = card.level ?? card.rank ?? card.link ?? null;
  if (lvl != null) {
    if (f.levelMin !== null && lvl < f.levelMin) return false;
    if (f.levelMax !== null && lvl > f.levelMax) return false;
  }

  // function tag dropdown
  if (f.fnTag) {
    const tags = getFunctionTags(card);
    if (!tags.includes(f.fnTag)) return false;
  }

  if (f.text) {
    const hay = [
      card.name,
      typesArrToString(card.type),
      card.attribute,
      card.desc,
    ].map(norm).join(" ");
    if (!hay.includes(f.text)) return false;
  }

  return true;
}

const filterCards = (cards, f) => (cards || []).filter(c => cardMatches(c, f));

// Produce a filtered deck
function makeFilteredDeck(deck, f) {
  return {
    ...deck,
    sections: {
      main:  filterCards(deck.sections?.main,  f),
      extra: filterCards(deck.sections?.extra, f),
      side:  filterCards(deck.sections?.side,  f),
    }
  };
}

// Debounce utility
function debounce(fn, ms = 150) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Only re-render sections (keep header + tester intact)
function refreshSections(root, deck) {
  const base = activeDeck() || deck || CURRENT_DECK;
  const filtered = makeFilteredDeck(base, readFilters(root));

  // Keep header + tester
  const headerEl = root.querySelector(".deck-header");
  const testerEl = root.querySelector("#handTester");

  root.innerHTML = "";
  if (headerEl) root.appendChild(headerEl);
  if (testerEl) root.appendChild(testerEl);

  root.insertAdjacentHTML("beforeend", `
    ${sectionBlock("Main Deck",  filtered.sections.main)}
    ${sectionBlock("Extra Deck", filtered.sections.extra)}
    ${sectionBlock("Side Deck",  filtered.sections.side)}
  `);

  // Re-wire just in case new nodes appeared
  wireUI(root, base);
  wireHandTester(root, base);
}

/* ===== END: FILTERING ===== */



/* =========================
   10) HAND TESTER (logic + wiring)
========================= */

// Expand a section by qty into a flat array of card refs
function expandSection(list) {
  const out = [];
  (list || []).forEach(card => {
    const n = Math.max(1, Number(card.qty) || 1);
    for (let i=0; i<n; i++) out.push(card);
  });
  return out;
}

// Pure shuffle (Fisher–Yates)
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a fresh draw state from a deck & toggle options
function makeDrawState(deck, { includeSide = false, includeExtra = false } = {}) {
  const main  = expandSection(deck.sections?.main);
  const side  = includeSide  ? expandSection(deck.sections?.side)  : [];
  const extra = includeExtra ? expandSection(deck.sections?.extra) : [];
  const pool = [...main, ...side, ...extra];
  return { deck: shuffle(pool), hand: [] };
}

// Render the current hand grid + stats
function renderHandInto(root, state) {
  const ul = root.querySelector("#handList");
  const stats = root.querySelector(".stats");
  if (!ul) return;

  if (!state.hand.length) {
    ul.innerHTML = `<li class="muted" style="list-style:none;margin:0.25rem 0;">No cards drawn.</li>`;
  } else {
    ul.innerHTML = state.hand.map(c => {
      const full  = c.img || "../assets/back.jpg";
      const thumb = (typeof full === "string" && full.includes("/images/cards/"))
        ? full.replace("/images/cards/", "/images/cards_small/")
        : full;
      return `
        <li class="card-tile" title="${c.name}">
          <div class="thumb">
            <img class="card-img" src="${thumb}" data-fullsrc="${full}" alt="${c.name}" loading="lazy">
          </div>
          <div class="meta"><strong>${c.name}</strong></div>
        </li>
      `;
    }).join("");
  }

  const total = state.deck.length + state.hand.length;
  if (stats) stats.textContent = `Hand: ${state.hand.length} • Deck remaining: ${state.deck.length} • Total pool: ${total}`;
}

// Wire the hand tester panel (draw/reshuffle/clear/save)
function wireHandTester(root, deck) {
  const panel = root.querySelector("#handTester");
  if (!panel || panel.dataset.wired) return;
  panel.dataset.wired = "1";

  const incSide  = panel.querySelector("#htIncludeSide");
  const incExtra = panel.querySelector("#htIncludeExtra");
  const btn5     = panel.querySelector("#htDraw5");
  const btn6     = panel.querySelector("#htDraw6");
  const btnPlus1 = panel.querySelector("#htPlus1");
  const btnShuf  = panel.querySelector("#htShuffle");
  const btnClear = panel.querySelector("#htClear");
  const btnSave  = panel.querySelector("#htSave");

  let state = makeDrawState(deck, {
    includeSide:  incSide?.checked || false,
    includeExtra: incExtra?.checked || false,
  });
  renderHandInto(panel, state);

  // Rebuild pool when toggles change
  const rebuild = () => {
    state = makeDrawState(deck, {
      includeSide:  incSide?.checked || false,
      includeExtra: incExtra?.checked || false,
    });
    renderHandInto(panel, state);
  };

  // Draw N and sync with “remaining qty” projection
  function drawAndSync(n) {
    for (let i = 0; i < n; i++) {
      if (!state.deck.length) break;
      const c = state.deck.pop();
      state.hand.push(c);
      incDrawn(c, 1);
    }
    renderHandInto(panel, state);
    refreshSections(root, deck);
  }

  incSide ?.addEventListener("change", rebuild);
  incExtra?.addEventListener("change", rebuild);

  btn5    ?.addEventListener("click", () => { clearDrawn(); rebuild(); drawAndSync(5); });
  btn6    ?.addEventListener("click", () => { clearDrawn(); rebuild(); drawAndSync(6); });
  btnPlus1?.addEventListener("click", () => { drawAndSync(1); });

  btnShuf ?.addEventListener("click", () => { clearDrawn(); rebuild(); refreshSections(root, deck); });
  btnClear?.addEventListener("click", () => {
    clearDrawn(); state.hand = []; renderHandInto(panel, state); refreshSections(root, deck);
  });

  // Save hand as a simple .txt (Name xCount)
  btnSave?.addEventListener("click", () => {
    if (!state.hand.length) return;
    const counts = new Map();
    const names  = new Map();
    state.hand.forEach(c => {
      const k = cardKey(c);
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!names.has(k)) names.set(k, c.name);
    });
    const lines = [];
    [...counts.entries()].forEach(([k, n]) => lines.push(`${names.get(k) || k} x${n}`));
    const now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    downloadFile(`hand-${stamp}.txt`, lines.join("\n") + "\n");
  });

  // Mobile nicety: tap a card in hand to put it back on top (undo 1 drawn)
  panel.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const list = Array.from(panel.querySelectorAll("#handList li"));
    const idx  = list.indexOf(li);
    if (idx >= 0) {
      const [card] = state.hand.splice(idx, 1);
      if (card) {
        state.deck.push(card);
        const k = cardKey(card);
        const cur = DRAWN.counts.get(k) || 0;
        if (cur > 0) DRAWN.counts.set(k, cur - 1);
      }
      renderHandInto(panel, state);
      refreshSections(root, deck);
    }
  });
}

/* ===== END: HAND TESTER ===== */



/* =========================
   11) UI WIRING (filters, export/import, collapsibles, header actions)
========================= */

function wireUI(root, deck) {
  if (!root) return;

  // Collapsibles
  root.querySelectorAll(".deck-section").forEach(sec => {
    const btn  = sec.querySelector(".deck-toggle");
    const grid = sec.querySelector(".card-grid");
    if (!btn || !grid) return;

    sec.classList.remove("is-collapsed");
    grid.style.display = "";

    if (!btn.dataset.wired) {
      btn.addEventListener("click", () => {
        const collapsed = sec.classList.toggle("is-collapsed");
        grid.style.display = collapsed ? "none" : "";
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
      btn.dataset.wired = "1";
    }
  });

  // EXPORT buttons
  const btnYdk = root.querySelector("#btnExportYdk");
  const btnTxt = root.querySelector("#btnExportTxt");

  btnYdk?.addEventListener("click", () => {
    const ydk = buildYdk(CURRENT_DECK || deck, (CURRENT_DECK || deck).author || "Unknown");
    downloadFile(`${(CURRENT_DECK || deck).name || "deck"}.ydk`, ydk);
  });

  btnTxt?.addEventListener("click", () => {
    const txt = buildTxt(CURRENT_DECK || deck);
    downloadFile(`${(CURRENT_DECK || deck).name || "deck"}.txt`, txt);
  });

  // IMPORT .YDK → JSON (download)
  const btnImport = root.querySelector("#btnImportYdk");
  const inputYdk  = root.querySelector("#importYdkInput");
  if (btnImport && inputYdk && !btnImport.dataset.wired) {
    btnImport.addEventListener("click", () => inputYdk.click());
    inputYdk.addEventListener("change", async () => {
      const file = inputYdk.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        showLoader();
        const deckJson = await importYdkToJson(text);
        const pretty = JSON.stringify(deckJson, null, 2);
        const safeName = (deckJson.name || "imported-deck").replace(/[^\w\-]+/g, "_");
        downloadFile(`${safeName}.json`, pretty);
      } catch (err) {
        console.error(err);
        alert("Import failed. Check the .YDK file and try again.");
      } finally {
        hideLoader();
        inputYdk.value = ""; // reset so selecting the same file again works
      }
    });
    btnImport.dataset.wired = "1";
  }

  // Header actions (collapse/expand all)
  const header = root.querySelector(".deck-header");
  if (header && !header.dataset.wired) {
    const collapseAllBtn = header.querySelector("#collapseAllBtn");
    const expandAllBtn   = header.querySelector("#expandAllBtn");

    const collapseAll = () => {
      root.querySelectorAll(".deck-section").forEach(sec => {
        const btn  = sec.querySelector(".deck-toggle");
        const grid = sec.querySelector(".card-grid");
        if (!btn || !grid) return;
        sec.classList.add("is-collapsed");
        grid.style.display = "none";
        btn.setAttribute("aria-expanded", "false");
      });
    };

    const expandAll = () => {
      root.querySelectorAll(".deck-section").forEach(sec => {
        const btn  = sec.querySelector(".deck-toggle");
        const grid = sec.querySelector(".card-grid");
        if (!btn || !grid) return;
        sec.classList.remove("is-collapsed");
        grid.style.display = "";
        btn.setAttribute("aria-expanded", "true");
      });
    };

    collapseAllBtn?.addEventListener("click", collapseAll);
    expandAllBtn  ?.addEventListener("click", expandAll);
    header.dataset.wired = "1";
  }

  // Build/refresh the Function dropdown
  const controls = root.querySelector("#deckControls");
  if (controls) {
    let fnWrap = controls.querySelector(".fn-filter-wrap");
    if (!fnWrap) {
      fnWrap = document.createElement("label");
      fnWrap.className = "fn-filter-wrap";
      fnWrap.style.marginLeft = "0.5rem";
      fnWrap.innerHTML = `
        Function:
        <select id="functionFilter">
          <option value="">All</option>
        </select>
      `;
      controls.appendChild(fnWrap);
    }

    const select = fnWrap.querySelector("#functionFilter");
    if (select) {
      const currentValue = select.value || "";
      select.innerHTML = `<option value="">All</option>`;
      collectFunctionFacet(CURRENT_DECK || deck).forEach(tag => {
        const opt = document.createElement("option");
        opt.value = tag;
        opt.textContent = tag.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        select.appendChild(opt);
      });
      if ([...select.options].some(o => o.value === currentValue)) {
        select.value = currentValue;
      }
    }
  }

  // Filter inputs
  const elText  = root.querySelector("#filterText");
  const elMons  = root.querySelector("#kindMonster");
  const elSpell = root.querySelector("#kindSpell");
  const elTrap  = root.querySelector("#kindTrap");
  const elMin   = root.querySelector("#levelMin");
  const elMax   = root.querySelector("#levelMax");
  const elFn    = root.querySelector("#functionFilter");
  const elClear = root.querySelector("#filterClear");

  const applyFilters = () => refreshSections(root, deck);
  const applyDebounced = debounce(applyFilters, 120);

  elText ?.addEventListener("input",  applyDebounced);
  elMons ?.addEventListener("change", applyFilters);
  elSpell?.addEventListener("change", applyFilters);
  elTrap ?.addEventListener("change", applyFilters);
  elMin  ?.addEventListener("input",  applyDebounced);
  elMax  ?.addEventListener("input",  applyDebounced);
  elFn   ?.addEventListener("change", applyFilters);

  elClear?.addEventListener("click", () => {
    if (elText)  elText.value = "";
    if (elMons)  elMons.checked  = true;
    if (elSpell) elSpell.checked = true;
    if (elTrap)  elTrap.checked  = true;
    if (elMin)   elMin.value = "";
    if (elMax)   elMax.value = "";
    if (elFn)    elFn.value = "";
    applyFilters();

    // Expand all after clearing
    root.querySelectorAll(".deck-section").forEach(sec => {
      sec.classList.remove("is-collapsed");
      const grid = sec.querySelector(".card-grid");
      const btn  = sec.querySelector(".deck-toggle");
      if (grid) grid.style.display = "";
      if (btn)  btn.setAttribute("aria-expanded", "true");
    });
  });
}

/* ===== END: UI WIRING ===== */



/* =========================
   12) DECKBOX COUNTS (labels)
========================= */

function sectionCounts(deck) {
  const main  = deck.sections?.main  ?? [];
  const extra = deck.sections?.extra ?? [];
  const side  = deck.sections?.side  ?? [];
  return { main: sumQty(main), extra: sumQty(extra), side: sumQty(side) };
}

async function preloadDeckCounts() {
  const boxes = document.querySelectorAll(".deckbox");
  for (const box of boxes) {
    const path = box.getAttribute("data-deck");
    if (!path) continue;
    try {
      const deck   = await loadDeck(path);
      const counts = sectionCounts(deck);
      const label  = box.querySelector(".deck-label");
      if (!label) continue;
      const deckKey = box.dataset.deckKey || "";
      const nameText = label.textContent.trim();
      label.innerHTML = `
        <span class="deck-name ${deckKey}">${nameText}</span>
        <span class="deck-counts">
          <span class="main-count">${counts.main}</span>
          <span class="extra-count">${counts.extra}</span>
          <span class="side-count">${counts.side}</span>
        </span>
      `;
    } catch (e) {
      console.warn(`Couldn’t preload ${path}`, e);
    }
  }
}

/* ===== END: DECKBOX COUNTS ===== */



/* =========================
   13) CROSSFADE LOAD + BOOT
========================= */

async function crossfadeLoad(path) {
  const mount = document.getElementById("deck-root");
  if (!mount) return;

  showLoader();
  mount.classList.add("is-switching");
  await wait(180);

  try {
    const deck = await loadDeck(path);
    CURRENT_DECK = deck;
    render(deck);
    WORKING_DECK = null;
    CURRENT_HAND = [];
    clearDrawn();
  } catch (e) {
    console.error(e);
    mount.innerHTML = `<p style="color:tomato">Couldn't load the deck (${e.message}).</p>`;
  } finally {
    requestAnimationFrame(() => {
      mount.classList.remove("is-switching");
      hideLoader();
    });
  }
}

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
  preloadDeckCounts();      // counts on deckbox labels
  wireLifePoints(document); // lifepoint counter (once)

  const root    = document.getElementById("deck-root");
  const buttons = Array.from(document.querySelectorAll(".deckbox, .deck-btn"));
  if (!root || buttons.length === 0) return;

  // Neutral state (no deck)
  root.innerHTML = `<p class="muted"></p>`;

  // Deck selection / toggling
  buttons.forEach(btn => {
    btn.addEventListener("click", async () => {
      // Clicking active deck again clears view
      if (btn.classList.contains("is-active")) {
        btn.classList.remove("is-active");
        root.innerHTML = `<p class="muted"></p>`;
        return;
      }

      const path    = btn.getAttribute("data-deck");
      const deckKey = btn.dataset.deckKey;
      if (!path || !deckKey) return;

      // Body theme for deck glow
      document.body.classList.forEach(cls => { if (cls.endsWith("-deck")) document.body.classList.remove(cls); });
      document.body.classList.add(`${deckKey}-deck`);

      // Visual “active” state
      buttons.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");

      try {
        await crossfadeLoad(path);
        btn.classList.remove("is-opening");
        btn.classList.add("is-active");
      } catch {
        btn.classList.remove("is-opening");
      }
    });
  });
});

/* ===== END: CROSSFADE + BOOT ===== */
