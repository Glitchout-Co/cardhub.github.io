let currentDeckPath = null; // which deck is currently shown (or null)

/* ------------------------- Loader on page load ------------------------- */

// Start with loader visible
document.addEventListener("DOMContentLoaded", () => showLoader?.());

// Safety: hide after page assets finish loading (user might not choose a deck)
window.addEventListener("load", () => {
  // If a deck is NOT currently being loaded, hide it.
  // (Your deck load functions below will show/hide during fetch.)
  hideLoader?.();
});

/* ------------------------- Data + Helpers ------------------------- */

// Tiny wait helper for transitions
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Crossfade transition for deck loading
 */
async function crossfadeLoad(path) {
  const mount = document.getElementById("deck-root");
  if (!mount) return;

  // Show loader and start fade-out
  showLoader?.();
  mount.classList.add("is-switching");
  await wait(180);

  try {
    const deck = await loadDeck(path);
    render(deck);
  } catch (e) {
    console.error(e);
    mount.innerHTML = `<p style="color:tomato">Couldn't load the deck (${e.message}).</p>`;
  } finally {
    requestAnimationFrame(() => {
      mount.classList.remove("is-switching");
      hideLoader?.(); // Hide once new deck is rendered
    });
  }
}

function wireCollapsibles(root) {
  const sections = root.querySelectorAll(".deck-section");

  // Per-section toggle
  sections.forEach(sec => {
    const toggle = sec.querySelector(".deck-toggle");
    const grid   = sec.querySelector(".card-grid");
    if (!toggle || !grid) return;

    toggle.addEventListener("click", () => {
      const collapsed = sec.classList.toggle("is-collapsed");
      grid.hidden = collapsed;
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  });

  // Expand all
  root.querySelector("#expandAll")?.addEventListener("click", () => {
    sections.forEach(sec => {
      const toggle = sec.querySelector(".deck-toggle");
      const grid   = sec.querySelector(".card-grid");
      if (!toggle || !grid) return;
      sec.classList.remove("is-collapsed");
      grid.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    });
  });

  // Collapse all
  root.querySelector("#collapseAll")?.addEventListener("click", () => {
    sections.forEach(sec => {
      const toggle = sec.querySelector(".deck-toggle");
      const grid   = sec.querySelector(".card-grid");
      if (!toggle || !grid) return;
      sec.classList.add("is-collapsed");
      grid.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

/**
 * Set active state on deckbox buttons
 */
function setActiveDeckbox(buttons, activeBtn) {
  buttons.forEach(btn => {
    const isActive = (btn === activeBtn);
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

/**
 * Get counts of cards in each section
 */
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

/**
 * Preload deck counts for buttons with data-deck-count attribute
 */
async function preloadDeckCounts() {
  const boxes = document.querySelectorAll(".deckbox");
  for (const box of boxes) {
    const path = box.getAttribute("data-deck");
    if (!path) continue;

    try {
      const deck = await loadDeck(path);
      const counts = sectionCounts(deck);

      const label = box.querySelector(".deck-label");
      if (label) {
        const deckKey = box.dataset.deckKey || ""; // you can add a data-deck-key attr in HTML

        // Update label with counts
        label.innerHTML = `
          <span class="deck-name ${deckKey}">${label.textContent}</span>
          <span class="deck-counts">
            <span class="main-count">${counts.main}</span>
            <span class="extra-count">${counts.extra}</span>
            <span class="side-count">${counts.side}</span>
          </span>
        `;
      }
    } catch (e) {
      console.warn(`Couldn’t preload ${path}`, e);
    }
  }
}

/**
 * Fetch and parse deck JSON
 */
async function loadDeck(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load: ${path} (${res.status})`);
  return await res.json();
}

/**
 * Sum up quantities in a list of cards
 */
function sumQty(list) {
  return list.reduce((n, c) => n + (Number(c.qty) || 1), 0);
}

/**
 * Generate small info line (Level, Type, Attribute, Requirements, ATK/DEF etc.)
 */
function smallInfo(card) {
  const inline = [];
  const req = [];
  const below = [];

  // Level/Rank/Link (only one will be present)
  if (card.level != null)      inline.push(`⭐ ${card.level}`);
  else if (card.rank != null)  inline.push(`⤴️ ${card.rank}`);
  else if (card.link != null)  inline.push(`🔗 ${card.link}`);

  // Type and Subtype
  const subtype = card.subtype;
  if (subtype) inline.push(String(subtype).toUpperCase());

  // Attribute
  if (card.attribute) inline.push(card.attribute.toUpperCase());

  // Requirements (for extra deck monsters)
  if (card.requirements) req.push(`<em>"${card.requirements}"</em>`);

  // ATK/DEF (only for monsters)
  if (card.atk != null && card.def != null) 
    below.push(`⚔️ ${card.atk} / 🛡️ ${card.def}`);

  else if (card.atk != null)                
    below.push(`⚔️ ${card.atk}`);

  let html = "";
  if (inline.length) html += inline.join(" • ");
  if (req.length)    html += `<br>${req.join(" ")}`;
  if (below.length)  html += `<br>${below.join(" • ")}`;

  return html ? `<small>${html}</small>` : "";
}

/**
 * Generate HTML for a single card item
 */
function cardItem(card) {
  const qty  = Number(card.qty) || 1;
  const full = card.img || "../assets/back.jpg";

  const thumb = (typeof full === "string" && full.includes("/images/cards/"))
    ? full.replace("/images/cards/", "/images/cards_small/")
    : full;

  const type  = card.type || "";
  const title = `${card.name} ×${qty}`;

  return `
    <li class="card-tile" title="${title}">
      <div class="thumb">
        <img class="card-img" src="${thumb}" data-fullsrc="${full}" alt="${card.name}" loading="lazy">
        <span class="qty">×${qty}</span>
      </div>
      <div class="meta">
        <strong>${card.name}</strong>
        <div>${type}</div>
        ${smallInfo(card)}
      </div>
    </li>
  `;
}

/* ------------ SECTION BLOCK (CHANGED for collapsible) ------------ */
function sectionBlock(label, cards, collapsed = false) {
  if (!cards || !cards.length) return "";
  const count = sumQty(cards);
  const collapsedClass = collapsed ? " is-collapsed" : "";
  const hiddenAttr = collapsed ? " hidden" : "";
  const ariaExpanded = collapsed ? "false" : "true";

  return `
    <section class="deck-section is-collapsed">
      <button class="deck-toggle">${label} <span class="count">(${sumQty(cards)})</span></button>
      <div class="deck-content">
        <ul class="card-grid">
          ${cards.map(cardItem).join("")}
        </ul>
      </div>
    </section>
  `;
}

/* ----------------------- RENDERING LOGIC ----------------------- */
function render(deck) {
  const el = document.getElementById("deck-root");
  if (!el) return;
  
  const main  = deck.sections?.main  ?? [];
  const extra = deck.sections?.extra ?? [];
  const side  = deck.sections?.side  ?? [];
  const total = sumQty(main) + sumQty(extra) + sumQty(side);

  el.innerHTML = `
    <header class="deck-header">
      <h1>${deck.name || "Deck"} <small class="muted">(${total})</h1>
      <p class="muted">Author: ${deck.author || "Unknown"}</p>
      <div class="deck-header-actions">
        <button class="btn btn-sm" id="expandAll">Expand All</button>
        <button class="btn btn-sm" id="collapseAll">Collapse All</button>
      </div>
    </header>
    ${sectionBlock("Main Deck", main)}
    ${sectionBlock("Extra Deck", extra)}
    ${sectionBlock("Side Deck", side)}
  `;

  wireCollapsibles(el); // Wire up collapsibles after deck renders
}

//----------------- Collapsible sections logic -----------------
function enableCollapsibles() {
  document.querySelectorAll(".deck-section .deck-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.parentElement.classList.toggle("is-collapsed");
    });
  });
}

/* ----------------- Loader helpers (if you added overlay) ----------------- */
function showLoader() {
  document.getElementById("loading")?.removeAttribute("hidden");
}
function hideLoader() {
  document.getElementById("loading")?.setAttribute("hidden", "");
}

/**
 * Load and render a deck, ensuring loader shows for at least 1s
 */
async function loadAndRender(path) {
  const mount = document.getElementById("deck-root");

  // Show loader at start
  showLoader && showLoader();
  if (mount) mount.innerHTML = `<p class="muted">Loading deck…</p>`;

  const start = Date.now(); // Record start time
  try {
    const deck = await loadDeck(path);
    render(deck);

    // Ensure loader shows for at least 1 second
    const elapsed = Date.now() - start;
    const minDelay = 1000; // ms
    if (elapsed < minDelay) {
      await new Promise(r => setTimeout(r, minDelay - elapsed));
    }
  } catch (e) {
    console.error(e);
    if (mount) mount.innerHTML = `<p style="color:tomato">Couldn't load the deck (${e.message}).</p>`;
  } finally {
    hideLoader && hideLoader();
  }
}

/* ------------------------------ Boot logic ------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  preloadDeckCounts();

  const mount   = document.getElementById("deck-root");
  const buttons = Array.from(document.querySelectorAll(".deckbox, .deck-btn"));
  if (!mount || buttons.length === 0) return;

  // Set initial state
  mount.innerHTML = `<p class="muted"></p>`;

  // Deckbox click logic
  buttons.forEach(btn => {
    btn.addEventListener("click", async () => {
      // Toggle active state
      if (btn.classList.contains("is-active")) {
        btn.classList.remove("is-active");
        document.getElementById("deck-root").innerHTML = `<p class="muted"></p>`;
        return;
      }

      const path = btn.getAttribute("data-deck");
      const deckKey = btn.dataset.deckKey;
      if (!path || !deckKey) return;

      // Remove any old deck-* classes from <body>
      document.body.classList.forEach(cls => {
      if (cls.endsWith("-deck")) document.body.classList.remove(cls);
    });

      // Add the active deck class to <body>
      document.body.classList.add(`${deckKey}-deck`);
      
      // Smooth swap
      await crossfadeLoad(path);
      
      buttons.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
  });

  /* --------------------------- Lightbox logic --------------------------- */
  const lightbox = document.getElementById("lightbox");
  const imgEl    = lightbox?.querySelector(".lightbox-img");
  const btnPrev  = lightbox?.querySelector(".prev");
  const btnNext  = lightbox?.querySelector(".next");
  const btnClose = lightbox?.querySelector(".close");

  if (imgEl) imgEl.addEventListener("load", () => imgEl.classList.add("loaded"));

  let gallery = [];
  let current = -1;

  // Collect all card images in the current gallery
  function collectGallery() {
    gallery = Array.from(document.querySelectorAll(".card-grid .card-img"));
  }

  // Open lightbox at specific index
  function openAt(index) {
    if (!gallery.length) collectGallery();
    if (index < 0 || index >= gallery.length || !lightbox || !imgEl) return;
    current = index;
    const el = gallery[current];
    const fullSrc = el.getAttribute("data-fullsrc") || el.src;
    imgEl.classList.remove("loaded");
    imgEl.src = fullSrc;
    imgEl.alt = el.alt || "Card preview";
    lightbox.style.display = "flex";
  }

  // Show next/prev image in gallery
  function showNext(delta) {
    if (!gallery.length || current < 0 || !imgEl) return;
    current = (current + delta + gallery.length) % gallery.length;
    const el = gallery[current];
    const fullSrc = el.getAttribute("data-fullsrc") || el.src;
    imgEl.classList.remove("loaded");
    imgEl.src = fullSrc;
    imgEl.alt = el.alt || "Card preview";
  }

  // Close the lightbox
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.style.display = "none";
    current = -1;
  }

  // Open lightbox when clicking a card image
  document.body.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.classList.contains("card-img")) {
      collectGallery();
      openAt(gallery.indexOf(t));
    }
  });

  // Wire up buttons and keyboard navigation
  btnPrev?.addEventListener("click", () => showNext(-1));
  btnNext?.addEventListener("click", () => showNext(1));
  btnClose?.addEventListener("click", closeLightbox);
  lightbox?.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (!lightbox || lightbox.style.display !== "flex") return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); showNext(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); showNext(1); }
    if (e.key === "Escape")     { e.preventDefault(); closeLightbox(); }
  });
});
