import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  confirmReplayDatabase,
  parseReplayArguments
} from '../../scripts/replayResourceFileCleanup'

describe('resource file cleanup replay arguments', () => {
  const source = readFileSync('scripts/replayResourceFileCleanup.ts', 'utf8')
  const secretUrl = 'postgresql://owner:s3cret-token@127.0.0.1:55432/touchgal'

  it('rejects command-line connection strings without echoing them', () => {
    expect(source).not.toContain('FORBIDDEN_DATABASE')
    expect(source).not.toContain('touchgal')
    const refused = parseReplayArguments([
      '--database-url',
      secretUrl,
      '--confirm-database',
      'touchgal'
    ])
    expect(refused).toEqual({
      error: 'connection string is not accepted on the command line'
    })
    expect(JSON.stringify(refused)).not.toContain('s3cret-token')
    const unknown = parseReplayArguments([secretUrl])
    expect(unknown).toEqual({ error: 'unrecognized replay argument' })
    expect(JSON.stringify(unknown)).not.toContain('s3cret-token')
    expect(parseReplayArguments([])).toEqual({ error: 'confirm-database is required' })
  })

  it('accepts an explicit database name and does not put the url in a mismatch error', () => {
    expect(parseReplayArguments(['--confirm-database', 'touchgal', '--limit', '10'])).toEqual({
      confirmDatabase: 'touchgal',
      limit: 10
    })
    expect(parseReplayArguments(['--confirm-database', 'touchgal', '--ids', '4,5'])).toEqual({
      confirmDatabase: 'touchgal',
      ids: [4, 5]
    })
    const mismatch = confirmReplayDatabase(secretUrl, 'other_database')
    expect(mismatch).toEqual({
      error: 'confirm-database must exactly match the configured database name'
    })
    expect(JSON.stringify(mismatch)).not.toContain('s3cret-token')
    expect(confirmReplayDatabase(secretUrl, 'touchgal')).toMatchObject({
      host: '127.0.0.1',
      port: '55432',
      databaseName: 'touchgal'
    })
    expect(confirmReplayDatabase(undefined, 'touchgal')).toEqual({
      error: 'KUN_DATABASE_URL is required'
    })
  })
})