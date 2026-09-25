const crypto = require("crypto");
const db = require("../config/database");

// Peserta undian: tamu yang punya kode, belum pernah menang,
// dan bukan dari sekolah dengan keyword "Undangan"
const PESERTA_QUERY = `
  SELECT
    bt.id,
    bt.kode,
    bt.nama_lengkap,
    bt.foto,
    ms.nama_sekolah,
    bt.other_instansi
  FROM buku_tamu bt
  LEFT JOIN master_sekolah ms ON bt.sekolah_id = ms.id
  WHERE bt.kode IS NOT NULL AND bt.kode <> ''
    AND NOT EXISTS (SELECT 1 FROM wheel_spin ws WHERE ws.tamu_id = bt.id)
    AND (ms.nama_sekolah NOT LIKE '%Undangan%' OR ms.nama_sekolah IS NULL)
  ORDER BY bt.created_at DESC`;

const getPeserta = async () => {
  const [tamu] = await db.query(PESERTA_QUERY);
  return tamu;
};

// Kunci sederhana agar dua spin tidak berjalan bersamaan (mis. klik ganda)
let spinInProgress = false;

// Get halaman wheel spin (admin)
const getWheelPage = (req, res) => {
  res.render("admin/wheel-spin", {
    title: "Lucky Wheel Spin - Undian Berhadiah",
    layout: "layout",
    currentPage: "wheel-spin",
  });
};

// API: Get data untuk wheel spin
const getWheelData = async (req, res) => {
  try {
    const tamu = await getPeserta();

    res.json({
      success: true,
      data: tamu,
      total: tamu.length,
    });
  } catch (error) {
    console.error("Error get wheel data:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data",
    });
  }
};

// API: Putar wheel dan pilih pemenang acak
const spinWheel = async (req, res) => {
  if (spinInProgress) {
    return res.status(409).json({
      success: false,
      message: "Undian sedang berlangsung, tunggu sebentar",
    });
  }

  spinInProgress = true;
  try {
    const tamu = await getPeserta();

    if (tamu.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tidak ada peserta undian",
      });
    }

    // Pilih pemenang secara acak (CSPRNG, distribusi merata)
    const randomIndex = crypto.randomInt(tamu.length);
    const winner = tamu[randomIndex];

    await db.query(`INSERT INTO wheel_spin (tamu_id, created_at) VALUES (?, NOW())`, [
      winner.id,
    ]);

    res.json({
      success: true,
      winner: {
        id: winner.id,
        kode: winner.kode,
        nama_lengkap: winner.nama_lengkap,
        foto: winner.foto,
        nama_sekolah: winner.nama_sekolah,
        other_instansi: winner.other_instansi,
        position: randomIndex,
      },
      totalParticipants: tamu.length,
    });
  } catch (error) {
    console.error("Error spin wheel:", error);
    res.status(500).json({
      success: false,
      message: "Gagal melakukan undian",
    });
  } finally {
    spinInProgress = false;
  }
};

// API: Get history pemenang dari table wheel_spin
const getWinnerHistory = async (req, res) => {
  try {
    const [winners] = await db.query(
      `SELECT
        ws.id,
        ws.tamu_id,
        ws.created_at,
        bt.kode,
        bt.nama_lengkap,
        bt.foto,
        ms.nama_sekolah,
        bt.other_instansi
      FROM wheel_spin ws
      INNER JOIN buku_tamu bt ON ws.tamu_id = bt.id
      LEFT JOIN master_sekolah ms ON bt.sekolah_id = ms.id
      ORDER BY ws.id ASC`
    );

    res.json({
      success: true,
      data: winners,
      total: winners.length,
    });
  } catch (error) {
    console.error("Error get winner history:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data pemenang",
    });
  }
};

module.exports = {
  getWheelPage,
  getWheelData,
  spinWheel,
  getWinnerHistory,
};
