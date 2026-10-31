import { resetDailyTask } from './tasks/resetDailyTask'
import { setCleanupTask } from './tasks/setCleanupTask'
import { flushPatchViewsTask } from './tasks/flushPatchViewsTask'
import { cleanupSubmissionAssetsTask } from './tasks/cleanupSubmissionAssetsTask'
import { caseTimeoutTask } from './tasks/caseTimeoutTask'
import { linkHealthTask } from './tasks/linkHealthTask'
import { pruneDailyActiveTask } from './tasks/pruneDailyActiveTask'

let isTaskStarted = false

export const setKUNGalgameTask = () => {
  if (isTaskStarted) {
    return
  }

  resetDailyTask.start()
  setCleanupTask.start()
  flushPatchViewsTask.start()
  cleanupSubmissionAssetsTask.start()
  caseTimeoutTask.start()
  linkHealthTask.start()
  pruneDailyActiveTask.start()
  isTaskStarted = true
}
