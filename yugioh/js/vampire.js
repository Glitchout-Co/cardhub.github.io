/* ------------------------- data + helpers ------------------------- */
async function loadDeck(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load: ${path} (${res.status})`);
  return await res.json();
}

function sumQty(list) {
  return list.reduce((n, c) => n + (Number(c.qty) || 1), 0);
}

function smallInfo(card) {
  const inline = []; // top row (level, attribute, subtype)
  const below = [];  // bottom row (atk/def)

  // Level / Rank / Link (first one present)
  if (card.level != null)      inline.push(`⭐ ${card.level}`);
  else if (card.rank != null)  inline.push(`⤴️ ${card.rank}`);
  else if (card.link != null)  inline.push(`🔗 ${card.link}`);

  // Subtype
  const subtype = card.subtype || card.Subtype;
  if (subtype) inline.push(String(subtype).toUpperCase());

  // Attribute
  if (card.attribute) inline.push(card.attribute.toUpperCase());

  // ATK / DEF
  if (card.atk != null && card.def != null) below.push(`⚔️ ${card.atk} / 🛡️ ${card.def}`);
  else if (card.atk != null)                below.push(`⚔️ ${card.atk}`);

  // Build return
  let html = "";
  if (inline.length) html += inline.join(" • ");
  if (below.length)  html += `<br>${below.join(" • ")}`;

  return html ? `<small>${html}</small>` : "";
}

function cardItem(card) {
  const qty  = Number(card.qty) || 1;
  const full = card.img || "../assets/back.jpg";

  // grid thumb if from ygoprodeck
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

function render(deck) {
  const el = document.getElementById("deck-root");
  if (!el) return;

  const main  = deck.sections?.main  ?? [];
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

/* optional global loader helpers (if you added the overlay) */
function showLoader(){ document.getElementById("loading")?.removeAttribute("hidden"); }
function hideLoader(){ document.getElementById("loading")?.setAttribute("hidden",""); }

async function loadAndRender(path) {
  showLoader && showLoader();                  // safe if not defined
  const mount = document.getElementById("deck-root");
  if (mount) mount.innerHTML = `<p class="muted">Loading deck…</p>`;
  try {
    const deck = await loadDeck(path);
    render(deck);
  } catch (e) {
    console.error(e);
    if (mount) mount.innerHTML = `<p style="color:tomato">Couldn't load the deck (${e.message}).</p>`;
  } finally {
    hideLoader && hideLoader();
  }
}

/* ------------------------------ boot ------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  /* deck switcher */
  const sel   = document.getElementById("deckSelect");
  const mount = document.getElementById("deck-root");
  if (!sel || !mount) { console.error("Missing deckSelect or deck-root"); return; }

  loadAndRender(sel.value);                    // initial load
  sel.addEventListener("change", () => loadAndRender(sel.value));

  /* lightbox */
  const lightbox = document.getElementById("lightbox");
  const imgEl    = lightbox?.querySelector(".lightbox-img");
  const btnPrev  = lightbox?.querySelector(".prev");
  const btnNext  = lightbox?.querySelector(".next");
  const btnClose = lightbox?.querySelector(".close");

  if (imgEl) imgEl.addEventListener("load", () => imgEl.classList.add("loaded"));

  let gallery = [];
  let current = -1;

  function collectGallery(){
    gallery = Array.from(document.querySelectorAll(".card-grid .card-img"));
  }
  function openAt(index){
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
  function showNext(delta){
    if (!gallery.length || current < 0 || !imgEl) return;
    current = (current + delta + gallery.length) % gallery.length;
    const el = gallery[current];
    const fullSrc = el.getAttribute("data-fullsrc") || el.src;
    imgEl.classList.remove("loaded");
    imgEl.src = fullSrc;
    imgEl.alt = el.alt || "Card preview";
  }
  function closeLightbox(){
    if (!lightbox) return;
    lightbox.style.display = "none";
    current = -1;
  }

  // open from grid (event delegation)
  document.body.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.classList.contains("card-img")) {
      collectGallery();
      openAt(gallery.indexOf(t));
    }
  });

  // controls
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
