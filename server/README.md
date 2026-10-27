# PhotoMemory 双端 API

零第三方依赖的 Node 服务，供 **网页** 与 **微信小程序** 共用。

## 本地启动

```bash
cd server
# 可选环境变量
# PORT=8787
# API_TOKEN=你的密钥
# DATA_DIR=./data
node index.js
```

默认 Token：`photomemory-dev-token`（请改成自己的）。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/photos` | 列表 |
| POST | `/api/photos` | 上传（JSON body） |
| GET | `/api/photos/:id` | 详情 |
| GET | `/api/photos/:id/file` | 原图 |
| PATCH | `/api/photos/:id` | 更新元数据/收藏 |
| DELETE | `/api/photos/:id` | 删除 |

鉴权：请求头 `X-API-Token: <token>` 或 `Authorization: Bearer <token>`。

### 上传 body 示例

```json
{
  "title": "黄昏",
  "place": "杭州",
  "note": "风很轻",
  "takenAt": "2026-01-02",
  "favorite": false,
  "mime": "image/jpeg",
  "width": 1200,
  "height": 800,
  "dataBase64": "...."
}
```

## 部署建议

1. 云服务器 / 宝塔：`node index.js` + pm2 守护  
2. 域名 + HTTPS（小程序必须 HTTPS）  
3. 微信小程序后台配置 request / uploadFile 合法域名  
4. 网页端在 `js/config.js` 填 `apiBase` 与 `apiToken`  

数据默认存在 `server/data/`（`db.json` + `files/`）。
