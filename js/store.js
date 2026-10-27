/**
 * PhotoMemory · IndexedDB 本地存储
 */
(function (global) {
  const DB_NAME = "photomemory";
  const DB_VERSION = 2;
  const STORE = "photos";
  const COL_STORE = "collections";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("takenAt", "takenAt");
          os.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(COL_STORE)) {
          db.createObjectStore(COL_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    });
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function uid() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function fileToBlob(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Blob([fr.result], { type: file.type || "image/jpeg" }));
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  function blobToUrl(blob) {
    return URL.createObjectURL(blob);
  }

  const cache = new Map(); // id -> { url, photo }

  function useCloud() {
    return !!(global.PhotoApi && PhotoApi.enabled() && global.PhotoConfig && PhotoConfig.preferCloud !== false);
  }

  const Store = {
    _db: null,
    mode: "local",

    async init() {
      this._db = await openDB();
      if (useCloud()) {
        try {
          await PhotoApi.health();
          this.mode = "cloud";
        } catch (e) {
          console.warn("云端不可用，回退本地", e);
          this.mode = "local";
        }
      } else {
        this.mode = "local";
      }
      return this;
    },

    async list() {
      if (this.mode === "cloud") {
        return PhotoApi.list();
      }
      const db = this._db;
      const tx = db.transaction(STORE, "readonly");
      const all = await reqToPromise(tx.objectStore(STORE).getAll());
      return all.sort((a, b) => {
        const ta = a.takenAt || a.createdAt || 0;
        const tb = b.takenAt || b.createdAt || 0;
        return tb - ta;
      });
    },

    async get(id) {
      if (this.mode === "cloud") {
        return PhotoApi.get(id);
      }
      const tx = this._db.transaction(STORE, "readonly");
      return reqToPromise(tx.objectStore(STORE).get(id));
    },

    async add(file, meta) {
      const blob = await fileToBlob(file);
      let info = {
        width: meta.width || 0,
        height: meta.height || 0,
        exif: meta.exif || null,
      };
      if (global.PhotoExif && (!info.width || !info.exif)) {
        try {
          const parsed = await PhotoExif.extractImageInfo(blob);
          info = {
            width: parsed.width || info.width,
            height: parsed.height || info.height,
            exif: parsed.exif || info.exif || null,
          };
        } catch (_) { /* keep meta */ }
      }
      let takenAt = meta.takenAt || (info.exif && info.exif.dateTime ? String(info.exif.dateTime).slice(0, 10).replace(/:/g, "-") : null) || new Date().toISOString().slice(0, 10);
      if (info.exif && info.exif.dateTime && !meta.takenAt) {
        const m = String(info.exif.dateTime).match(/^(\d{4}):(\d{2}):(\d{2})/);
        if (m) takenAt = `${m[1]}-${m[2]}-${m[3]}`;
      }

      if (this.mode === "cloud") {
        const remote = await PhotoApi.create(blob, {
          title: meta.title,
          place: meta.place,
          note: meta.note,
          takenAt,
          favorite: meta.favorite,
          width: info.width,
          height: info.height,
          mime: blob.type || "image/jpeg",
        });
        return remote;
      }

      const photo = {
        id: uid(),
        title: (meta.title || "").trim() || "未命名一帧",
        place: (meta.place || "").trim(),
        note: (meta.note || "").trim(),
        takenAt,
        createdAt: Date.now(),
        width: info.width,
        height: info.height,
        mime: blob.type || "image/jpeg",
        size: blob.size,
        favorite: !!meta.favorite,
        exif: info.exif,
        collectionIds: Array.isArray(meta.collectionIds) ? meta.collectionIds.map(String) : [],
        blob,
      };
      const db = this._db;
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(photo);
      await txDone(tx);
      if (photo.collectionIds && photo.collectionIds.length) {
        for (const cid of photo.collectionIds) {
          try {
            const ctx = this._db.transaction(COL_STORE, "readonly");
            const col = await reqToPromise(ctx.objectStore(COL_STORE).get(cid));
            if (col && !col.photoIds.includes(photo.id)) {
              col.photoIds.push(photo.id);
              col.updatedAt = Date.now();
              const wtx = this._db.transaction(COL_STORE, "readwrite");
              wtx.objectStore(COL_STORE).put(col);
              await txDone(wtx);
            }
          } catch (_) {}
        }
      }
      const url = blobToUrl(photo.blob);
      cache.set(photo.id, { url, photo });
      return photo;
    },

    async remove(id) {
      if (this.mode === "cloud") {
        return PhotoApi.remove(id);
      }
      const db = this._db;
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      await txDone(tx);
      const c = cache.get(id);
      if (c) {
        URL.revokeObjectURL(c.url);
        cache.delete(id);
      }
    },

    async update(id, patch) {
      if (this.mode === "cloud") {
        return PhotoApi.update(id, patch);
      }
      const existing = await this.get(id);
      if (!existing) throw new Error("照片不存在");
      const next = {
        ...existing,
        title: patch.title != null ? String(patch.title).trim() || "未命名一帧" : existing.title,
        place: patch.place != null ? String(patch.place).trim() : existing.place,
        note: patch.note != null ? String(patch.note).trim() : existing.note,
        takenAt: patch.takenAt != null && patch.takenAt ? patch.takenAt : existing.takenAt,
        favorite: patch.favorite != null ? !!patch.favorite : existing.favorite,
        exif: patch.exif !== undefined ? patch.exif : existing.exif,
        width: patch.width != null ? patch.width : existing.width,
        height: patch.height != null ? patch.height : existing.height,
        collectionIds:
          patch.collectionIds !== undefined
            ? patch.collectionIds.map(String)
            : existing.collectionIds || [],
      };
      const db = this._db;
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(next);
      await txDone(tx);
      const c = cache.get(id);
      if (c) c.photo = next;
      return next;
    },

    /** 备份导入：按 id 覆盖或新建 */
    async putPhoto(photoLike) {
      let blob = photoLike.blob;
      let info = {
        width: photoLike.width || 0,
        height: photoLike.height || 0,
        exif: photoLike.exif || null,
        mime: photoLike.mime || (blob && blob.type) || "image/jpeg",
      };
      if (blob && global.PhotoExif) {
        try {
          const parsed = await PhotoExif.extractImageInfo(blob);
          info = {
            width: parsed.width || info.width,
            height: parsed.height || info.height,
            exif: info.exif || parsed.exif || null,
            mime: info.mime,
          };
        } catch (_) { /* ignore */ }
      }
      const photo = {
        id: photoLike.id || uid(),
        title: (photoLike.title || "").trim() || "未命名一帧",
        place: (photoLike.place || "").trim(),
        note: (photoLike.note || "").trim(),
        takenAt: photoLike.takenAt || new Date().toISOString().slice(0, 10),
        createdAt: photoLike.createdAt || Date.now(),
        width: info.width,
        height: info.height,
        mime: info.mime,
        size: photoLike.size != null ? photoLike.size : (blob ? blob.size : 0),
        favorite: !!photoLike.favorite,
        exif: info.exif,
        blob,
      };
      if (!photo.blob && !photo.url) throw new Error("缺少图片数据");
      if (this.mode === "cloud") {
        return PhotoApi.create(photo.blob, {
          title: photo.title,
          place: photo.place,
          note: photo.note,
          takenAt: photo.takenAt,
          favorite: photo.favorite,
          width: info.width,
          height: info.height,
          mime: info.mime,
        });
      }
      const db = this._db;
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(photo);
      await txDone(tx);
      const old = cache.get(photo.id);
      if (old && old.url) URL.revokeObjectURL(old.url);
      cache.set(photo.id, { url: blobToUrl(photo.blob), photo });
      return photo;
    },

    urlFor(photo) {
      if (!photo) return "";
      if (photo.url) return photo.url;
      if (photo.blob) {
        const hit = cache.get(photo.id);
        if (hit && hit.url) return hit.url;
        const url = blobToUrl(photo.blob);
        cache.set(photo.id, { url, photo });
        return url;
      }
      if (this.mode === "cloud" && photo.id && global.PhotoApi && PhotoApi.enabled()) {
        return (PhotoConfig.apiBase || "").replace(/\/+$/, "") + "/api/photos/" + photo.id + "/file";
      }
      return "";
    },

    /* ── 集合 ── */
    async listCollections() {
      if (this.mode === "cloud") return PhotoApi.listCollections();
      const tx = this._db.transaction(COL_STORE, "readonly");
      const all = await reqToPromise(tx.objectStore(COL_STORE).getAll());
      return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },

    async createCollection(name, note) {
      const n = String(name || "").trim();
      if (!n) throw new Error("请填写集名称");
      if (this.mode === "cloud") return PhotoApi.createCollection(n, note);
      const col = {
        id: "c_" + uid(),
        name: n.slice(0, 40),
        note: String(note || "").trim(),
        photoIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const tx = this._db.transaction(COL_STORE, "readwrite");
      tx.objectStore(COL_STORE).put(col);
      await txDone(tx);
      return col;
    },

    async updateCollection(id, patch) {
      if (this.mode === "cloud") return PhotoApi.updateCollection(id, patch);
      const tx = this._db.transaction(COL_STORE, "readonly");
      const col = await reqToPromise(tx.objectStore(COL_STORE).get(id));
      if (!col) throw new Error("集不存在");
      const next = { ...col, ...patch, updatedAt: Date.now() };
      if (patch.name != null) next.name = String(patch.name).trim().slice(0, 40) || col.name;
      const tx2 = this._db.transaction(COL_STORE, "readwrite");
      tx2.objectStore(COL_STORE).put(next);
      await txDone(tx2);
      if (Array.isArray(patch.photoIds)) {
        // 同步照片
        const photos = await this.list();
        for (const p of photos) {
          const ids = Array.isArray(p.collectionIds) ? p.collectionIds.slice() : [];
          const has = ids.includes(id);
          const should = patch.photoIds.includes(p.id);
          if (should && !has) ids.push(id);
          if (!should && has) {
            const i = ids.indexOf(id);
            if (i >= 0) ids.splice(i, 1);
          }
          if (should !== has) {
            await this.update(p.id, { collectionIds: ids });
          }
        }
      }
      return next;
    },

    async deleteCollection(id) {
      if (this.mode === "cloud") return PhotoApi.deleteCollection(id);
      const photos = await this.list();
      for (const p of photos) {
        if (Array.isArray(p.collectionIds) && p.collectionIds.includes(id)) {
          const ids = p.collectionIds.filter((x) => x !== id);
          await this.update(p.id, { collectionIds: ids });
        }
      }
      const tx = this._db.transaction(COL_STORE, "readwrite");
      tx.objectStore(COL_STORE).delete(id);
      await txDone(tx);
      return true;
    },

    async measure() {
      const photos = await this.list();
      let bytes = 0;
      for (const p of photos) bytes += p.size || 0;
      let quota = 0;
      let usage = 0;
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          quota = est.quota || 0;
          usage = est.usage || 0;
        }
      } catch (_) { /* ignore */ }
      return { count: photos.length, bytes, quota, usage };
    },
  };

  global.PhotoStore = Store;
})(window);
