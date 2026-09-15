import { resetDailyTask } from './tasks/resetDailyTask'
import { setCleanupTask } from './tasks/setCleanupTask'
import { flushPatchViewsTask } from './tasks/flushPatchViewsTask'
import { cleanupSubmissionAssetsTask } from './tasks/cleanupSubmissionAssetsTask'
import { caseTimeoutTask } from './tasks/caseTimeoutTask'

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
  isTaskStarted = true
}
