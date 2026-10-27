/**
 * PhotoMemory · 导入时自动分类（浏览器端 MobileNet）
 * 需联网加载 TF.js 模型；失败则跳过归档，不影响入藏。
 */
(function (global) {
  const TF_JS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  const MOBILE =
    "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js";

  /** ImageNet 关键词 → 自动集（中文） */
  const RULES = [
    {
      key: "animal",
      label: "动物",
      test: (s) =>
        /(dog|cat|puppy|kitten|bird|eagle|owl|parrot|horse|cow|sheep|elephant|tiger|lion|bear|fox|deer|rabbit|mouse|fish|shark|whale|butterfly|spider|monkey|penguin|zebra|kangaroo|squirrel|gecko|snake|turtle)/i.test(
          s
        ),
    },
    {
      key: "food",
      label: "美食",
      test: (s) =>
        /(pizza|burger|sushi|cake|bread|cookie|coffee|tea|fruit|orange|banana|apple|strawberry|salad|soup|steak|pasta|noodle|ice cream|chocolate|wine|beer|breakfast|dish|plate|espresso)/i.test(
          s
        ),
    },
    {
      key: "plant",
      label: "植物",
      test: (s) =>
        /(flower|rose|tulip|daisy|sunflower|orchid|mushroom|tree|forest|leaf|plant|garden|bouquet|cactus|fern|maple|pine|palm)/i.test(
          s
        ),
    },
    {
      key: "building",
      label: "建筑",
      test: (s) =>
        /(palace|castle|church|cathedral|temple|mosque|bridge|tower|skyscraper|monastery|abbey|stadium|lighthouse|house|cottage|barn|building|arch|monument|library|museum)/i.test(
          s
        ),
    },
    {
      key: "landscape",
      label: "风景",
      test: (s) =>
        /(seashore|seaside|cliff|valley|mountain|volcano|lake|river|waterfall|canyon|field|meadow|dune|beach|coast|ocean|sky|cloud|sunset|sunrise|hill|glacier|forest|landscape|grotto|promontory|seascape|horizon)/i.test(
          s
        ),
    },
    {
      key: "city",
      label: "城市",
      test: (s) =>
        /(street|traffic|cab|taxi|car|bus|train|subway|shop|market|store|downtown|city|sidewalk|awning|signboard|fountain|fountain pen)/i.test(
          s
        ),
    },
    {
      key: "person",
      label: "人物",
      test: (s) =>
        /(person|man|woman|boy|girl|groom|bride|swimmer|rider|model|scuba|bikini|poncho|kimono|trench coat|bow tie|sunglasses|wig|mask)/i.test(
          s
        ),
    },
    {
      key: "vehicle",
      label: "交通工具",
      test: (s) =>
        /(car|truck|bus|train|bicycle|motorcycle|airplane|boat|ship|canoe|yacht|scooter|ambulance|fire engine|cab)/i.test(
          s
        ),
    },
  ];

  const AUTO_PREFIX = "自动 · ";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("加载失败 " + src));
      document.head.appendChild(s);
    });
  }

  let netPromise = null;

  async function loadModel() {
    if (!netPromise) {
      netPromise = (async () => {
        await loadScript(TF_JS);
        await loadScript(MOBILE);
        if (!window.mobilenet) throw new Error("mobilenet 不可用");
        return window.mobilenet.load({ version: 2, alpha: 0.5 });
      })().catch((e) => {
        netPromise = null;
        throw e;
      });
    }
    return netPromise;
  }

  function classifyFromPredictions(preds) {
    // preds: [{ className, probability }]
    const texts = preds.map((p) => String(p.className || ""));
    for (const rule of RULES) {
      for (let i = 0; i < preds.length; i++) {
        const p = preds[i];
        // 置信度阈值：第一名更高要求，前三名稍松
        const minP = i === 0 ? 0.12 : 0.08;
        if (p.probability >= minP && rule.test(String(p.className))) {
          return {
            key: rule.key,
            label: rule.label,
            albumName: AUTO_PREFIX + rule.label,
            score: p.probability,
            raw: p.className,
            top: texts.slice(0, 3),
          };
        }
      }
    }
    return {
      key: "other",
      label: "其他",
      albumName: AUTO_PREFIX + "其他",
      score: preds[0] ? preds[0].probability : 0,
      raw: preds[0] ? preds[0].className : "",
      top: texts.slice(0, 3),
    };
  }

  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ img, url });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败"));
      };
      img.src = url;
    });
  }

  const Classify = {
    enabled() {
      const c = global.PhotoConfig || {};
      return c.autoClassify !== false;
    },

    async classify(blob) {
      if (!this.enabled()) return null;
      try {
        const net = await loadModel();
        const { img, url } = await blobToImage(blob);
        try {
          const preds = await net.classify(img, 3);
          return classifyFromPredictions(preds);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        console.warn("自动分类跳过：", e && e.message);
        return null;
      }
    },

    albumNameFor(result) {
      if (!result) return "";
      return result.albumName || AUTO_PREFIX + (result.label || "其他");
    },
  };

  global.PhotoClassify = Classify;
})(window);
