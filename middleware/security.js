const crypto = require("crypto");

// Header keamanan dasar untuk semua response
const securityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
};

/**
 * Rate limiter sederhana berbasis memori (per IP, fixed window).
 * Cukup untuk satu proses Node; tanpa dependency tambahan.
 */
const rateLimit = ({ windowMs, max, message, onLimit }) => {
  const hits = new Map();

  // Bersihkan entri kedaluwarsa agar memori tidak terus bertambah
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      res.status(429);
      return onLimit ? onLimit(req, res, message) : res.json({ success: false, message });
    }
    next();
  };
};

/**
 * Proteksi CSRF untuk route admin.
 * Token disimpan di session dan wajib dikirim pada request non-GET
 * lewat header "X-CSRF-Token" (fetch) atau field "_csrf" (form).
 */
const csrfProtection = (req, res, next) => {
  if (req.session && req.session.isAuthenticated && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = (req.session && req.session.csrfToken) || "";

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  // Login belum punya session, dilindungi rate limit + SameSite cookie
  if (!req.session || !req.session.isAuthenticated) return next();

  const sent = req.get("x-csrf-token") || (req.body && req.body._csrf) || "";
  const expected = req.session.csrfToken;

  const valid =
    typeof sent === "string" &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

  if (!valid) {
    if (req.path.startsWith("/api/") || req.is("json")) {
      return res
        .status(403)
        .json({ success: false, message: "Sesi tidak valid, muat ulang halaman." });
    }
    return res.status(403).render("error", {
      title: "Error",
      error: { message: "Sesi tidak valid. Silakan muat ulang halaman dan coba lagi." },
    });
  }
  next();
};

module.exports = {
  securityHeaders,
  rateLimit,
  csrfProtection,
};
