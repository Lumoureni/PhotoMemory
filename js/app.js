/**
 * PhotoMemory · 应用主逻辑
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    photos: [],
    filter: "all",
    query: "",
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
    // 收藏优先，再按时间
    const sorted = state.photos.slice().sort((a, b) => {
      const fa = a.favorite ? 1 : 0;
      const fb = b.favorite ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return 0;
    });
    const list = sorted.slice(0, 8);
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
      frame.addEventListener("click", async () => {
        const photo = homeCarousel.photos[homeCarousel.index];
        if (!photo) return;
        const idx = state.photos.findIndex((p) => p.id === photo.id);
        const slideImg = $(".carousel-slide.is-active img", frame) || $("#previewImg");
        await openViewerWithTransition(idx >= 0 ? idx : 0, slideImg);
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
  function matchesQuery(photo, q) {
    if (!q) return true;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const hay = [photo.title, photo.place, photo.note, photo.takenAt]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(s);
  }

  function filteredPhotos() {
    let list = state.photos.slice();
    if (state.filter === "fav") {
      list = list.filter((p) => p.favorite);
    }
    if (state.query) {
      list = list.filter((p) => matchesQuery(p, state.query));
    }
    return list;
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
    const emptyTitle = empty.querySelector("h3");
    const emptyP = empty.querySelector("p");
    if (!list.length) {
      empty.classList.add("is-visible");
      section.classList.add("is-empty");
      grid.style.setProperty("--gallery-rows", "1");
      if (state.photos.length && (state.query || state.filter === "fav")) {
        emptyTitle.textContent = "没有匹配的影帧";
        emptyP.textContent = "试试换关键词，或取消筛选。";
      } else {
        emptyTitle.textContent = "暗房尚空";
        emptyP.textContent = "还没有照片入藏。上传第一张，让影集开始生长。";
      }
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
      card.className = "card" + (photo.favorite ? " is-fav" : "");
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

      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "card-fav" + (photo.favorite ? " is-on" : "");
      favBtn.setAttribute("aria-label", photo.favorite ? "取消收藏" : "收藏");
      favBtn.textContent = photo.favorite ? "★" : "☆";
      favBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await PhotoStore.update(photo.id, { favorite: !photo.favorite });
        await refreshPhotos();
        toast(photo.favorite ? "已取消收藏" : "已收藏");
      });
      wrap.appendChild(favBtn);

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
      const open = () => {
        const idx = state.photos.findIndex((p) => p.id === photo.id);
        openViewer(idx >= 0 ? idx : 0);
      };
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
    const search = $("#gallerySearch");
    if (search) {
      let t = 0;
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.query = search.value || "";
          renderGallery();
        }, 120);
      });
    }
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
    return state.photos;
  }

  function openViewer(index) {
    const list = currentList();
    if (!list.length) return;
    state.viewer.open = true;
    state.viewer.index = Math.max(0, Math.min(index, list.length - 1));
    const viewer = $("#viewer");
    viewer.hidden = false;
    setEditMode(false);
    document.body.classList.add("is-locked");
    requestAnimationFrame(() => viewer.classList.add("is-open"));
    renderViewer(true);
    renderThumbs();
  }

  /** 首页轮播 → 查看器：共享元素飞入 + 柔和淡入 */
  function openViewerWithTransition(index, fromImgEl) {
    const list = currentList();
    if (!list.length) return Promise.resolve();

    const reduce =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fromImgEl || !fromImgEl.getBoundingClientRect || reduce) {
      openViewer(index);
      return Promise.resolve();
    }

    const fromRect = fromImgEl.getBoundingClientRect();
    if (fromRect.width < 4 || fromRect.height < 4) {
      openViewer(index);
      return Promise.resolve();
    }

    // 轮播暂停
    clearInterval(homeCarousel.timer);

    // 舞台图片先隐藏，避免与飞行克隆重叠
    const viewer = $("#viewer");
    const imgA = $("#viewerImgA");
    const imgB = $("#viewerImgB");
    [imgA, imgB].forEach((el) => el && el.classList.add("is-flight-hidden"));

    openViewer(index);

    // 等待布局与首帧
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const target = activeImgEl();
          const stage = $("#viewerStage");
          let toRect = target.getBoundingClientRect();
          if (toRect.width < 8 || toRect.height < 8) {
            toRect = stage ? stage.getBoundingClientRect() : toRect;
          }
          // 目标区略收缩，更接近「落入」舞台
          const padX = toRect.width * 0.04;
          const padY = toRect.height * 0.04;
          toRect = {
            left: toRect.left + padX,
            top: toRect.top + padY,
            width: Math.max(40, toRect.width - padX * 2),
            height: Math.max(40, toRect.height - padY * 2),
          };
          const src = PhotoStore.urlFor(list[Math.max(0, Math.min(index, list.length - 1))]) || fromImgEl.src;

          const flight = document.createElement("div");
          flight.className = "viewer-flight";
          flight.style.left = fromRect.left + "px";
          flight.style.top = fromRect.top + "px";
          flight.style.width = fromRect.width + "px";
          flight.style.height = fromRect.height + "px";
          flight.style.backgroundImage = `url("${src}")`;
          document.body.appendChild(flight);

          // 首页轻淡出
          const home = $("#viewHome");
          if (home) home.classList.add("is-transitioning");

          // 小粒子（若首页画布仍在）
          const hero = $("#heroParticles");
          if (hero && viewerFx && hero.offsetParent !== null) {
            const fr = fromRect;
            viewerFx.burst(hero, fr.left + fr.width / 2 - hero.getBoundingClientRect().left, fr.top + fr.height / 2 - hero.getBoundingClientRect().top);
          }

          const DUR = 720;
          const start = performance.now();
          const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic

          const step = (now) => {
            const t = Math.min(1, (now - start) / DUR);
            const e = ease(t);
            const x = fromRect.left + (toRect.left - fromRect.left) * e;
            const y = fromRect.top + (toRect.top - fromRect.top) * e;
            const w = fromRect.width + (toRect.width - fromRect.width) * e;
            const h = fromRect.height + (toRect.height - fromRect.height) * e;
            flight.style.transform = `translate(${x - fromRect.left}px, ${y - fromRect.top}px)`;
            flight.style.width = w + "px";
            flight.style.height = h + "px";
            flight.style.opacity = t < 0.75 ? String(0.75 + 0.25 * t) : String(1 - (t - 0.75) / 0.25);

            if (t < 1) {
              requestAnimationFrame(step);
            } else {
              flight.remove();
              [imgA, imgB].forEach((el) => el && el.classList.remove("is-flight-hidden"));
              if (home) home.classList.remove("is-transitioning");
              resolve();
            }
          };
          requestAnimationFrame(step);
        });
      });
    });
  }

  function closeViewer() {
    const viewer = $("#viewer");
    viewer.classList.remove("is-open");
    state.viewer.open = false;
    setEditMode(false);
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

  function updateFavButton() {
    const btn = $("#btnFav");
    if (!btn) return;
    const list = currentList();
    const photo = list[state.viewer.index];
    const on = !!(photo && photo.favorite);
    btn.textContent = on ? "已收藏" : "收藏";
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function updateViewerFloatMeta() {
    /* 左侧常驻信息栏已展示标题，不再使用浮动文案 */
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
    updateFavButton();
    updateViewerFloatMeta(photo);

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
      setEditMode(false);
      // 侧栏更新
      $("#viewerIndex").textContent =
        String(state.viewer.index + 1).padStart(2, "0") +
        " / " +
        String(list.length).padStart(2, "0");
      $("#viewerTitle").textContent = nextPhoto.title;
      const bits = [formatDate(nextPhoto.takenAt), nextPhoto.place].filter(Boolean);
      $("#viewerMeta").textContent = bits.join(" · ");
      $("#viewerNote").textContent = nextPhoto.note || "";
      updateFavButton();
      updateViewerFloatMeta(nextPhoto);
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
      setEditMode(false);
      renderSideMeta(nextPhoto, list.length);
      updateFavButton();
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
    updateViewerFloatMeta(photo);
  }

  function updateThumbActive() {
    $$(".thumb", $("#viewerThumbs")).forEach((t, i) => {
      t.classList.toggle("is-active", i === state.viewer.index);
    });
  }

  function setEditMode(on) {
    const display = $("#viewerDisplay");
    const form = $("#viewerEdit");
    const actionsView = $("#viewerActionsView");
    const actionsEdit = $("#viewerActionsEdit");
    if (!display) return;
    display.hidden = on;
    form.hidden = !on;
    actionsView.hidden = on;
    actionsEdit.hidden = !on;
    if (on) {
      const list = currentList();
      const photo = list[state.viewer.index];
      if (!photo) return;
      $("#editTitle").value = photo.title || "";
      $("#editDate").value = (photo.takenAt || "").slice(0, 10);
      $("#editPlace").value = photo.place || "";
      $("#editNote").value = photo.note || "";
      $("#editTitle").focus();
    }
  }

  async function saveViewerEdit() {
    const list = currentList();
    const photo = list[state.viewer.index];
    if (!photo) return;
    try {
      const next = await PhotoStore.update(photo.id, {
        title: $("#editTitle").value,
        takenAt: $("#editDate").value,
        place: $("#editPlace").value,
        note: $("#editNote").value,
      });
      // 同步 state 中的对象
      const idx = state.photos.findIndex((p) => p.id === photo.id);
      if (idx >= 0) state.photos[idx] = next;
      setEditMode(false);
      renderSideMeta(next, list.length);
      renderGallery();
      toast("已保存修改");
    } catch (err) {
      console.error(err);
      toast("保存失败");
    }
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
      setEditMode(false);
      renderViewer(true);
      renderThumbs();
      toast("已移出影集");
    });

    $("#btnEdit").addEventListener("click", () => setEditMode(true));
    $("#btnCancelEdit").addEventListener("click", () => setEditMode(false));
    $("#btnSaveEdit").addEventListener("click", (e) => {
      e.preventDefault();
      saveViewerEdit();
    });
    $("#viewerEdit").addEventListener("submit", (e) => {
      e.preventDefault();
      saveViewerEdit();
    });

    const favBtn = $("#btnFav");
    if (favBtn) {
      favBtn.addEventListener("click", async () => {
        const list = currentList();
        const photo = list[state.viewer.index];
        if (!photo) return;
        const next = await PhotoStore.update(photo.id, { favorite: !photo.favorite });
        const idx = state.photos.findIndex((p) => p.id === photo.id);
        if (idx >= 0) state.photos[idx] = next;
        updateFavButton();
        renderGallery();
        toast(next.favorite ? "已收藏" : "已取消收藏");
      });
    }

    $("#btnShare").addEventListener("click", () => openShare());

    const detailsBtn = $("#btnDetails");
    if (detailsBtn) detailsBtn.addEventListener("click", () => openDetails());
    const detailsClose = $("#detailsClose");
    if (detailsClose) detailsClose.addEventListener("click", closeDetails);
    const detailsSheet = $("#detailsSheet");
    if (detailsSheet) {
      detailsSheet.addEventListener("click", (e) => {
        if (e.target === detailsSheet) closeDetails();
      });
    }

    // 键盘
    window.addEventListener("keydown", (e) => {
      if ($("#shareSheet") && !$("#shareSheet").hidden) {
        if (e.key === "Escape") closeShare();
        return;
      }
      if ($("#detailsSheet") && !$("#detailsSheet").hidden) {
        if (e.key === "Escape") closeDetails();
        return;
      }
      if (!state.viewer.open) return;
      const editing = $("#viewerEdit") && !$("#viewerEdit").hidden;
      if (e.key === "Escape") {
        if (editing) {
          setEditMode(false);
          return;
        }
        closeViewer();
      }
      if (editing) return;
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

  /* ── 详细信息 ── */
  function closeDetails() {
    const el = $("#detailsSheet");
    if (el) el.hidden = true;
  }

  function openDetails() {
    const list = currentList();
    const photo = list[state.viewer.index];
    const panel = $("#detailsList");
    const hint = $("#detailsHint");
    if (!photo || !panel) return;

    const rows = [];
    const add = (label, value) => {
      if (value == null || value === "") return;
      rows.push({ label, value: String(value) });
    };

    add("标题", photo.title);
    add("日期", formatDate(photo.takenAt));
    add("地点", photo.place);
    add("备注", photo.note);
    add("尺寸", photo.width && photo.height ? `${photo.width} × ${photo.height}` : null);
    add("文件大小", formatBytes(photo.size));
    add("格式", photo.mime);
    add("入藏于", photo.createdAt ? new Date(photo.createdAt).toLocaleString("zh-CN") : null);
    add("收藏", photo.favorite ? "是" : "否");

    if (window.PhotoExif && photo.exif) {
      PhotoExif.formatExifForDisplay(photo).forEach((r) => add(r.label, r.value));
    } else if (window.PhotoExif && photo.blob) {
      // 兼容旧数据：懒解析一次
      PhotoExif.extractImageInfo(photo.blob).then((info) => {
        if (info && info.exif) {
          photo.exif = info.exif;
          photo.width = info.width || photo.width;
          photo.height = info.height || photo.height;
          PhotoStore.update(photo.id, {
            exif: info.exif,
            width: photo.width,
            height: photo.height,
          }).catch(() => {});
          openDetails();
        }
      }).catch(() => {});
    }

    panel.innerHTML = "";
    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<dt></dt><dd></dd>`;
      row.querySelector("dt").textContent = r.label;
      row.querySelector("dd").textContent = r.value;
      panel.appendChild(row);
    });

    const hasExif = !!(photo.exif && Object.keys(photo.exif).length);
    hint.textContent = hasExif
      ? "EXIF 来自图片文件本身，入藏/导入时自动解析。"
      : "此文件未包含可识别的 EXIF（可能是合成图或已剥离元数据）。";

    const sheet = $("#detailsSheet");
    sheet.hidden = false;
  }

  /* ── 备份导出 / 导入 ── */
  function bindBackup() {
    const status = $("#backupStatus");
    const exportBtn = $("#btnExport");
    const importBtn = $("#btnImport");
    const importInput = $("#importInput");

    if (exportBtn) {
      exportBtn.addEventListener("click", async () => {
        if (!state.photos.length) {
          status.textContent = "影集为空，无需导出";
          return;
        }
        exportBtn.disabled = true;
        status.textContent = "正在打包…";
        try {
          const photos = await PhotoStore.list();
          const blob = await PhotoBackup.exportArchive(photos);
          const stamp = new Date().toISOString().slice(0, 10);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `photomemory-backup-${stamp}.zip`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          status.textContent = `已导出 ${photos.length} 帧（${formatBytes(blob.size)}）`;
          toast("备份已下载");
        } catch (err) {
          console.error(err);
          status.textContent = "导出失败：" + (err && err.message ? err.message : "未知错误");
        } finally {
          exportBtn.disabled = false;
        }
      });
    }

    if (importBtn && importInput) {
      importBtn.addEventListener("click", () => importInput.click());
      importInput.addEventListener("change", async () => {
        const file = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!file) return;
        status.textContent = "正在解析备份…";
        importBtn.disabled = true;
        try {
          const { items } = await PhotoBackup.parseArchive(file);
          if (!items.length) {
            status.textContent = "备份中没有可导入的照片";
            return;
          }
          let ok = 0;
          for (const item of items) {
            await PhotoStore.putPhoto({
              id: item.meta.id,
              title: item.meta.title,
              place: item.meta.place,
              note: item.meta.note,
              takenAt: item.meta.takenAt,
              createdAt: item.meta.createdAt,
              width: item.meta.width,
              height: item.meta.height,
              mime: item.meta.mime || item.blob.type,
              size: item.blob.size,
              favorite: !!item.meta.favorite,
              exif: item.meta.exif || null,
              blob: item.blob,
            });
            ok++;
          }
          await refreshPhotos();
          status.textContent = `已导入 ${ok} 帧`;
          toast(`已导入 ${ok} 帧`);
        } catch (err) {
          console.error(err);
          status.textContent = "导入失败：" + (err && err.message ? err.message : "未知错误");
        } finally {
          importBtn.disabled = false;
        }
      });
    }
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
    bindBackup();

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
