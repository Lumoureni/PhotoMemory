/**
 * PhotoMemory · Canvas 2D 粒子系统
 * - HeroAmbient: 轻氛围粒子
 * - ViewerParticles: 照片切换时的解体 / 重组
 */
(function (global) {
  const BRASS = [196, 165, 116];
  const CLAY = [139, 94, 60];
  const PAPER = [242, 235, 224];

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function sampleColor(rgb, t) {
    // 混合黄铜 / 陶土 / 纸白
    const palette = [BRASS, CLAY, PAPER];
    const w = Math.random();
    let c;
    if (w < 0.55) c = BRASS;
    else if (w < 0.85) c = CLAY;
    else c = PAPER;
    const n = 0.65 + Math.random() * 0.45;
    return [
      Math.min(255, (c[0] * n) | 0),
      Math.min(255, (c[1] * n) | 0),
      Math.min(255, (c[2] * n) | 0),
      t,
    ];
  }

  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    return { w, h, dpr };
  }

  /* ── Hero 氛围粒子 ── */
  class HeroAmbient {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.particles = [];
      this.raf = 0;
      this.running = false;
      this.mouse = { x: -9999, y: -9999 };
      this._onMove = (e) => {
        const r = canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - r.left;
        this.mouse.y = e.clientY - r.top;
      };
      this._onLeave = () => {
        this.mouse.x = -9999;
        this.mouse.y = -9999;
      };
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.resize();
      this.spawn();
      window.addEventListener("resize", this.resize);
      this.canvas.parentElement.addEventListener("pointermove", this._onMove, { passive: true });
      this.canvas.parentElement.addEventListener("pointerleave", this._onLeave);
      this.loop();
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      window.removeEventListener("resize", this.resize);
      try {
        this.canvas.parentElement.removeEventListener("pointermove", this._onMove);
        this.canvas.parentElement.removeEventListener("pointerleave", this._onLeave);
      } catch (_) { /* ignore */ }
    }

    resize = () => {
      fitCanvas(this.canvas);
    };

    spawn() {
      const { w, h } = fitCanvas(this.canvas);
      const count = Math.min(90, Math.floor((w * h) / 18000));
      this.particles = Array.from({ length: count }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-0.15, 0.15),
        vy: rand(-0.08, -0.22),
        r: rand(0.6, 2.2),
        a: rand(0.15, 0.55),
        pulse: rand(0, Math.PI * 2),
        color: sampleColor(BRASS, 1).slice(0, 3),
      }));
    }

    loop = () => {
      if (!this.running) return;
      const { w, h, dpr } = fitCanvas(this.canvas);
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (const p of this.particles) {
        // 轻微鼠标吸引
        const dx = this.mouse.x - p.x;
        const dy = this.mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 140 && dist > 1) {
          p.vx += (dx / dist) * 0.02;
          p.vy += (dy / dist) * 0.02;
        }
        p.vx *= 0.99;
        p.vy *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += 0.02;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = rand(0, w);
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        const alpha = p.a * (0.65 + 0.35 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      this.raf = requestAnimationFrame(this.loop);
    };
  }

  /* ── 查看器切换粒子 ── */
  class ViewerParticles {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { willReadFrequently: false });
      this.particles = [];
      this.raf = 0;
      this.busy = false;
      this.phase = "idle"; // explode | implode
    }

    /**
     * 过渡：fromImg -> toImg
     * 1) 从 fromImg 像素采样粒子向外飘散
     * 2) 同时从 toImg 采样粒子从外汇聚
     * callback 在中点调用以切换 DOM 图片
     */
    async transition(fromImg, toImg, onMid, duration = 900) {
      if (this.busy) return;
      this.busy = true;

      const { w, h, dpr } = fitCanvas(this.canvas);
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const reduce =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !fromImg || !fromImg.naturalWidth) {
        if (onMid) onMid();
        this.busy = false;
        return;
      }

      const stage = this.canvas.parentElement.querySelector(".viewer-stage") || this.canvas;
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = this.canvas.getBoundingClientRect();
      // 图片在画布中的绘制区域
      const offsetX = stageRect.left - canvasRect.left;
      const offsetY = stageRect.top - canvasRect.top;

      const sampleGrid = Math.max(4, Math.min(8, Math.floor(Math.min(w, h) / 110)));

      const outParticles = this._sampleImage(fromImg, stageRect, offsetX, offsetY, sampleGrid, "out");
      const inParticles = toImg && toImg.naturalWidth
        ? this._sampleImage(toImg, stageRect, offsetX, offsetY, sampleGrid, "in")
        : [];

      this.particles = outParticles.concat(inParticles);
      this.phase = "explode";

      const start = performance.now();
      let midFired = false;

      await new Promise((resolve) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          // ease
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          if (!midFired && t > 0.38) {
            midFired = true;
            this.phase = "implode";
            if (onMid) onMid();
          }

          for (const p of this.particles) {
            let x, y, alpha, size;
            if (p.kind === "out") {
              // 飘散：向外加速 + 轻微重力/旋涡
              const te = Math.pow(t, 0.85);
              x = p.x + p.vx * te * p.dist + Math.sin(p.seed + t * 4) * p.drift;
              y = p.y + p.vy * te * p.dist + Math.cos(p.seed + t * 3.5) * p.drift * 0.6 + te * te * 30 * p.g;
              alpha = (1 - Math.pow(t, 0.7)) * p.alpha;
              size = p.size * (1 - t * 0.35);
            } else {
              // 汇聚：从外侧飞入目标点
              const te = 1 - Math.pow(1 - t, 1.6);
              x = p.sx + (p.x - p.sx) * te;
              y = p.sy + (p.y - p.sy) * te;
              alpha = Math.min(1, Math.pow(Math.max(0, (t - 0.15) / 0.85), 0.6)) * p.alpha;
              size = p.size * (0.55 + 0.45 * te);
            }

            if (alpha <= 0.01) continue;
            // 轻微光晕感：先画较大半透明方块，再画实心点
            ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha * 0.22})`;
            ctx.fillRect(x - size, y - size, size * 3, size * 3);
            ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha})`;
            ctx.fillRect(x, y, size, size);
          }

          if (t < 1) {
            this.raf = requestAnimationFrame(step);
          } else {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            this.particles = [];
            this.phase = "idle";
            this.busy = false;
            resolve();
          }
        };
        this.raf = requestAnimationFrame(step);
      });
    }

    _sampleImage(img, stageRect, offsetX, offsetY, grid, kind) {
      const w = stageRect.width;
      const h = stageRect.height;
      const maxW = Math.min(w, 720);
      const maxH = Math.min(h, 640);
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = offsetX + (w - dw) / 2;
      const dy = offsetY + (h - dh) / 2;

      // 离屏采样
      const sw = Math.max(1, Math.floor(dw / grid));
      const sh = Math.max(1, Math.floor(dh / grid));
      const off = document.createElement("canvas");
      off.width = sw;
      off.height = sh;
      const octx = off.getContext("2d", { willReadFrequently: true });
      try {
        octx.drawImage(img, 0, 0, sw, sh);
      } catch (_) {
        return [];
      }
      let data;
      try {
        data = octx.getImageData(0, 0, sw, sh).data;
      } catch (_) {
        return [];
      }

      const list = [];
      const cx = dx + dw / 2;
      const cy = dy + dh / 2;
      // 限制粒子数量
      const maxP = 1600;
      const step = Math.max(1, Math.ceil((sw * sh) / maxP));

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const idx = (y * sw + x) * 4;
          const a = data[idx + 3];
          if (a < 20) continue;
          // 跳过采样以控数量
          if ((y * sw + x) % step !== 0) continue;

          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          // 亮度
          const lum = (r * 0.3 + g * 0.5 + b * 0.2) / 255;

          const px = dx + (x / sw) * dw + (Math.random() - 0.5) * (dw / sw);
          const py = dy + (y / sh) * dh + (Math.random() - 0.5) * (dh / sh);

          // 暖色映射：保留原色但压向黄铜调
          const mix = 0.35;
          const cr = (r * (1 - mix) + BRASS[0] * mix * (0.4 + lum * 0.6)) | 0;
          const cg = (g * (1 - mix) + BRASS[1] * mix * (0.4 + lum * 0.6)) | 0;
          const cb = (b * (1 - mix) + BRASS[2] * mix * (0.4 + lum * 0.6)) | 0;

          const ang = Math.atan2(py - cy, px - cx) + rand(-0.5, 0.5);
          const dist = Math.hypot(px - cx, py - cy);
          const outDist = 80 + dist * 0.85 + rand(0, 120);

          list.push({
            kind,
            x: px,
            y: py,
            sx: cx + Math.cos(ang) * (dist + rand(120, 280)),
            sy: cy + Math.sin(ang) * (dist + rand(120, 280)),
            vx: Math.cos(ang),
            vy: Math.sin(ang),
            dist: outDist,
            drift: rand(-18, 18),
            g: rand(-0.5, 1.2),
            seed: rand(0, Math.PI * 2),
            size: rand(1.6, 3.6) * (0.75 + lum * 0.7),
            alpha: rand(0.7, 1) * (kind === "out" ? 1 : 0.95),
            color: [cr, cg, cb],
          });
        }
      }
      return list;
    }

    /** 入藏庆祝小粒子 */
    burst(canvas, originX, originY) {
      const { w, h, dpr } = fitCanvas(canvas);
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = 48;
      const parts = Array.from({ length: n }, () => {
        const ang = rand(0, Math.PI * 2);
        const sp = rand(2, 9);
        return {
          x: originX,
          y: originY,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 2,
          life: 1,
          decay: rand(0.012, 0.028),
          size: rand(1.5, 3),
          color: sampleColor(BRASS, 1).slice(0, 3),
        };
      });
      const start = performance.now();
      const step = (now) => {
        const elapsed = now - start;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // 不清全屏，轻擦
        ctx.clearRect(0, 0, w, h);
        let alive = 0;
        for (const p of parts) {
          if (p.life <= 0) continue;
          alive++;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.12;
          p.vx *= 0.98;
          p.life -= p.decay;
          ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${Math.max(0, p.life)})`;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
        if (alive > 0 && elapsed < 1600) {
          requestAnimationFrame(step);
        } else {
          ctx.clearRect(0, 0, w, h);
        }
      };
      requestAnimationFrame(step);
    }
  }

  /**
   * 视图切换：全屏粒子扫入 → 中点切换 → 粒子散开
   */
  class ViewWipe {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.busy = false;
      this.raf = 0;
    }

    /**
     * @param {(mid: number) => void} midCallback 在遮罩最浓时切换视图
     * @param {object} opts { duration, origin: {x,y}|null, direction }
     */
    async play(midCallback, opts = {}) {
      if (this.busy) return;
      const duration = opts.duration || 900;
      const reduce =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        if (midCallback) midCallback();
        return;
      }

      this.busy = true;
      this.canvas.classList.add("is-on");
      const { w, h, dpr } = fitCanvas(this.canvas);
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = (opts.origin && opts.origin.x) || w * 0.5;
      const cy = (opts.origin && opts.origin.y) || h * 0.5;
      const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));

      const count = Math.min(1400, Math.floor((w * h) / 900));
      const parts = Array.from({ length: count }, () => {
        const ang = rand(0, Math.PI * 2);
        // 偏向从点击点向外
        const startR = rand(0, maxR * 0.15);
        return {
          x0: cx + Math.cos(ang) * startR,
          y0: cy + Math.sin(ang) * startR,
          ang,
          // 汇聚时的目标：铺满屏幕网格感
          rMax: rand(maxR * 0.35, maxR * 1.15),
          speed: rand(0.55, 1.1),
          size: rand(1.2, 3.2),
          spin: rand(-0.04, 0.04),
          seed: rand(0, Math.PI * 2),
          color: sampleColor(BRASS, 1).slice(0, 3),
          a: rand(0.45, 1),
        };
      });

      // 遮罩深色层进度
      const start = performance.now();
      let midFired = false;

      await new Promise((resolve) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          // 0→1→0 浓度包络（中点最浓）
          const envelope = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
          const env = Math.max(0, Math.min(1, envelope));

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          // 深底
          ctx.fillStyle = `rgba(14, 12, 10, ${0.72 * env})`;
          ctx.fillRect(0, 0, w, h);

          if (!midFired && t >= 0.42) {
            midFired = true;
            if (midCallback) midCallback();
          }

          // 粒子：前半从中心涌出加密，后半向外飘散消散
          const expand = t < 0.45 ? t / 0.45 : 1;
          const disperse = t > 0.45 ? (t - 0.45) / 0.55 : 0;

          for (const p of parts) {
            p.ang += p.spin * (t < 0.5 ? 1 : -0.5);
            const wave = Math.sin(p.seed + t * Math.PI * 2) * 12 * env;
            let r = p.rMax * expand * p.speed + wave;
            let x = cx + Math.cos(p.ang) * r;
            let y = cy + Math.sin(p.ang) * r + disperse * disperse * 40 * (p.seed % 2 === 0 ? 1 : -1);
            x += Math.cos(p.seed + t * 6) * disperse * 30;
            y += Math.sin(p.seed + t * 5) * disperse * 18;

            const alpha = p.a * env * (1 - disperse * 0.85);
            if (alpha <= 0.02) continue;

            const size = p.size * (0.7 + env * 0.5);
            ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha * 0.2})`;
            ctx.fillRect(x - size, y - size, size * 3, size * 3);
            ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha})`;
            ctx.fillRect(x, y, size, size);
          }

          // 中点附近轻微暗角脉冲
          if (env > 0.2) {
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
            g.addColorStop(0, `rgba(196,165,116,${0.04 * env})`);
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
          }

          if (t < 1) {
            this.raf = requestAnimationFrame(step);
          } else {
            ctx.clearRect(0, 0, w, h);
            this.canvas.classList.remove("is-on");
            this.busy = false;
            resolve();
          }
        };
        this.raf = requestAnimationFrame(step);
      });
    }
  }

  global.PhotoParticles = { HeroAmbient, ViewerParticles, ViewWipe };
})(window);
