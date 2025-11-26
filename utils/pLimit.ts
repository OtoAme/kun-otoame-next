/**
 * A simple concurrency limiter.
 * @param concurrency The maximum number of concurrent promises.
 * @returns A function that takes a promise-returning function and returns a promise that resolves to the result of the function.
 */
export const pLimit = (concurrency: number) => {
  const queue: (() => void)[] = []
  let activeCount = 0

  const next = () => {
    activeCount--
    if (queue.length > 0) {
      const resolve = queue.shift()
      if (resolve) {
        activeCount++
        resolve()
      }
    }
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (activeCount >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    } else {
      activeCount++
    }

    try {
      return await fn()
    } finally {
      next()
    }
  }

  return run
}
