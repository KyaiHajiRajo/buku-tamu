const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const wheelController = require("../controllers/wheelController");
const { isAuthenticated, isNotAuthenticated } = require("../middleware/auth");
const { rateLimit, csrfProtection } = require("../middleware/security");

// Maks 10 percobaan login per 15 menit per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
  onLimit: (req, res, message) =>
    res.render("admin/login", { title: "Login Admin - Buku Tamu Digital", error: message }),
});

// Halaman admin tidak boleh di-cache browser/proxy
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Semua request POST admin wajib membawa token CSRF
router.use(csrfProtection);

// Login routes (tanpa autentikasi)
router.get("/login", isNotAuthenticated, adminController.getLogin);
router.post("/login", loginLimiter, isNotAuthenticated, adminController.postLogin);

// Logout
router.post("/logout", adminController.logout);

// Dashboard (dengan autentikasi)
router.get("/", isAuthenticated, (req, res) =>
  res.redirect("/admin/dashboard")
);
router.get("/dashboard", isAuthenticated, adminController.getDashboard);

// Master Sekolah routes
router.get(
  "/master-sekolah",
  isAuthenticated,
  adminController.getMasterSekolah
);
router.post(
  "/master-sekolah/create",
  isAuthenticated,
  adminController.createSekolah
);
router.post(
  "/master-sekolah/update/:id",
  isAuthenticated,
  adminController.updateSekolah
);
router.post(
  "/master-sekolah/delete/:id",
  isAuthenticated,
  adminController.deleteSekolah
);

// Data Tamu routes
router.get("/data-tamu", isAuthenticated, adminController.getDataTamu);
router.post(
  "/data-tamu/delete/:id",
  isAuthenticated,
  adminController.deleteTamu
);
router.get("/data-tamu/export", isAuthenticated, adminController.exportExcel);

// Generate Kode routes
router.get(
  "/api/tamu-without-kode",
  isAuthenticated,
  adminController.getTamuWithoutKode
);
router.post(
  "/api/generate-kode",
  isAuthenticated,
  adminController.generateKode
);

// Wheel Spin routes
router.get("/wheel-spin", isAuthenticated, wheelController.getWheelPage);
router.get("/api/wheel/data", isAuthenticated, wheelController.getWheelData);
router.post("/api/wheel/spin", isAuthenticated, wheelController.spinWheel);
router.get(
  "/api/wheel/winners",
  isAuthenticated,
  wheelController.getWinnerHistory
);

// Photo Migration route (one-time use by Super Admin)
router.post("/migrate-photos", isAuthenticated, adminController.migratePhotos);

// WhatsApp Management routes
router.get(
  "/whatsapp-settings",
  isAuthenticated,
  adminController.getWhatsAppSettings
);
router.get(
  "/api/whatsapp/status",
  isAuthenticated,
  adminController.getWhatsAppStatus
);
router.post(
  "/api/whatsapp/logout",
  isAuthenticated,
  adminController.logoutWhatsApp
);

module.exports = router;
