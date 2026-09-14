/** The migration ledger's definition, shared by the runner and the SQL exporter.
 *
 *  Kept free of any database import so the exporter can build an import file
 *  without a connection. If the two copies of this table ever differed, a
 *  database set up by import would confuse `db:migrate` later — it would either
 *  fail to read the ledger or re-apply a migration that already ran. */

export const LEDGER_TABLE = 'schema_migrations';

export const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  name        VARCHAR(255) NOT NULL,
  applied_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
