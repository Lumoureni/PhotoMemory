const api = require("../../utils/api");

Page({
  data: {
    photo: null,
    src: "",
    indexText: "",
    editing: false,
    form: { title: "", place: "", note: "", takenAt: "" },
    total: 0,
    index: 0,
    collections: [],
    checkedIds: [],
  },

  async onLoad(query) {
    this.id = query.id;
    await this.load();
  },

  async load() {
    try {
      const list = await api.listPhotos();
      const index = Math.max(0, list.findIndex((p) => p.id === this.id));
      this.list = list;
      const photo = list[index] || null;
      if (!photo) {
        wx.showToast({ title: "照片不存在", icon: "none" });
        return;
      }
      this.setData({
        photo,
        src: api.fileUrl(photo.id),
        index,
        total: list.length,
        indexText: `${String(index + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}`,
        form: {
          title: photo.title || "",
          place: photo.place || "",
          note: photo.note || "",
          takenAt: photo.takenAt || "",
        },
        checkedIds: (photo.collectionIds || []).slice(),
      });
      try {
        this.setData({ collections: await api.listCollections() });
      } catch (_) {}
      wx.setNavigationBarTitle({ title: photo.title || "查看" });
    } catch (e) {
      wx.showToast({ title: e.message || "加载失败", icon: "none" });
    }
  },

  async step(dir) {
    if (!this.list || !this.list.length) return;
    const next = (this.data.index + dir + this.list.length) % this.list.length;
    this.id = this.list[next].id;
    await this.load();
  },

  prev() {
    this.step(-1);
  },
  next() {
    this.step(1);
  },

  async toggleFav() {
    const { photo } = this.data;
    if (!photo) return;
    try {
      await api.updatePhoto(photo.id, { favorite: !photo.favorite });
      await this.load();
      wx.showToast({ title: photo.favorite ? "已取消收藏" : "已收藏", icon: "none" });
    } catch (e) {
      wx.showToast({ title: e.message || "失败", icon: "none" });
    }
  },

  openAssign() {
    const { photo, collections } = this.data;
    const names = collections.map((c) => {
      const on = (photo.collectionIds || []).indexOf(c.id) >= 0;
      return (on ? "✓ " : "□ ") + c.name;
    });
    if (!names.length) {
      wx.showModal({
        title: "还没有集",
        content: "请先在影集页「＋ 新建集」",
        showCancel: false,
      });
      return;
    }
    wx.showActionSheet({
      itemList: names.concat(["完成收纳"]),
      success: async (res) => {
        if (res.tapIndex >= collections.length) {
          // 完成 — 已逐项写入
          await this.load();
          return;
        }
        const col = collections[res.tapIndex];
        const ids = (photo.collectionIds || []).slice();
        const i = ids.indexOf(col.id);
        if (i >= 0) ids.splice(i, 1);
        else ids.push(col.id);
        await api.updatePhoto(photo.id, { collectionIds: ids });
        await this.load();
        wx.showToast({
          title: i >= 0 ? "已移出该集" : "已收入该集",
          icon: "none",
        });
      },
    });
  },

  startEdit() {
    this.setData({ editing: true });
  },
  cancelEdit() {
    this.setData({ editing: false });
  },
  onTitle(e) {
    this.setData({ "form.title": e.detail.value });
  },
  onPlace(e) {
    this.setData({ "form.place": e.detail.value });
  },
  onNote(e) {
    this.setData({ "form.note": e.detail.value });
  },
  onDate(e) {
    this.setData({ "form.takenAt": e.detail.value });
  },

  async saveEdit() {
    const { photo, form } = this.data;
    try {
      await api.updatePhoto(photo.id, {
        title: form.title,
        place: form.place,
        note: form.note,
        takenAt: form.takenAt,
      });
      this.setData({ editing: false });
      await this.load();
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.showToast({ title: e.message || "保存失败", icon: "none" });
    }
  },

  async remove() {
    const { photo } = this.data;
    const r = await wx.showModal({ title: "移出影集", content: "不可恢复，确定？" });
    if (!r.confirm) return;
    try {
      await api.removePhoto(photo.id);
      wx.navigateBack();
    } catch (e) {
      wx.showToast({ title: e.message || "删除失败", icon: "none" });
    }
  },

  preview() {
    if (this.data.src) {
      wx.previewImage({ urls: [this.data.src], current: this.data.src });
    }
  },

  onShareAppMessage() {
    const p = this.data.photo;
    return {
      title: p ? `分享一帧：${p.title}` : "PhotoMemory",
      path: "/pages/viewer/viewer?id=" + (p && p.id),
      imageUrl: this.data.src,
    };
  },

  onShareTimeline() {
    const p = this.data.photo;
    return {
      title: p ? p.title : "PhotoMemory",
      query: "id=" + (p && p.id),
      imageUrl: this.data.src,
    };
  },
});
