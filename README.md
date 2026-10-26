# PhotoMemory · 私人影集

自用拍照记录站：本地上传、一屏翻阅、粒子切换、分享卡片。  
纯静态前端，照片保存在浏览器 IndexedDB（不上传服务器）。

## 本地预览

```bash
# 任意静态服务器均可，例如：
python -m http.server 8765
# 打开 http://127.0.0.1:8765
```

## 部署到 GitHub Pages

1. 推送本仓库到 GitHub  
2. 仓库 **Settings → Pages → Build and deployment**  
   - Source: `Deploy from a branch`  
   - Branch: `main` / `(root)`  
3. 保存后等待约 1 分钟，访问：  
   `https://<你的用户名>.github.io/<仓库名>/`

> 注意：清空浏览器站点数据会丢失影集，请自行备份重要照片。
