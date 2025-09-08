/* =========================================================================
   Yu-Gi-Oh! page logic (deck loading, collapsibles, filtering, counts)
   ========================================================================= */

/* ------------------------- Loader on page load ------------------------- */
// What it does: Shows a loading overlay as soon as HTML is parsed; hides it when all page assets (images/fonts/css) finish.
//
// Why: Prevents a “flash of empty page” feeling while things get ready.

// Start with loader visible while the page parses CSS/fonts/etc.
document.addEventListener("DOMContentLoaded", () => showLoader());
// Hide it once the page’s static assets are done (even if no deck is chosen)
window.addEventListener("load", () => hideLoader());

/* ------------------------- Data + small helpers ------------------------ */

// Keep the last loaded deck so we can re-filter without re-fetching.
let CURRENT_DECK = null;
let WORKING_DECK = null; // after filtering
let CURRENT_HAND = []; // for hand tester
const SAVED_KEY = "ygo.savedHands.v1"; // localStorage key

// Deep-clone a deck so we can mutate qtys safely
const cloneDeck = (deck) => JSON.parse(JSON.stringify(deck));

// Use card.id as the identity (your JSON has it). Fallback to name if missing.
const cardIdOf = (card) => card.id ?? card.name;

// Get an "active" deck to render from (working deck if exists, otherwise current)
const activeDeck = () => WORKING_DECK || CURRENT_DECK;

// global-ish bag to track how many copies of each card we've drawn
const DRAWN = { counts: new Map() };

// Small wait helper for transitions / crossfades.
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Normalize strings for case-insensitive matching.
const norm = (s) => String(s || "").toLowerCase();

// Accepts "Monster/Vampire" OR ["Monster","Vampire"] and returns an array.
const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return String(v).split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
};

// Join tokens back to a single display string like "Monster/Vampire".
const joinSlash = (arr) => arr.join(" / ");

// For text search: stringify card.type no matter its shape.
const typesArrToString = (v) => joinSlash(asArray(v));

// Grab a normalized array of "function" tags from a card
function getFunctionTags(card) {
  const raw = card.function ?? card.functions ?? [];
  return asArray(raw).map(s => s.toLowerCase());
}

// Start/Reset the working deck (copies CURRENT_DECK; restores all qty)
function startWorkingDeck() {
  if (!CURRENT_DECK) return;
  WORKING_DECK = cloneDeck(CURRENT_DECK);
  CURRENT_HAND = [];
}

// Build a unique, sorted list of function tags from a deck
function collectFunctionFacet(deck) {
  const set = new Set();
  const allSections = [deck.sections?.main ?? [], deck.sections?.extra ?? [], deck.sections?.side ?? []].flat();
  allSections.forEach(card => {
    getFunctionTags(card).forEach(tag => set.add(tag));
  });
  return Array.from(set).sort(); // e.g. ["boss","control","disruption",...]
}

// Fully reshuffle: reset working deck back to CURRENT_DECK
function reshuffleWorkingDeck() {
  startWorkingDeck();
}

// Draw N cards from WORKING_DECK.main, reduce quantities, update CURRENT_HAND
function drawFromWorkingDeck(n = 5) {
  if (!WORKING_DECK) startWorkingDeck();
  const main = WORKING_DECK.sections?.main || [];
  const pool = expandByQty(main);
  if (pool.length === 0) return [];

  const shuffled = shuffle(pool); // use your existing pure shuffle
  const drawn = shuffled.slice(0, Math.max(0, Math.min(n, shuffled.length)));

  // reduce qty in WORKING_DECK by drawn counts
  const need = new Map();
  for (const c of drawn) {
    const key = cardIdOf(c);
    need.set(key, (need.get(key) || 0) + 1);
  }
  for (const c of main) {
    const k = cardIdOf(c);
    const take = need.get(k) || 0;
    if (take > 0) {
      const q = Number(c.qty) || 1;
      c.qty = Math.max(0, q - take);
    }
  }

  CURRENT_HAND = drawn.slice();
  return drawn;
}


// Persist CURRENT_HAND to localStorage (IDs + names)
function saveCurrentHand() {
  const prev = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  const pack = {
    at: Date.now(),
    hand: CURRENT_HAND.map(c => ({
      id: cardIdOf(c),
      name: c.name,
      img: c.img || null
    }))
  };
  prev.unshift(pack);
  // keep last 20 hands
  localStorage.setItem(SAVED_KEY, JSON.stringify(prev.slice(0, 20)));
}

// stable key per card (prefer id, fall back to name)
function cardKey(card) {
  return (card.id != null) ? `id:${card.id}` : `name:${card.name}`;
}

function incDrawn(card, n = 1) {
  const k = cardKey(card);
  DRAWN.counts.set(k, (DRAWN.counts.get(k) || 0) + n);
}
function clearDrawn() {
  DRAWN.counts.clear();
}

function remainingQtyFor(card) {
  const have = Number(card.qty) || 1;
  const used = DRAWN.counts.get(cardKey(card)) || 0;
  return Math.max(0, have - used);
}

// project a section’s cards so .qty becomes “remaining”, and drop depleted
function projectCardsForDisplay(list) {
  return (list || [])
    .map(c => ({ ...c, qty: remainingQtyFor(c) }))
    .filter(c => c.qty > 0);
}

/* =========================
   LIFE POINT COUNTER (JS)
========================= */

function wireLifePoints(root = document) {
  const wrap   = root.querySelector("#lpRoot");
  if (!wrap || wrap.dataset.wired) return; // avoid double-binding
  wrap.dataset.wired = "1";

  const elA    = wrap.querySelector("#lpA");
  const elB    = wrap.querySelector("#lpB");
  const presets= wrap.querySelectorAll(".lp-btn.preset");
  const steppers= wrap.querySelectorAll(".lp-btn.step");
  const mode   = wrap.querySelector("#lpMode");
  const reset  = wrap.querySelector("#lpReset");
  const input  = wrap.querySelector("#lpAmt");

  // Local state
  let lpA = 8000;
  let lpB = 8000;
  let isDamage = true; // Damage = subtract, Heal = add

  const clampLP = (v) => Math.max(0, Math.min(999999, v|0));
  const readAmt = () => Math.max(0, Math.abs(parseInt(input.value || "0", 10) || 0));
  const render  = () => {
    elA.textContent = lpA;
    elB.textContent = lpB;
  };
  render();

  // Tap/click a player panel to apply amount in the middle
  wrap.querySelectorAll(".lp-player").forEach(panel => {
    panel.addEventListener("click", () => {
      const amt = readAmt();
      if (!amt) return;
      const target = panel.dataset.player === "A" ? "A" : "B";
      if (target === "A") lpA = clampLP(isDamage ? lpA - amt : lpA + amt);
      else                lpB = clampLP(isDamage ? lpB - amt : lpB + amt);
      render();
      // optional: clear the amount after apply
      // input.value = "0";
    });
  });

  // Preset buttons (100 / 500 / 1000)
  presets.forEach(b => {
    b.addEventListener("click", () => {
      input.value = b.dataset.amt || "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // Stepper buttons (±100 around current amount)
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

  // Keyboard niceties: Enter applies to last-clicked player; default to A
  let lastPlayer = "A";
  wrap.querySelectorAll(".lp-player").forEach(p => {
    p.addEventListener("focus", () => { lastPlayer = p.dataset.player === "B" ? "B" : "A"; });
    p.addEventListener("mouseenter", () => { lastPlayer = p.dataset.player === "B" ? "B" : "A"; });
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

/* ---------------------------- Data layer ------------------------------- */

async function loadDeck(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load: ${path} (${res.status})`);
  return await res.json();
}

function sumQty(list) {
  return (list || []).reduce((n, c) => n + (Number(c.qty) || 1), 0);
}

/* --------------------------- Rendering bits ---------------------------- */

// Build the tiny info block beneath a card’s name.
function smallInfo(card) {
  const inline = [], req = [], below = [];

  // Level/Rank/Link (only one shows)
  if (card.level != null)      inline.push(`⭐ ${card.level}`);
  else if (card.rank != null)  inline.push(`⤴️ ${card.rank}`);
  else if (card.link != null)  inline.push(`🔗 ${card.link}`);

  // Subtype
  if (card.subtype) inline.push(String(card.subtype).toUpperCase());

  // Attribute
  if (card.attribute) inline.push(card.attribute.toUpperCase());

  // Extra-deck requirements (optional field you added)
  if (card.requirements) req.push(`<em>"${card.requirements}"</em>`);

  // ATK/DEF (or ATK only)
  if (card.atk != null && card.def != null) below.push(`⚔️ ${card.atk} / 🛡️ ${card.def}`);
  else if (card.atk != null)                below.push(`⚔️ ${card.atk}`);

  let html = "";
  if (inline.length) html += inline.join(" • ");
  if (req.length)    html += `<br>${req.join(" ")}`;
  if (below.length)  html += `<br>${below.join(" • ")}`;

  return html ? `<small>${html}</small>` : "";
}

// Single card list item.
function cardItem(card) {
  const qty   = Number(card.qty) || 1;
  const full  = card.img || "../assets/back.jpg";
  const thumb = (typeof full === "string" && full.includes("/images/cards/"))
    ? full.replace("/images/cards/", "/images/cards_small/")
    : full;

  const typesArr    = asArray(card.type);
  const typeDisplay = typesArr.length ? joinSlash(typesArr) : "";

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

// One deck section (collapsible).
function sectionBlock(label, cards, collapsed = false) {
  // NEW: apply the “remaining quantity” projection based on DRAWN
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


//*------------------------- Hand Tester ---------------------------*/
// Expand a section list by qty into a flat array of cards.
function expandSection(list) {
  const out = [];
  (list || []).forEach(card => {
    const n = Math.max(1, Number(card.qty) || 1);
    for (let i=0; i<n; i++) out.push(card);
  });
  return out;
}

/** Fisher–Yates shuffle */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Expand a section's cards into a flat array by quantity (for drawing)
function expandByQty(cards = []) {
  const out = [];
  for (const c of cards) {
    const qty = Number(c.qty) || 1;
    for (let i = 0; i < qty; i++) out.push(c);
  }
  return out;
}

/** Build a new draw state from CURRENT_DECK and options */
function makeDrawState(deck, { includeSide = false, includeExtra = false } = {}) {
  const main = expandSection(deck.sections?.main);
  const side = includeSide ? expandSection(deck.sections?.side) : [];
  const extra = includeExtra ? expandSection(deck.sections?.extra) : [];
  const pool = [...main, ...side, ...extra];          // draw pile source
  return {
    deck: shuffle(pool),  // top of deck is at the end or beginning? we’ll pop()
    hand: [],
  };
}

/** Render the current hand into the tester */
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
          <div class="meta">
            <strong>${c.name}</strong>
          </div>
        </li>
      `;
    }).join("");
  }

  const total = state.deck.length + state.hand.length;
  if (stats) stats.textContent = `Hand: ${state.hand.length} • Deck remaining: ${state.deck.length} • Total pool: ${total}`;
}

/** Draw N cards from state.deck into state.hand */
function drawN(state, n) {
  for (let i=0; i<n; i++) {
    if (!state.deck.length) break;
    state.hand.push(state.deck.pop());
  }
}

/** Hand Tester HTML block */
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

function wireHandTester(root, deck) {
  const panel = root.querySelector("#handTester");
  if (!panel || panel.dataset.wired) return;
  panel.dataset.wired = "1";

  // Elements
  const incSide  = panel.querySelector("#htIncludeSide");
  const incExtra = panel.querySelector("#htIncludeExtra");
  const btn5     = panel.querySelector("#htDraw5");
  const btn6     = panel.querySelector("#htDraw6");
  const btnPlus1 = panel.querySelector("#htPlus1");
  const btnShuf  = panel.querySelector("#htShuffle");
  const btnClear = panel.querySelector("#htClear");
  const btnSave  = panel.querySelector("#htSave");

  // State (hand + draw pile)
  let state = makeDrawState(deck, {
    includeSide:  incSide?.checked || false,
    includeExtra: incExtra?.checked || false,
  });
  renderHandInto(panel, state);

  // ——— UTIL: recompute draw state from toggles ———
  const rebuild = () => {
    state = makeDrawState(deck, {
      includeSide:  incSide?.checked || false,
      includeExtra: incExtra?.checked || false,
    });
    renderHandInto(panel, state);
  };

  // ——— DRAW that also marks DRAWN and updates the deck sections ———
  function drawAndSync(n) {
    for (let i = 0; i < n; i++) {
      if (!state.deck.length) break;
      const c = state.deck.pop();
      state.hand.push(c);
      incDrawn(c, 1);                // mark one copy “used”
    }
    renderHandInto(panel, state);
    refreshSections(root, deck);     // refresh deck grid to hide/reduce
  }

  // Toggles
  incSide ?.addEventListener("change", rebuild);
  incExtra?.addEventListener("change", rebuild);

  // Actions
  btn5   ?.addEventListener("click", () => { clearDrawn(); rebuild(); drawAndSync(5); });
  btn6   ?.addEventListener("click", () => { clearDrawn(); rebuild(); drawAndSync(6); });
  btnPlus1?.addEventListener("click", () => { drawAndSync(1); });

  // Reshuffle = reset hand, rebuild pool, clear DRAWN, refresh deck sections
  btnShuf?.addEventListener("click", () => {
    clearDrawn();
    rebuild();
    refreshSections(root, deck);
  });

  // Clear = keep current pool, just empty hand and unmark drawn
  btnClear?.addEventListener("click", () => {
    clearDrawn();
    state.hand = [];
    renderHandInto(panel, state);
    refreshSections(root, deck);
  });

  // Save Hand → simple .txt of “Name xCount” lines
  btnSave?.addEventListener("click", () => {
    if (!state.hand.length) return;

    // tally by cardKey (id or name); we’ll show by name in file
    const counts = new Map();
    const names  = new Map();
    state.hand.forEach(c => {
      const k = cardKey(c);
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!names.has(k)) names.set(k, c.name);
    });

    const lines = [];
    [...counts.entries()].forEach(([k, n]) => {
      const display = names.get(k) || k;
      lines.push(`${display} x${n}`);
    });

    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth()+1).padStart(2,"0");
    const d = String(now.getDate()).padStart(2,"0");
    const hh = String(now.getHours()).padStart(2,"0");
    const mm = String(now.getMinutes()).padStart(2,"0");

    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `hand-${y}${m}${d}-${hh}${mm}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  });

  // Mobile nicety: tap a card in hand to put it back on top (and unmark 1 copy)
  panel.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const list = Array.from(panel.querySelectorAll("#handList li"));
    const idx  = list.indexOf(li);
    if (idx >= 0) {
      const [card] = state.hand.splice(idx, 1);
      if (card) {
        state.deck.push(card);
        // unmark one copy
        const k = cardKey(card);
        const cur = DRAWN.counts.get(k) || 0;
        if (cur > 0) DRAWN.counts.set(k, cur - 1);
      }
      renderHandInto(panel, state);
      refreshSections(root, deck);
    }
  });
}


// Full deck render (header + sections). Then we wire the UI for this DOM.
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
    </header>

    ${handTesterBlock()}

    ${sectionBlock("Main Deck",  main)}
    ${sectionBlock("Extra Deck", extra)}
    ${sectionBlock("Side Deck",  side)}
  `;

  // IMPORTANT: wire everything for this render, scoped to this root.
  wireUI(root, deck);
  wireHandTester(root, deck);
}

/* ------------------------- Filtering logic ----------------------------- */

// Build a filters object from the *given root* instead of global document.
// This keeps us safe if multiple decks exist on one page.
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
  const fnTag  = norm(q("#functionFilter")?.value || "");

  return { text, kinds, levelMin, levelMax, fnTag };
}

// Does a single card pass the filters?
function cardMatches(card, f) {
  const typeTokens = asArray(card.type).map(t => t.toLowerCase());

  // Kind toggles: if ANY token matches "monster"/"spell"/"trap"
  const isMonster = typeTokens.some(t => t.includes("monster"));
  const isSpell   = typeTokens.some(t => t.includes("spell"));
  const isTrap    = typeTokens.some(t => t.includes("trap"));

  if (isMonster && !f.kinds.Monster) return false;
  if (isSpell   && !f.kinds.Spell)   return false;
  if (isTrap    && !f.kinds.Trap)    return false;

  // Level/rank/link checks
  const lvl = card.level ?? card.rank ?? card.link ?? null;
  if (lvl != null) {
    if (f.levelMin !== null && lvl < f.levelMin) return false;
    if (f.levelMax !== null && lvl > f.levelMax) return false;
  }

  // Function tag dropdown
if (f.fnTag) {
  const tags = getFunctionTags(card); // normalized array
  if (!tags.includes(f.fnTag)) return false;
}

  // Text search across common fields + the type tokens.
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

// Simple debounce for text input.
function debounce(fn, ms = 150) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Read filters from root, filter the deck, re-render sections only.
// Keep the header + hand tester intact.
function refreshSections(root, deck) {
  const base = activeDeck() || deck || CURRENT_DECK;
  const filtered = makeFilteredDeck(base, readFilters(root));

  // capture header + tester before clearing
  const headerEl = root.querySelector(".deck-header");
  const testerEl = root.querySelector("#handTester");

  root.innerHTML = "";
  if (headerEl) root.appendChild(headerEl);
  if (testerEl) root.appendChild(testerEl);  // keep the Hand Tester in place

  root.insertAdjacentHTML("beforeend", `
    ${sectionBlock("Main Deck",  filtered.sections.main)}
    ${sectionBlock("Extra Deck", filtered.sections.extra)}
    ${sectionBlock("Side Deck",  filtered.sections.side)}
  `);

  wireUI(root, base);
  wireHandTester(root, base); // (re)ensure tester events exist after moves
}

/* -------------- Wire *all* interactive UI inside root ------------------ */

function wireUI(root, deck) {
  if (!root) return;

  /* -------- Collapsibles (per section) -------- */
  root.querySelectorAll(".deck-section").forEach(sec => {
    const btn  = sec.querySelector(".deck-toggle");
    const grid = sec.querySelector(".card-grid");
    if (!btn || !grid) return;

    // Start expanded
    sec.classList.remove("is-collapsed");
    grid.style.display = "";

    // Prevent duplicate bindings when re-rendering
    if (!btn.dataset.wired) {
      btn.addEventListener("click", () => {
        const collapsed = sec.classList.toggle("is-collapsed");
        grid.style.display = collapsed ? "none" : "";
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
      btn.dataset.wired = "1";
    }
  });
  
  /* -------- Hand controls (wire once per root) -------- */
  const hc = root.querySelector("#handControls");
  if (hc && !hc.dataset.wired) {
    const sizeEl  = root.querySelector("#handSize");
    const drawBtn = root.querySelector("#btnDraw");
    const reshBtn = root.querySelector("#btnReshuffle");
    const saveBtn = root.querySelector("#btnSaveHand");
    const handList= root.querySelector("#handList");

    function renderHandList() {
      if (!handList) return;
      if (!CURRENT_HAND.length) {
        handList.innerHTML = `<em>No hand drawn.</em>`;
        return;
      }
      handList.innerHTML = `
        <strong>Hand (${CURRENT_HAND.length}):</strong>
        <ul style="margin:.4rem 0 0; padding-left:1rem">
          ${CURRENT_HAND.map(c => `<li>${c.name}</li>`).join("")}
        </ul>
      `;
    }

    drawBtn?.addEventListener("click", () => {
      const n = Math.max(1, Math.min(10, parseInt(sizeEl?.value || "5", 10) || 5));
      const drawn = drawFromWorkingDeck(n);
      refreshSections(root, deck);
      renderHandList();
    });

    reshBtn?.addEventListener("click", () => {
      reshuffleWorkingDeck();
      refreshSections(root, deck);
      renderHandList();
    });

    saveBtn?.addEventListener("click", () => {
      if (!CURRENT_HAND.length) return;
      saveCurrentHand();
      saveBtn.classList.add("saved");
      setTimeout(() => saveBtn.classList.remove("saved"), 600);
    });

    renderHandList();
    hc.dataset.wired = "1";
  }


  /* -------- Header actions (collapse/expand all) -------- */
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

  /* -------- build/refresh the Function dropdown -------- */
const controls = root.querySelector("#deckControls");
if (controls) {
  // create the wrapper <label> + <select> if they don't exist
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

  // fill options based on CURRENT_DECK (or deck)
  const select = fnWrap.querySelector("#functionFilter");
  if (select) {
    const currentValue = select.value || "";
    // clear and rebuild
    select.innerHTML = `<option value="">All</option>`;
    collectFunctionFacet(CURRENT_DECK || deck).forEach(tag => {
      const opt = document.createElement("option");
      opt.value = tag;
      // prettify label (optional): snake_case → Title Case
      opt.textContent = tag.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      select.appendChild(opt);
    });
    // keep previous selection if it still exists
    if ([...select.options].some(o => o.value === currentValue)) {
      select.value = currentValue;
    }
  }
}


  /* -------- Filter bar (scoped to root) -------- */
  const elText  = root.querySelector("#filterText");
  const elMons  = root.querySelector("#kindMonster");
  const elSpell = root.querySelector("#kindSpell");
  const elTrap  = root.querySelector("#kindTrap");
  const elMin   = root.querySelector("#levelMin");
  const elMax   = root.querySelector("#levelMax");
  const elFn    = root.querySelector("#functionFilter");
  const elClear = root.querySelector("#filterClear");

const applyFilters = () => {
  refreshSections(root, deck);
};
  // debounce text + number inputs, but not the rest
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

    // Optionally expand all after clearing
    root.querySelectorAll(".deck-section").forEach(sec => {
      sec.classList.remove("is-collapsed");
      const grid = sec.querySelector(".card-grid");
      const btn  = sec.querySelector(".deck-toggle");
      if (grid) grid.style.display = "";
      if (btn)  btn.setAttribute("aria-expanded", "true");
    });
  });
}

/* ------------------ Crossfade deck loading ---------------------------- */

async function crossfadeLoad(path) {
  const mount = document.getElementById("deck-root");
  if (!mount) return;

  showLoader();
  mount.classList.add("is-switching");      // CSS: fade out current content
  await wait(180);                           // tiny delay for the fade

  try {
    const deck = await loadDeck(path);
    CURRENT_DECK = deck;
    render(deck);                            // render + wire UI
    WORKING_DECK = null;
    CURRENT_HAND = [];
    clearDrawn();                            // clear any DRAWN marks    
  } catch (e) {
    console.error(e);
    mount.innerHTML = `<p style="color:tomato">Couldn't load the deck (${e.message}).</p>`;
  } finally {
    requestAnimationFrame(() => {
      mount.classList.remove("is-switching"); // CSS: fade back in
      hideLoader();
    });
  }
}

/* ------------------- Counts for deckbox labels ------------------------ */

function sectionCounts(deck) {
  const main  = deck.sections?.main  ?? [];
  const extra = deck.sections?.extra ?? [];
  const side  = deck.sections?.side  ?? [];
  return { 
    main: sumQty(main), 
    extra: sumQty(extra), 
    side: sumQty(side) 
  };
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
      // Keep the original name (textContent) and inject counts under it.
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

/* ------------------------ Loader helpers ------------------------------ */

function showLoader() {
  document.getElementById("loading")?.removeAttribute("hidden");
}
function hideLoader() {
  document.getElementById("loading")?.setAttribute("hidden", "");
}

/* ------------------------------ Boot ---------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  // Preload counts for the deckbox labels (optional but nice UX).
  preloadDeckCounts();
  // Initial render of the Life Points counter (persists per deck).
  wireLifePoints(document);

  const root    = document.getElementById("deck-root");
  const buttons = Array.from(document.querySelectorAll(".deckbox, .deck-btn"));
  if (!root || buttons.length === 0) return;

  // Neutral state before a deck is chosen.
  root.innerHTML = `<p class="muted"></p>`;

  // Deck selection / toggling
  buttons.forEach(btn => {
    btn.addEventListener("click", async () => {
      // Clicking the active deckbox again → clear the view to default.
      if (btn.classList.contains("is-active")) {
        btn.classList.remove("is-active");
        root.innerHTML = `<p class="muted"></p>`;
        return;
      }

      const path    = btn.getAttribute("data-deck");
      const deckKey = btn.dataset.deckKey;
      if (!path || !deckKey) return;

      // Switch the <body> theme class for hover/glow per deck, etc.
      document.body.classList.forEach(cls => {
        if (cls.endsWith("-deck")) document.body.classList.remove(cls);
      });
      document.body.classList.add(`${deckKey}-deck`);

      // Visual “active” state for the chosen deckbox.
      buttons.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");

      try {
        await crossfadeLoad(path);       // loads, renders, wires, and crossfades
        btn.classList.remove("is-opening");
        btn.classList.add("is-active");
      } catch {
        btn.classList.remove("is-opening");
      }
    });
  });
});
