/**
 * Runs enqueued tasks one at a time, in the order they were enqueued.
 *
 * The point is read-modify-write safety, not throughput: a task may read shared
 * state, derive a whole new value from it and write it back, and the next task
 * is guaranteed to read what the previous one left behind rather than the
 * snapshot they both started from.
 *
 * A rejected task does not break the chain — the one behind it runs either way,
 * because a failed write must not silently strand every later write. Each
 * caller still sees only its own task's outcome.
 */
export type SerialTaskQueue = <T>(task: () => Promise<T>) => Promise<T>

export const createSerialTaskQueue = (): SerialTaskQueue => {
  let tail: Promise<unknown> = Promise.resolve()

  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}
