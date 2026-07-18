import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const apiOnly = process.argv.includes('--api-only');
const port = Number(process.env.PORT || process.env.APP_PORT || (apiOnly ? 3001 : 8080));
const dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'health-tracker.sqlite');
const peptideDbPath = process.env.PEPTIDE_DB_PATH || '';
const allowedHealthEmails = new Set(
  String(process.env.HEALTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const sessionLifetimeMs = 1000 * 60 * 60 * 12;
const sessions = new Map();

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    file_name TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    record_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    provider TEXT,
    external_id TEXT,
    measured_at TEXT,
    date TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    raw_value TEXT,
    comparator TEXT,
    unit TEXT,
    status TEXT,
    reference_range TEXT,
    reference_low REAL,
    reference_high REAL,
    import_batch_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_measurements_source_metric_date
    ON measurements (source, metric, date);

  CREATE INDEX IF NOT EXISTS idx_measurements_date
    ON measurements (date);
`);

const insertBatch = db.prepare(`
  INSERT INTO import_batches (source, file_name, record_count)
  VALUES (@source, @fileName, @recordCount)
`);

const updateBatch = db.prepare(`
  UPDATE import_batches
  SET inserted_count = @insertedCount,
      duplicate_count = @duplicateCount
  WHERE id = @id
`);

const insertMeasurement = db.prepare(`
  INSERT OR IGNORE INTO measurements (
    unique_key,
    source,
    provider,
    external_id,
    measured_at,
    date,
    metric,
    value,
    raw_value,
    comparator,
    unit,
    status,
    reference_range,
    reference_low,
    reference_high,
    import_batch_id
  ) VALUES (
    @uniqueKey,
    @source,
    @provider,
    @externalId,
    @measuredAt,
    @date,
    @metric,
    @value,
    @rawValue,
    @comparator,
    @unit,
    @status,
    @referenceRange,
    @referenceLow,
    @referenceHigh,
    @importBatchId
  )
`);

const findMeasurementByUniqueKey = db.prepare('SELECT id FROM measurements WHERE unique_key = ?');

const overrideMeasurement = db.prepare(`
  UPDATE measurements
  SET
    provider = @provider,
    external_id = @externalId,
    measured_at = @measuredAt,
    date = @date,
    metric = @metric,
    value = @value,
    raw_value = @rawValue,
    comparator = @comparator,
    unit = @unit,
    status = @status,
    reference_range = @referenceRange,
    reference_low = @referenceLow,
    reference_high = @referenceHigh,
    import_batch_id = @importBatchId
  WHERE unique_key = @uniqueKey
`);

const selectMeasurements = db.prepare(`
  SELECT
    id,
    source,
    provider,
    external_id AS externalId,
    measured_at AS measuredAt,
    date,
    metric,
    value,
    raw_value AS rawValue,
    comparator,
    unit,
    status,
    reference_range AS referenceRange,
    reference_low AS low,
    reference_high AS high,
    import_batch_id AS importBatchId
  FROM measurements
  ORDER BY date ASC, metric ASC, id ASC
`);

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, peptideIntegrationConfigured: Boolean(peptideDbPath) });
});

app.get('/api/auth/session', (req, res) => {
  const user = sessionUser(req);
  res.json({ authenticated: Boolean(user), user: user || null });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  if (allowedHealthEmails.size && !allowedHealthEmails.has(email)) {
    res.status(403).json({ error: 'This account is not allowed to access Health Tracker.' });
    return;
  }

  const peptideDb = openPeptideDb();
  if (!peptideDb) {
    res.status(503).json({ error: 'Peptide account data is not configured on this Health Tracker server.' });
    return;
  }

  try {
    const user = peptideDb.prepare(`
      SELECT id, email, display_name AS displayName, password_hash AS passwordHash
      FROM users
      WHERE email = ? AND active = 1
    `).get(email);
    if (!user || !verifyPeptidePassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const session = { id: user.id, email: user.email, displayName: user.displayName, expiresAt: Date.now() + sessionLifetimeMs };
    sessions.set(token, session);
    setSessionCookie(res, token);
    res.json({ authenticated: true, user: publicUser(session) });
  } catch (error) {
    res.status(500).json({ error: `Could not verify the peptide account: ${error.message}` });
  } finally {
    peptideDb.close();
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookies(req).health_tracker_session;
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

app.use('/api', requireAuthenticatedUser);

app.get('/api/peptides/doses', (req, res) => {
  const userId = req.healthUser.id;

  const peptideDb = openPeptideDb();
  if (!peptideDb) {
    res.status(503).json({ error: 'Peptide SQLite database is not configured.' });
    return;
  }

  try {
    const doses = peptideDb.prepare(`
      SELECT
        id,
        peptide_name AS peptideName,
        actual_dose_amount AS actualDoseAmount,
        dose_unit AS doseUnit,
        status,
        site,
        notes,
        logged_at AS loggedAt,
        substr(logged_at, 1, 10) AS date
      FROM dose_logs
      WHERE user_id = ?
      ORDER BY logged_at ASC, id ASC
    `).all(userId);
    res.json({ connected: true, user: publicUser(req.healthUser), doses });
  } catch (error) {
    res.status(500).json({ error: `Could not read peptide doses: ${error.message}` });
  } finally {
    peptideDb.close();
  }
});

app.get('/api/measurements', (_req, res) => {
  res.json(groupBySource(selectMeasurements.all().map(cleanRecord)));
});

app.get('/api/import-batches', (_req, res) => {
  const rows = db.prepare('SELECT * FROM import_batches ORDER BY imported_at DESC, id DESC').all();
  res.json(rows);
});

app.post('/api/import', (req, res) => {
  const { source, fileName = '', records = [], overrideExisting = false } = req.body || {};
  if (!['labs', 'dexa', 'scale', 'glucose'].includes(source)) {
    res.status(400).json({ error: 'source must be labs, dexa, scale, or glucose' });
    return;
  }
  if (!Array.isArray(records)) {
    res.status(400).json({ error: 'records must be an array' });
    return;
  }

  const result = db.transaction(() => {
    const batch = insertBatch.run({ source, fileName, recordCount: records.length });
    let insertedCount = 0;
    let overriddenCount = 0;
    for (const record of records) {
      const normalized = normalizeIncomingRecord(record, source, batch.lastInsertRowid);
      if (!normalized) continue;
      if (source === 'glucose' && overrideExisting && findMeasurementByUniqueKey.get(normalized.uniqueKey)) {
        overrideMeasurement.run(normalized);
        overriddenCount += 1;
        continue;
      }
      const insert = insertMeasurement.run(normalized);
      insertedCount += insert.changes;
    }
    const duplicateCount = records.length - insertedCount - overriddenCount;
    updateBatch.run({ id: batch.lastInsertRowid, insertedCount, duplicateCount });
    return { batchId: batch.lastInsertRowid, insertedCount, overriddenCount, duplicateCount };
  })();

  res.json({
    ...result,
    records: groupBySource(selectMeasurements.all().map(cleanRecord)),
  });
});

app.delete('/api/measurements', (_req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM measurements').run();
    db.prepare('DELETE FROM import_batches').run();
  })();
  res.json(groupBySource([]));
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

if (!apiOnly) {
  const dist = path.join(projectRoot, 'dist');
  app.use(express.static(dist));
  app.use((_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Health Tracker listening on ${port}`);
  console.log(`SQLite database: ${dbPath}`);
});

function normalizeIncomingRecord(record, source, importBatchId) {
  if (!record || typeof record !== 'object') return null;
  const date = String(record.date || '').slice(0, 10);
  const metric = String(record.metric || '').trim();
  const value = Number(record.value);
  if (!date || !metric || !Number.isFinite(value)) return null;

  const normalized = {
    source,
    provider: record.importer || record.provider || '',
    externalId: record.externalId || record.external_id || '',
    measuredAt: record.measuredAt || record.measured_at || '',
    date,
    metric,
    value,
    rawValue: record.rawValue || record.raw_value || '',
    comparator: record.comparator || '',
    unit: record.unit || '',
    status: record.status || '',
    referenceRange: record.referenceRange || record.reference_range || '',
    referenceLow: nullableNumber(record.low ?? record.referenceLow ?? record.reference_low),
    referenceHigh: nullableNumber(record.high ?? record.referenceHigh ?? record.reference_high),
    importBatchId,
  };
  normalized.uniqueKey = uniqueKey(normalized);
  return normalized;
}

function uniqueKey(record) {
  if (record.source === 'glucose') {
    return crypto
      .createHash('sha256')
      .update([
        record.source,
        record.provider,
        record.externalId,
        record.date,
        record.metric,
        record.unit,
      ].join('|'))
      .digest('hex');
  }

  return crypto
    .createHash('sha256')
    .update([
      record.source,
      record.provider,
      record.externalId,
      record.measuredAt,
      record.date,
      record.metric,
      record.value,
      record.unit,
      record.rawValue,
    ].join('|'))
    .digest('hex');
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanRecord(record) {
  return {
    ...record,
    low: record.low ?? undefined,
    high: record.high ?? undefined,
    rawValue: record.rawValue || undefined,
    comparator: record.comparator || undefined,
    status: record.status || undefined,
    referenceRange: record.referenceRange || undefined,
    externalId: record.externalId || undefined,
    measuredAt: record.measuredAt || undefined,
    provider: record.provider || undefined,
  };
}

function readCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .reduce((cookies, entry) => {
      const [name, ...value] = entry.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(value.join('='));
      return cookies;
    }, {});
}

function sessionUser(req) {
  const token = readCookies(req).health_tracker_session;
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAuthenticatedUser(req, res, next) {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in is required.' });
    return;
  }
  req.healthUser = user;
  next();
}

function verifyPeptidePassword(password, storedHash) {
  try {
    const [iterationsText, salt, expected] = String(storedHash).split('$', 3);
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || !salt || !/^[a-f0-9]+$/i.test(expected || '')) return false;
    const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `health_tracker_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'health_tracker_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function openPeptideDb() {
  if (!peptideDbPath || !fs.existsSync(peptideDbPath)) return null;
  try {
    return new Database(peptideDbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function groupBySource(rows) {
  return rows.reduce((acc, row) => {
    if (!acc[row.source]) acc[row.source] = [];
    acc[row.source].push(row);
    return acc;
  }, { labs: [], dexa: [], scale: [], glucose: [] });
}
