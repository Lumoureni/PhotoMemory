/**
 * PhotoMemory · ZIP 备份（store 模式，无第三方依赖）
 * 导出：photos.json + images/<id>.<ext>
 * 导入：解析同结构 ZIP
 */
(function (global) {
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();

  function crc32(buf) {
    let c;
    const table = crc32.table;
    if (!table) {
      crc32.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc32.table[n] = c >>> 0;
      }
    }
    const t = crc32.table;
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    return [n & 0xff, (n >>> 8) & 0xff];
  }
  function u32(n) {
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  }

  function dosDateTime(date) {
    const d = date || new Date();
    const time =
      ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
    const day = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
    return { time, date: day };
  }

  /** entries: [{ name: string, data: Uint8Array }] → Blob */
  function createZip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosDateTime(new Date());

    for (const entry of entries) {
      const nameBytes = ENC.encode(entry.name);
      const data = entry.data;
      const crc = crc32(data);
      const size = data.length;
      const local = [
        ...u32(0x04034b50),
        ...u16(20),
        ...u16(0),
        ...u16(0), // store
        ...u16(time),
        ...u16(date),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(nameBytes.length),
        ...u16(0),
      ];
      parts.push(new Uint8Array(local), nameBytes, data);
      central.push({ nameBytes, crc, size, offset, time, date });
      offset += local.length + nameBytes.length + size;
    }

    const centralStart = offset;
    const centralParts = [];
    for (const c of central) {
      const rec = [
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(c.time),
        ...u16(c.date),
        ...u32(c.crc),
        ...u32(c.size),
        ...u32(c.size),
        ...u16(c.nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(c.offset),
      ];
      centralParts.push(new Uint8Array(rec), c.nameBytes);
      offset += rec.length + c.nameBytes.length;
    }

    const eocd = new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(central.length),
      ...u16(central.length),
      ...u32(offset - centralStart),
      ...u32(centralStart),
      ...u16(0),
    ]);

    return new Blob([...parts, ...centralParts, eocd], { type: "application/zip" });
  }

  /** ArrayBuffer → [{ name, data: Uint8Array }] */
  async function readZip(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    // 找 EOCD
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("不是有效的 ZIP 备份");

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const entries = [];

    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOff = view.getUint32(ptr + 42, true);
      const name = DEC.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;

      // local header
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) {
        data = raw.slice();
      } else if (method === 8) {
        data = await inflateRaw(raw);
      } else {
        throw new Error("不支持的压缩方式：" + method);
      }
      entries.push({ name, data });
    }
    return entries;
  }

  async function inflateRaw(raw) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解压，请用较新版本浏览器导入");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function deflateRaw(raw) {
    if (typeof CompressionStream === "undefined") {
      return null; // 回退 store
    }
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([raw]).stream().pipeThrough(cs);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * 导出影集 ZIP
   * photos: PhotoStore 记录数组
   */
  async function exportArchive(photos) {
    const meta = photos.map((p) => ({
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
      file: `images/${p.id}${extFromMime(p.mime)}`,
    }));

    const manifest = {
      app: "PhotoMemory",
      version: 1,
      exportedAt: new Date().toISOString(),
      count: meta.length,
      photos: meta,
    };

    const entries = [
      { name: "photos.json", data: ENC.encode(JSON.stringify(manifest, null, 2)) },
    ];

    for (const p of photos) {
      const ab = await p.blob.arrayBuffer();
      entries.push({
        name: `images/${p.id}${extFromMime(p.mime)}`,
        data: new Uint8Array(ab),
      });
    }

    return createZip(entries);
  }

  function extFromMime(mime) {
    const m = (mime || "").toLowerCase();
    if (m.includes("png")) return ".png";
    if (m.includes("webp")) return ".webp";
    if (m.includes("gif")) return ".gif";
    if (m.includes("bmp")) return ".bmp";
    return ".jpg";
  }

  /**
   * 解析备份 ZIP → [{ meta, blob }]
   */
  async function parseArchive(fileOrBuffer) {
    const ab =
      fileOrBuffer instanceof ArrayBuffer
        ? fileOrBuffer
        : await (fileOrBuffer.arrayBuffer ? fileOrBuffer.arrayBuffer() : fileOrBuffer);
    const entries = await readZip(ab);
    const jsonEntry = entries.find((e) => e.name === "photos.json" || e.name.endsWith("/photos.json"));
    if (!jsonEntry) throw new Error("备份缺少 photos.json");
    const manifest = JSON.parse(DEC.decode(jsonEntry.data));
    if (!manifest || !Array.isArray(manifest.photos)) throw new Error("备份格式不正确");

    const byName = new Map(entries.map((e) => [e.name, e.data]));
    const out = [];
    for (const meta of manifest.photos) {
      const path = meta.file || `images/${meta.id}.jpg`;
      let data = byName.get(path);
      if (!data) {
        // 容错：按 id 前缀找
        const hit = entries.find((e) => e.name.includes(meta.id) && !e.name.endsWith(".json"));
        if (hit) data = hit.data;
      }
      if (!data) continue;
      const blob = new Blob([data], { type: meta.mime || "image/jpeg" });
      out.push({ meta, blob });
    }
    return { manifest, items: out };
  }

  global.PhotoBackup = { createZip, exportArchive, parseArchive };
})(window);
