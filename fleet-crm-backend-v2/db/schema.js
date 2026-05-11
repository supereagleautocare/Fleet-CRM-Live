/**
 * FLEET CRM — DATABASE SCHEMA (PostgreSQL)
 *
 * On startup:
 *  1. Creates the `platform` schema (master tenant registry)
 *  2. Ensures the default Super Eagle tenant exists using the `public` schema
 *  3. Runs all table migrations on the public schema (safe to re-run)
 *  4. Migrates any existing users into platform.tenant_users
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  const { initPlatformSchema, initShopSchema } = require('./tenant');
  const client = await pool.connect();
  try {
    // 1. Set up the platform schema (tenants + tenant_users tables)
    await initPlatformSchema(client);

    // 2. Register the default Super Eagle tenant pointing at `public`
    await client.query(`SET search_path TO platform, public`);
    await client.query(`
      INSERT INTO platform.tenants (slug, name, schema)
      VALUES ('supereagle', 'Super Eagle Auto Care', 'public')
      ON CONFLICT (slug) DO NOTHING
    `);

    // 3. Run all table migrations on the public schema
    await initShopSchema(client, 'public');

    // 4. Apply any column migrations that may be missing on older installs
    await client.query(`SET search_path TO public`);
    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS fleet_research TEXT`);

    // 5. Migrate any existing users into platform.tenant_users
    await client.query(`SET search_path TO platform, public`);
    const { rows: users } = await client.query(`SELECT email FROM public.users`);
    for (const u of users) {
      await client.query(
        `INSERT INTO platform.tenant_users (email, schema) VALUES ($1, 'public') ON CONFLICT (email) DO NOTHING`,
        [u.email]
      );
    }

    // 6. Seed the Super Eagle default admin user if this is a brand-new install
    await client.query(`SET search_path TO public`);
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('6521', 10);
    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Nathan', 'nathan@supereagleautocare.com', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [hash]);

    // Ensure the default admin is also in platform.tenant_users
    await client.query(`SET search_path TO platform, public`);
    await client.query(`
      INSERT INTO platform.tenant_users (email, schema)
      VALUES ('nathan@supereagleautocare.com', 'public')
      ON CONFLICT (email) DO NOTHING
    `);

    console.log('✅ PostgreSQL database ready');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = pool;
module.exports.initDb = initDb;
module.exports.pool = pool;
