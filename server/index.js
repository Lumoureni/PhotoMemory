/**
 * PhotoMemory 双端 API（零第三方依赖）
 * Node 18+ 运行：node server/index.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const FILES_DIR = path.join(DATA_DIR, "files");
const DB_FILE = path.join(DATA_DIR, "db.json");
const API_TOKEN = process.env.API_TOKEN || "photomemory-dev-token";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim());

fs.mkdirSync(FILES_DIR, { recursive: true });

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return { photos: [] };
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    if (!Array.isArray(db.photos)) db.photos = [];
    return db;
  } catch (_) {
    return { photos: [] };
  }
}

function saveDb(db) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function uid() {
  return "p_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Token, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  });
  res.end(body);
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function authOk(req) {
  if (!API_TOKEN) return true;
  const h = req.headers["x-api-token"] || "";
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return h === API_TOKEN || bearer === API_TOKEN;
}

function publicPhoto(p) {
  return {
    id: p.id,
    title: p.title,
    place: p.place,
    note: p.note,
    takenAt: p.takenAt,
    createdAt: p.createdAt,
    width: p.width,
    height: p.height,
    mime: p.mime,
    size: p.size,
    favorite: !!p.favorite,
    file: `/api/photos/${p.id}/file`,
  };
}

function extFromMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  return ".jpg";
}

function sortPhotos(list) {
  return list.slice().sort((a, b) => {
    const ta = a.takenAt || a.createdAt || 0;
    const tb = b.takenAt || b.createdAt || 0;
    return String(tb).localeCompare(String(ta)) || b.createdAt - a.createdAt;
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Token, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    });
    res.end();
    return;
  }

  try {
    // 健康检查（无需鉴权）
    if (pathname === "/api/health") {
      return json(res, 200, { ok: true, app: "PhotoMemory", time: Date.now() });
    }

    if (!authOk(req)) {
      return json(res, 401, { error: "unauthorized" });
    }

    const db = loadDb();

    // 列表
    if (pathname === "/api/photos" && req.method === "GET") {
      return json(res, 200, { photos: sortPhotos(db.photos).map(publicPhoto) });
    }

    // 上传
    if (pathname === "/api/photos" && req.method === "POST") {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8") || "{}");
      if (!body.dataBase64) return json(res, 400, { error: "dataBase64 required" });
      const b64 = String(body.dataBase64).replace(/^data:[^;]+;base64,/, "");
      const bin = Buffer.from(b64, "base64");
      if (!bin.length) return json(res, 400, { error: "empty image" });

      const id = uid();
      const mime = body.mime || "image/jpeg";
      const fileRel = id + extFromMime(mime);
      const fileAbs = path.join(FILES_DIR, fileRel);
      fs.writeFileSync(fileAbs, bin);

      const photo = {
        id,
        title: (body.title || "").trim() || "未命名一帧",
        place: (body.place || "").trim(),
        note: (body.note || "").trim(),
        takenAt: body.takenAt || new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
        width: body.width || 0,
        height: body.height || 0,
        mime,
        size: bin.length,
        favorite: !!body.favorite,
        file: fileRel,
      };
      db.photos.push(photo);
      saveDb(db);
      return json(res, 201, { photo: publicPhoto(photo) });
    }

    // 单条 / 更新 / 删除
    const m = pathname.match(/^\/api\/photos\/([^/]+)(\/file)?$/);
    if (m) {
      const id = m[1];
      const isFile = !!m[2];
      const idx = db.photos.findIndex((p) => p.id === id);
      const photo = idx >= 0 ? db.photos[idx] : null;

      if (isFile) {
        if (!photo) return json(res, 404, { error: "not found" });
        const abs = path.join(FILES_DIR, photo.file);
        if (!fs.existsSync(abs)) return json(res, 404, { error: "file missing" });
        const data = fs.readFileSync(abs);
        res.writeHead(200, {
          "Content-Type": photo.mime || "image/jpeg",
          "Content-Length": data.length,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(data);
      }

      if (!photo) return json(res, 404, { error: "not found" });

      if (req.method === "GET") {
        return json(res, 200, { photo: publicPhoto(photo) });
      }

      if (req.method === "PATCH") {
        const raw = await readBody(req, 64 * 1024);
        const body = JSON.parse(raw.toString("utf8") || "{}");
        if (body.title != null) photo.title = String(body.title).trim() || "未命名一帧";
        if (body.place != null) photo.place = String(body.place).trim();
        if (body.note != null) photo.note = String(body.note).trim();
        if (body.takenAt != null && body.takenAt) photo.takenAt = body.takenAt;
        if (body.favorite != null) photo.favorite = !!body.favorite;
        if (body.width != null) photo.width = body.width;
        if (body.height != null) photo.height = body.height;
        db.photos[idx] = photo;
        saveDb(db);
        return json(res, 200, { photo: publicPhoto(photo) });
      }

      if (req.method === "DELETE") {
        const abs = path.join(FILES_DIR, photo.file);
        try {
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (_) {}
        db.photos.splice(idx, 1);
        saveDb(db);
        return json(res, 200, { ok: true });
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message || "server error" });
  }
});

server.listen(PORT, () => {
  console.log(`PhotoMemory API  http://127.0.0.1:${PORT}`);
  console.log(`Token: ${API_TOKEN}`);
  console.log(`Data:  ${DATA_DIR}`);
});
