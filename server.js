// Overlord Media Dashboard — backend Express + Postgres
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const STATE_ID = 'default';

// ─── Postgres ──────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Initial row if absent
  await pool.query(
    `INSERT INTO app_state (id, state) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [STATE_ID, JSON.stringify({})]
  );
  console.log('[db] app_state table ready');
}

// ─── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// ─── API ───────────────────────────────────────────────────
app.get('/api/state', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT state, updated_at FROM app_state WHERE id = $1',
      [STATE_ID]
    );
    if (!rows.length) return res.json({ state: {}, updated_at: null });
    res.json({ state: rows[0].state, updated_at: rows[0].updated_at });
  } catch (err) {
    console.error('[GET /api/state]', err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const state = req.body && req.body.state;
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ error: 'bad_request' });
    }
    await pool.query(
      `INSERT INTO app_state (id, state, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [STATE_ID, JSON.stringify(state)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /api/state]', err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ─── Static ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[init] DB init failed:', err);
    // Démarrer quand même pour que Railway voie l'app comme up et que le healthcheck remonte l'erreur
    app.listen(PORT, () => {
      console.log(`[server] listening on :${PORT} (DB NOT INITIALIZED)`);
    });
  });
