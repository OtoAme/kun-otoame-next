import { beforeEach, describe, expect, it, vi } from 'vitest'

const cronMock = vi.hoisted(() => ({
  expression: '',
  callback: undefined as undefined | (() => Promise<void>),
  options: undefined as undefined | Record<string, unknown>,
  start: vi.fn()
}))
vi.mock('node-cron', () => ({
  default: {
    createTask: (
      expression: string,
      callback: () => Promise<void>,
      options: Record<string, unknown>
    ) => {
      cronMock.expression = expression
      cronMock.callback = callback
      cronMock.options = options
      return { start: cronMock.start }
    }
  }
}))

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), withTaskLock: vi.fn() }))
vi.mock('~/prisma', () => ({ prisma: { $executeRaw: mocks.executeRaw } }))
vi.mock('~/server/tasks/withTaskLock', () => ({
  withTaskLock: mocks.withTaskLock
}))

import {
  dailyActiveCutoff,
  pruneDailyActive,
  pruneDailyActiveTask
} from '~/server/tasks/pruneDailyActiveTask'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withTaskLock.mockImplementation(
    (_options: unknown, task: () => Promise<unknown>) => task()
  )
})

describe('pruneDailyActiveTask', () => {
  it('runs on the 1st and 15th at 04:30 Shanghai time, not started on import', () => {
    expect(pruneDailyActiveTask).toBeTruthy()
    expect(cronMock.expression).toBe('30 4 1,15 * *')
    expect(cronMock.options).toEqual({
      timezone: 'Asia/Shanghai',
      noOverlap: true
    })
    expect(cronMock.start).not.toHaveBeenCalled()
  })

  it('keeps the last 90 Shanghai calendar days, today included', () => {
    // 2026-10-31 20:00 UTC is 11-01 in Shanghai; 90 days ending 11-01
    // start on 08-04.
    expect(dailyActiveCutoff(new Date('2026-10-31T20:00:00Z'))).toBe(
      '2026-08-04'
    )
  })

  it('deletes in batches below the cutoff and stops on a short batch', async () => {
    mocks.executeRaw
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(120)
    const removed = await pruneDailyActive(new Date('2026-10-31T20:00:00Z'))
    expect(removed).toBe(10120)
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3)
    const [sql, ...values] = mocks.executeRaw.mock.calls[0]
    expect(sql.join('?')).toContain('day < ?::date')
    expect(values).toEqual(['2026-08-04', 5000])
  })

  it('runs through the multi-instance lock and logs instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.executeRaw.mockRejectedValue(new Error('db down'))
    await cronMock.callback!()
    expect(mocks.withTaskLock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'cron:prune-daily-active:lock',
        taskName: 'pruneDailyActiveTask'
      }),
      expect.any(Function)
    )
    expect(error).toHaveBeenCalledWith(
      'Error pruning daily activity:',
      expect.any(Error)
    )
    error.mockRestore()
  })
})
