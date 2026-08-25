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

const cleanupMocks = vi.hoisted(() => ({
  dependencies: { close: vi.fn() },
  createDependencies: vi.fn(),
  run: vi.fn(),
  print: vi.fn()
}))
vi.mock('~/scripts/cleanupSubmissionAssets', () => ({
  createSubmissionAssetCleanupDependencies: cleanupMocks.createDependencies,
  runSubmissionAssetCleanup: cleanupMocks.run,
  printSubmissionAssetCleanupSummary: cleanupMocks.print
}))

const withTaskLockMock = vi.hoisted(() => vi.fn())
vi.mock('~/server/tasks/withTaskLock', () => ({
  withTaskLock: withTaskLockMock
}))

import {
  cleanupSubmissionAssetsTask,
  inspectSubmissionAssets
} from '~/server/tasks/cleanupSubmissionAssetsTask'

beforeEach(() => {
  vi.clearAllMocks()
  cleanupMocks.createDependencies.mockResolvedValue(cleanupMocks.dependencies)
  cleanupMocks.run.mockResolvedValue({
    newOrphans: [],
    cleanupSubmissionIds: []
  })
  withTaskLockMock.mockImplementation(
    (_options: unknown, task: () => Promise<unknown>) => task()
  )
})

describe('cleanupSubmissionAssetsTask', () => {
  it('is a stopped daily 04:00 Asia/Shanghai task with a long scan lock', () => {
    expect(cleanupSubmissionAssetsTask).toBeTruthy()
    expect(cronMock.expression).toBe('0 4 * * *')
    expect(cronMock.options).toEqual({
      timezone: 'Asia/Shanghai',
      noOverlap: true
    })
    expect(cronMock.start).not.toHaveBeenCalled()
  })

  it('runs only dry inspection and never closes the shared Prisma client', async () => {
    await inspectSubmissionAssets()

    expect(cleanupMocks.run).toHaveBeenCalledWith(
      { apply: false, graceHours: 24 },
      cleanupMocks.dependencies
    )
    expect(cleanupMocks.print).toHaveBeenCalled()
    expect(cleanupMocks.dependencies.close).not.toHaveBeenCalled()
  })

  it('executes through the multi-instance task lock', async () => {
    await cronMock.callback?.()

    expect(withTaskLockMock).toHaveBeenCalledWith(
      {
        key: 'cron:submission-assets-audit:lock',
        ttlSeconds: 8 * 60 * 60,
        taskName: 'cleanupSubmissionAssetsTask'
      },
      inspectSubmissionAssets
    )
  })
})
