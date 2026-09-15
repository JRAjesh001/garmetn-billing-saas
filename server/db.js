// Database connection
// Production version: database is already created and seeded.

const mysql = require("mysql2/promise");
const cfg = require("./config");

let pool = null;

async function initDb() {
  if (pool) {
    return pool;
  }

  try {
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,

      waitForConnections: cfg.waitForConnections ?? true,
      connectionLimit: cfg.connectionLimit ?? 10,
      queueLimit: cfg.queueLimit ?? 0,
      dateStrings: cfg.dateStrings ?? false,

      // Keep this false unless you specifically need
      // multiple SQL statements in a single query.
      multipleStatements: false,
    });

    // Test connection
    const connection = await pool.getConnection();

    await connection.query("SELECT 1");

    connection.release();

    console.log(`MySQL connected successfully: ${cfg.database}`);

    return pool;
  } catch (error) {
    console.error("MySQL connection failed.");

    console.error("Error:", error.message);

    pool = null;

    throw error;
  }
}

function getPool() {
  if (!pool) {
    throw new Error("Database not initialized. Call initDb() first.");
  }

  return pool;
}

module.exports = {
  initDb,
  getPool,
};
