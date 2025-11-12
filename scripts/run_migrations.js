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

// SSL handling: check insecure mode first (for development), then CA file, then DB_SSL=REQUIRED
if (process.env.DB_SSL_INSECURE && process.env.DB_SSL_INSECURE.toLowerCase() === 'true') {
  console.warn('⚠️  WARNING: Using insecure SSL (rejectUnauthorized: false). This should only be used for development/testing!');
  dbConfig.ssl = { rejectUnauthorized: false };
} else if (process.env.DB_SSL_CA_PATH) {
  try {
    dbConfig.ssl = { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH), rejectUnauthorized: true };
  } catch (err) {
    console.warn('Could not read DB_SSL_CA_PATH file, continuing without CA:', err.message);
  }
} else if (process.env.DB_SSL && process.env.DB_SSL.toLowerCase() === 'required') {
  dbConfig.ssl = { rejectUnauthorized: true };
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
