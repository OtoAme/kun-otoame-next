import { describe, expect, it, vi } from 'vitest'

const taskMocks = vi.hoisted(() => ({
  reset: vi.fn(),
  cleanup: vi.fn(),
  views: vi.fn(),
  submissionAssets: vi.fn()
}))

vi.mock('~/server/tasks/resetDailyTask', () => ({
  resetDailyTask: { start: taskMocks.reset }
}))
vi.mock('~/server/tasks/setCleanupTask', () => ({
  setCleanupTask: { start: taskMocks.cleanup }
}))
vi.mock('~/server/tasks/flushPatchViewsTask', () => ({
  flushPatchViewsTask: { start: taskMocks.views }
}))
vi.mock('~/server/tasks/cleanupSubmissionAssetsTask', () => ({
  cleanupSubmissionAssetsTask: { start: taskMocks.submissionAssets }
}))

import { setKUNGalgameTask } from '~/server/cron'

describe('server cron registration', () => {
  it('starts the submission asset inspection exactly once with the task set', () => {
    setKUNGalgameTask()
    setKUNGalgameTask()

    expect(taskMocks.reset).toHaveBeenCalledTimes(1)
    expect(taskMocks.cleanup).toHaveBeenCalledTimes(1)
    expect(taskMocks.views).toHaveBeenCalledTimes(1)
    expect(taskMocks.submissionAssets).toHaveBeenCalledTimes(1)
  })
})
