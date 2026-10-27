# PhotoMemory · 私人影集（网页 + 微信小程序）

双端共用一套数据：**上传 / 翻阅 / 收藏 / 编辑 / 分享**。

## 目录

| 路径 | 说明 |
|------|------|
| `index.html` + `css/` + `js/` | 网页端（GitHub Pages） |
| `server/` | 双端共用 API（Node 18+，零第三方依赖） |
| `miniprogram/` | 微信小程序 |

## 模式

1. **纯本地（默认）**  
   不配置 `js/config.js` 时，网页照片只存在浏览器 IndexedDB。

2. **双端云同步**  
   部署 `server/`，网页与小程序都填 `apiBase` + `apiToken`，数据落在服务器。

## 一、启动服务端

```bash
cd server
API_TOKEN=请改成强随机字符串 node index.js
```

详见 `server/README.md`。公网请加 **HTTPS**（小程序强制）。

## 二、网页端接云

编辑 `js/config.js`：

```js
apiBase: "https://你的域名",
apiToken: "与服务端一致",
preferCloud: true,
```

刷新网页；「关于」页会显示当前模式。

## 三、微信小程序

1. 用微信开发者工具导入 `miniprogram/`  
2. 修改 `miniprogram/app.js`：

```js
apiBase: "https://你的域名",
apiToken: "与服务端一致",
```

3. 小程序后台 → 开发管理 → 服务器域名：  
   - request 合法域名：`https://你的域名`  
4. 真机预览需 HTTPS 且域名已备案（或开发工具勾选「不校验合法域名」）

能力：
- **影集**：网格、搜索、收藏筛选、下拉刷新  
- **入藏**：相册/拍照上传  
- **查看**：上一张/下一张、收藏、编辑、移出、**分享给朋友 / 朋友圈**  
- **关于**：服务状态与用量  

## 四、网页静态部署

与之前相同：GitHub Pages 托管根目录静态文件。  
云同步模式下，Pages 只承载前端，数据在你的 API。

## 安全提示

- `API_TOKEN` 当作密码，不要提交到公开仓库的真实值  
- 服务端目录 `server/data/` 含原图与元数据，注意备份与权限  
- 个人自用可加 IP 白名单 / Nginx Basic Auth  

## 本地纯前端预览

```bash
python -m http.server 8765
# http://127.0.0.1:8765
```
