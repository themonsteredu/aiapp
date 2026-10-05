'use strict';
// Prints the SQL that prepares the disposable online plaza test project, as numbered files.
// It never connects to a database: the files are applied to that one project by hand (or MCP),
// in order, as the project owner. docs/plaza-online-test.md has the procedure.
//   node scripts/plaza-online-schema.js <PLAZA_TEST_ID> <output directory>
const fs = require('node:fs');
const path = require('node:path');
const { TEST_REF } = require('../lib/plaza-online');

async function appSchema() {
  // lib/db.js init() is the only source of the app tables. Run it against a recorder instead of a
  // database and keep the statements without parameters (DDL). Seeds stay with the app's first
  // request, so the superadmin password is set from SUPERADMIN_PASSWORD there, never here.
  process.env.DATABASE_URL = 'postgres://schema-capture@127.0.0.1/schema_capture';
  delete process.env.PLAZA_ONLINE_TEST;
  const { Pool } = require('pg');
  const statements = [];
  Pool.prototype.query = async function capture(sql, params) {
    if ((!params || !params.length) && !/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql.trim())) statements.push(sql.trim().replace(/;\s*$/, ''));
    // Pretend every seed row already exists so init() only walks its DDL.
    return { rows: [{ c: 1, id: 1 }] };
  };
  await require('../lib/db').ready();
  return statements;
}

async function main() {
  const [testId, out] = process.argv.slice(2);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(testId || '') || !out) {
    throw new Error('usage: node scripts/plaza-online-schema.js <PLAZA_TEST_ID> <output directory>');
  }
  const read = name => fs.readFileSync(path.join(__dirname, '..', 'db', name), 'utf8');
  // Session-level settings: the guards in db/plaza-*.sql read them in every following statement.
  const marked = sql => `SELECT set_config('plaza.test_id', '${testId}', false), set_config('plaza.online_ref', '${TEST_REF}', false);\n${sql}`;
  const files = [
    ['01-lock-data-api.sql', `-- The app connects as the table owner through the pooler. The Data API never needs these tables.
-- PUBLIC too: anon and authenticated inherit its default USAGE on the public schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
`],
    ['02-app-schema.sql', (await appSchema()).join(';\n') + ';\n'],
    ['03-career-log.sql', read('plaza-test-career-log.sql') + read('job-career-log.sql')],
    ['04-plaza-stage1.sql', marked(read('plaza-stage1.sql'))],
    ['05-plaza-stage2.sql', marked(read('plaza-stage2.sql'))],
    ['06-plaza-stage3.sql', marked(read('plaza-stage3.sql'))],
    ['07-plaza-stage4.sql', marked(read('plaza-stage4.sql'))],
    ['08-plaza-storage.sql', marked(read('plaza-online-storage.sql'))],
    ['09-lock-tables.sql', `-- Every table, including the app's own, stays closed to the Data API roles.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'career_log') AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
  END LOOP;
END $$;
`],
  ];
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  for (const [name, sql] of files) fs.writeFileSync(path.join(out, name), sql, { mode: 0o600 });
  console.log(JSON.stringify({ project: TEST_REF, files: files.map(([name]) => name) }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
