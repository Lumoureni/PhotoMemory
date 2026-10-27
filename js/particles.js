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
      this._lastWind = null;
    }

    /** 每次切换随机一套风场/节奏，避免观感固化 */
    _nextStyle() {
      // 在若干「暗房气流」方向里随机，再抖一点角度
      const presets = [
        { ang: -0.65, label: "右上" },
        { ang: -2.35, label: "左上" },
        { ang: 0.95, label: "右下" },
        { ang: 2.2, label: "左下" },
        { ang: -1.5, label: "上升" },
        { ang: 0.2, label: "横掠" },
        { ang: -0.35, label: "斜掠" },
      ];
      let pick = presets[(Math.random() * presets.length) | 0];
      // 避免连续两次同向
      if (this._lastWind != null && Math.abs(pick.ang - this._lastWind) < 0.8) {
        pick = presets[(presets.indexOf(pick) + 1 + ((Math.random() * 3) | 0)) % presets.length];
      }
      const ang = pick.ang + rand(-0.28, 0.28);
      this._lastWind = ang;
      const styles = ["wind", "swirl", "scatter"];
      const mode = styles[(Math.random() * styles.length) | 0];
      return {
        ang,
        mode,
        duration: 880 + Math.random() * 380,
        midAt: 0.3 + Math.random() * 0.18,
        easeOut: 1.8 + Math.random() * 1.2,
        curlScale: 0.7 + Math.random() * 1.1,
        gravity: rand(-0.6, 1.4),
        distScale: 0.75 + Math.random() * 0.7,
        stretch: 1.6 + Math.random() * 1.8,
        delayMode: Math.random() < 0.55 ? "wind" : "shuffle",
        tremble: rand(0.2, 0.85),
      };
    }

    /**
     * 过渡：fromImg -> toImg
     * 旧照片粒子随机风向消散，新照片从上游轻柔汇入
     */
    async transition(fromImg, toImg, onMid, duration) {
      // 若上一段仍在播，等它结束再开始，避免静默 return 导致调用方卡住
      if (this.busy) {
        await new Promise((resolve) => {
          const t0 = performance.now();
          const wait = () => {
            if (!this.busy || performance.now() - t0 > 2000) resolve();
            else requestAnimationFrame(wait);
          };
          wait();
        });
        if (this.busy) {
          if (onMid) onMid();
          return;
        }
      }
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
      const offsetX = stageRect.left - canvasRect.left;
      const offsetY = stageRect.top - canvasRect.top;

      const sampleGrid = Math.max(4, Math.min(8, Math.floor(Math.min(w, h) / 110)));
      const style = this._nextStyle();
      const dur = duration || style.duration;

      const windAng = style.ang;
      const wind = { x: Math.cos(windAng), y: Math.sin(windAng) };
      const side = { x: -wind.y, y: wind.x };

      const outParticles = this._sampleImage(
        fromImg,
        stageRect,
        offsetX,
        offsetY,
        sampleGrid,
        "out",
        wind,
        side,
        style
      );
      const inParticles =
        toImg && toImg.naturalWidth
          ? this._sampleImage(toImg, stageRect, offsetX, offsetY, sampleGrid, "in", wind, side, style)
          : [];

      this.particles = outParticles.concat(inParticles);
      this.phase = "explode";

      const start = performance.now();
      let midFired = false;
      const midAt = style.midAt;

      await new Promise((resolve) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / dur);

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          if (!midFired && t > midAt) {
            midFired = true;
            this.phase = "implode";
            if (onMid) onMid();
          }

          for (const p of this.particles) {
            let x, y, alpha, size, stretch;

            if (p.kind === "out") {
              const local = Math.max(0, Math.min(1, (t - p.delay) / Math.max(0.01, 1 - p.delay)));
              if (local <= 0) {
                const tremble = Math.sin(now * 0.008 * (1 + style.tremble) + p.seed) * style.tremble;
                x = p.x + tremble;
                y = p.y + tremble * 0.6;
                alpha = p.alpha * 0.9;
                size = p.size;
                stretch = 1;
              } else {
                const g = 1 - Math.pow(1 - local, style.easeOut);
                const lift = g * g;
                const along = p.windSpeed * g * p.dist;
                const swirl =
                  style.mode === "swirl"
                    ? Math.sin(p.seed + local * Math.PI * 3.2) * p.curl * 1.25 * g
                    : Math.sin(p.seed + local * Math.PI * 2.2) * p.curl * g * style.curlScale;
                const scatter =
                  style.mode === "scatter"
                    ? (p.seed % 2 === 0 ? 1 : -1) * p.drift * g * (0.8 + Math.sin(local * 7 + p.seed))
                    : Math.cos(p.seed * 1.7 + local * 5.5) * p.drift * g * 0.45;

                x = p.x + wind.x * along + side.x * swirl + side.x * scatter + wind.x * lift * 40;
                y =
                  p.y +
                  wind.y * along +
                  side.y * swirl +
                  side.y * scatter +
                  wind.y * lift * 40 +
                  lift * 18 * p.g * style.gravity;

                alpha = p.alpha * Math.pow(1 - local, 1.25 + style.easeOut * 0.08);
                alpha *= 0.55 + 0.45 * Math.sin(p.seed + local * (4 + style.curlScale * 3));
                if (alpha < 0) alpha = 0;
                size = p.size * (1 - local * 0.4);
                stretch = 1 + local * style.stretch;
              }
            } else {
              const easeIn = 1.35 + (style.easeOut - 1.8) * 0.3;
              const te = 1 - Math.pow(1 - t, easeIn);
              const curl = Math.sin(p.seed + t * (2.4 + style.curlScale)) * p.curl * 0.3 * (1 - te) * style.curlScale;
              x = p.sx + (p.x - p.sx) * te + side.x * curl;
              y = p.sy + (p.y - p.sy) * te + side.y * curl;
              alpha = Math.min(1, Math.pow(Math.max(0, (t - 0.1) / 0.9), 0.5)) * p.alpha * 0.95;
              size = p.size * (0.5 + 0.5 * te);
              stretch = 1.5 - te * 0.5;
            }

            if (alpha <= 0.012) continue;

            if (p.kind === "out" && stretch > 1.15) {
              const tailX = x - wind.x * (stretch - 1) * size * 2.0;
              const tailY = y - wind.y * (stretch - 1) * size * 2.0;
              ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha * 0.26})`;
              ctx.fillRect(tailX - size * 0.5, tailY - size * 0.5, size * 1.2, size * 1.2);
            }

            ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha * 0.18})`;
            ctx.fillRect(x - size, y - size, size * 3, size * 3);
            ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha})`;
            const sx = Math.max(1, size * Math.min(stretch, 2.8));
            const sy = Math.max(1, size * (2 - Math.min(stretch, 2)) * 0.85 + size * 0.15);
            ctx.fillRect(x, y, sx, sy);
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

    _sampleImage(img, stageRect, offsetX, offsetY, grid, kind, wind, side, style) {
      const w = stageRect.width;
      const h = stageRect.height;
      const maxW = Math.min(w, 720);
      const maxH = Math.min(h, 640);
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = offsetX + (w - dw) / 2;
      const dy = offsetY + (h - dh) / 2;

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
      const maxP = 1700;
      const step = Math.max(1, Math.ceil((sw * sh) / maxP));
      const wdir = wind || { x: 0.75, y: -0.66 };
      const sdir = side || { x: 0.66, y: 0.75 };
      const st = style || { delayMode: "wind", distScale: 1, curlScale: 1 };

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const idx = (y * sw + x) * 4;
          const a = data[idx + 3];
          if (a < 20) continue;
          if ((y * sw + x) % step !== 0) continue;

          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = (r * 0.3 + g * 0.5 + b * 0.2) / 255;

          const px = dx + (x / sw) * dw + (Math.random() - 0.5) * (dw / sw);
          const py = dy + (y / sh) * dh + (Math.random() - 0.5) * (dh / sh);

          const mix = 0.38;
          const cr = (r * (1 - mix) + BRASS[0] * mix * (0.35 + lum * 0.65)) | 0;
          const cg = (g * (1 - mix) + BRASS[1] * mix * (0.35 + lum * 0.65)) | 0;
          const cb = (b * (1 - mix) + BRASS[2] * mix * (0.35 + lum * 0.65)) | 0;

          const nx = (px - dx) / Math.max(1, dw);
          const ny = (py - dy) / Math.max(1, dh);
          const windProj = -(nx - 0.5) * wdir.x - (ny - 0.5) * wdir.y;
          let delay;
          if (st.delayMode === "shuffle") {
            delay = rand(0, 0.38);
          } else {
            delay = Math.max(0, Math.min(0.42, 0.28 - windProj * 0.35 + rand(-0.1, 0.14)));
          }

          const dist = Math.hypot(px - cx, py - cy);
          const ang = Math.atan2(py - cy, px - cx);

          list.push({
            kind,
            x: px,
            y: py,
            sx: cx + wdir.x * (140 + rand(0, 200)) + Math.cos(ang) * rand(40, 110),
            sy: cy + wdir.y * (140 + rand(0, 200)) + Math.sin(ang) * rand(40, 110),
            dist: (200 + dist * 0.85 + rand(30, 220)) * (st.distScale || 1),
            windSpeed: rand(0.65, 1.5),
            curl: rand(18, 80) * (st.curlScale || 1),
            drift: rand(-22, 22),
            g: rand(-0.3, 1.2),
            seed: rand(0, Math.PI * 2),
            delay,
            size: rand(1.5, 3.4) * (0.7 + lum * 0.75),
            alpha: rand(0.72, 1),
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
