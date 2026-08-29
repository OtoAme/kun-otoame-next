import { describe, expect, it } from 'vitest'
import { createSerialTaskQueue } from '~/utils/serialTaskQueue'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('serial task queue', () => {
  it('runs tasks strictly one after another in enqueue order', async () => {
    const enqueue = createSerialTaskQueue()
    const events: string[] = []
    const first = deferred<void>()
    const second = deferred<void>()

    const firstRun = enqueue(async () => {
      events.push('first:start')
      await first.promise
      events.push('first:end')
    })
    const secondRun = enqueue(async () => {
      events.push('second:start')
      await second.promise
      events.push('second:end')
    })

    await Promise.resolve()
    // The second task has not even started while the first is still in flight.
    expect(events).toEqual(['first:start'])

    first.resolve()
    await firstRun
    await Promise.resolve()
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])

    second.resolve()
    await secondRun
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end'
    ])
  })

  it('lets a task read the state the task before it wrote', async () => {
    const enqueue = createSerialTaskQueue()
    const release = deferred<void>()
    let state = ['a']
    const seen: string[][] = []

    // Both callers derive their next value from the same snapshot moment, which
    // is exactly the interleaving the queue exists to serialize.
    const first = enqueue(async () => {
      await release.promise
      seen.push(state)
      state = [...state, 'b']
    })
    const second = enqueue(async () => {
      seen.push(state)
      state = [...state, 'c']
    })

    release.resolve()
    await Promise.all([first, second])

    expect(seen).toEqual([['a'], ['a', 'b']])
    expect(state).toEqual(['a', 'b', 'c'])
  })

  it('keeps running later tasks after one rejects, and reports each outcome to its own caller', async () => {
    const enqueue = createSerialTaskQueue()
    const events: string[] = []

    const failing = enqueue(async () => {
      events.push('failing')
      throw new Error('storage is gone')
    })
    const following = enqueue(async () => {
      events.push('following')
      return 'done'
    })

    await expect(failing).rejects.toThrow('storage is gone')
    await expect(following).resolves.toBe('done')
    expect(events).toEqual(['failing', 'following'])
  })

  it('keeps two queues independent of each other', async () => {
    const left = createSerialTaskQueue()
    const right = createSerialTaskQueue()
    const events: string[] = []
    const block = deferred<void>()

    const blocked = left(async () => {
      events.push('left:start')
      await block.promise
      events.push('left:end')
    })
    const other = right(async () => {
      events.push('right')
    })

    await other
    // A queue blocked on its own task cannot hold up another instance.
    expect(events).toEqual(['left:start', 'right'])

    block.resolve()
    await blocked
    expect(events).toEqual(['left:start', 'right', 'left:end'])
  })
})
