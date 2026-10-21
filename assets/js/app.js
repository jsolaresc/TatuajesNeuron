(() => {
  const C = window.NEURON || {};
  const IG_URL = `https://www.instagram.com/${C.instagram || "tatuajesneuron"}/`;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Enlaces de WhatsApp y mapa desde config ---------- */
  const waHref = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(C.whatsappMessage || "")}`;
  $$(".js-wa").forEach(a => (a.href = waHref));
  if (C.mapsLink) $$(".js-maps").forEach(a => (a.href = C.mapsLink));
  if (C.mapsLat && C.mapsLng) {
    $$(".js-map").forEach(f => (f.src = `https://www.google.com/maps?q=${C.mapsLat},${C.mapsLng}&z=16&output=embed`));
  }

  /* ---------- Header sólido al scrollear ---------- */
  const top = $(".top");
  const onScroll = () => top.classList.toggle("is-solid", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Datos ---------- */
  const FALLBACK = Array.from({ length: 17 }, (_, i) => ({
    id: `local-${i + 1}`,
    type: "IMAGE",
    src: `assets/img/trabajos/t${String(i + 1).padStart(2, "0")}.webp`,
    permalink: IG_URL,
    caption: ""
  }));

  let posts = [];
  let stories = [];

  fetch("data/instagram.json", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(data => {
      posts = (data.posts || []).filter(p => p.src);
      const now = Date.now();
      stories = (data.stories || []).filter(s => s.src && now - Date.parse(s.timestamp) < 24 * 3600e3);
      if (data.updated) {
        $("#updated").textContent = `Galería actualizada desde Instagram el ${new Date(data.updated).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" })}.`;
      }
    })
    .catch(() => {})
    .finally(() => {
      if (!posts.length) posts = FALLBACK;
      renderGrid();
      // La foto de fondo de la portada es la última publicación con imagen
      const lead = posts.find(p => p.type !== "VIDEO" || p.poster);
      if (lead && !String(lead.id).startsWith("local-")) $("#hero-img").src = lead.type === "VIDEO" ? lead.poster : lead.src;
      if (stories.length) $$("[data-open-stories]").forEach(b => (b.hidden = false));
    });

  /* ---------- Grilla ---------- */
  function renderGrid() {
    const grid = $("#grid");
    grid.innerHTML = "";
    posts.forEach((p, i) => {
      const b = document.createElement("button");
      b.className = "tile";
      b.type = "button";
      const label = (p.caption || "").split("\n")[0].slice(0, 90);
      b.setAttribute("aria-label", label ? `Ver publicación: ${label}` : "Ver publicación");
      const img = new Image();
      img.loading = i < 6 ? "eager" : "lazy";
      img.decoding = "async";
      img.alt = "";
      img.src = p.type === "VIDEO" ? p.poster || p.src : p.src;
      b.append(img);
      const icon = p.type === "VIDEO" ? "i-play" : p.type === "CAROUSEL_ALBUM" ? "i-stack" : null;
      if (icon) b.insertAdjacentHTML("beforeend", `<svg class="tile__badge" aria-hidden="true"><use href="#${icon}"/></svg>`);
      b.addEventListener("click", () => openPost(i));
      grid.append(b);
    });
  }

  /* ---------- Lightbox ---------- */
  const lb = $("#lightbox");
  let cur = 0, slide = 0;

  function mediaEl(m, { autoplay = false } = {}) {
    if (m.type === "VIDEO") {
      const v = document.createElement("video");
      v.src = m.src;
      if (m.poster) v.poster = m.poster;
      v.controls = true; v.playsInline = true; v.loop = true;
      if (autoplay) { v.autoplay = true; v.muted = true; }
      return v;
    }
    const img = new Image();
    img.src = m.src; img.alt = "";
    return img;
  }

  function slidesOf(p) {
    return p.type === "CAROUSEL_ALBUM" && p.children?.length ? p.children : [p];
  }

  function drawPost() {
    const p = posts[cur];
    const list = slidesOf(p);
    const box = $("#lb-media");
    box.innerHTML = "";
    box.append(mediaEl(list[slide], { autoplay: true }));
    if (list.length > 1) {
      const dots = document.createElement("div");
      dots.className = "lightbox__dots";
      list.forEach((_, k) => {
        const d = document.createElement("button");
        d.type = "button";
        d.setAttribute("aria-label", `Foto ${k + 1} de ${list.length}`);
        if (k === slide) d.setAttribute("aria-current", "true");
        d.onclick = () => { slide = k; drawPost(); };
        dots.append(d);
      });
      box.append(dots);
    }
    $("#lb-caption").textContent = p.caption || "";
    $("#lb-link").href = p.permalink || IG_URL;
  }

  function openPost(i) { cur = i; slide = 0; drawPost(); lb.showModal(); }
  function step(dir) {
    const list = slidesOf(posts[cur]);
    if (list.length > 1 && slide + dir >= 0 && slide + dir < list.length) slide += dir;
    else { cur = (cur + dir + posts.length) % posts.length; slide = dir < 0 ? slidesOf(posts[cur]).length - 1 : 0; }
    drawPost();
  }

  lb.addEventListener("click", e => {
    const act = e.target.closest("[data-lb]")?.dataset.lb;
    if (act === "close" || e.target === lb) lb.close();
    if (act === "prev") step(-1);
    if (act === "next") step(1);
  });
  lb.addEventListener("close", () => ($("#lb-media").innerHTML = ""));
  lb.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
  swipe(lb, d => step(d));

  /* ---------- Historias ---------- */
  const st = $("#stories");
  let si = 0, timer = null, started = 0, duration = 5000, raf = 0;

  function ago(ts) {
    const h = Math.floor((Date.now() - Date.parse(ts)) / 3600e3);
    if (h < 1) return "hace un rato";
    return `hace ${h} h`;
  }

  function drawStory() {
    clearTimeout(timer); cancelAnimationFrame(raf);
    const s = stories[si];
    const bars = $("#st-bars");
    bars.innerHTML = stories.map((_, k) => `<span><i style="width:${k < si ? 100 : 0}%"></i></span>`).join("");
    $("#st-time").textContent = ago(s.timestamp);
    const box = $("#st-media");
    box.innerHTML = "";
    const el = mediaEl(s);
    box.append(el);
    const bar = bars.children[si].firstElementChild;
    const run = ms => {
      duration = ms; started = performance.now();
      const tick = t => {
        bar.style.width = Math.min(100, ((t - started) / duration) * 100) + "%";
        if (t - started < duration) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      timer = setTimeout(() => nextStory(1), duration);
    };
    if (el.tagName === "VIDEO") {
      el.controls = false; el.loop = false; el.muted = false; el.autoplay = true;
      el.addEventListener("loadedmetadata", () => run((el.duration || 15) * 1000), { once: true });
      el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    } else run(5000);
  }

  function nextStory(d) {
    const n = si + d;
    if (n < 0) { si = 0; drawStory(); return; }
    if (n >= stories.length) { st.close(); return; }
    si = n; drawStory();
  }

  $$("[data-open-stories]").forEach(b => b.addEventListener("click", () => { si = 0; st.showModal(); drawStory(); }));
  st.addEventListener("click", e => {
    const act = e.target.closest("[data-st]")?.dataset.st;
    if (act === "close" || e.target === st) st.close();
    if (act === "prev") nextStory(-1);
    if (act === "next") nextStory(1);
  });
  st.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") nextStory(-1);
    if (e.key === "ArrowRight") nextStory(1);
  });
  st.addEventListener("close", () => { clearTimeout(timer); cancelAnimationFrame(raf); $("#st-media").innerHTML = ""; });

  /* ---------- Swipe táctil ---------- */
  function swipe(el, cb) {
    let x0 = null;
    el.addEventListener("touchstart", e => (x0 = e.touches[0].clientX), { passive: true });
    el.addEventListener("touchend", e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) cb(dx < 0 ? 1 : -1);
      x0 = null;
    });
  }

  if (reduceMotion) document.documentElement.classList.add("reduce-motion");
})();
