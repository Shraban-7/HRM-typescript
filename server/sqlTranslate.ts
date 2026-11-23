// Pure SQL dialect translators allowing shared parameterized queries to run identically
// on Supabase PostgreSQL (pg) and local SQLite fallback.

const TABLES_WITHOUT_SERIAL_ID = new Set([
  'company_settings',
  'role_permissions',
  'user_roles',
  'sessions',
  'mfa_challenges',
  'policy_acknowledgements',
]);

/**
 * Converts positional `?` placeholders to PostgreSQL `$1, $2, ...` placeholders
 * while leaving `?` characters inside single-quoted SQL string literals untouched.
 */
export function convertPlaceholdersToPg(sql: string): string {
  let out = '';
  let paramIdx = 1;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        // Escaped single quote inside string literal
        out += "'";
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (ch === '?' && !inSingleQuote) {
      out += `$${paramIdx++}`;
    } else {
      out += ch;
    }
  }

  return out;
}

/**
 * Converts SQLite-compatible DDL into strict PostgreSQL DDL suitable for Supabase Postgres.
 */
export function convertSqliteDdlToPostgres(ddl: string): string {
  return ddl
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION');
}

/**
 * Translates minor SQLite query constructs to PostgreSQL equivalents and optionally
 * appends `RETURNING id` for INSERT statements targeting surrogate-key tables.
 */
export function translateQueryForPg(
  sql: string,
  options: { appendReturningId?: boolean } = {}
): string {
  let translated = sql;

  // Translate GROUP_CONCAT(expr) -> STRING_AGG(expr, ',')
  translated = translated.replace(/GROUP_CONCAT\(\s*([^)]+?)\s*\)/gi, "STRING_AGG($1, ',')");

  // Translate INSERT OR IGNORE INTO ... -> INSERT INTO ... ON CONFLICT DO NOTHING
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(translated)) {
    translated = translated.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
    if (!/\bON\s+CONFLICT\b/i.test(translated)) {
      translated = `${translated.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
    }
  }

  // Convert `?` -> `$1, $2, ...`
  translated = convertPlaceholdersToPg(translated);

  // Append RETURNING id for INSERT into tables with SERIAL id PK
  if (options.appendReturningId) {
    const insertMatch = translated.match(/^\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/i);
    if (
      insertMatch &&
      !TABLES_WITHOUT_SERIAL_ID.has(insertMatch[1].toLowerCase()) &&
      !/\bRETURNING\b/i.test(translated)
    ) {
      translated = `${translated.replace(/;\s*$/, '')} RETURNING id`;
    }
  }

  return translated;
}
