import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(
  new URL('../../ecosystem.config.cjs', import.meta.url),
  'utf8'
)
const evaluate = (pending: boolean) => {
  const config = vi.fn(() => ({ parsed: {} }))
  const module = { exports: {} as any }
  const execute = () =>
    runInNewContext(source, {
      __dirname: '/synthetic-project',
      module,
      require: (name: string) => {
        if (name === 'path') return path
        if (name === 'dotenv') return { config }
        if (name === 'fs')
          return {
            lstatSync: () => {
              if (!pending)
                throw Object.assign(new Error('absent'), { code: 'ENOENT' })
              return {}
            },
            existsSync: () => true
          }
        throw new Error('Unexpected dependency')
      }
    })
  return { config, module, execute }
}

describe('direct PM2 ecosystem startup guard', () => {
  it('refuses unresolved journals before loading configuration or returning an application', () => {
    const scenario = evaluate(true)
    expect(scenario.execute).toThrow('pnpm deploy:rollback --list')
    expect(scenario.config).not.toHaveBeenCalled()
    expect(scenario.module.exports.apps).toBeUndefined()
  })
  it('retains the normal three-instance startup configuration without an unresolved journal', () => {
    const scenario = evaluate(false)
    scenario.execute()
    expect(scenario.module.exports.apps).toHaveLength(1)
    expect(scenario.module.exports.apps[0]).toMatchObject({
      name: 'kun-touchgal-next',
      instances: 3,
      cwd: '/synthetic-project/.deploy/current',
      env: { HOSTNAME: '127.0.0.1', PORT: 3000 }
    })
  })
})
