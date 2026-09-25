/**
 * Migrasi database (aman dijalankan berulang kali).
 * Jalankan dengan: npm run db:migrate
 *
 * - wheel_spin.tamu_id UNIQUE → satu tamu tidak bisa menang dua kali
 * - FK wheel_spin → buku_tamu ON DELETE CASCADE
 * - Index created_at & kode untuk mempercepat dashboard/undian
 * - Kolom other_instansi (jika database dibuat dari dump lama)
 */
require("dotenv").config({ quiet: true });
const mysql = require("mysql2/promise");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "buku_tamu",
  port: Number(process.env.DB_PORT) || 3306,
};

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  const db = dbConfig.database;

  const exists = async (sql, params) => {
    const [rows] = await conn.query(sql, params);
    return rows.length > 0;
  };
  const hasIndex = (table, name) =>
    exists(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?",
      [db, table, name]
    );
  const run = async (label, sql) => {
    await conn.query(sql);
    console.log("✅", label);
  };

  try {
    if (
      !(await exists(
        "SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name='buku_tamu' AND column_name='other_instansi'",
        [db]
      ))
    ) {
      await run(
        "Tambah kolom buku_tamu.other_instansi",
        "ALTER TABLE buku_tamu ADD COLUMN other_instansi VARCHAR(100) NULL DEFAULT NULL AFTER sekolah_id"
      );
    }

    if (!(await hasIndex("buku_tamu", "idx_buku_tamu_created_at"))) {
      await run("Index buku_tamu.created_at", "CREATE INDEX idx_buku_tamu_created_at ON buku_tamu (created_at)");
    }
    if (!(await hasIndex("buku_tamu", "idx_buku_tamu_kode"))) {
      await run("Index buku_tamu.kode", "CREATE INDEX idx_buku_tamu_kode ON buku_tamu (kode)");
    }

    if (!(await hasIndex("wheel_spin", "uq_wheel_spin_tamu"))) {
      const [dupes] = await conn.query(
        "SELECT tamu_id FROM wheel_spin GROUP BY tamu_id HAVING COUNT(*) > 1"
      );
      if (dupes.length > 0) {
        console.warn("⚠️ Ada pemenang ganda, UNIQUE dilewati. tamu_id:", dupes.map((d) => d.tamu_id).join(", "));
      } else {
        await run("UNIQUE wheel_spin.tamu_id", "ALTER TABLE wheel_spin ADD UNIQUE KEY uq_wheel_spin_tamu (tamu_id)");
      }
    }

    const [fks] = await conn.query(
      `SELECT constraint_name, delete_rule FROM information_schema.referential_constraints
       WHERE constraint_schema=? AND table_name='wheel_spin' AND referenced_table_name='buku_tamu'`,
      [db]
    );
    for (const fk of fks) {
      const name = fk.CONSTRAINT_NAME || fk.constraint_name;
      const rule = fk.DELETE_RULE || fk.delete_rule;
      if (rule !== "CASCADE") {
        // MySQL tidak bisa drop & add FK bernama sama dalam satu ALTER
        await run(`Hapus FK lama ${name}`, `ALTER TABLE wheel_spin DROP FOREIGN KEY \`${name}\``);
        await run(
          `FK ${name} → ON DELETE CASCADE`,
          `ALTER TABLE wheel_spin ADD CONSTRAINT \`${name}\`
           FOREIGN KEY (tamu_id) REFERENCES buku_tamu (id) ON DELETE CASCADE`
        );
      }
    }

    console.log("🎉 Migrasi selesai");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("❌ Migrasi gagal:", error.message);
  process.exit(1);
});
