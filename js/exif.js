/**
 * PhotoMemory · 轻量 EXIF / 图像信息解析（JPEG 主路径）
 */
(function (global) {
  const TAGS = {
    0x010f: "Make",
    0x0110: "Model",
    0x0112: "Orientation",
    0x011a: "XResolution",
    0x011b: "YResolution",
    0x0128: "ResolutionUnit",
    0x0131: "Software",
    0x0132: "DateTime",
    0x013b: "Artist",
    0x8298: "Copyright",
    0x8769: "ExifIFDPointer",
    0x8825: "GPSInfoIFDPointer",
    0x9003: "DateTimeOriginal",
    0x9004: "DateTimeDigitized",
    0x920a: "FocalLength",
    0x9286: "UserComment",
    0xa001: "ColorSpace",
    0xa002: "PixelXDimension",
    0xa003: "PixelYDimension",
    0xa434: "LensModel",
    0xa433: "LensMake",
    0x829d: "FNumber",
    0x8827: "ISO",
    0x9201: "ShutterSpeedValue",
    0x9202: "ApertureValue",
    0x9203: "BrightnessValue",
    0x9204: "ExposureBiasValue",
    0x9205: "MaxApertureValue",
    0x9207: "MeteringMode",
    0x9208: "LightSource",
    0x9209: "Flash",
    0xa20e: "FocalPlaneXResolution",
    0xa20f: "FocalPlaneYResolution",
    0x0001: "GPSLatitudeRef",
    0x0002: "GPSLatitude",
    0x0003: "GPSLongitudeRef",
    0x0004: "GPSLongitude",
    0x0006: "GPSAltitude",
  };

  function readUint16(view, offset, little) {
    return view.getUint16(offset, little);
  }
  function readUint32(view, offset, little) {
    return view.getUint32(offset, little);
  }

  function formatRational(view, offset, little) {
    const num = readUint32(view, offset, little);
    const den = readUint32(view, offset + 4, little);
    if (!den) return null;
    return { num, den, value: num / den };
  }

  function readAscii(view, offset, length) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    let s = "";
    for (let i = 0; i < length; i++) {
      const c = bytes[i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }

  function parseIfd(view, start, little, maxEntries, tiffBase) {
    const result = {};
    if (start < 0 || start + 2 > view.byteLength) return result;
    const count = readUint16(view, start, little);
    const n = Math.min(count, maxEntries || 80);
    for (let i = 0; i < n; i++) {
      const entry = start + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const tag = readUint16(view, entry, little);
      const type = readUint16(view, entry + 2, little);
      const countV = readUint32(view, entry + 4, little);
      const valueOff = entry + 8;
      let value = null;

      const byteLen = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
      const total = byteLen * countV;
      let dataOffset = valueOff;
      if (total > 4) {
        // TIFF 内偏移相对于 TIFF 头
        const rel = readUint32(view, valueOff, little);
        dataOffset = (tiffBase != null ? tiffBase : 0) + rel;
      }
      if (dataOffset < 0 || dataOffset + Math.min(total, 1) > view.byteLength) continue;

      try {
        if (type === 2) {
          value = readAscii(view, dataOffset, Math.min(countV, 128));
        } else if (type === 3) {
          if (countV === 1) value = readUint16(view, dataOffset, little);
          else {
            value = [];
            for (let k = 0; k < Math.min(countV, 8); k++)
              value.push(readUint16(view, dataOffset + k * 2, little));
          }
        } else if (type === 4) {
          if (countV === 1) value = readUint32(view, dataOffset, little);
          else {
            value = [];
            for (let k = 0; k < Math.min(countV, 8); k++)
              value.push(readUint32(view, dataOffset + k * 4, little));
          }
        } else if (type === 5) {
          const r = formatRational(view, dataOffset, little);
          if (countV === 1) value = r;
          else {
            value = [];
            for (let k = 0; k < Math.min(countV, 4); k++)
              value.push(formatRational(view, dataOffset + k * 8, little));
          }
        } else if (type === 1 || type === 7) {
          if (countV === 1) value = view.getUint8(dataOffset);
          else value = readUint32(view, valueOff, little);
        } else if (type === 10) {
          value = formatRational(view, dataOffset, little);
        }
      } catch (_) {
        value = null;
      }
      result[TAGS[tag] || "tag_0x" + tag.toString(16)] = value;
    }
    return result;
  }

  function degToDec(rationalArr, ref) {
    if (!Array.isArray(rationalArr) || rationalArr.length < 3) return null;
    const d = rationalArr[0].value + rationalArr[1].value / 60 + rationalArr[2].value / 3600;
    const sign = ref === "S" || ref === "W" ? -1 : 1;
    return +(sign * d).toFixed(6);
  }

  function parseExifFromBuffer(buffer) {
    const buf = new Uint8Array(buffer);
    // JPEG?
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null;
    let offset = 2;
    let tiff = -1;
    while (offset + 4 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) break; // SOS
      const size = (buf[offset + 2] << 8) | buf[offset + 3];
      if (marker === 0xe1 && size > 8) {
        const head = String.fromCharCode.apply(null, buf.subarray(offset + 4, offset + 10));
        if (head === "Exif\0\0") {
          tiff = offset + 10;
          break;
        }
      }
      offset += 2 + size;
    }
    if (tiff < 0) return null;

    const view = new DataView(buffer);
    const byte1 = buf[tiff];
    const byte2 = buf[tiff + 1];
    let little = false;
    if (byte1 === 0x49 && byte2 === 0x49) little = true;
    else if (byte1 === 0x4d && byte2 === 0x4d) little = false;
    else return null;
    const magic = readUint16(view, tiff + 2, little);
    if (magic !== 42) return null;

    const ifd0 = readUint32(view, tiff + 4, little);
    const ifd0Off = tiff + ifd0;
    const tags0 = parseIfd(view, ifd0Off, little, 64, tiff);

    let exif = {};
    if (tags0.ExifIFDPointer != null) {
      exif = parseIfd(view, tiff + tags0.ExifIFDPointer, little, 80, tiff);
    }
    let gps = {};
    if (tags0.GPSInfoIFDPointer != null) {
      gps = parseIfd(view, tiff + tags0.GPSInfoIFDPointer, little, 32, tiff);
    }

    const lat = degToDec(gps.GPSLatitude, gps.GPSLatitudeRef);
    const lon = degToDec(gps.GPSLongitude, gps.GPSLongitudeRef);

    const out = {
      make: tags0.Make || null,
      model: tags0.Model || null,
      software: tags0.Software || null,
      artist: tags0.Artist || null,
      dateTime: exif.DateTimeOriginal || tags0.DateTime || exif.DateTimeDigitized || null,
      orientation: tags0.Orientation || null,
      lens: exif.LensModel || null,
      lensMake: exif.LensMake || null,
      fnumber: exif.FNumber && exif.FNumber.value != null ? +exif.FNumber.value.toFixed(2) : null,
      iso: Array.isArray(exif.ISO) ? exif.ISO[0] : exif.ISO || null,
      exposureTime: null,
      focalLength: exif.FocalLength && exif.FocalLength.value != null ? +exif.FocalLength.value.toFixed(1) : null,
      exposureBias:
        exif.ExposureBiasValue && exif.ExposureBiasValue.value != null
          ? +exif.ExposureBiasValue.value.toFixed(2)
          : null,
      meteringMode: exif.MeteringMode != null ? exif.MeteringMode : null,
      flash: exif.Flash != null ? exif.Flash : null,
      colorSpace: exif.ColorSpace != null ? exif.ColorSpace : null,
      gps: lat != null && lon != null ? { lat, lon } : null,
    };

    if (exif.ExposureTime) {
      if (exif.ExposureTime.value != null) {
        const v = exif.ExposureTime.value;
        out.exposureTime = v >= 1 ? v.toFixed(1) + "s" : "1/" + Math.round(1 / v) + "s";
      }
    } else if (exif.ShutterSpeedValue && exif.ShutterSpeedValue.value != null) {
      const v = Math.pow(2, exif.ShutterSpeedValue.value);
      out.exposureTime = v >= 1 ? v.toFixed(1) + "s" : "1/" + Math.round(1 / v) + "s";
    }

    // 去掉全空
    Object.keys(out).forEach((k) => {
      if (out[k] == null || out[k] === "") delete out[k];
    });
    return Object.keys(out).length ? out : null;
  }

  async function extractImageInfo(blob) {
    const info = {
      width: 0,
      height: 0,
      mime: blob.type || "image/jpeg",
      size: blob.size,
      exif: null,
    };
    // 用 Image 读尺寸
    try {
      const url = URL.createObjectURL(blob);
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      info.width = img.naturalWidth;
      info.height = img.naturalHeight;
      URL.revokeObjectURL(url);
    } catch (_) { /* ignore */ }

    // EXIF：仅 JPEG 读头部足够
    try {
      const mime = info.mime.toLowerCase();
      if (mime.includes("jpeg") || mime.includes("jpg") || blob.type === "") {
        const headSize = Math.min(blob.size, 256 * 1024);
        const slice = blob.slice(0, headSize);
        const ab = await slice.arrayBuffer();
        info.exif = parseExifFromBuffer(ab);
      }
    } catch (_) {
      info.exif = null;
    }
    return info;
  }

  function formatExifForDisplay(photo) {
    const rows = [];
    const add = (label, value) => {
      if (value == null || value === "") return;
      rows.push({ label, value: String(value) });
    };
    add("相机", [photo.exif && photo.exif.make, photo.exif && photo.exif.model].filter(Boolean).join(" "));
    add("镜头", photo.exif && (photo.exif.lens || photo.exif.lensMake));
    add("拍摄时间", photo.exif && photo.exif.dateTime);
    add("光圈", photo.exif && photo.exif.fnumber ? "f/" + photo.exif.fnumber : null);
    add("快门", photo.exif && photo.exif.exposureTime);
    add("ISO", photo.exif && photo.exif.iso);
    add("焦距", photo.exif && photo.exif.focalLength ? photo.exif.focalLength + "mm" : null);
    add("曝光补偿", photo.exif && photo.exif.exposureBias != null ? photo.exif.exposureBias + " EV" : null);
    add("测光", photo.exif && photo.exif.meteringMode);
    add("闪光灯", photo.exif && photo.exif.flash != null ? (photo.exif.flash ? "开/曾用" : "关") : null);
    add("软件", photo.exif && photo.exif.software);
    add("作者", photo.exif && photo.exif.artist);
    if (photo.exif && photo.exif.gps) {
      add("GPS", `${photo.exif.gps.lat}, ${photo.exif.gps.lon}`);
    }
    return rows;
  }

  global.PhotoExif = { extractImageInfo, parseExifFromBuffer, formatExifForDisplay };
})(window);
