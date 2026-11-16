import { it, expect } from 'vitest'
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
  realpath
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import {
  createIdentity,
  assertContainer,
  digest
} from '~/scripts/worktree/config.mjs'
import {
  WorktreeManager,
  serveDevelopment,
  stopDevelopment
} from '~/scripts/worktree.mjs'
import { run, readJson, pause } from '~/scripts/worktree/runtime.mjs'

const acceptance = process.env.OTOAME_WORKTREE_ACCEPTANCE === '1' ? it : it.skip

acceptance(
  'prepares two disposable worktrees, isolates access, preserves data and controls only its own process',
  async () => {
    const project = resolve(fileURLToPath(new URL('../../', import.meta.url)))
    const primary = await realpath(
      await mkdtemp(join(tmpdir(), 'otoame-worktree-acceptance-'))
    )
    const managers: WorktreeManager[] = []
    let dev: Promise<number> | undefined
    let stopManager: WorktreeManager | undefined
    let cleanupSucceeded = true
    try {
      await copyFile(
        join(project, '.env.worktree.example'),
        join(primary, '.env.worktree.local')
      )
      const runner = async (
        command: string,
        args: string[],
        options: any = {}
      ) => {
        if (command === 'pnpm' && args[0] === 'install')
          return { code: 0, stdout: '', stderr: '' }
        if (command === 'pnpm') {
          const result = await run(command, args, {
            ...options,
            cwd: project,
            env: {
              ...options.env,
              DOTENV_CONFIG_PATH: join(options.cwd, '.env')
            }
          })
          if (result.code !== 0)
            console.error(
              result.stderr
                .replace(/postgresql:\/\/[^\s"'`]+/g, '[database]')
                .replace(/[a-f0-9]{64}/gi, '[secret]')
            )
          return result
        }
        const result = await run(command, args, options)
        if (args.includes('psql') && result.code !== 0)
          console.error(
            result.stderr
              .replace(/postgresql:\/\/[^\s"'`]+/g, '[database]')
              .replace(/[a-f0-9]{64}/gi, '[secret]')
          )
        return result
      }
      for (const name of ['checkout-a', 'checkout-b']) {
        const root = join(primary, name)
        await mkdir(join(root, 'migration'), { recursive: true })
        for (const file of [
          'production-tag-company-count-sync-2026-08-30.sql',
          'production-tag-company-count-postflight-2026-08-30.sql'
        ]) {
          await copyFile(
            join(project, 'migration', file),
            join(root, 'migration', file)
          )
        }
        const manager = new WorktreeManager(createIdentity(root, primary), {
          run: runner,
          log: () => {}
        })
        managers.push(manager)
        await manager.setup()
      }
      const [a, b] = await Promise.all(
        managers.map((manager) => manager.load())
      )
      const pg = await managers[0].sharedState()
      expect(a.appPort).not.toBe(b.appPort)
      expect(a.database).not.toBe(b.database)
      expect(a.redis.id).not.toBe(b.redis.id)
      expect(a.prefix).not.toBe(b.prefix)
      expect((await managers[1].sharedState()).id).toBe(pg.id)
      expect(
        await managers[0].docker.psql(
          pg,
          a.database,
          a.role,
          'SELECT count(*) FROM public."user";'
        )
      ).toBe('3')
      expect(
        await managers[0].docker.psql(
          pg,
          a.database,
          a.role,
          'SELECT count(*) FROM public.user_moemoepoint_ledger;'
        )
      ).toBe('3')
      const credentials = await managers[0].credentials()
      const denied = await managers[0].docker.run(
        'docker',
        [
          'exec',
          '-i',
          pg.id,
          'sh',
          '-c',
          'read -r PGPASSWORD; export PGPASSWORD; exec psql "$@"',
          'sh',
          '-X',
          '--no-password',
          '-h',
          '127.0.0.1',
          '-U',
          a.role,
          '-d',
          b.database,
          '-c',
          'SELECT 1'
        ],
        { input: `${credentials.databasePassword}\n` }
      )
      expect(denied.code).not.toBe(0)
      expect(denied.stderr).toContain('permission denied for database')

      await managers[0].docker.psql(
        pg,
        a.database,
        a.role,
        `UPDATE public."user" SET bio='keep-after-setup' WHERE name='wt_user';`
      )
      const hash = digest(await readFile(managers[0].secretsPath, 'utf8'))
      await managers[0].setup()
      expect(digest(await readFile(managers[0].secretsPath, 'utf8'))).toBe(hash)
      expect(
        await managers[0].docker.psql(
          pg,
          a.database,
          a.role,
          `SELECT bio FROM public."user" WHERE name='wt_user';`
        )
      ).toBe('keep-after-setup')
      const env = parseEnv(await readFile(join(a.root, '.env'), 'utf8'))
      expect(env.KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX).toBe(a.prefix)
      expect(env.KUN_ENABLE_CRON).toBe('false')
      expect(env.KUN_CF_CACHE_PURGE_API_TOKEN).toBe('')

      // A controlled Node server exercises launcher ownership and stop handling;
      // this is not a Next/browser or external-storage acceptance test.
      const nextBin = join(a.root, 'node_modules', 'next', 'dist', 'bin')
      await mkdir(nextBin, { recursive: true })
      await writeFile(
        join(nextBin, 'next'),
        `
      const http = require('node:http');
      const server = http.createServer((req,res) => res.end(process.env.OTOAME_WORKTREE_ID));
      server.listen(Number(process.env.PORT), '127.0.0.1');
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
      )
      stopManager = managers[0]
      dev = serveDevelopment(managers[0])
      for (
        let attempt = 0;
        attempt < 80 && (await managers[0].probe(a.appPort));
        attempt++
      )
        await pause(100)
      const response = await fetch(`http://127.0.0.1:${a.appPort}`)
      expect(await response.text()).toBe(a.id)
      await stopDevelopment(managers[0])
      expect(await dev).toBe(0)
      dev = undefined
      stopManager = undefined
      expect(await managers[0].status()).toMatchObject({
        redisRunning: false,
        postgresRunning: true
      })
      expect(await managers[0].probe(a.appPort)).toBe(true)
    } finally {
      if (dev && stopManager) {
        try {
          await stopDevelopment(stopManager)
          await dev
        } catch {
          cleanupSucceeded = false
        }
      }
      const resources: any[] = []
      for (const manager of managers) {
        const state = await readJson(manager.statePath, true)
        if (state?.redis?.id) resources.push(state.redis)
      }
      if (managers.length) {
        const shared = await readJson(managers[0].sharedPath, true)
        if (shared?.id) resources.push(shared)
      }
      for (const resource of resources) {
        try {
          await managers[0].docker.verify(resource)
          await managers[0].docker.command(
            ['rm', '-f', resource.id],
            undefined,
            '清理验收容器'
          )
          const labels = await managers[0].docker.command([
            'volume',
            'inspect',
            '--format',
            '{{json .Labels}}',
            resource.volume
          ])
          assertContainer(
            { id: 'volume', labels: JSON.parse(labels) },
            resource.labels
          )
          await managers[0].docker.command(
            ['volume', 'rm', resource.volume],
            undefined,
            '清理验收数据卷'
          )
        } catch {
          cleanupSucceeded = false
        }
      }
      if (cleanupSucceeded) await rm(primary, { recursive: true, force: true })
      else
        throw new Error(`验收清理未完成，保留本次运行目录以便核对：${primary}`)
    }
  },
  240_000
)
