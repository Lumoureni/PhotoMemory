const api = require("../../utils/api");

Page({
  data: {
    photos: [],
    query: "",
    filter: "all",
    loading: true,
    error: "",
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      let photos = await api.listPhotos();
      photos = photos.map((p) => ({
        ...p,
        thumb: api.fileUrl(p.id),
        dateText: api.formatDate(p.takenAt),
      }));
      this.setData({ photos, loading: false });
      this.setData({ shown: this.filtered() });
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || "加载失败，请检查 apiBase / 网络",
      });
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onQuery(e) {
    this.setData({ query: e.detail.value || "" });
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter });
  },

  filtered() {
    const { photos, query, filter } = this.data;
    let list = photos.slice();
    if (filter === "fav") list = list.filter((p) => p.favorite);
    const q = (query || "").trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.title, p.place, p.note, p.takenAt]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  },

  onFilterTap(e) {
    this.setData({ filter: e.currentTarget.dataset.filter }, () => {
      this.setData({ shown: this.filtered() });
    });
  },

  onViewData() {
    this.setData({ shown: this.filtered() });
  },

  openPhoto(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/viewer/viewer?id=" + id });
  },

  goUpload() {
    wx.switchTab({ url: "/pages/upload/upload" });
  },

  onShareAppMessage() {
    return {
      title: "PhotoMemory · 私人影集",
      path: "/pages/gallery/gallery",
    };
  },

  onShareTimeline() {
    return { title: "PhotoMemory · 私人影集" };
  },
});
