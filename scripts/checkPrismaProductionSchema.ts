import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import {
  runPrismaProductionSchemaGuard,
  type PrismaDiffResult,
  type ReleasedPatternIndexMetadata
} from './prismaProductionSchemaGuard'

const projectRoot = resolve(import.meta.dirname, '..')

const INDEX_METADATA_QUERY = `
SELECT
  namespace.nspname AS schema_name,
  indexed_table.relname AS table_name,
  index_relation.relname AS index_name,
  indexed_column.attname AS column_name,
  access_method.amname AS access_method,
  operator_class.opcname AS operator_class,
  index_metadata.indnkeyatts AS key_attribute_count,
  index_metadata.indnatts AS total_attribute_count,
  index_metadata.indisunique AS is_unique,
  index_metadata.indisprimary AS is_primary,
  index_metadata.indisvalid AS is_valid,
  index_metadata.indisready AS is_ready,
  index_metadata.indislive AS is_live,
  index_metadata.indpred IS NULL AS has_no_predicate,
  index_metadata.indexprs IS NULL AS has_no_expression
FROM pg_index AS index_metadata
JOIN pg_class AS index_relation
  ON index_relation.oid = index_metadata.indexrelid
JOIN pg_class AS indexed_table
  ON indexed_table.oid = index_metadata.indrelid
JOIN pg_namespace AS namespace
  ON namespace.oid = indexed_table.relnamespace
JOIN pg_am AS access_method
  ON access_method.oid = index_relation.relam
JOIN pg_opclass AS operator_class
  ON operator_class.oid = index_metadata.indclass[0]
JOIN pg_attribute AS indexed_column
  ON indexed_column.attrelid = indexed_table.oid
  AND indexed_column.attnum = index_metadata.indkey[0]
WHERE namespace.nspname = 'public'
  AND indexed_table.relname = 'patch'
  AND index_relation.relname = 'patch_released_idx'
`

const runDiff = async (): Promise<PrismaDiffResult> => {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--exit-code',
      '--from-config-datasource',
      '--to-schema=prisma/schema',
      '--script'
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: process.env
    }
  )

  if (result.error) throw result.error
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

const loadIndexMetadata = async (): Promise<ReleasedPatternIndexMetadata[]> => {
  const connectionString = process.env.KUN_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'KUN_DATABASE_URL is required for production schema verification.'
    )
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000
  })

  try {
    const result =
      await pool.query<ReleasedPatternIndexMetadata>(INDEX_METADATA_QUERY)
    return result.rows
  } finally {
    await pool.end()
  }
}

runPrismaProductionSchemaGuard({
  runDiff,
  loadIndexMetadata,
  log: console.log
}).catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Unknown production schema verification failure.'
  )
  process.exitCode = 1
})
