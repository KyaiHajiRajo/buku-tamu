const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 MB setelah decode

// Tipe gambar yang diizinkan beserta signature (magic bytes) file-nya
const ALLOWED_TYPES = {
  "image/jpeg": { ext: "jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/jpg": { ext: "jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": {
    ext: "png",
    check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/webp": {
    ext: "webp",
    check: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
};

/**
 * Validasi data URL base64 gambar.
 * @returns {{buffer: Buffer, ext: string}|null} null jika tidak valid
 */
const parseImageDataUrl = (dataUrl, maxBytes = MAX_PHOTO_BYTES) => {
  if (typeof dataUrl !== "string") return null;

  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;

  const type = ALLOWED_TYPES[match[1]];
  if (!type) return null;

  // Cek perkiraan ukuran sebelum decode agar tidak membuang memori
  if ((match[2].length * 3) / 4 > maxBytes + 3) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length < 12 || buffer.length > maxBytes || !type.check(buffer)) {
    return null;
  }

  return { buffer, ext: type.ext };
};

/**
 * Simpan buffer gambar ke public/uploads dengan nama acak.
 * @returns {Promise<string>} path relatif, contoh: /uploads/123_abc.jpg
 */
const savePhoto = async ({ buffer, ext }) => {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
};

/**
 * Hapus file foto. Hanya file di dalam folder uploads yang bisa dihapus.
 */
const deletePhoto = async (relativePath) => {
  if (typeof relativePath !== "string" || !relativePath.startsWith("/uploads/")) {
    return;
  }
  const filename = path.basename(relativePath);
  if (!/^[\w.-]+$/.test(filename)) return;

  try {
    await fs.promises.unlink(path.join(UPLOAD_DIR, filename));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Gagal menghapus foto:", error.message);
    }
  }
};

/**
 * Validasi + simpan foto dari form tamu.
 * @returns {Promise<string|null>} path relatif atau null jika foto tidak valid
 */
const saveBase64Image = async (dataUrl) => {
  const image = parseImageDataUrl(dataUrl);
  if (!image) return null;
  return savePhoto(image);
};

/**
 * Dipakai migrasi foto lama (base64 di database) ke file.
 * Batas ukuran lebih longgar karena data lama belum di-resize.
 */
const decodeAndSaveBase64 = async (dataUrl) => {
  const image = parseImageDataUrl(dataUrl, 20 * 1024 * 1024);
  if (!image) return null;
  return savePhoto(image);
};

module.exports = {
  parseImageDataUrl,
  saveBase64Image,
  decodeAndSaveBase64,
  deletePhoto,
};
