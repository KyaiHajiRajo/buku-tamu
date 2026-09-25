const db = require("../config/database");
const { withTransaction } = require("../config/database");
const bcrypt = require("bcrypt");
const xlsx = require("xlsx");
const { decodeAndSaveBase64, deletePhoto } = require("../utils/imageHelper");
const { buatKode } = require("../utils/kode");
const {
  getClientStatus,
  getQRCode,
  logoutClient,
} = require("../utils/whatsapp");

// Hash dummy agar waktu respons login sama walau username tidak ada
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

const PER_PAGE = 30;

// Parse id angka positif dari parameter, null jika tidak valid
const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Filter sekolah: "all" atau id angka
const parseSchoolFilter = (value) => parseId(value) || "all";

const renderLogin = (res, error = null) =>
  res.render("admin/login", {
    title: "Login Admin - Buku Tamu Digital",
    error,
  });

// GET Login page
const getLogin = (req, res) => {
  if (req.session.isAuthenticated) {
    return res.redirect("/admin/dashboard");
  }
  renderLogin(res);
};

// POST Login
const postLogin = async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    // Validasi input
    if (!username || !password) {
      return renderLogin(res, "Username dan password harus diisi!");
    }

    // Cari user di database - bisa pakai name ATAU whatsapp
    const [users] = await db.query(
      "SELECT id, name, whatsapp, password FROM super_admin WHERE name = ? OR whatsapp = ? LIMIT 1",
      [username, username]
    );

    const user = users[0];
    const isValidPassword = await bcrypt.compare(
      password.slice(0, 72),
      user ? user.password : DUMMY_HASH
    );

    if (!user || !isValidPassword) {
      return renderLogin(res, "Username atau password salah!");
    }

    // Buat session baru untuk mencegah session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error("Error regenerate session:", err);
        return renderLogin(res, "Terjadi kesalahan server. Silakan coba lagi.");
      }

      req.session.isAuthenticated = true;
      req.session.user = {
        id: user.id,
        name: user.name,
        whatsapp: user.whatsapp,
      };
      req.session.flashSuccess = "Login berhasil! Selamat datang kembali.";

      req.session.save(() => res.redirect("/admin/dashboard"));
    });
  } catch (error) {
    console.error("Error login:", error);
    renderLogin(res, "Terjadi kesalahan server. Silakan coba lagi.");
  }
};

// Logout
const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error logout:", err);
    }
    res.clearCookie(req.app.get("sessionCookieName"));
    res.redirect("/admin/login");
  });
};

// Dashboard
const getDashboard = async (req, res) => {
  try {
    const [[stats], [schoolStats], [recentGuests]] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM buku_tamu
            WHERE created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY) AS today,
          (SELECT COUNT(*) FROM buku_tamu) AS total,
          (SELECT COUNT(*) FROM master_sekolah) AS schools
      `),
      // Statistik per sekolah (jumlah tamu per sekolah)
      db.query(`
        SELECT
          ms.id,
          ms.nama_sekolah,
          COUNT(bt.id) as jumlah_tamu,
          MAX(bt.created_at) as last_visit
        FROM master_sekolah ms
        LEFT JOIN buku_tamu bt ON ms.id = bt.sekolah_id
        GROUP BY ms.id, ms.nama_sekolah
        ORDER BY jumlah_tamu DESC, ms.nama_sekolah ASC
      `),
      // Tamu terbaru (5 terakhir)
      db.query(`
        SELECT bt.id, bt.nama_lengkap, bt.nomor_wa, bt.kode,
               bt.other_instansi, bt.created_at, ms.nama_sekolah
        FROM buku_tamu bt
        LEFT JOIN master_sekolah ms ON bt.sekolah_id = ms.id
        ORDER BY bt.created_at DESC
        LIMIT 5
      `),
    ]);

    res.render("admin/dashboard", {
      title: "Dashboard Admin",
      currentPage: "dashboard",
      stats: {
        today: stats[0].today,
        total: stats[0].total,
        schools: stats[0].schools,
      },
      schoolStats,
      recentGuests,
    });
  } catch (error) {
    console.error("Error dashboard:", error);
    res.status(500).render("error", {
      title: "Error",
      error: { message: "Terjadi kesalahan saat memuat dashboard" },
    });
  }
};

// Master Sekolah - GET
const getMasterSekolah = async (req, res) => {
  try {
    const [schools] = await db.query(
      "SELECT * FROM master_sekolah ORDER BY nama_sekolah ASC"
    );

    res.render("admin/master-sekolah", {
      title: "Master Sekolah",
      currentPage: "master-sekolah",
      schools,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (error) {
    console.error("Error get master sekolah:", error);
    res.status(500).render("error", {
      title: "Error",
      error: { message: "Terjadi kesalahan saat memuat data sekolah" },
    });
  }
};

// Validasi nama sekolah dari form
const cleanNamaSekolah = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

// Master Sekolah - CREATE
const createSekolah = async (req, res) => {
  try {
    const namaSekolah = cleanNamaSekolah(req.body.nama_sekolah);

    if (!namaSekolah || namaSekolah.length > 150) {
      return res.redirect(
        "/admin/master-sekolah?error=Nama sekolah harus diisi (maksimal 150 karakter)"
      );
    }

    await db.query("INSERT INTO master_sekolah (nama_sekolah) VALUES (?)", [
      namaSekolah,
    ]);

    res.redirect(
      "/admin/master-sekolah?success=Data sekolah berhasil ditambahkan"
    );
  } catch (error) {
    console.error("Error create sekolah:", error);
    res.redirect(
      "/admin/master-sekolah?error=Terjadi kesalahan saat menambahkan data"
    );
  }
};

// Master Sekolah - UPDATE
const updateSekolah = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const namaSekolah = cleanNamaSekolah(req.body.nama_sekolah);

    if (!id || !namaSekolah || namaSekolah.length > 150) {
      return res.redirect(
        "/admin/master-sekolah?error=Nama sekolah harus diisi (maksimal 150 karakter)"
      );
    }

    await db.query("UPDATE master_sekolah SET nama_sekolah = ? WHERE id = ?", [
      namaSekolah,
      id,
    ]);

    res.redirect(
      "/admin/master-sekolah?success=Data sekolah berhasil diupdate"
    );
  } catch (error) {
    console.error("Error update sekolah:", error);
    res.redirect(
      "/admin/master-sekolah?error=Terjadi kesalahan saat mengupdate data"
    );
  }
};

// Master Sekolah - DELETE
const deleteSekolah = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.redirect("/admin/master-sekolah?error=Data tidak valid");
    }

    // Cek apakah ada tamu yang terdaftar dari sekolah ini
    const [guests] = await db.query(
      "SELECT COUNT(*) as count FROM buku_tamu WHERE sekolah_id = ?",
      [id]
    );

    if (guests[0].count > 0) {
      return res.redirect(
        "/admin/master-sekolah?error=Tidak dapat menghapus. Masih ada tamu terdaftar dari sekolah ini"
      );
    }

    await db.query("DELETE FROM master_sekolah WHERE id = ?", [id]);

    res.redirect("/admin/master-sekolah?success=Data sekolah berhasil dihapus");
  } catch (error) {
    console.error("Error delete sekolah:", error);
    res.redirect(
      "/admin/master-sekolah?error=Terjadi kesalahan saat menghapus data"
    );
  }
};

// Data Tamu - GET
const getDataTamu = async (req, res) => {
  try {
    const selectedSchool = parseSchoolFilter(req.query.sekolah);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = PER_PAGE;
    const offset = (page - 1) * limit;

    const whereClause = selectedSchool !== "all" ? " WHERE bt.sekolah_id = ?" : "";
    const filterParams = selectedSchool !== "all" ? [selectedSchool] : [];

    const [[schools], [countResult], [guests], [schoolStats], [checks]] =
      await Promise.all([
        // Semua sekolah untuk filter
        db.query("SELECT id, nama_sekolah FROM master_sekolah ORDER BY nama_sekolah ASC"),
        // Total data untuk pagination
        db.query(`SELECT COUNT(*) as total FROM buku_tamu bt${whereClause}`, filterParams),
        // Data per halaman
        db.query(
          `SELECT bt.id, bt.sekolah_id, bt.other_instansi, bt.nama_lengkap, bt.nomor_wa,
                  bt.foto, bt.kode, bt.created_at, ms.nama_sekolah
           FROM buku_tamu bt
           LEFT JOIN master_sekolah ms ON bt.sekolah_id = ms.id
           ${whereClause}
           ORDER BY bt.created_at DESC
           LIMIT ? OFFSET ?`,
          [...filterParams, limit, offset]
        ),
        // Statistik per sekolah
        db.query(`
          SELECT
            ms.id,
            ms.nama_sekolah,
            COUNT(bt.id) as total_tamu,
            COUNT(CASE WHEN bt.created_at >= CURDATE() THEN 1 END) as tamu_hari_ini,
            MAX(bt.created_at) as kunjungan_terakhir
          FROM master_sekolah ms
          LEFT JOIN buku_tamu bt ON ms.id = bt.sekolah_id
          GROUP BY ms.id, ms.nama_sekolah
          ORDER BY total_tamu DESC, ms.nama_sekolah ASC
        `),
        // Kondisi tombol generate kode & migrasi foto
        db.query(`
          SELECT
            COALESCE(SUM(kode IS NULL OR kode = ''), 0) AS count_without_kode,
            COALESCE(SUM(foto LIKE 'data:image%'), 0) AS count_base64_photos
          FROM buku_tamu
        `),
      ]);

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    res.render("admin/data-tamu", {
      title: "Data Tamu",
      // For sidebar active state
      currentPage: "data-tamu",
      currentPageName: "data-tamu",
      guests,
      schools,
      schoolStats,
      selectedSchool: String(selectedSchool),
      success: req.query.success || null,
      error: req.query.error || null,
      session: req.session,
      // Pagination data
      currentPageNumber: page,
      totalPages: totalPages,
      totalRecords: totalRecords,
      limit: limit,
      startRecord: totalRecords === 0 ? 0 : offset + 1,
      endRecord: Math.min(offset + limit, totalRecords),
      // Button states
      hasDataWithoutKode: Number(checks[0].count_without_kode) > 0,
      hasBase64Photos: Number(checks[0].count_base64_photos) > 0,
    });
  } catch (error) {
    console.error("Error get data tamu:", error);
    res.status(500).render("error", {
      title: "Error",
      error: { message: "Terjadi kesalahan saat memuat data tamu" },
    });
  }
};

// Data Tamu - DELETE
const deleteTamu = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.redirect("/admin/data-tamu?error=Data tidak valid");
    }

    // Hapus riwayat undian dulu agar tidak terhalang foreign key
    const foto = await withTransaction(async (conn) => {
      const [rows] = await conn.query("SELECT foto FROM buku_tamu WHERE id = ?", [id]);
      await conn.query("DELETE FROM wheel_spin WHERE tamu_id = ?", [id]);
      await conn.query("DELETE FROM buku_tamu WHERE id = ?", [id]);
      return rows[0] ? rows[0].foto : null;
    });

    await deletePhoto(foto);

    res.redirect("/admin/data-tamu?success=Data tamu berhasil dihapus");
  } catch (error) {
    console.error("Error delete tamu:", error);
    res.redirect(
      "/admin/data-tamu?error=Terjadi kesalahan saat menghapus data"
    );
  }
};

// Export Excel
const exportExcel = async (req, res) => {
  try {
    const selectedSchool = parseSchoolFilter(req.query.sekolah);

    let query = `
      SELECT
        bt.id,
        bt.kode,
        ms.nama_sekolah,
        bt.other_instansi,
        bt.nama_lengkap,
        bt.nomor_wa,
        bt.created_at
      FROM buku_tamu bt
      LEFT JOIN master_sekolah ms ON bt.sekolah_id = ms.id
    `;

    const params = [];
    let schoolName = "Semua_Sekolah";

    if (selectedSchool !== "all") {
      query += " WHERE bt.sekolah_id = ?";
      params.push(selectedSchool);

      const [schoolData] = await db.query(
        "SELECT nama_sekolah FROM master_sekolah WHERE id = ?",
        [selectedSchool]
      );
      if (schoolData.length > 0) {
        schoolName = schoolData[0].nama_sekolah.replace(/[^a-zA-Z0-9]/g, "_");
      }
    }

    query += " ORDER BY bt.created_at DESC";

    const [guests] = await db.query(query, params);

    const excelData = guests.map((guest, index) => ({
      No: index + 1,
      "Kode Tamu": guest.kode || "-",
      "Asal Sekolah": guest.nama_sekolah || "-",
      "Instansi Lain": guest.other_instansi || "-",
      "Nama Lengkap": guest.nama_lengkap,
      "Nomor WhatsApp": guest.nomor_wa,
      "Tanggal Daftar": new Date(guest.created_at).toLocaleString("id-ID", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(excelData);

    ws["!cols"] = [
      { wch: 5 }, // No
      { wch: 12 }, // Kode Tamu
      { wch: 30 }, // Asal Sekolah
      { wch: 30 }, // Instansi Lain
      { wch: 25 }, // Nama Lengkap
      { wch: 18 }, // Nomor WhatsApp
      { wch: 22 }, // Tanggal Daftar
    ];

    xlsx.utils.book_append_sheet(wb, ws, "Data Tamu");

    const excelBuffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const timestamp = new Date()
      .toISOString()
      .replace(/T/, "_")
      .replace(/\..+/, "")
      .replace(/:/g, "-");

    const filename =
      selectedSchool !== "all"
        ? `Data_Tamu_${schoolName}_${timestamp}.xlsx`
        : `Data_Tamu_${timestamp}.xlsx`;

    res.status(200);
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": excelBuffer.length,
      "Cache-Control": "no-store",
    });

    return res.end(excelBuffer);
  } catch (error) {
    console.error("Error export Excel:", error);
    return res.redirect(
      "/admin/data-tamu?error=Terjadi kesalahan saat export data"
    );
  }
};

// Get tamu yang belum punya kode (untuk modal generate kode)
const getTamuWithoutKode = async (req, res) => {
  try {
    const [tamu] = await db.query(
      `SELECT
        bt.id,
        bt.nama_lengkap,
        ms.nama_sekolah,
        bt.other_instansi,
        bt.created_at
      FROM buku_tamu bt
      LEFT JOIN master_sekolah ms ON bt.sekolah_id = ms.id
      WHERE bt.kode IS NULL OR bt.kode = ''
      ORDER BY bt.created_at DESC`
    );

    res.json({
      success: true,
      data: tamu,
    });
  } catch (error) {
    console.error("Error get tamu without kode:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data",
    });
  }
};

// Generate kode untuk tamu tertentu atau semua
const generateKode = async (req, res) => {
  try {
    const { tamuIds, autoGenerate } = req.body || {};

    let query;
    let params = [];

    if (autoGenerate === true) {
      query = `SELECT id, nama_lengkap FROM buku_tamu WHERE kode IS NULL OR kode = ''`;
    } else if (Array.isArray(tamuIds) && tamuIds.length > 0) {
      const ids = [...new Set(tamuIds.map(parseId).filter(Boolean))].slice(0, 1000);
      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "Data tidak valid" });
      }
      query = `SELECT id, nama_lengkap FROM buku_tamu WHERE id IN (?)`;
      params = [ids];
    } else {
      return res.status(400).json({
        success: false,
        message: "Tidak ada data yang dipilih",
      });
    }

    const [tamuList] = await db.query(query, params);

    if (tamuList.length === 0) {
      return res.json({
        success: true,
        message: "Tidak ada tamu yang perlu di-generate kode",
        updated: 0,
      });
    }

    await withTransaction(async (conn) => {
      for (const tamu of tamuList) {
        await conn.query("UPDATE buku_tamu SET kode = ? WHERE id = ?", [
          buatKode(tamu.nama_lengkap, tamu.id),
          tamu.id,
        ]);
      }
    });

    res.json({
      success: true,
      message: `Berhasil generate kode untuk ${tamuList.length} tamu`,
      updated: tamuList.length,
    });
  } catch (error) {
    console.error("Error generate kode:", error);
    res.status(500).json({
      success: false,
      message: "Gagal generate kode",
    });
  }
};

// Migration: Convert Base64 photos to files
const migratePhotos = async (req, res) => {
  try {
    // Ambil id saja dulu agar foto base64 besar tidak dimuat sekaligus
    const [guests] = await db.query(
      `SELECT id FROM buku_tamu WHERE foto LIKE 'data:image%'`
    );

    if (guests.length === 0) {
      return res.json({
        success: true,
        message: "Tidak ada foto yang perlu dimigrasi",
        migrated: 0,
        failed: 0,
        total: 0,
      });
    }

    let migratedCount = 0;
    const failedIds = [];

    for (const { id } of guests) {
      try {
        const [rows] = await db.query("SELECT foto FROM buku_tamu WHERE id = ?", [id]);
        const filePath = rows[0] ? await decodeAndSaveBase64(rows[0].foto) : null;

        if (filePath) {
          await db.query("UPDATE buku_tamu SET foto = ? WHERE id = ?", [filePath, id]);
          migratedCount++;
        } else {
          failedIds.push(id);
        }
      } catch (error) {
        failedIds.push(id);
        console.error(`Error migrating guest ID ${id}:`, error.message);
      }
    }

    res.json({
      success: true,
      message: `Migrasi selesai! Berhasil: ${migratedCount}, Gagal: ${failedIds.length}`,
      migrated: migratedCount,
      failed: failedIds.length,
      failedIds: failedIds,
      total: guests.length,
    });
  } catch (error) {
    console.error("Error in photo migration:", error);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat migrasi foto",
    });
  }
};

// ============================================
// WhatsApp Management Functions
// ============================================

// GET WhatsApp Settings Page
const getWhatsAppSettings = (req, res) => {
  res.render("admin/whatsapp-settings", {
    title: "WhatsApp Settings",
    currentPage: "whatsapp-settings",
    whatsappStatus: getClientStatus(),
  });
};

// API: Get WhatsApp Status and QR Code
const getWhatsAppStatus = (req, res) => {
  res.json({
    success: true,
    status: getClientStatus(),
    qrCode: getQRCode(),
  });
};

// API: Logout WhatsApp Client
const logoutWhatsApp = async (req, res) => {
  try {
    const result = await logoutClient();

    if (result.success) {
      res.json({
        success: true,
        message: "WhatsApp berhasil logout",
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Error logout WhatsApp:", error);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat logout WhatsApp",
    });
  }
};

module.exports = {
  getLogin,
  postLogin,
  logout,
  getDashboard,
  getMasterSekolah,
  createSekolah,
  updateSekolah,
  deleteSekolah,
  getDataTamu,
  deleteTamu,
  exportExcel,
  getTamuWithoutKode,
  generateKode,
  migratePhotos,
  getWhatsAppSettings,
  getWhatsAppStatus,
  logoutWhatsApp,
};
