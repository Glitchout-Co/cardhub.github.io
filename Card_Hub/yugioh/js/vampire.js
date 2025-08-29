/* Loading JSON Deck File */ 
async function loadDeck(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load: ${path} (${res.status})`);
  return await res.json();
}

/* Getting deck quantities */
function sumQty(list) {
  return list.reduce((n, c) => n + (Number(c.qty) || 1), 0);
}

/* Getting card info for display */
function smallInfo(card) {
  const bits = [];

  /* check property level/rank/link */
  if (card.level != null) {
    bits.push(`⭐ ${card.level}`);
  } else if (Card.rank != null) {
    bits.push(`⤴️ ${card.rank}`);
  } else if (card.link != null) {
    bits.push(`♾️ ${card.link}`)
  }

  /* Show Subtype */
  if (card.subtype) bits.push(card.subtype.toUpperCase());

  /* Show Attribute */
  if (card.attribute) bits.push(card.attribute.toUpperCase());

  /* Show atk/def value */
  if (card.atk != null && card.def != null) bits.push(`⚔️ ${card.atk} / 🛡️ ${card.def}`);
  
  return bits.length ? `<small>${bits.join("  •  ")}</small>` : "";
}

/* Render single card */
function cardItem(card) {
  const qty = Number(card.qty) || 1;
  const full = card.img || "../assets/back.jpg";

  // Derive small thumbnail if it's a YGOPRODECK URL; otherwise fall back to full
  const thumb = (typeof full === "string" && full.includes("/images/cards/"))
    ? full.replace("/images/cards/", "/images/cards_small/")
    : full;

  const type = card.type || "";
  const title = `${card.name} ×${qty}`;

  return `
    <li class="card-tile" title="${title}">
      <div class="thumb">
        <img
          class="card-img"
          src="${thumb}"
          data-fullsrc="${full}"
          alt="${card.name}"
          loading="lazy"
        >
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


/* Render a section */
function sectionBlock(label, cards) {
  if (!cards || !cards.length) return "";
  return `
    <section class="deck-section">
      <h2>${label} <span class="count">(${sumQty(cards)})</span></h2>
      <ul class="card-grid">
        ${cards.map(cardItem).join("")}
      </ul>
    </section>
  `;
}

/* Render whole deck */
function render(deck) {
  const el = document.getElementById("deck-root");
  if (!el) return;

  const main = deck.sections?.main ?? [];
  const extra = deck.sections?.extra ?? [];
  const side  = deck.sections?.side  ?? [];

  el.innerHTML = `
    <header class="deck-header">
      <h1>${deck.name || "Deck"}</h1>
      <p class="muted">Author: ${deck.author || "Unknown"}</p>
    </header>
    ${sectionBlock("Main Deck", main)}
    ${sectionBlock("Extra Deck", extra)}
    ${sectionBlock("Side Deck", side)}
  `;
}

/* Loader helper */
async function loadAndRender(path) {
  const mount = document.getElementById("deck-root");
  if (mount) mount.innerHTML = `<p class="muted">Loading deck…</p>`;
  const deck = await loadDeck(path);
  render(deck);
}

/* ONE DOMContentLoaded to wire everything */
document.addEventListener("DOMContentLoaded", () => {
  // Deck switcher
  const sel = document.getElementById("deckSelect");
  if (sel) {
    loadAndRender(sel.value);
    sel.addEventListener("change", () => loadAndRender(sel.value));
  }

  // Lightbox wiring
const lightbox = document.getElementById("lightbox");
const imgEl    = lightbox?.querySelector(".lightbox-img");

if (imgEl) {
  imgEl.addEventListener("load", () => {
    imgEl.classList.add("loaded");   // add class when big image finishes loading
  });
}

const btnPrev  = lightbox?.querySelector(".prev");
const btnNext  = lightbox?.querySelector(".next");
const btnClose = lightbox?.querySelector(".close");


  let gallery = [];
  let current = -1;

  function collectGallery() {
    gallery = Array.from(document.querySelectorAll(".card-grid .card-img"));
  }

  function openAt(index) {
    if (!gallery.length) collectGallery();
    if (index < 0 || index >= gallery.length || !lightbox || !imgEl) return;
    current = index;
    imgEl.src = gallery[current].src;
    imgEl.alt = gallery[current].alt || "Card preview";
    lightbox.style.display = "flex";
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.style.display = "none";
    current = -1;
  }

  function showNext(delta) {
    if (!gallery.length || current < 0 || !imgEl) return;
    current = (current + delta + gallery.length) % gallery.length;
    imgEl.src = gallery[current].src;
    imgEl.alt = gallery[current].alt || "Card preview";
  }

// Open on image click (event delegation)
document.body.addEventListener("click", (e) => {
  const t = e.target;
  if (t instanceof Element && t.classList.contains("card-img")) {
    collectGallery();
    const idx = gallery.indexOf(t);
    openAt(idx);
  }
});

function openAt(index) {
  if (!gallery.length) collectGallery();
  if (index < 0 || index >= gallery.length || !lightbox || !imgEl) return;
  current = index;

  const el = gallery[current];
  const fullSrc = el.getAttribute("data-fullsrc") || el.src; // prefer full
  imgEl.src = fullSrc;
  imgEl.alt = el.alt || "Card preview";
  lightbox.style.display = "flex";
}

function showNext(delta) {
  if (!gallery.length || current < 0 || !imgEl) return;
  current = (current + delta + gallery.length) % gallery.length;

  const el = gallery[current];
  const fullSrc = el.getAttribute("data-fullsrc") || el.src;
  imgEl.src = fullSrc;
  imgEl.alt = el.alt || "Card preview";
}
});
