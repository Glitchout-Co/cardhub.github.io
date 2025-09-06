// Theme toggle and year update
(function () {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const themeToggle = document.getElementById('themeToggle');
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) root.setAttribute('data-theme', savedTheme);

  themeToggle?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || 'system';
    const next = current === 'light' ? 'system' : current === 'system' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
})();

// Loader logic
let loaderTimer;

function showLoaderDelayed(delay = 120) {
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => showLoader?.(), delay);
}

function hideLoaderClear() {
  clearTimeout(loaderTimer);
  hideLoader?.();
}

function showLoader() {
  const el = document.getElementById("loading");
  if (el) {
    el.removeAttribute("hidden");
    el.setAttribute("aria-busy", "true");
  }
}

function hideLoader() {
  const el = document.getElementById("loading");
  if (el) {
    el.setAttribute("hidden", "");
    el.setAttribute("aria-busy", "false");
  }
}

// DOMContentLoaded: update year and hide loader
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const loading = document.getElementById('loading');
  if (loading) loading.setAttribute('hidden', '');
});

// Lightbox logic
(function () {
  function setupLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox || lightbox.dataset.wired) return;

    const imgEl = lightbox.querySelector(".lightbox-img");
    const btnPrev = lightbox.querySelector(".prev");
    const btnNext = lightbox.querySelector(".next");
    const btnClose = lightbox.querySelector(".close");

    let gallery = [];
    let current = -1;

    const collectGallery = () => {
      gallery = Array.from(document.querySelectorAll(".card-grid .card-img"));
    };

    function openAt(index) {
      if (!gallery.length) collectGallery();
      if (index < 0 || index >= gallery.length || !imgEl) return;
      current = index;
      const el = gallery[current];
      const fullSrc = el.getAttribute("data-fullsrc") || el.src;
      imgEl.classList.remove("loaded");
      imgEl.src = fullSrc;
      imgEl.alt = el.alt || "Card preview";
      lightbox.style.display = "flex";
    }

    function showNext(delta) {
      if (!gallery.length || current < 0 || !imgEl) return;
      current = (current + delta + gallery.length) % gallery.length;
      const el = gallery[current];
      const fullSrc = el.getAttribute("data-fullsrc") || el.src;
      imgEl.classList.remove("loaded");
      imgEl.src = fullSrc;
      imgEl.alt = el.alt || "Card preview";
    }

    function closeLightbox() {
      lightbox.style.display = "none";
      current = -1;
    }

    imgEl?.addEventListener("load", () => imgEl.classList.add("loaded"));

    // Open from any card image (delegated)
    function onBodyClick(e) {
      const t = e.target;
      if (t instanceof Element && t.classList.contains("card-img")) {
        collectGallery();
        openAt(gallery.indexOf(t));
      }
    }
    document.body.addEventListener("click", onBodyClick);

    // Controls
    btnPrev?.addEventListener("click", () => showNext(-1));
    btnNext?.addEventListener("click", () => showNext(1));
    btnClose?.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (lightbox.style.display !== "flex") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); showNext(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); showNext(1); }
      if (e.key === "Escape") { e.preventDefault(); closeLightbox(); }
    });

    lightbox.dataset.wired = "1";
  }

  document.addEventListener("DOMContentLoaded", setupLightbox);
})();
