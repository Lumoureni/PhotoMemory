const app = getApp();

function base() {
  return String(app.globalData.apiBase || "").replace(/\/+$/, "");
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (app.globalData.apiToken) h["X-API-Token"] = app.globalData.apiToken;
  return h;
}

function request(path, options) {
  const url = base() + path;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: (options && options.method) || "GET",
      data: options && options.data,
      header: headers(),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.error) || "HTTP " + res.statusCode));
      },
      fail(err) {
        reject(new Error(err.errMsg || "网络错误"));
      },
    });
  });
}

function fileUrl(id) {
  return base() + "/api/photos/" + id + "/file";
}

function listPhotos() {
  return request("/api/photos").then((d) => d.photos || []);
}

function createPhoto(base64, meta) {
  return request("/api/photos", {
    method: "POST",
    data: {
      title: meta.title || "",
      place: meta.place || "",
      note: meta.note || "",
      takenAt: meta.takenAt || "",
      favorite: !!meta.favorite,
      collectionIds: meta.collectionIds || [],
      mime: meta.mime || "image/jpeg",
      width: meta.width || 0,
      height: meta.height || 0,
      dataBase64: base64,
    },
  }).then((d) => d.photo);
}

function updatePhoto(id, patch) {
  return request("/api/photos/" + id, { method: "PATCH", data: patch }).then((d) => d.photo);
}

function removePhoto(id) {
  return request("/api/photos/" + id, { method: "DELETE" });
}

function listCollections() {
  return request("/api/collections").then((d) => d.collections || []);
}

function createCollection(name, note) {
  return request("/api/collections", {
    method: "POST",
    data: { name, note: note || "" },
  }).then((d) => d.collection);
}

function updateCollection(id, patch) {
  return request("/api/collections/" + id, { method: "PATCH", data: patch }).then(
    (d) => d.collection
  );
}

function deleteCollection(id) {
  return request("/api/collections/" + id, { method: "DELETE" });
}

function formatDate(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
  return String(iso);
}

module.exports = {
  base,
  fileUrl,
  listPhotos,
  createPhoto,
  updatePhoto,
  removePhoto,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  formatDate,
};
