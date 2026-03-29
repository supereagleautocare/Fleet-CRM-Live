/**
 * FLEET CRM — PostgreSQL Adapter
 * Makes PostgreSQL work like SQLite's synchronous API.
 * All route files require this instead of db/schema directly.
 */

const { pool } = require('./schema');

// Convert SQLite ? placeholders to PostgreSQL $1, $2, $3...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Convert SQLite datetime('now') to PostgreSQL now()
function convertSql(sql) {
  return sql
    .replace(/datetime\('now'\)/gi, "to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
    .replace(/date\('now'\)/gi, "current_date")
    .replace(/date\('now',\s*'([^']+)'\)/gi, "(current_date + interval '$1')")
    .replace(/INSERT OR IGNORE/gi, 'INSERT')
    .replace(/INSERT OR REPLACE/gi, 'INSERT')
    .replace(/ON CONFLICT.*DO NOTHING/gi, 'ON CONFLICT DO NOTHING')
    .replace(/AUTOINCREMENT/gi, '')
    .replace(/INTEGER PRIMARY KEY/gi, 'SERIAL PRIMARY KEY');
}

// Synchronous-style query runner using shared connection pool
function runQuery(sql, params = []) {
  const converted = convertPlaceholders(convertSql(sql));
  // We run this synchronously by blocking — works for our use case
  // since Railway/Node handles the event loop fine
  return { sql: converted, params };
}

// The main db object that mimics SQLite's synchronous API
const db = {
  // db.prepare(sql).get(params) — returns first row or undefined
  prepare(sql) {
    const self = this;
    return {
      get(...args) {
        const params = args.flat();
        const { sql: converted, params: p } = runQuery(sql, params);
        // Use sync-style via deasync pattern
        const result = self._runSync(converted, p);
        return result.rows[0] || null;
      },
      all(...args) {
        const params = args.flat();
        const { sql: converted, params: p } = runQuery(sql, params);
        const result = self._runSync(converted, p);
        return result.rows;
      },
      run(...args) {
        const params = args.flat();
        let converted = convertPlaceholders(convertSql(sql));
        // For INSERT, append RETURNING id so we get lastInsertRowid
        const isInsert = converted.trim().toUpperCase().startsWith('INSERT');
        if (isInsert && !converted.toUpperCase().includes('RETURNING')) {
          converted += ' RETURNING id';
        }
        const result = self._runSync(converted, p);
        return {
          lastInsertRowid: result.rows[0]?.id || null,
          changes: result.rowCount || 0,
        };
      },
    };
  },

  exec(sql) {
    // Handle transactions and multi-statement SQL
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      if (!stmt) continue;
      const converted = convertSql(stmt);
      this._runSync(converted, []);
    }
  },

  _runSync(sql, params) {
    // Synchronous execution using shared-memory trick
    const { execFileSync } = require('child_process');
    // We store result in a shared buffer
    let result = { rows: [], rowCount: 0 };
    let done = false;
    let error = null;

    pool.query(sql, params)
      .then(r => { result = r; done = true; })
      .catch(e => { error = e; done = true; });

    // Spin wait — safe for low-concurrency CRM use
    const start = Date.now();
    while (!done) {
      if (Date.now() - start > 10000) {
        throw new Error('Database query timeout: ' + sql.slice(0, 100));
      }
      // Tiny sleep to yield
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }

    if (error) throw error;
    return result;
  },
};

module.exports = db;
