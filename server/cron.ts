import { resetDailyTask } from './tasks/resetDailyTask'
import { setCleanupTask } from './tasks/setCleanupTask'
import { flushPatchViewsTask } from './tasks/flushPatchViewsTask'

let isTaskStarted = false

export const setKUNGalgameTask = () => {
  if (isTaskStarted) {
    return
  }

  resetDailyTask.start()
  setCleanupTask.start()
  flushPatchViewsTask.start()
  isTaskStarted = true
}
