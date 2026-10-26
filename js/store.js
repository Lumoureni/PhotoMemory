/**
 * PhotoMemory · IndexedDB 本地存储
 */
(function (global) {
  const DB_NAME = "photomemory";
  const DB_VERSION = 1;
  const STORE = "photos";

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

  const Store = {
    _db: null,

    async init() {
      this._db = await openDB();
      return this;
    },

    async list() {
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
      const tx = this._db.transaction(STORE, "readonly");
      return reqToPromise(tx.objectStore(STORE).get(id));
    },

    async add(file, meta) {
      const blob = await fileToBlob(file);
      const photo = {
        id: uid(),
        title: (meta.title || "").trim() || "未命名一帧",
        place: (meta.place || "").trim(),
        note: (meta.note || "").trim(),
        takenAt: meta.takenAt || new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
        width: meta.width || 0,
        height: meta.height || 0,
        mime: blob.type || "image/jpeg",
        size: blob.size,
        blob,
      };
      const db = this._db;
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(photo);
      await txDone(tx);
      const url = blobToUrl(photo.blob);
      cache.set(photo.id, { url, photo });
      return photo;
    },

    async remove(id) {
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
      const existing = await this.get(id);
      if (!existing) throw new Error("照片不存在");
      const next = {
        ...existing,
        title: patch.title != null ? String(patch.title).trim() || "未命名一帧" : existing.title,
        place: patch.place != null ? String(patch.place).trim() : existing.place,
        note: patch.note != null ? String(patch.note).trim() : existing.note,
        takenAt: patch.takenAt != null && patch.takenAt ? patch.takenAt : existing.takenAt,
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
      const photo = {
        id: photoLike.id || uid(),
        title: (photoLike.title || "").trim() || "未命名一帧",
        place: (photoLike.place || "").trim(),
        note: (photoLike.note || "").trim(),
        takenAt: photoLike.takenAt || new Date().toISOString().slice(0, 10),
        createdAt: photoLike.createdAt || Date.now(),
        width: photoLike.width || 0,
        height: photoLike.height || 0,
        mime: photoLike.mime || (photoLike.blob && photoLike.blob.type) || "image/jpeg",
        size: photoLike.size != null ? photoLike.size : (photoLike.blob ? photoLike.blob.size : 0),
        blob: photoLike.blob,
      };
      if (!photo.blob) throw new Error("缺少图片数据");
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
      if (!photo || !photo.blob) return "";
      const hit = cache.get(photo.id);
      if (hit && hit.url) return hit.url;
      const url = blobToUrl(photo.blob);
      cache.set(photo.id, { url, photo });
      return url;
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
