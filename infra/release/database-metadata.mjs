import { parseEnv } from "node:util"

export function databaseQuery(runtime, sql) {
  return runtime
    .compose(
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "bootstrap_admin",
      "-d",
      "enterprise_admin",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql
    )
    .trim()
}

export function readDatabaseMetadata(runtime) {
  const os = parseEnv(
    runtime.compose("exec", "-T", "postgres", "cat", "/etc/os-release")
  )
  const database = JSON.parse(
    databaseQuery(
      runtime,
      `SELECT jsonb_build_object('serverVersionNum',current_setting('server_version_num')::int,'encoding',pg_encoding_to_char(encoding),'sorting',jsonb_build_object('provider',datlocprovider,'collate',datcollate,'ctype',datctype,'locale',datlocale,'version',datcollversion,'actualVersion',pg_database_collation_actual_version(oid)))::text FROM pg_database WHERE datname=current_database()`
    )
  )
  const sortingProbe = JSON.parse(
    databaseQuery(
      runtime,
      "SELECT jsonb_agg(value ORDER BY value)::text FROM (VALUES ('Z'),('ä'),('Å'),('a'),('a-a'),('a_a'),('北京')) probe(value)"
    )
  )
  return {
    ...database,
    sortingProbe,
    os: { id: os.ID, versionId: os.VERSION_ID },
  }
}
