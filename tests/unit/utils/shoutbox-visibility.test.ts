import { afterEach, expect, it, vi } from 'vitest'
import { scheduleShoutboxDeadline } from '~/utils/shoutboxVisibility'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for a real deadline beyond the browser timer range', () => {
  vi.useFakeTimers()
  const delay = 40 * 86400_000
  const onDue = vi.fn()
  scheduleShoutboxDeadline(Date.now() + delay, onDue)
  vi.advanceTimersByTime(2 ** 31 - 1)
  expect(onDue).not.toHaveBeenCalled()
  vi.advanceTimersByTime(delay - (2 ** 31 - 1) - 1)
  expect(onDue).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(onDue).toHaveBeenCalledTimes(1)
})

it('cancels the remaining segment after a long timer wakes', () => {
  vi.useFakeTimers()
  const onDue = vi.fn()
  const cancel = scheduleShoutboxDeadline(Date.now() + 40 * 86400_000, onDue)
  vi.advanceTimersByTime(2 ** 31 - 1)
  cancel()
  vi.advanceTimersByTime(40 * 86400_000)
  expect(onDue).not.toHaveBeenCalled()
})
