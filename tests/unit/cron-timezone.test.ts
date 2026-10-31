import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// A separate process gives Intl a real host timezone and bounds any scheduler
// spin. Import only node-cron: no application services or real task callbacks.
const runScheduler = (timezone: string, script: string) => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: process.cwd(),
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
      timeout: 5000
    }
  )
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
}

const hostTimezones = [
  'America/New_York',
  'Europe/Berlin',
  'Asia/Kathmandu',
  'Asia/Shanghai',
  'UTC'
]

describe.each(hostTimezones)('real cron scheduling on host %s', (timezone) => {
  it('keeps Shanghai schedules and next runs independent of host DST', () => {
    runScheduler(
      timezone,
      `
      import assert from 'node:assert/strict'
      import { mock } from 'node:test'
      import cron from 'node-cron'

      const schedules = [
        ['0 0 * * *', 'Asia/Shanghai', '2026-11-01T16:00:00.000Z'],
        ['0 * * * *', undefined, '2026-10-31T21:00:00.000Z'],
        ['*/2 * * * *', undefined, '2026-10-31T20:26:00.000Z'],
        ['0 4 * * *', 'Asia/Shanghai', '2026-11-01T20:00:00.000Z'],
        ['17 * * * *', 'Asia/Shanghai', '2026-10-31T21:17:00.000Z'],
        ['27 * * * *', 'Asia/Shanghai', '2026-10-31T20:27:00.000Z'],
        ['30 4 1,15 * *', 'Asia/Shanghai', '2026-10-31T20:30:00.000Z']
      ]
      const bases = [
        '2026-10-31T20:25:48.000Z',
        '2026-10-31T20:17:00.000Z',
        '2026-11-01T05:59:00.000Z',
        '2026-11-01T06:01:00.000Z',
        '2026-03-08T06:59:00.000Z',
        '2026-03-08T07:01:00.000Z',
        '2026-10-25T00:59:00.000Z',
        '2026-10-25T01:01:00.000Z'
      ]
      for (const base of bases) {
        mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(base) })
        try {
          for (const [expression, zone, expected] of schedules) {
            const task = cron.createTask(expression, () => {}, { timezone: zone })
            try {
              task.start()
              for (let step = 0; step < 3; step++) {
                const next = task.getNextRun()
                assert(next.getTime() > Date.now(), expression + ' must advance at ' + new Date().toISOString())
                if (base === bases[0] && step === 0) {
                  // Kathmandu's :45 offset shifts host-local hour/minute boundaries.
                  const exact = !zone && process.env.TZ === 'Asia/Kathmandu'
                    ? expression === '0 * * * *'
                      ? '2026-10-31T21:15:00.000Z'
                      : '2026-10-31T20:27:00.000Z'
                    : expected
                  assert.equal(next.toISOString(), exact, expression)
                }
                mock.timers.setTime(next.getTime())
              }
              mock.timers.setTime(new Date(base).getTime())
            } finally {
              task.destroy()
            }
          }
        } finally {
          mock.timers.reset()
        }
      }
    `
    )
  })

  it('runs a due callback and returns from delayed-heartbeat catch-up', () => {
    runScheduler(
      timezone,
      `
      import assert from 'node:assert/strict'
      import { mock } from 'node:test'
      import cron from 'node-cron'

      mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-10-31T20:25:48Z') })
      let calls = 0
      const missed = []
      const task = cron.createTask('17 * * * *', () => { calls++ }, { timezone: 'Asia/Shanghai' })
      task.on('execution:missed', context => missed.push(context.date.toISOString()))
      try {
        task.start()
        mock.timers.setTime(new Date('2026-10-31T21:17:00Z').getTime())
        mock.timers.tick(0)
        await new Promise(resolve => setImmediate(resolve))
        mock.timers.tick(0)
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls, 1)
        assert.deepEqual(missed, [])
        assert.equal(task.getNextRun().toISOString(), '2026-10-31T22:17:00.000Z')

        mock.timers.setTime(new Date('2026-10-31T23:17:10Z').getTime())
        mock.timers.tick(0)
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls, 1, 'missed callbacks must not be replayed')
        assert.deepEqual(missed, ['2026-10-31T22:17:00.000Z', '2026-10-31T23:17:00.000Z'])
        assert.equal(task.getNextRun().toISOString(), '2026-11-01T00:17:00.000Z')
      } finally {
        task.destroy()
        mock.timers.reset()
      }
    `
    )
  })
})
