/**
 * PhotoMemory · 应用主逻辑
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    photos: [],
    filter: "all",
    viewer: {
      open: false,
      index: 0,
      imgA: true,
      switching: false,
      objectUrls: [],
    },
    pendingFiles: [],
    pendingPreviewUrl: null,
  };

  let heroAmbient = null;
  let viewerFx = null;
  let viewWipe = null;
  let toastTimer = 0;
  let navLocked = false;
  const homeCarousel = {
    photos: [],
    index: 0,
    timer: 0,
    paused: false,
    running: false,
  };

  /* ── 工具 ── */
  function formatDate(iso) {
    if (!iso) return "";
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split("-");
      return `${y}年${Number(m)}月${Number(d)}日`;
    }
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return s;
    return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
  }

  function formatBytes(n) {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + " " + units[i];
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function measureImage(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  /* ── 导航 ── */
  function applyView(name) {
    $$(".view").forEach((v) => {
      const active = v.dataset.view === name;
      v.classList.toggle("is-active", active);
      v.hidden = !active;
    });
    $$(".nav-link").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === name);
    });
    if (name === "about") refreshStorageMeter();
    if (name === "home") {
      if (heroAmbient) heroAmbient.start();
      startHomeCarousel();
    } else {
      if (heroAmbient) heroAmbient.stop();
      stopHomeCarousel();
    }
    if (location.hash.startsWith("#share/")) {
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      history.replaceState(null, "", "#" + name);
    }
  }

  function setView(name, opts = {}) {
    const current = $$(".view").find((v) => v.classList.contains("is-active"));
    const currentName = current ? current.dataset.view : null;
    if (name === currentName && !opts.force) return;

    const useFx = opts.transition && viewWipe && !navLocked;
    if (!useFx) {
      applyView(name);
      return;
    }

    navLocked = true;
    const origin = opts.origin || null;
    viewWipe
      .play(() => applyView(name), { origin, duration: 880 })
      .then(() => {
        navLocked = false;
      })
      .catch(() => {
        navLocked = false;
        applyView(name);
      });
  }

  function bindNav() {
    $$("[data-nav]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const name = el.dataset.nav;
        if (!name) return;
        const wantFx = el.dataset.transition === "1" || name === "gallery" || name === "upload";
        const rect = el.getBoundingClientRect();
        const origin = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        setView(name, { transition: wantFx, origin });
      });
    });
    // 开始翻阅按钮（若仍存在）
    const browse = $("#btnBrowse");
    if (browse) {
      browse.addEventListener("click", () => {
        const rect = browse.getBoundingClientRect();
        setView("gallery", {
          transition: true,
          origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        });
      });
    }
  }

  function updateHeroStatus() {
    const el = $("#heroStatus");
    if (!el) return;
    const n = state.photos.length;
    el.textContent = n > 0 ? `影集 · ${n} 帧` : "影集空 · 待入藏";
  }

  /* ── 首页轮播 ── */
  function buildCarouselDom() {
    const stack = $("#carouselStack");
    const dots = $("#carouselDots");
    stack.innerHTML = "";
    dots.innerHTML = "";
    homeCarousel.photos.forEach((photo, i) => {
      const slide = document.createElement("div");
      slide.className = "carousel-slide" + (i === homeCarousel.index ? " is-active" : "");
      slide.dataset.index = String(i);
      const img = document.createElement("img");
      img.alt = photo.title;
      img.src = PhotoStore.urlFor(photo);
      img.draggable = false;
      slide.appendChild(img);
      stack.appendChild(slide);

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "carousel-dot" + (i === homeCarousel.index ? " is-active" : "");
      dot.setAttribute("aria-label", `第 ${i + 1} 帧：${photo.title}`);
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        showCarouselIndex(i, true);
      });
      dots.appendChild(dot);
    });
  }

  function updateCarouselMeta() {
    const photo = homeCarousel.photos[homeCarousel.index];
    if (!photo) return;
    const total = homeCarousel.photos.length;
    $("#carouselIndex").textContent =
      String(homeCarousel.index + 1).padStart(2, "0") +
      " / " +
      String(total).padStart(2, "0");
    $("#carouselTitle").textContent = photo.title;
    const bits = [formatDate(photo.takenAt), photo.place].filter(Boolean);
    $("#carouselMeta").textContent = bits.join(" · ");
  }

  function showCarouselIndex(index, manual) {
    const total = homeCarousel.photos.length;
    if (!total) return;
    homeCarousel.index = ((index % total) + total) % total;
    $$(".carousel-slide", $("#carouselStack")).forEach((el, i) => {
      el.classList.toggle("is-active", i === homeCarousel.index);
    });
    $$(".carousel-dot", $("#carouselDots")).forEach((el, i) => {
      el.classList.toggle("is-active", i === homeCarousel.index);
    });
    updateCarouselMeta();
    // 预载下一张
    const next = homeCarousel.photos[(homeCarousel.index + 1) % total];
    if (next) {
      const pre = new Image();
      pre.src = PhotoStore.urlFor(next);
    }
    if (manual) restartCarouselTimer();
  }

  function restartCarouselTimer() {
    clearInterval(homeCarousel.timer);
    if (homeCarousel.paused || homeCarousel.photos.length < 2) return;
    homeCarousel.timer = setInterval(() => {
      if (homeCarousel.paused) return;
      showCarouselIndex(homeCarousel.index + 1, false);
    }, 4800);
  }

  function stopHomeCarousel() {
    homeCarousel.running = false;
    clearInterval(homeCarousel.timer);
  }

  function startHomeCarousel() {
    // 与最新影集同步（保留当前索引尽量不跳）
    const list = state.photos.slice(0, 8);
    homeCarousel.photos = list;
    const root = $("#homeCarousel");
    if (!list.length) {
      root.hidden = true;
      const status = $("#heroStatus");
      if (status) status.hidden = false;
      stopHomeCarousel();
      return;
    }
    root.hidden = false;
    const statusEl = $("#heroStatus");
    if (statusEl) statusEl.hidden = true;
    if (homeCarousel.index >= list.length) homeCarousel.index = 0;
    buildCarouselDom();
    updateCarouselMeta();
    homeCarousel.running = true;
    restartCarouselTimer();
  }

  function bindCarousel() {
    const frame = $(".carousel-frame");
    const pauseBtn = $("#carouselPause");
    if (frame) {
      frame.addEventListener("click", () => {
        const photo = homeCarousel.photos[homeCarousel.index];
        if (!photo) return;
        const idx = state.photos.findIndex((p) => p.id === photo.id);
        openViewer(idx >= 0 ? idx : homeCarousel.index);
      });
    }
    if (pauseBtn) {
      pauseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        homeCarousel.paused = !homeCarousel.paused;
        pauseBtn.textContent = homeCarousel.paused ? "▶" : "❚❚";
        pauseBtn.setAttribute("aria-label", homeCarousel.paused ? "继续轮播" : "暂停轮播");
        if (homeCarousel.paused) clearInterval(homeCarousel.timer);
        else restartCarouselTimer();
      });
    }
    const root = $("#homeCarousel");
    if (root) {
      root.addEventListener("pointerenter", () => {
        if (!homeCarousel.paused) clearInterval(homeCarousel.timer);
      });
      root.addEventListener("pointerleave", () => {
        if (!homeCarousel.paused) restartCarouselTimer();
      });
    }
  }

  /* ── 画廊 ── */
  function filteredPhotos() {
    return state.photos.slice();
  }

  function yearOf(photo) {
    const t = photo.takenAt || "";
    const m = String(t).match(/^(\d{4})/);
    return m ? m[1] : "未标注";
  }

  function renderGallery() {
    const grid = $("#galleryGrid");
    const empty = $("#emptyState");
    const list = filteredPhotos();
    $("#photoCount").textContent = `${state.photos.length} 帧`;

    grid.innerHTML = "";
    grid.classList.toggle("is-grouped", state.filter === "year");
    const section = $("#gallerySection");
    if (!list.length) {
      empty.classList.add("is-visible");
      section.classList.add("is-empty");
      grid.style.setProperty("--gallery-rows", "1");
      return;
    }
    empty.classList.remove("is-visible");
    section.classList.remove("is-empty");

    // 行列自适应，保证一屏铺满且不溢出
    const n = list.length;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    let cols = 2;
    let rows = 1;
    if (state.filter === "year") {
      cols = n <= 2 ? Math.max(n, 1) : n <= 6 ? 3 : n <= 12 ? 4 : 5;
      if (narrow) cols = Math.min(cols, 2);
      rows = Math.min(narrow ? 4 : 3, Math.max(1, Math.ceil(n / cols)));
    } else if (n <= 1) {
      cols = 1;
      rows = 1;
    } else if (n <= 2) {
      cols = narrow ? 2 : 2;
      rows = 1;
    } else if (n <= 4) {
      cols = 2;
      rows = 2;
    } else if (n <= 6) {
      cols = narrow ? 2 : 3;
      rows = 2;
    } else if (n <= 9) {
      cols = narrow ? 2 : 3;
      rows = Math.min(narrow ? 4 : 3, Math.ceil(n / cols));
    } else if (n <= 16) {
      cols = narrow ? 2 : 4;
      rows = Math.min(3, Math.ceil(n / cols));
    } else {
      cols = narrow ? 2 : 5;
      rows = 3;
    }
    grid.style.setProperty("--gallery-cols", String(cols));
    grid.style.setProperty("--gallery-rows", String(rows));

    let delay = 0;
    let lastYear = null;
    const addCard = (photo) => {
      const card = document.createElement("article");
      card.className = "card";
      card.style.animationDelay = `${Math.min(delay * 0.04, 0.5)}s`;
      delay++;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `打开 ${photo.title}`);

      const wrap = document.createElement("div");
      wrap.className = "card-img-wrap";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = photo.title;
      img.src = PhotoStore.urlFor(photo);
      wrap.appendChild(img);

      const overlay = document.createElement("div");
      overlay.className = "card-overlay";
      overlay.innerHTML = `
        <h3 class="card-title"></h3>
        <p class="card-meta"></p>
      `;
      overlay.querySelector(".card-title").textContent = photo.title;
      const metaBits = [formatDate(photo.takenAt), photo.place].filter(Boolean);
      overlay.querySelector(".card-meta").textContent = metaBits.join(" · ") || "无元信息";
      wrap.appendChild(overlay);

      card.appendChild(wrap);
      const open = () => openViewer(state.photos.indexOf(photo));
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
      return card;
    };

    if (state.filter === "year") {
      list.forEach((photo) => {
        const y = yearOf(photo);
        if (y !== lastYear) {
          lastYear = y;
          const head = document.createElement("div");
          head.className = "year-head";
          head.innerHTML = `<span>${y}</span><i></i>`;
          grid.appendChild(head);
        }
        grid.appendChild(addCard(photo));
      });
    } else {
      list.forEach((photo) => grid.appendChild(addCard(photo)));
    }
  }

  function bindFilters() {
    $("#galleryFilters").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      state.filter = btn.dataset.filter || "all";
      $$("#galleryFilters .chip").forEach((c) => {
        c.classList.toggle("is-active", c === btn);
      });
      renderGallery();
    });
  }

  /* ── 上传 ── */
  function bindUpload() {
    const dropzone = $("#dropzone");
    const input = $("#fileInput");
    const preview = $("#dropPreview");
    const previewImg = $("#previewImg");
    const form = $("#uploadForm");
    const status = $("#formStatus");

    // 默认日期
    $("#fieldDate").value = new Date().toISOString().slice(0, 10);

    dropzone.addEventListener("click", (e) => {
      if (e.target.closest("#clearPreview")) return;
      input.click();
    });
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });

    ["dragenter", "dragover"].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("is-dragover");
      });
    });
    dropzone.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer.files || []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length) setPendingFiles(files);
    });

    input.addEventListener("change", () => {
      const files = Array.from(input.files || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) setPendingFiles(files);
      input.value = "";
    });

    $("#clearPreview").addEventListener("click", (e) => {
      e.stopPropagation();
      clearPending();
    });

    function setPendingFiles(files) {
      state.pendingFiles = files;
      const first = files[0];
      if (state.pendingPreviewUrl) URL.revokeObjectURL(state.pendingPreviewUrl);
      state.pendingPreviewUrl = URL.createObjectURL(first);
      previewImg.src = state.pendingPreviewUrl;
      preview.hidden = false;
      $("#dropzoneInner").hidden = true;
      status.textContent =
        files.length > 1 ? `已选择 ${files.length} 张照片` : `已选择：${first.name}`;
    }

    function clearPending() {
      state.pendingFiles = [];
      if (state.pendingPreviewUrl) {
        URL.revokeObjectURL(state.pendingPreviewUrl);
        state.pendingPreviewUrl = null;
      }
      previewImg.removeAttribute("src");
      preview.hidden = true;
      $("#dropzoneInner").hidden = false;
      status.textContent = "";
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.pendingFiles.length) {
        status.textContent = "请先选择照片";
        return;
      }
      const btn = $("#btnSave");
      btn.disabled = true;
      status.textContent = "正在入藏…";
      try {
        const metaBase = {
          title: $("#fieldTitle").value,
          place: $("#fieldPlace").value,
          note: $("#fieldNote").value,
          takenAt: $("#fieldDate").value || new Date().toISOString().slice(0, 10),
        };
        let count = 0;
        for (let i = 0; i < state.pendingFiles.length; i++) {
          const file = state.pendingFiles[i];
          const dim = await measureImage(file);
          const title =
            state.pendingFiles.length > 1
              ? `${metaBase.title || "未命名一帧"} ${i + 1}`
              : metaBase.title || file.name.replace(/\.[^.]+$/, "");
          await PhotoStore.add(file, {
            ...metaBase,
            title,
            width: dim.width,
            height: dim.height,
          });
          count++;
        }
        await refreshPhotos();
        clearPending();
        $("#fieldTitle").value = "";
        $("#fieldNote").value = "";
        $("#fieldPlace").value = "";
        status.textContent = `已入藏 ${count} 帧`;
        toast(`已入藏 ${count} 帧记忆`);
        // 短暂庆祝粒子
        celebrate();
        setTimeout(() => {
          const btn = document.querySelector('[data-nav="gallery"]');
          const rect = btn ? btn.getBoundingClientRect() : null;
          setView("gallery", {
            transition: true,
            origin: rect
              ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
              : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
          });
        }, 480);
      } catch (err) {
        console.error(err);
        status.textContent = "入藏失败：" + (err && err.message ? err.message : "未知错误");
      } finally {
        btn.disabled = false;
      }
    });
  }

  function celebrate() {
    const canvas = $("#viewerParticles");
    if (!canvas || !viewerFx) return;
    const r = canvas.getBoundingClientRect();
    // 使用 hero 区域中心；若不可见则用视口中心
    const x = r.width > 0 ? r.width / 2 : window.innerWidth / 2;
    const y = r.height > 0 ? r.height / 2 : window.innerHeight / 2;
    // 粒子画布在查看器内，入藏后可能不可见 —— 在 hero canvas 上也可
    const hero = $("#heroParticles");
    if (hero && hero.offsetParent !== null) {
      viewerFx.burst(hero, hero.clientWidth / 2, hero.clientHeight * 0.4);
    } else {
      viewerFx.burst(canvas, x, y);
    }
  }

  /* ── 查看器 ── */
  function currentList() {
    return filteredPhotos();
  }

  function openViewer(index) {
    const list = currentList();
    if (!list.length) return;
    state.viewer.open = true;
    state.viewer.index = Math.max(0, Math.min(index, list.length - 1));
    const viewer = $("#viewer");
    viewer.hidden = false;
    document.body.classList.add("is-locked");
    requestAnimationFrame(() => viewer.classList.add("is-open"));
    renderViewer(true);
    renderThumbs();
  }

  function closeViewer() {
    const viewer = $("#viewer");
    viewer.classList.remove("is-open");
    state.viewer.open = false;
    setTimeout(() => {
      viewer.hidden = true;
      document.body.classList.remove("is-locked");
    }, 280);
  }

  function activeImgEl() {
    return $("#viewerImgA").classList.contains("is-current") ? $("#viewerImgA") : $("#viewerImgB");
  }

  function standbyImgEl() {
    return $("#viewerImgA").classList.contains("is-current") ? $("#viewerImgB") : $("#viewerImgA");
  }

  function renderViewer(instant) {
    const list = currentList();
    if (!list.length) {
      closeViewer();
      return;
    }
    const photo = list[state.viewer.index];
    const url = PhotoStore.urlFor(photo);
    const img = activeImgEl();
    img.alt = photo.title;
    img.src = url;

    $("#viewerIndex").textContent =
      String(state.viewer.index + 1).padStart(2, "0") +
      " / " +
      String(list.length).padStart(2, "0");
    $("#viewerTitle").textContent = photo.title;
    const bits = [formatDate(photo.takenAt), photo.place].filter(Boolean);
    $("#viewerMeta").textContent = bits.join(" · ") || (photo.width ? `${photo.width}×${photo.height}` : "");
    $("#viewerNote").textContent = photo.note || "";

    if (instant) {
      // 预加载相邻
      const next = list[state.viewer.index + 1];
      if (next) {
        const pre = new Image();
        pre.src = PhotoStore.urlFor(next);
      }
    }
    updateThumbActive();
  }

  async function switchPhoto(delta) {
    const list = currentList();
    if (!list.length || state.viewer.switching) return;
    const nextIndex = (state.viewer.index + delta + list.length) % list.length;
    if (nextIndex === state.viewer.index && list.length === 1) return;

    state.viewer.switching = true;
    const viewer = $("#viewer");
    viewer.classList.add("is-animating");

    const fromImg = activeImgEl();
    const toImg = standbyImgEl();
    const nextPhoto = list[nextIndex];
    const url = PhotoStore.urlFor(nextPhoto);

    // 预加载目标图，确保采样可用
    try {
      await loadImg(url);
    } catch (_) {
      /* continue */
    }

    toImg.src = url;
    toImg.alt = nextPhoto.title;
    // 等 decode
    if (toImg.decode) {
      try {
        await toImg.decode();
      } catch (_) { /* ignore */ }
    }

    const canvas = $("#viewerParticles");
    await viewerFx.transition(fromImg, toImg, () => {
      state.viewer.index = nextIndex;
      fromImg.classList.remove("is-current");
      fromImg.classList.add("is-leaving");
      toImg.classList.add("is-current");
      // 侧栏更新
      $("#viewerIndex").textContent =
        String(state.viewer.index + 1).padStart(2, "0") +
        " / " +
        String(list.length).padStart(2, "0");
      $("#viewerTitle").textContent = nextPhoto.title;
      const bits = [formatDate(nextPhoto.takenAt), nextPhoto.place].filter(Boolean);
      $("#viewerMeta").textContent = bits.join(" · ");
      $("#viewerNote").textContent = nextPhoto.note || "";
      updateThumbActive();
      // 预取下一张
      const after = list[(state.viewer.index + 1) % list.length];
      if (after) {
        const pre = new Image();
        pre.src = PhotoStore.urlFor(after);
      }
    });

    // 清理 leaving 状态
    fromImg.classList.remove("is-leaving");
    viewer.classList.remove("is-animating");
    state.viewer.switching = false;
  }

  function renderThumbs() {
    const wrap = $("#viewerThumbs");
    wrap.innerHTML = "";
    const list = currentList();
    list.forEach((photo, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "thumb" + (i === state.viewer.index ? " is-active" : "");
      btn.setAttribute("aria-label", photo.title);
      const img = document.createElement("img");
      img.src = PhotoStore.urlFor(photo);
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        if (i === state.viewer.index || state.viewer.switching) return;
        const delta = i - state.viewer.index;
        // 简化：直接跳
        state.viewer.index = i;
        switchToIndex(i);
      });
      wrap.appendChild(btn);
    });
  }

  async function switchToIndex(index) {
    if (state.viewer.switching) return;
    const list = currentList();
    if (index < 0 || index >= list.length) return;
    const delta = index - state.viewer.index;
    if (delta === 0) return;
    // 复用 switchPhoto 的粒子逻辑：临时改 index 计算
    state.viewer.switching = true;
    const viewer = $("#viewer");
    viewer.classList.add("is-animating");

    const fromImg = activeImgEl();
    const toImg = standbyImgEl();
    const nextPhoto = list[index];
    const url = PhotoStore.urlFor(nextPhoto);
    try {
      await loadImg(url);
    } catch (_) {}
    toImg.src = url;
    toImg.alt = nextPhoto.title;
    if (toImg.decode) {
      try {
        await toImg.decode();
      } catch (_) {}
    }

    await viewerFx.transition(fromImg, toImg, () => {
      state.viewer.index = index;
      fromImg.classList.remove("is-current");
      fromImg.classList.add("is-leaving");
      toImg.classList.add("is-current");
      renderSideMeta(nextPhoto, list.length);
      updateThumbActive();
    });
    fromImg.classList.remove("is-leaving");
    viewer.classList.remove("is-animating");
    state.viewer.switching = false;
  }

  function renderSideMeta(photo, total) {
    $("#viewerIndex").textContent =
      String(state.viewer.index + 1).padStart(2, "0") +
      " / " +
      String(total).padStart(2, "0");
    $("#viewerTitle").textContent = photo.title;
    const bits = [formatDate(photo.takenAt), photo.place].filter(Boolean);
    $("#viewerMeta").textContent = bits.join(" · ");
    $("#viewerNote").textContent = photo.note || "";
  }

  function updateThumbActive() {
    $$(".thumb", $("#viewerThumbs")).forEach((t, i) => {
      t.classList.toggle("is-active", i === state.viewer.index);
    });
  }

  function bindViewer() {
    $("#viewerClose").addEventListener("click", closeViewer);
    $("#viewerBackdrop").addEventListener("click", closeViewer);
    $("#viewerPrev").addEventListener("click", () => switchPhoto(-1));
    $("#viewerNext").addEventListener("click", () => switchPhoto(1));

    $("#btnDelete").addEventListener("click", async () => {
      const list = currentList();
      const photo = list[state.viewer.index];
      if (!photo) return;
      if (!confirm(`将「${photo.title}」移出影集？此操作不可恢复。`)) return;
      await PhotoStore.remove(photo.id);
      await refreshPhotos();
      const left = currentList();
      if (!left.length) {
        closeViewer();
        toast("影帧已移出");
        return;
      }
      state.viewer.index = Math.min(state.viewer.index, left.length - 1);
      renderViewer(true);
      renderThumbs();
      toast("已移出影集");
    });

    $("#btnShare").addEventListener("click", () => openShare());

    // 键盘
    window.addEventListener("keydown", (e) => {
      if ($("#shareSheet") && !$("#shareSheet").hidden) {
        if (e.key === "Escape") closeShare();
        return;
      }
      if (!state.viewer.open) return;
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") switchPhoto(-1);
      if (e.key === "ArrowRight") switchPhoto(1);
    });

    // 触摸滑动
    let touchX = null;
    const stage = $("#viewerStage");
    stage.addEventListener(
      "touchstart",
      (e) => {
        touchX = e.changedTouches[0].clientX;
      },
      { passive: true }
    );
    stage.addEventListener(
      "touchend",
      (e) => {
        if (touchX == null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) < 48) return;
        switchPhoto(dx > 0 ? -1 : 1);
      },
      { passive: true }
    );

    // 滚轮切换（节流）
    let wheelLock = false;
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!state.viewer.open || wheelLock) return;
        if (Math.abs(e.deltaY) < 20 && Math.abs(e.deltaX) < 20) return;
        wheelLock = true;
        const d = e.deltaY + e.deltaX > 0 ? 1 : -1;
        switchPhoto(d);
        setTimeout(() => {
          wheelLock = false;
        }, 900);
      },
      { passive: true }
    );
  }

  /* ── 分享 ── */
  function captionFor(photo) {
    const bits = [photo.title];
    if (photo.takenAt) bits.push(formatDate(photo.takenAt));
    if (photo.place) bits.push(photo.place);
    let s = bits.join(" · ");
    if (photo.note) s += "\n" + photo.note;
    s += "\n— 来自 PhotoMemory 私人影集";
    return s;
  }

  async function drawShareCard(photo) {
    const canvas = $("#shareCanvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    // 背景
    ctx.fillStyle = "#0E0C0A";
    ctx.fillRect(0, 0, W, H);

    // 细边框
    ctx.strokeStyle = "rgba(196,165,116,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, W - 80, H - 80);

    // 照片区域
    const padX = 90;
    const padTop = 120;
    const photoH = H - padTop - 320;
    const photoW = W - padX * 2;

    try {
      const url = PhotoStore.urlFor(photo);
      const img = await loadImg(url);
      const scale = Math.min(photoW / img.naturalWidth, photoH / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = (W - dw) / 2;
      const dy = padTop + (photoH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      // 底部渐隐衔接
      const grad = ctx.createLinearGradient(0, dy + dh - 80, 0, dy + dh);
      grad.addColorStop(0, "rgba(14,12,10,0)");
      grad.addColorStop(1, "rgba(14,12,10,0.9)");
      ctx.fillStyle = grad;
      ctx.fillRect(dx, dy + dh - 80, dw, 80);
    } catch (_) {
      ctx.fillStyle = "#1A1613";
      ctx.fillRect(padX, padTop, photoW, photoH);
    }

    // 文案
    const textY = padTop + photoH + 48;
    ctx.fillStyle = "#C4A574";
    ctx.font = "500 22px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.letterSpacing = "6px";
    ctx.fillText("PHOTOMEMORY", padX, textY);
    ctx.letterSpacing = "0px";

    ctx.fillStyle = "#F2EBE0";
    const titleSize = photo.title.length > 16 ? 40 : 48;
    ctx.font = `400 ${titleSize}px Palatino, Georgia, 'Songti SC', serif`;
    wrapText(ctx, photo.title, padX, textY + 64, W - padX * 2, titleSize * 1.3);

    ctx.fillStyle = "#9A8F82";
    ctx.font = "400 26px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const meta = [formatDate(photo.takenAt), photo.place].filter(Boolean).join("  ·  ");
    if (meta) ctx.fillText(meta, padX, textY + 130);

    if (photo.note) {
      ctx.fillStyle = "rgba(242,235,224,0.7)";
      ctx.font = "italic 400 24px Palatino, Georgia, 'Songti SC', serif";
      const clipped = photo.note.length > 42 ? photo.note.slice(0, 42) + "…" : photo.note;
      wrapText(ctx, clipped, padX, textY + 180, W - padX * 2, 34);
    }

    return canvas;
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const chars = String(text).split("");
    let line = "";
    let yy = y;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = chars[i];
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  async function openShare() {
    const list = currentList();
    const photo = list[state.viewer.index];
    if (!photo) return;
    const sheet = $("#shareSheet");
    sheet.hidden = false;
    try {
      await drawShareCard(photo);
    } catch (e) {
      console.error(e);
      toast("分享卡片生成失败");
    }
  }

  function closeShare() {
    $("#shareSheet").hidden = true;
  }

  function bindShare() {
    $("#shareClose").addEventListener("click", closeShare);
    $("#shareSheet").addEventListener("click", (e) => {
      if (e.target === $("#shareSheet")) closeShare();
    });

    $("#btnDownloadCard").addEventListener("click", () => {
      const list = currentList();
      const photo = list[state.viewer.index];
      const canvas = $("#shareCanvas");
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `photomemory-${(photo && photo.id) || "card"}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast("卡片已下载");
      }, "image/png");
    });

    $("#btnNativeShare").addEventListener("click", async () => {
      const list = currentList();
      const photo = list[state.viewer.index];
      if (!photo) return;
      const caption = captionFor(photo);
      const canvas = $("#shareCanvas");
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      try {
        if (blob && navigator.canShare && navigator.share) {
          const file = new File([blob], "photomemory.png", { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: caption });
            return;
          }
          if (navigator.share) {
            await navigator.share({ text: caption });
            return;
          }
        }
        toast("当前浏览器不支持系统分享，请下载卡片");
      } catch (err) {
        if (err && err.name !== "AbortError") toast("分享未完成");
      }
    });

    $("#btnCopyCaption").addEventListener("click", async () => {
      const list = currentList();
      const photo = list[state.viewer.index];
      if (!photo) return;
      const text = captionFor(photo);
      try {
        await navigator.clipboard.writeText(text);
        toast("文案已复制");
      } catch (_) {
        toast("复制失败，请手动选择");
      }
    });
  }

  /* ── 存储计量 ── */
  async function refreshStorageMeter() {
    try {
      const m = await PhotoStore.measure();
      const fill = $("#meterFill");
      const text = $("#meterText");
      let pct = 0;
      if (m.quota > 0) pct = Math.min(100, (m.usage / m.quota) * 100);
      fill.style.width = (pct < 1 && m.count ? 2 : pct) + "%";
      text.textContent =
        `${m.count} 帧 · 影像约 ${formatBytes(m.bytes)}` +
        (m.quota ? ` · 站点用量 ${formatBytes(m.usage)} / ${formatBytes(m.quota)}` : "");
    } catch (_) {
      /* ignore */
    }
  }

  /* ── 数据刷新 ── */
  async function refreshPhotos() {
    state.photos = await PhotoStore.list();
    renderGallery();
    $("#photoCount").textContent = `${state.photos.length} 帧`;
    updateHeroStatus();
    if ($$(".view").some((v) => v.dataset.view === "home" && v.classList.contains("is-active"))) {
      startHomeCarousel();
    }
  }

  /* ── 分享只读路由（hash） ── */
  async function handleHashRoute() {
    const hash = location.hash.replace(/^#/, "");
    if (hash.startsWith("share/")) {
      const id = hash.slice(6);
      const photo = await PhotoStore.get(id);
      if (photo) {
        setView("gallery");
        const list = currentList();
        const idx = list.findIndex((p) => p.id === id);
        if (idx >= 0) openViewer(idx);
        return true;
      }
    }
    if (hash === "upload" || hash === "about" || hash === "gallery" || hash === "home") {
      setView(hash, { force: true });
      return true;
    }
    return false;
  }

  /* ── 启动 ── */
  async function boot() {
    try {
      await PhotoStore.init();
    } catch (e) {
      console.error(e);
      toast("无法初始化本地数据库（隐私模式？）");
    }

    viewerFx = new PhotoParticles.ViewerParticles($("#viewerParticles"));
    heroAmbient = new PhotoParticles.HeroAmbient($("#heroParticles"));
    viewWipe = new PhotoParticles.ViewWipe($("#viewWipe"));

    bindNav();
    bindFilters();
    bindUpload();
    bindViewer();
    bindShare();
    bindCarousel();

    await refreshPhotos();
    await handleHashRoute();

    // 默认视图：一屏首页
    if (!location.hash || location.hash === "#" || location.hash === "#home") {
      setView("home", { force: true });
    }

    window.addEventListener("hashchange", () => handleHashRoute());

    // 空影集引导文案微调
    if (state.photos.length === 0) {
      $("#emptyState").querySelector("h3").textContent = "暗房尚空";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
