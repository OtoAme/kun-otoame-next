import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  assertNoSharedNextDevLock,
  assertSoleE2EDevServer,
  buildE2ECompanyServerLaunchConfig,
  forwardE2EServerSignals,
  parseE2EResolverMode
} from '~/scripts/e2eCompanyIdentityServer'

describe('company identity E2E server launcher', () => {
  it('keeps the safe database, server, and runner package entries', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['e2e:db:prepare']).toBe(
      'node --env-file=.env scripts/e2eDatabasePreparation.ts'
    )
    expect(pkg.scripts['e2e:company-server']).toBe(
      'esno scripts/e2eCompanyIdentityServer.ts'
    )
    expect(pkg.scripts['e2e:company-identity']).toBe(
      'node --env-file=.env tests/e2e/company-identity.e2e.ts'
    )
  })

  it.each([
    [['--resolver=off'], 'off'],
    [['--resolver=on'], 'on'],
    [['--', '--resolver=off'], 'off']
  ] as const)('accepts the explicit resolver mode %j', (args, expected) => {
    expect(parseE2EResolverMode([...args])).toBe(expected)
  })

  it.each([
    { args: [] },
    { args: ['--resolver=true'] },
    { args: ['--resolver=on', '--port=3000'] },
    { args: ['on'] }
  ])('rejects unsafe or ambiguous arguments: $args', ({ args }) => {
    expect(() => parseE2EResolverMode(args)).toThrow(
      'requires exactly --resolver=off|on'
    )
  })

  it('builds a fixed loopback server and overrides every external side effect', () => {
    const sourceEnv = {
      KUN_E2E_DATABASE_URL:
        'postgresql://tester:secret@127.0.0.1:5432/touchgal_e2e',
      KUN_DATABASE_URL: 'postgresql://tester@db.example.invalid/production',
      NODE_ENV: 'production',
      KUN_COMPANY_IDENTITY_RESOLVER_ENABLED: 'false',
      NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV: 'http://127.0.0.1:3000',
      KUN_CF_CACHE_ZONE_ID: 'production-zone',
      KUN_CF_CACHE_PURGE_API_TOKEN: 'production-token',
      KUN_VISUAL_NOVEL_INDEX_NOW_KEY: 'production-index-key'
    }

    const config = buildE2ECompanyServerLaunchConfig(
      ['--resolver=on'],
      sourceEnv
    )

    expect(config.command).toBe('pnpm')
    expect(config.args).toEqual([
      'exec',
      'next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100'
    ])
    expect(config.databaseName).toBe('touchgal_e2e')
    expect(config.resolverMode).toBe('on')
    expect(config.env).toMatchObject({
      KUN_DATABASE_URL:
        'postgresql://tester:secret@127.0.0.1:5432/touchgal_e2e',
      NODE_ENV: 'development',
      KUN_COMPANY_IDENTITY_RESOLVER_ENABLED: 'true',
      NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV: 'http://127.0.0.1:3100',
      KUN_E2E_BASE_URL: 'http://127.0.0.1:3100',
      KUN_E2E_ORIGIN: 'http://127.0.0.1:3100',
      KUN_CF_CACHE_ZONE_ID: '',
      KUN_CF_CACHE_PURGE_API_TOKEN: '',
      KUN_VISUAL_NOVEL_INDEX_NOW_KEY: ''
    })
    expect(sourceEnv.KUN_CF_CACHE_ZONE_ID).toBe('production-zone')
  })

  it('fails closed without an explicit safe _e2e database', () => {
    expect(() =>
      buildE2ECompanyServerLaunchConfig(['--resolver=off'], {})
    ).toThrow('KUN_E2E_DATABASE_URL is required')
    expect(() =>
      buildE2ECompanyServerLaunchConfig(['--resolver=off'], {
        KUN_E2E_DATABASE_URL: 'postgresql://tester@localhost/touchgal'
      })
    ).toThrow('whose name ends in _e2e')
  })

  it('rejects the application database itself even when its name ends in _e2e', () => {
    const databaseUrl = 'postgresql://tester@127.0.0.1:5432/touchgal_e2e'

    expect(() =>
      buildE2ECompanyServerLaunchConfig(['--resolver=on'], {
        KUN_E2E_DATABASE_URL: databaseUrl,
        KUN_DATABASE_URL: databaseUrl
      })
    ).toThrow('KUN_E2E_DATABASE_URL must not equal KUN_DATABASE_URL')
  })

  it('checks both shared Next dev ports before launch', async () => {
    const probe = vi.fn(async () => undefined)

    await assertSoleE2EDevServer(probe)

    expect(probe.mock.calls).toEqual([
      [3000, '127.0.0.1'],
      [3100, '127.0.0.1']
    ])
  })

  it('refuses an existing shared Next dev lock', () => {
    expect(() =>
      assertNoSharedNextDevLock(() => true, '/repo/.next/dev/lock')
    ).toThrow('stop the other dev server first')
    expect(() =>
      assertNoSharedNextDevLock(() => false, '/repo/.next/dev/lock')
    ).not.toThrow()
  })

  it('forwards SIGINT and SIGTERM and removes both handlers', () => {
    const source = new EventEmitter()
    const child = { kill: vi.fn() }
    const cleanup = forwardE2EServerSignals(source, child)

    source.emit('SIGINT')
    source.emit('SIGTERM')
    expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGTERM']])

    cleanup()
    source.emit('SIGINT')
    expect(child.kill).toHaveBeenCalledTimes(2)
  })
})
