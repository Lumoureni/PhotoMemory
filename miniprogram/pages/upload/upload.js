const api = require("../../utils/api");

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

Page({
  data: {
    tempPath: "",
    width: 0,
    height: 0,
    title: "",
    place: "",
    note: "",
    takenAt: "",
    saving: false,
  },

  onLoad() {
    this.setData({ takenAt: today() });
  },

  choose() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({
          tempPath: f.tempFilePath,
          width: f.width || 0,
          height: f.height || 0,
        });
      },
    });
  },

  clear() {
    this.setData({ tempPath: "" });
  },

  onTitle(e) {
    this.setData({ title: e.detail.value });
  },
  onPlace(e) {
    this.setData({ place: e.detail.value });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  onDate(e) {
    this.setData({ takenAt: e.detail.value });
  },

  async save() {
    const { tempPath, title, place, note, takenAt, width, height } = this.data;
    if (!tempPath) {
      wx.showToast({ title: "请先选择照片", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const fs = wx.getFileSystemManager();
      const base64 = await new Promise((resolve, reject) => {
        fs.readFile({
          filePath: tempPath,
          encoding: "base64",
          success: (res) => resolve(res.data),
          fail: reject,
        });
      });
      await api.createPhoto(base64, {
        title,
        place,
        note,
        takenAt,
        width,
        height,
        mime: "image/jpeg",
      });
      wx.showToast({ title: "已入藏", icon: "success" });
      this.setData({
        tempPath: "",
        title: "",
        place: "",
        note: "",
        takenAt: today(),
      });
      setTimeout(() => wx.switchTab({ url: "/pages/gallery/gallery" }), 500);
    } catch (e) {
      wx.showToast({ title: e.message || "入藏失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  onShareAppMessage() {
    return { title: "PhotoMemory · 入藏一帧记忆", path: "/pages/upload/upload" };
  },
});
