require("dotenv").config({ quiet: true });
const mysql = require("mysql2");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "buku_tamu",
  port: Number(process.env.DB_PORT) || 3306,
  charset: "utf8mb4",
};

// Create connection pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// Get promise-based connection
const db = pool.promise();

// Test connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Error koneksi database:", err.message);
    return;
  }
  connection.release();
});

/**
 * Jalankan callback di dalam transaksi.
 * Commit jika sukses, rollback jika terjadi error.
 */
const withTransaction = async (callback) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = db;
module.exports.pool = pool;
module.exports.dbConfig = dbConfig;
module.exports.withTransaction = withTransaction;
