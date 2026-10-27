const api = require("../../utils/api");

Page({
  data: {
    photos: [],
    collections: [],
    albumId: "",
    albumName: "全部",
    query: "",
    filter: "all",
    loading: true,
    error: "",
    shown: [],
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [photos, collections] = await Promise.all([
        api.listPhotos(),
        api.listCollections(),
      ]);
      const mapped = photos.map((p) => ({
        ...p,
        thumb: api.fileUrl(p.id),
        dateText: api.formatDate(p.takenAt),
      }));
      this.setData({ photos: mapped, collections, loading: false });
      this.applyFilter();
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || "加载失败，请检查 apiBase / 网络",
      });
    }
  },

  applyFilter() {
    const { photos, query, filter, albumId } = this.data;
    let list = photos.slice();
    if (filter === "fav") list = list.filter((p) => p.favorite);
    if (albumId === "none") {
      list = list.filter((p) => !(p.collectionIds && p.collectionIds.length));
    } else if (albumId) {
      list = list.filter((p) => p.collectionIds && p.collectionIds.indexOf(albumId) >= 0);
    }
    const q = (query || "").trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.title, p.place, p.note, p.takenAt].filter(Boolean).join(" ").toLowerCase().indexOf(q) >= 0
      );
    }
    const col = this.data.collections.find((c) => c.id === albumId);
    this.setData({
      shown: list,
      albumName: !albumId ? "全部" : albumId === "none" ? "未分类" : col ? col.name : "全部",
    });
  },

  onQuery(e) {
    this.setData({ query: e.detail.value || "" }, () => this.applyFilter());
  },

  onFilterTap(e) {
    this.setData({ filter: e.currentTarget.dataset.filter }, () => this.applyFilter());
  },

  onAlbumTap(e) {
    this.setData({ albumId: e.currentTarget.dataset.id || "" }, () => this.applyFilter());
  },

  async newAlbum() {
    const that = this;
    wx.showModal({
      title: "新建集",
      editable: true,
      placeholderText: "集名称，例如：2026 旅行",
      success: async (res) => {
        if (!res.confirm || !res.content || !res.content.trim()) return;
        try {
          const col = await api.createCollection(res.content.trim());
          await that.load();
          that.setData({ albumId: col.id }, () => that.applyFilter());
          wx.showToast({ title: "已创建", icon: "success" });
        } catch (e) {
          wx.showToast({ title: e.message || "失败", icon: "none" });
        }
      },
    });
  },

  async removeAlbum() {
    const { albumId, collections } = this.data;
    const col = collections.find((c) => c.id === albumId);
    if (!col) return;
    const r = await wx.showModal({
      title: "删除集",
      content: `删除「${col.name}」？照片不会被删除。`,
    });
    if (!r.confirm) return;
    try {
      await api.deleteCollection(col.id);
      this.setData({ albumId: "" });
      await this.load();
    } catch (e) {
      wx.showToast({ title: e.message || "失败", icon: "none" });
    }
  },

  openPhoto(e) {
    wx.navigateTo({ url: "/pages/viewer/viewer?id=" + e.currentTarget.dataset.id });
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    return { title: "PhotoMemory · 私人影集", path: "/pages/gallery/gallery" };
  },
});
