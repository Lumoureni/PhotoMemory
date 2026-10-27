/**
 * PhotoMemory 云端 API 客户端
 * 接口形状与 PhotoStore 对齐（blob 用 object URL 包装）
 */
(function (global) {
  function cfg() {
    return global.PhotoConfig || { apiBase: "", apiToken: "" };
  }

  function headers(json) {
    const c = cfg();
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (c.apiToken) h["X-API-Token"] = c.apiToken;
    return h;
  }

  function base() {
    return String(cfg().apiBase || "").replace(/\/+$/, "");
  }

  async function req(path, options) {
    const b = base();
    if (!b) throw new Error("未配置 apiBase");
    const res = await fetch(b + path, {
      ...options,
      headers: { ...headers(options && options.json), ...((options && options.headers) || {}) },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || res.statusText;
      throw new Error(msg || "API " + res.status);
    }
    return data;
  }

  function fileUrl(id) {
    return base() + "/api/photos/" + id + "/file";
  }

  function attachBlobUrl(photo) {
    if (!photo || !photo.id) return photo;
    photo.url = fileUrl(photo.id);
    return photo;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result);
        const comma = s.indexOf(",");
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  const Api = {
    enabled() {
      return !!(cfg().apiBase && String(cfg().apiBase).trim());
    },

    async health() {
      return req("/api/health");
    },

    async list() {
      const data = await req("/api/photos");
      return (data.photos || []).map(attachBlobUrl);
    },

    async get(id) {
      const data = await req("/api/photos/" + encodeURIComponent(id));
      return attachBlobUrl(data.photo);
    },

    async create(file, meta) {
      // file 可以是 File/Blob
      const dataBase64 = await blobToBase64(file);
      const payload = {
        title: meta.title,
        place: meta.place,
        note: meta.note,
        takenAt: meta.takenAt,
        favorite: !!meta.favorite,
        mime: (file && file.type) || meta.mime || "image/jpeg",
        width: meta.width || 0,
        height: meta.height || 0,
        dataBase64,
      };
      const data = await req("/api/photos", {
        method: "POST",
        json: true,
        body: JSON.stringify(payload),
      });
      return attachBlobUrl(data.photo);
    },

    async update(id, patch) {
      const data = await req("/api/photos/" + encodeURIComponent(id), {
        method: "PATCH",
        json: true,
        body: JSON.stringify(patch),
      });
      return attachBlobUrl(data.photo);
    },

    async remove(id) {
      await req("/api/photos/" + encodeURIComponent(id), { method: "DELETE" });
      return true;
    },
  };

  global.PhotoApi = Api;
})(window);
