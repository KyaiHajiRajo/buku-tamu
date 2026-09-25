require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const compression = require("compression");
const path = require("path");
const db = require("./config/database");
const { initializeClient, destroyClient } = require("./utils/whatsapp");
const { securityHeaders } = require("./middleware/security");

const app = express();
const PORT = Number(process.env.PORT) || 1000;
const isProduction = process.env.NODE_ENV === "production";

// Session secret wajib kuat di production
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) {
    console.error("❌ SESSION_SECRET wajib diisi minimal 32 karakter di .env");
    process.exit(1);
  }
  console.warn("⚠️ SESSION_SECRET lemah/kosong, memakai secret acak sementara (sesi hilang saat restart)");
  sessionSecret = crypto.randomBytes(48).toString("hex");
}

// Aktifkan jika berjalan di belakang reverse proxy (nginx, cloudflare), contoh: TRUST_PROXY=1
if (process.env.TRUST_PROXY) {
  const value = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(value) ? Number(value) : value);
}

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(compression());

// Static files (foto upload namanya unik → aman di-cache lama)
app.use(
  "/uploads",
  express.static(path.join(__dirname, "public", "uploads"), {
    maxAge: "30d",
    immutable: true,
    index: false,
  })
);
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: isProduction ? "7d" : 0,
    index: false,
  })
);

// Body parser - batas kecil untuk semua route, kecuali submit foto buku tamu
const jsonParser = express.json({ limit: "100kb" });
app.use((req, res, next) =>
  req.path === "/buku-tamu/submit" ? next() : jsonParser(req, res, next)
);
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Session disimpan di MySQL (tidak hilang saat restart, tidak bocor memori)
const sessionCookieName = "bukutamu.sid";
app.set("sessionCookieName", sessionCookieName);
const sessionStore = new MySQLStore(
  {
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    createDatabaseTable: true,
  },
  db.pool
);

app.use(
  session({
    name: sessionCookieName,
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // Set COOKIE_SECURE=true jika situs diakses lewat HTTPS
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 1000 * 60 * 60 * 12, // 12 jam
    },
  })
);

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Flash message middleware (simple implementation using session)
app.use((req, res, next) => {
  res.locals.flash = {
    success: req.session.flashSuccess || null,
    error: req.session.flashError || null,
  };
  delete req.session.flashSuccess;
  delete req.session.flashError;
  next();
});

// Make session data available to all views
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.isAuthenticated = req.session.isAuthenticated || false;
  res.locals.csrfToken = "";
  next();
});

// Routes
const bukuTamuRoutes = require("./routes/bukuTamuRoutes");
const adminRoutes = require("./routes/adminRoutes");

app.use("/buku-tamu", bukuTamuRoutes);
app.use("/admin", adminRoutes);

// Root redirect
app.get("/", (req, res) => {
  res.redirect("/buku-tamu");
});

// Health check (untuk monitoring)
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) {
    res.status(503).json({ status: "db_error" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).render("404", { title: "404 - Halaman Tidak Ditemukan" });
});

// Error handler
app.use((err, req, res, next) => {
  const wantsJson =
    req.path.startsWith("/admin/api/") ||
    req.path === "/buku-tamu/submit" ||
    req.is("json");

  // Error dari body parser (payload terlalu besar / JSON rusak)
  if (err.type === "entity.too.large") {
    const message = "Data terlalu besar. Silakan ambil ulang foto.";
    return wantsJson
      ? res.status(413).json({ success: false, message })
      : res.status(413).render("error", { title: "Error", error: { message } });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Format data tidak valid" });
  }

  console.error(err.stack || err);
  if (wantsJson) {
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
  res.status(500).render("error", {
    title: "Error",
    error: isProduction ? {} : { message: err.message },
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// Initialize WhatsApp Client
initializeClient();

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  console.log(`📝 Buku Tamu: http://localhost:${PORT}/buku-tamu`);
  console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
});

// Matikan server dengan rapi (tutup Chrome WhatsApp & koneksi DB)
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} diterima, mematikan server...`);
  server.close();
  await destroyClient();
  await sessionStore.close().catch(() => {});
  await db.end().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
