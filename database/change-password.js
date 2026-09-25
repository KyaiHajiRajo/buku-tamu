/**
 * Ganti password akun admin.
 * Jalankan dengan: npm run admin:password
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

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    const [admins] = await connection.query("SELECT id, name, whatsapp FROM super_admin ORDER BY id");

    console.log("\n=== 🔐 GANTI PASSWORD ADMIN ===\n");
    admins.forEach((a) => console.log(`  [${a.id}] ${a.name} (${a.whatsapp || "-"})`));

    const id = Number((await rl.question("\nID admin: ")).trim());
    if (!admins.some((a) => a.id === id)) throw new Error("ID admin tidak ditemukan");

    const password = await rl.question("Password baru (min. 8 karakter): ");
    if (password.length < 8) throw new Error("Password minimal 8 karakter");
    const confirm = await rl.question("Ulangi password baru: ");
    if (password !== confirm) throw new Error("Password tidak sama");

    const hash = await bcrypt.hash(password, 12);
    await connection.execute("UPDATE super_admin SET password = ? WHERE id = ?", [hash, id]);

    // Paksa login ulang di semua perangkat
    await connection.query("DELETE FROM sessions").catch(() => {});

    console.log("\n✅ Password berhasil diganti. Semua sesi login direset.\n");
  } catch (error) {
    console.error("\n❌ Gagal:", error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    if (connection) await connection.end();
  }
}

main();
