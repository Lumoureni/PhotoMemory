const api = require("../../utils/api");
const app = getApp();

Page({
  data: {
    apiBase: "",
    count: "-",
    bytes: "-",
  },

  onShow() {
    this.setData({ apiBase: app.globalData.apiBase });
    this.refresh();
  },

  async refresh() {
    try {
      const photos = await api.listPhotos();
      const bytes = photos.reduce((s, p) => s + (p.size || 0), 0);
      this.setData({
        count: photos.length + " 帧",
        bytes: (bytes / 1024 / 1024).toFixed(2) + " MB",
      });
    } catch (e) {
      this.setData({ count: "不可用", bytes: e.message || "" });
    }
  },

  onShareAppMessage() {
    return { title: "PhotoMemory · 私人影集", path: "/pages/gallery/gallery" };
  },
});
