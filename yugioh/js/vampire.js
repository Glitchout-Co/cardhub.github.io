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

// Small wait helper for transitions / crossfades.
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Normalize strings for case-insensitive matching.
const norm = (s) => String(s || "").toLowerCase();

// Accepts "Monster/Vampire" OR ["Monster","Vampire"] and returns an array.
const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return String(v).split(" / ").map(s => s.trim()).filter(Boolean);
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

// Build a unique, sorted list of function tags from a deck
function collectFunctionFacet(deck) {
  const set = new Set();
  const allSections = [deck.sections?.main ?? [], deck.sections?.extra ?? [], deck.sections?.side ?? []].flat();
  allSections.forEach(card => {
    getFunctionTags(card).forEach(tag => set.add(tag));
  });
  return Array.from(set).sort(); // e.g. ["boss","control","disruption",...]
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
  if (!cards || !cards.length) return "";
  const count = sumQty(cards);
  const cls   = collapsed ? " is-collapsed" : "";
  const show  = collapsed ? 'style="display:none"' : "";

  return `
    <section class="deck-section${cls}">
      <button class="deck-toggle" type="button" aria-expanded="${collapsed ? "false" : "true"}">
        ${label} <span class="count">(${count})</span>
      </button>
      <div class="deck-content">
        <ul class="card-grid" ${show}>
          ${cards.map(cardItem).join("")}
        </ul>
      </div>
    </section>
  `;
}

// Full deck render (header + sections). Then we wire the UI for this DOM.
function render(deck) {
  const root = document.getElementById("deck-root");
  if (!root) return;

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
      <p class="muted">Author: ${deck.author || "Unknown"} • Total: ${total}</p>
      <div class="deck-controls" id="deckControls">
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

    ${sectionBlock("Main Deck",  main)}
    ${sectionBlock("Extra Deck", extra)}
    ${sectionBlock("Side Deck",  side)}
  `;

  // IMPORTANT: wire everything for this render, scoped to this root.
  wireUI(root, deck);
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
      card.subtype || card.Subtype,
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

  // Re-render only sections (keep header) using current controls in this root.
  const applyFilters = () => {
    const filtered = makeFilteredDeck(CURRENT_DECK || deck, readFilters(root));
    const sectionsHTML = `
      ${sectionBlock("Main Deck",  filtered.sections.main)}
      ${sectionBlock("Extra Deck", filtered.sections.extra)}
      ${sectionBlock("Side Deck",  filtered.sections.side)}
    `;

    const headerEl = root.querySelector(".deck-header");
    root.innerHTML = "";
    if (headerEl) root.appendChild(headerEl);
    root.insertAdjacentHTML("beforeend", sectionsHTML);

    // Re-wire for the new sections. Header won’t double-bind due to data flag.
    wireUI(root, CURRENT_DECK || deck);
  };

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
