import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertSafeBackupDestination,
  buildDockerPgDumpCommand,
  buildDockerPgRestoreListCommand,
  buildDockerPsqlCommand,
  parseE2EDatabaseTarget,
  parseE2EPgContainer,
  prepareE2EDatabase
} from '~/scripts/e2eDatabasePreparation'

describe('E2E database preparation target guard', () => {
  it('accepts an explicit PostgreSQL database whose name ends in _e2e', () => {
    const target = parseE2EDatabaseTarget(
      'postgresql://tester:secret@127.0.0.1:5432/touchgal_e2e'
    )

    expect(target.databaseName).toBe('touchgal_e2e')
    expect(target.host).toBe('127.0.0.1')
  })

  it.each([
    ['the development database', 'postgresql://tester@localhost/touchgal'],
    ['a suffix lookalike', 'postgresql://tester@localhost/touchgal_e2e_backup'],
    ['a non-PostgreSQL URL', 'mysql://tester@localhost/touchgal_e2e'],
    ['a URL without a database', 'postgresql://tester@localhost/']
  ])('rejects %s', (_label, value) => {
    expect(() => parseE2EDatabaseTarget(value)).toThrow(
      /disposable PostgreSQL database whose name ends in _e2e/
    )
  })

  it('rejects the exact database used by the running application', () => {
    const value = 'postgresql://tester@localhost/touchgal_e2e'

    expect(() => parseE2EDatabaseTarget(value, value)).toThrow(
      'KUN_E2E_DATABASE_URL must not equal KUN_DATABASE_URL'
    )
  })

  it('rejects the same host and database even when credentials and URL spelling differ', () => {
    expect(() =>
      parseE2EDatabaseTarget(
        'postgresql://e2e_user@localhost/touchgal_e2e',
        'postgres://app_user:other@localhost:5432/touchgal_e2e?schema=public'
      )
    ).toThrow('KUN_E2E_DATABASE_URL must not equal KUN_DATABASE_URL')
  })

  it('treats loopback aliases as the same database host', () => {
    expect(() =>
      parseE2EDatabaseTarget(
        'postgresql://e2e_user@127.0.0.1/touchgal_e2e',
        'postgresql://app_user@[::1]:5432/touchgal_e2e'
      )
    ).toThrow('KUN_E2E_DATABASE_URL must not equal KUN_DATABASE_URL')
  })

  it('fails closed when the application database URL cannot be compared', () => {
    expect(() =>
      parseE2EDatabaseTarget(
        'postgresql://e2e_user@localhost/touchgal_e2e',
        'not-a-database-url'
      )
    ).toThrow(
      'KUN_DATABASE_URL is invalid, so the E2E target cannot be compared safely'
    )
  })

  it('rejects an encoded database path separator', () => {
    expect(() =>
      parseE2EDatabaseTarget(
        'postgresql://tester@localhost/archive%2Ftouchgal_e2e'
      )
    ).toThrow(/disposable PostgreSQL database whose name ends in _e2e/)
  })

  it('rejects a backup destination reached through a symbolic-link directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-e2e-backup-'))
    const realDirectory = join(root, 'real')
    const linkedDirectory = join(root, 'linked')
    mkdirSync(realDirectory)
    symlinkSync(realDirectory, linkedDirectory, 'dir')
    try {
      expect(() =>
        assertSafeBackupDestination(join(linkedDirectory, 'backup.dump'))
      ).toThrow('must not contain symlinks')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    '',
    '-postgres18',
    ' postgres18',
    'postgres18 ',
    'postgres/18',
    'postgres 18',
    `p${'x'.repeat(128)}`
  ])('rejects an unsafe Docker container name: %j', (container) => {
    const target = parseE2EDatabaseTarget(
      'postgresql://tester@127.0.0.1:5432/touchgal_e2e'
    )
    expect(() => parseE2EPgContainer(container, target)).toThrow(
      'KUN_E2E_PG_CONTAINER is not a valid Docker container name'
    )
  })

  it('allows Docker PostgreSQL only for a loopback target', () => {
    const remote = parseE2EDatabaseTarget(
      'postgresql://tester@db.example.invalid:5432/touchgal_e2e'
    )
    expect(() => parseE2EPgContainer('postgres18', remote)).toThrow(
      'requires a loopback KUN_E2E_DATABASE_URL target'
    )
  })

  it('rejects a remote Docker target before backup or reset starts', async () => {
    const createBackup = vi.fn()
    const resetSchema = vi.fn()

    await expect(
      prepareE2EDatabase(
        {
          databaseUrl:
            'postgresql://tester@db.example.invalid:5432/touchgal_e2e',
          backupPath: '/private/tmp/touchgal_e2e.dump',
          resetConfirmed: true,
          pgContainer: 'postgres18'
        },
        {
          createBackup,
          resetSchema,
          runSqlFile: vi.fn(),
          seed: vi.fn()
        }
      )
    ).rejects.toThrow('requires a loopback KUN_E2E_DATABASE_URL target')
    expect(createBackup).not.toHaveBeenCalled()
    expect(resetSchema).not.toHaveBeenCalled()
  })

  it('builds Docker PostgreSQL commands without a URL or password argument', () => {
    const target = parseE2EDatabaseTarget(
      'postgresql://tester:secret@127.0.0.1:5432/touchgal_e2e'
    )
    const container = parseE2EPgContainer('postgres18', target)

    expect(buildDockerPgDumpCommand(container, target)).toEqual({
      command: 'docker',
      args: [
        'exec',
        'postgres18',
        'pg_dump',
        '-Fc',
        '--no-password',
        '-U',
        'tester',
        '-d',
        'touchgal_e2e'
      ]
    })
    expect(buildDockerPgRestoreListCommand(container)).toEqual({
      command: 'docker',
      args: ['exec', '-i', 'postgres18', 'pg_restore', '--list']
    })
    expect(buildDockerPsqlCommand(container, target)).toEqual({
      command: 'docker',
      args: [
        'exec',
        '-i',
        'postgres18',
        'psql',
        '-X',
        '--set',
        'ON_ERROR_STOP=on',
        '--no-password',
        '-U',
        'tester',
        '-d',
        'touchgal_e2e'
      ]
    })

    const serialized = JSON.stringify([
      buildDockerPgDumpCommand(container, target),
      buildDockerPgRestoreListCommand(container),
      buildDockerPsqlCommand(container, target)
    ])
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('postgresql://')
  })

  it('backs up before reset, installs triggers, verifies both contracts, then seeds', async () => {
    const calls: string[] = []
    const seedResult = {
      submitterUid: 1,
      reviewerUid: 2,
      patchUniqueId: 'e2e00001'
    }

    const result = await prepareE2EDatabase(
      {
        databaseUrl: 'postgresql://tester@localhost/touchgal_e2e',
        applicationDatabaseUrl: 'postgresql://tester@localhost/touchgal',
        backupPath: '/tmp/touchgal_e2e.dump',
        resetConfirmed: true
      },
      {
        createBackup: vi.fn(() => calls.push('backup')),
        resetSchema: vi.fn(() => calls.push('reset')),
        runSqlFile: vi.fn((_target, filePath) =>
          calls.push(filePath.split('/').at(-1) ?? filePath)
        ),
        seed: vi.fn(async () => {
          calls.push('seed')
          return seedResult
        })
      }
    )

    expect(result).toEqual(seedResult)
    expect(calls).toEqual([
      'backup',
      'reset',
      'production-tag-company-count-sync-2026-08-30.sql',
      'production-tag-company-count-postflight-2026-08-30.sql',
      'production-company-identity-constraint-postflight-2026-08-30.sql',
      'seed'
    ])
  })

  it('does not perform any work without an explicit reset confirmation', async () => {
    const createBackup = vi.fn()

    await expect(
      prepareE2EDatabase(
        {
          databaseUrl: 'postgresql://tester@localhost/touchgal_e2e',
          backupPath: '/tmp/touchgal_e2e.dump',
          resetConfirmed: false as true
        },
        {
          createBackup,
          resetSchema: vi.fn(),
          runSqlFile: vi.fn(),
          seed: vi.fn()
        }
      )
    ).rejects.toThrow('requires explicit reset confirmation')
    expect(createBackup).not.toHaveBeenCalled()
  })

  it('stops before reset when the verified backup fails', async () => {
    const resetSchema = vi.fn()

    await expect(
      prepareE2EDatabase(
        {
          databaseUrl: 'postgresql://tester@localhost/touchgal_e2e',
          backupPath: '/tmp/touchgal_e2e.dump',
          resetConfirmed: true
        },
        {
          createBackup: vi.fn(() => {
            throw new Error('backup verification failed')
          }),
          resetSchema,
          runSqlFile: vi.fn(),
          seed: vi.fn()
        }
      )
    ).rejects.toThrow('backup verification failed')
    expect(resetSchema).not.toHaveBeenCalled()
  })

  it('does not seed if a postflight fails', async () => {
    const seed = vi.fn()

    await expect(
      prepareE2EDatabase(
        {
          databaseUrl: 'postgresql://tester@localhost/touchgal_e2e',
          backupPath: '/tmp/touchgal_e2e.dump',
          resetConfirmed: true
        },
        {
          createBackup: vi.fn(),
          resetSchema: vi.fn(),
          runSqlFile: vi.fn((_target, filePath) => {
            if (filePath.includes('count-postflight')) {
              throw new Error('postflight failed')
            }
          }),
          seed
        }
      )
    ).rejects.toThrow('postflight failed')
    expect(seed).not.toHaveBeenCalled()
  })
})
