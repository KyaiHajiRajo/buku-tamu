const db = require("../config/database");
const { withTransaction } = require("../config/database");
const { saveBase64Image, deletePhoto } = require("../utils/imageHelper");
const { sendWhatsAppMessage } = require("../utils/whatsapp");
const { buatKode } = require("../utils/kode");

// Huruf (termasuk beraksen), angka, spasi dan tanda baca umum pada nama
const NAMA_PATTERN = /^[\p{L}\p{M}\p{N} .,'’()\-/&]+$/u;

const cleanText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

// Get form buku tamu
const getForm = async (req, res) => {
  try {
    // Ambil data sekolah untuk dropdown
    const [sekolahList] = await db.query(
      "SELECT id, nama_sekolah FROM master_sekolah ORDER BY nama_sekolah ASC"
    );

    res.render("buku-tamu/form", {
      title: "Buku Tamu Digital - HUT Yayasan",
      sekolahList,
      success: req.query.success || null,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).render("error", {
      title: "Error",
      error: { message: "Terjadi kesalahan saat memuat halaman" },
    });
  }
};

// Validasi input form, return { data } atau { error }
const validateSubmission = (body) => {
  const sekolahId = Number(body.sekolah_id);
  const namaLengkap = cleanText(body.nama_lengkap);
  const otherInstansi = cleanText(body.other_instansi);
  const nomorWa = String(body.nomor_wa || "").replace(/\D/g, "");

  if (!Number.isInteger(sekolahId) || sekolahId <= 0) {
    return { error: "Asal sekolah harus dipilih!" };
  }
  if (namaLengkap.length < 2 || namaLengkap.length > 100) {
    return { error: "Nama lengkap harus 2-100 karakter!" };
  }
  if (!NAMA_PATTERN.test(namaLengkap)) {
    return { error: "Nama lengkap mengandung karakter yang tidak diizinkan!" };
  }
  if (otherInstansi.length > 100 || (otherInstansi && !NAMA_PATTERN.test(otherInstansi))) {
    return { error: "Nama instansi tidak valid (maksimal 100 karakter)!" };
  }
  if (nomorWa.length < 9 || nomorWa.length > 15) {
    return { error: "Nomor WhatsApp harus 9-15 digit!" };
  }
  if (!body.foto) {
    return { error: "Foto harus diambil!" };
  }

  return {
    data: {
      sekolahId,
      namaLengkap,
      otherInstansi: otherInstansi || null,
      nomorWa,
    },
  };
};

// Submit buku tamu
const submitForm = async (req, res) => {
  let fotoPath = null;

  try {
    const { data, error } = validateSubmission(req.body || {});
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const [sekolah] = await db.query("SELECT id FROM master_sekolah WHERE id = ?", [
      data.sekolahId,
    ]);
    if (sekolah.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Asal sekolah tidak ditemukan!",
      });
    }

    // Simpan foto hanya setelah semua data valid
    fotoPath = await saveBase64Image(req.body.foto);
    if (!fotoPath) {
      return res.status(400).json({
        success: false,
        message: "Foto tidak valid. Silakan ambil ulang foto (JPG/PNG, maks 3 MB).",
      });
    }

    // Insert + generate kode dalam satu transaksi
    const kode = await withTransaction(async (conn) => {
      const [result] = await conn.query(
        "INSERT INTO buku_tamu (sekolah_id, other_instansi, nama_lengkap, nomor_wa, foto) VALUES (?, ?, ?, ?, ?)",
        [data.sekolahId, data.otherInstansi, data.namaLengkap, data.nomorWa, fotoPath]
      );

      const newKode = buatKode(data.namaLengkap, result.insertId);
      await conn.query("UPDATE buku_tamu SET kode = ? WHERE id = ?", [
        newKode,
        result.insertId,
      ]);
      return newKode;
    });

    // Kirim pesan WhatsApp (non-blocking)
    // Jangan biarkan error WhatsApp menghentikan proses utama
    sendWhatsAppMessage(data.nomorWa, data.namaLengkap, kode)
      .then((result) => {
        if (result.success) {
          console.log(`✅ WhatsApp notification sent (${result.number})`);
        } else {
          console.warn(`⚠️ Failed to send WhatsApp: ${result.message}`);
        }
      })
      .catch((err) => {
        console.error(`❌ WhatsApp error: ${err.message}`);
      });

    res.json({
      success: true,
      message: "Terima kasih! Data Anda telah tersimpan.",
      kode: kode,
      nama_lengkap: data.namaLengkap,
    });
  } catch (error) {
    console.error("Error submit buku tamu:", error);
    // Jangan tinggalkan file yatim jika penyimpanan data gagal
    if (fotoPath) await deletePhoto(fotoPath);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat menyimpan data",
    });
  }
};

// Halaman sukses
const successPage = (req, res) => {
  const kode = /^[A-Z0-9]{1,15}$/.test(req.query.kode || "") ? req.query.kode : null;
  const nama = cleanText(req.query.nama).slice(0, 100) || null;

  res.render("buku-tamu/success", {
    title: "Terima Kasih - Buku Tamu Digital",
    kode: kode,
    nama_lengkap: nama,
  });
};

module.exports = {
  getForm,
  submitForm,
  successPage,
};
