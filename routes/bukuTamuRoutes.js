const express = require("express");
const router = express.Router();
const bukuTamuController = require("../controllers/bukuTamuController");
const { rateLimit } = require("../middleware/security");

// Batasi submit per IP agar tidak bisa dibanjiri.
// Default 30/menit: cukup longgar untuk banyak tamu di satu WiFi acara.
const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.SUBMIT_RATE_LIMIT) || 30,
  message: "Terlalu banyak percobaan. Silakan tunggu 1 menit.",
});

// Route untuk halaman form
router.get("/", bukuTamuController.getForm);

// Route untuk submit form (foto base64 → batas body 5 MB)
router.post(
  "/submit",
  submitLimiter,
  express.json({ limit: "5mb" }),
  bukuTamuController.submitForm
);

// Route untuk halaman sukses
router.get("/success", bukuTamuController.successPage);

module.exports = router;
