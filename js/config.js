/**
 * PhotoMemory 配置
 * 留空 apiBase = 纯本地 IndexedDB
 * 填写后 = 双端云同步（网页 + 小程序共用）
 */
(function (global) {
  global.PhotoConfig = {
    // 例如 https://api.example.com  （不要末尾斜杠）
    apiBase: "",
    // 与 server 端 API_TOKEN 一致
    apiToken: "",
    // true 时优先云端；false 时本地优先（云端仅手动同步可后续扩展）
    preferCloud: true,
  };
})(window);
