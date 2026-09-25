const { Client, LocalAuth } = require("whatsapp-web.js");

// Set WHATSAPP_ENABLED=false di .env untuk mematikan WhatsApp (hemat RAM, tanpa Chrome)
const isEnabled = process.env.WHATSAPP_ENABLED !== "false";

let client = null;
let isClientReady = false;
let currentQRCode = null;
let clientState = isEnabled ? "initializing" : "disabled"; // initializing, qr_ready, authenticated, ready, disconnected, auth_failed, disabled
let reconnectTimer = null;

const createClient = () => {
  const instance = new Client({
    authStrategy: new LocalAuth({
      clientId: "buku-tamu-client",
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--disable-gpu",
        "--disable-extensions",
      ],
    },
  });

  // Event: QR Code untuk scanning
  instance.on("qr", (qr) => {
    currentQRCode = qr;
    clientState = "qr_ready";
  });

  // Event: Client siap
  instance.on("ready", () => {
    isClientReady = true;
    currentQRCode = null;
    clientState = "ready";
    console.log("✅ WhatsApp Client siap dan terhubung!");
  });

  // Event: Client terautentikasi
  instance.on("authenticated", () => {
    clientState = "authenticated";
    currentQRCode = null;
    console.log("🔐 WhatsApp berhasil diautentikasi.");
  });

  // Event: Authentication gagal
  instance.on("auth_failure", (msg) => {
    console.error("❌ WhatsApp Authentication Failure:", msg);
    isClientReady = false;
    currentQRCode = null;
    clientState = "auth_failed";
  });

  // Event: Client terputus → siapkan ulang agar QR baru muncul tanpa restart server
  instance.on("disconnected", (reason) => {
    console.log("⚠️ WhatsApp Client Disconnected:", reason);
    isClientReady = false;
    currentQRCode = null;
    clientState = "disconnected";
    scheduleReconnect();
  });

  return instance;
};

const startClient = () => {
  client = createClient();
  clientState = "initializing";
  client.initialize().catch((error) => {
    console.error("❌ Gagal menginisialisasi WhatsApp:", error.message);
    clientState = "disconnected";
    scheduleReconnect(30000);
  });
};

const scheduleReconnect = (delay = 5000) => {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    const old = client;
    client = null;
    if (old) await old.destroy().catch(() => {});
    startClient();
  }, delay);
};

/**
 * Format nomor Indonesia menjadi 628xxxx
 */
const formatNumber = (number) => {
  let formatted = String(number).replace(/\D/g, "");
  if (formatted.startsWith("0")) {
    formatted = "62" + formatted.substring(1);
  } else if (!formatted.startsWith("62")) {
    formatted = "62" + formatted;
  }
  return formatted;
};

/**
 * Fungsi untuk mengirim pesan WhatsApp
 * @param {string} number - Nomor WhatsApp tujuan (format: 08xxx atau 628xxx)
 * @param {string} name - Nama lengkap tamu
 * @param {string} code - Kode undian tamu
 * @returns {Promise<Object>} - Result object dengan status dan message
 */
const sendWhatsAppMessage = async (number, name, code) => {
  try {
    if (!client || !isClientReady) {
      return {
        success: false,
        message: "WhatsApp Client belum siap",
      };
    }

    const formattedNumber = formatNumber(number);
    const chatId = `${formattedNumber}@c.us`;

    const message = `*Terima Kasih, ${name}!*

Selamat datang di acara HUT Yayasan KAGUMI KE-50! 🎊

Data kehadiran Anda telah berhasil tercatat.
*Kode Undian Anda:*
*${code}*

Simpan kode ini dengan baik untuk mengikuti *Lucky Wheel Spin* dan berkesempatan memenangkan hadiah menarik!

Selamat menikmati acara!`;

    await client.sendMessage(chatId, message);

    return {
      success: true,
      message: "Pesan WhatsApp berhasil dikirim",
      number: formattedNumber,
    };
  } catch (error) {
    return {
      success: false,
      message: `Gagal mengirim WhatsApp: ${error.message}`,
      error: error.message,
    };
  }
};

/**
 * Fungsi untuk mendapatkan status client
 */
const getClientStatus = () => ({
  isReady: isClientReady,
  state: clientState,
  hasQR: currentQRCode !== null,
});

/**
 * Fungsi untuk mendapatkan QR Code
 */
const getQRCode = () => currentQRCode;

/**
 * Fungsi untuk logout dan reset client
 */
const logoutClient = async () => {
  if (!client) {
    return { success: false, message: "WhatsApp client tidak aktif" };
  }
  try {
    await client.logout();
    isClientReady = false;
    currentQRCode = null;
    clientState = "disconnected";
    scheduleReconnect(2000);

    console.log("✅ WhatsApp Client logged out successfully");
    return {
      success: true,
      message: "WhatsApp client logged out successfully",
    };
  } catch (error) {
    console.error("❌ Error logging out WhatsApp client:", error.message);
    return {
      success: false,
      message: `Error logging out: ${error.message}`,
    };
  }
};

/**
 * Fungsi untuk initialize client
 * Harus dipanggil saat aplikasi start
 */
const initializeClient = () => {
  if (!isEnabled) {
    console.log("ℹ️ WhatsApp dinonaktifkan (WHATSAPP_ENABLED=false)");
    return;
  }
  console.log("🚀 Menginisialisasi WhatsApp Client...");
  startClient();
};

/**
 * Tutup browser WhatsApp saat server berhenti
 */
const destroyClient = async () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (client) await client.destroy().catch(() => {});
};

module.exports = {
  sendWhatsAppMessage,
  getClientStatus,
  getQRCode,
  logoutClient,
  initializeClient,
  destroyClient,
};
