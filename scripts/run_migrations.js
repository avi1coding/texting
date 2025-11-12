const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
require('dotenv').config();

const sqlPath = path.join(__dirname, '..', 'migrations', 'init.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('Migration file not found at', sqlPath);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
  multipleStatements: true,
};

// SSL handling: prefer a provided CA file and enable strict verification. Fallback to DB_SSL=REQUIRED.
if (process.env.DB_SSL_CA_PATH) {
  try {
    dbConfig.ssl = { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH), rejectUnauthorized: true };
  } catch (err) {
    console.warn('Could not read DB_SSL_CA_PATH file, continuing without CA:', err.message);
  }
} else if (process.env.DB_SSL && process.env.DB_SSL.toLowerCase() === 'required') {
  dbConfig.ssl = { rejectUnauthorized: true };
}

// Optional insecure mode: set DB_SSL_INSECURE=true to disable TLS verification (ssl.rejectUnauthorized = false).
// WARNING: This is insecure and should only be used for local testing or debugging.
if (process.env.DB_SSL_INSECURE && process.env.DB_SSL_INSECURE.toLowerCase() === 'true') {
  dbConfig.ssl = { rejectUnauthorized: false };
}

const connection = mysql.createConnection(dbConfig);

connection.connect(err => {
  if (err) {
    console.error('Failed to connect to DB for migrations:', err);
    process.exit(1);
  }

  connection.query(sql, (err2, results) => {
    if (err2) {
      console.error('Migration failed:', err2);
      connection.end();
      process.exit(1);
    }

    console.log('Migration successfully applied.');
    connection.end();
  });
});
