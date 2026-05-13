require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'store_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// Initialize tables with retry (for Docker startup timing)
async function initDB() {
  for (let i = 1; i <= 10; i++) {
    try { await pool.query('SELECT 1'); break; }
    catch {
      if (i === 10) { console.error('Cannot connect to database after 10 retries'); process.exit(1); }
      console.log(`Waiting for database... (${i}/10)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      barcode TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      category TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      barcode TEXT NOT NULL,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      qty INTEGER DEFAULT 1,
      sold_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    )
  `);
  console.log('Database tables ready');
}

// Products
app.get('/api/products', async (req, res) => {
  const { barcode } = req.query;
  try {
    if (barcode) {
      const result = await pool.query('SELECT * FROM products WHERE barcode = $1', [barcode]);
      if (result.rows.length === 0) return res.json({ found: false });
      return res.json({ found: true, product: result.rows[0] });
    }
    const result = await pool.query('SELECT * FROM products ORDER BY name');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
  const { barcode, name, price, category } = req.body;
  if (!barcode || !name || price === undefined) return res.status(400).json({ error: 'barcode, name, price required' });
  try {
    const result = await pool.query(
      `INSERT INTO products (barcode, name, price, category)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (barcode) DO UPDATE SET name=$2, price=$3, category=$4, updated_at=NOW()
       RETURNING *`,
      [barcode, name, parseFloat(price), category || '']
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:barcode', async (req, res) => {
  const { barcode } = req.params;
  const { name, price, category } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products SET name=$1, price=$2, category=$3, updated_at=NOW() WHERE barcode=$4 RETURNING *`,
      [name, parseFloat(price), category || '', barcode]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:barcode', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE barcode=$1', [req.params.barcode]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sales
app.post('/api/sales', async (req, res) => {
  const { barcode, name, price, qty } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO sales (barcode, name, price, qty) VALUES ($1,$2,$3,$4) RETURNING *`,
      [barcode, name, parseFloat(price), qty || 1]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/today', async (req, res) => {
  const { date } = req.query;
  try {
    const d = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const result = await pool.query(`
      SELECT * FROM sales
      WHERE sold_at AT TIME ZONE 'Asia/Bangkok' >= $1::date 
        AND sold_at AT TIME ZONE 'Asia/Bangkok' < ($1::date + INTERVAL '1 day')
      ORDER BY sold_at DESC
    `, [d]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/summary', async (req, res) => {
  const { date } = req.query;
  try {
    const d = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const result = await pool.query(`
      SELECT COUNT(*) AS total_transactions, COALESCE(SUM(price*qty),0) AS total_revenue,
             COALESCE(SUM(qty),0) AS total_items, COUNT(DISTINCT barcode) AS unique_products
      FROM sales
      WHERE sold_at AT TIME ZONE 'Asia/Bangkok' >= $1::date
        AND sold_at AT TIME ZONE 'Asia/Bangkok' < ($1::date + INTERVAL '1 day')
    `, [d]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/top', async (req, res) => {
  const { date } = req.query;
  try {
    const d = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const result = await pool.query(`
      SELECT barcode, name, SUM(qty) AS total_qty, SUM(price*qty) AS total_revenue
      FROM sales
      WHERE sold_at AT TIME ZONE 'Asia/Bangkok' >= $1::date
        AND sold_at AT TIME ZONE 'Asia/Bangkok' < ($1::date + INTERVAL '1 day')
      GROUP BY barcode, name ORDER BY total_revenue DESC LIMIT 10
    `, [d]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/hourly', async (req, res) => {
  const { date } = req.query;
  try {
    const d = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const result = await pool.query(`
      SELECT EXTRACT(HOUR FROM sold_at AT TIME ZONE 'Asia/Bangkok') AS hour, SUM(price*qty) AS revenue
      FROM sales
      WHERE sold_at AT TIME ZONE 'Asia/Bangkok' >= $1::date
        AND sold_at AT TIME ZONE 'Asia/Bangkok' < ($1::date + INTERVAL '1 day')
      GROUP BY hour ORDER BY hour
    `, [d]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Categories
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM categories ORDER BY name');
    res.json(result.rows.map(r => r.name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    await pool.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const https = require('https');
const fs = require('fs');
const selfsigned = require('selfsigned');

initDB().then(() => {
  // Generate self-signed cert on first run, reuse after
  const certPath = './cert.pem';
  const keyPath  = './key.pem';

  if (!fs.existsSync(certPath)) {
    console.log('Generating self-signed SSL certificate...');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems  = selfsigned.generate(attrs, { days: 3650 });
    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath,  pems.private);
    console.log('Certificate generated');
  }

  const cert = fs.readFileSync(certPath);
  const key  = fs.readFileSync(keyPath);

  https.createServer({ key, cert }, app).listen(PORT, '0.0.0.0', () => {
    console.log(`\nServer running at https://localhost:${PORT}`);
    console.log(`Phone: https://<your-pc-ip>:${PORT}\n`);
  });

  const http = require('http');
  http.createServer(app).listen(3001, '0.0.0.0', () => {
    console.log('HTTP server running at http://localhost:3001 (for native app)');
  });
}).catch(err => { console.error(err); process.exit(1); });
