/**
 * Membuat akun Super Admin pertama.
 * Jalankan dengan: npm run seed:admin
 *
 * Nama, nomor WhatsApp dan password ditanyakan saat dijalankan
 * (atau diisi lewat .env: ADMIN_NAME, ADMIN_WHATSAPP, ADMIN_PASSWORD).
 */
require("dotenv").config({ quiet: true });
const readline = require("readline/promises");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "buku_tamu",
  port: Number(process.env.DB_PORT) || 3306,
};

async function seedAdmin() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let connection;

  try {
    console.log("\n=== 🚀 BUAT SUPER ADMIN ===\n");

    const name = process.env.ADMIN_NAME || (await rl.question("Nama admin: ")).trim();
    const whatsapp =
      process.env.ADMIN_WHATSAPP || (await rl.question("Nomor WhatsApp (untuk login): ")).trim();
    const password = process.env.ADMIN_PASSWORD || (await rl.question("Password (min. 8 karakter): "));

    if (!name || !whatsapp) throw new Error("Nama dan nomor WhatsApp wajib diisi");
    if (password.length < 8) throw new Error("Password minimal 8 karakter");

    connection = await mysql.createConnection(dbConfig);

    const [existing] = await connection.execute(
      "SELECT id FROM super_admin WHERE whatsapp = ? OR name = ?",
      [whatsapp, name]
    );
    if (existing.length > 0) {
      console.log("\n⚠️  Admin dengan nama/nomor ini sudah ada. Pakai: npm run admin:password\n");
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await connection.execute(
      "INSERT INTO super_admin (name, whatsapp, password, created_at) VALUES (?, ?, ?, NOW())",
      [name, whatsapp, hashedPassword]
    );

    console.log(`\n✅ Super Admin "${name}" berhasil dibuat. Login dengan ${whatsapp}\n`);
  } catch (error) {
    console.error("\n❌ Gagal:", error.message);
    if (error.code === "ER_NO_SUCH_TABLE") {
      console.error("💡 Jalankan database/schema.sql terlebih dahulu");
    } else if (error.code === "ECONNREFUSED") {
      console.error("💡 Pastikan MySQL sudah running");
    }
    process.exitCode = 1;
  } finally {
    rl.close();
    if (connection) await connection.end();
  }
}

seedAdmin();
