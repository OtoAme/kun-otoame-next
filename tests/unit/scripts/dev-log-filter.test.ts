import { describe, expect, it } from 'vitest'
import {
  createDevLogFilter,
  shouldHideDevLogLine
} from '~/scripts/devLogFilter.mjs'

describe('development request log filter', () => {
  it.each([
    'GET /api/shoutbox 200 in 10ms',
    'GET /api/shoutbox/banner?x=1 200 in 10ms',
    'GET /api/admin/shoutbox/moderate 200 in 10ms'
  ])('hides successful shoutbox GET logs: %s', (line) => {
    expect(shouldHideDevLogLine(line)).toBe(true)
  })

  it.each([
    'GET /api/shoutbox-other 200 in 10ms',
    'GET /api/other?next=/api/shoutbox 200 in 10ms',
    'POST /api/shoutbox 200 in 10ms',
    'GET /api/shoutbox 500 in 10ms',
    'GET /api/shoutbox 304 in 10ms',
    'GET /dashboard/shoutbox 200 in 10ms'
  ])('keeps non-target request logs: %s', (line) => {
    expect(shouldHideDevLogLine(line)).toBe(false)
  })

  it('buffers split chunks while preserving non-target lines', () => {
    const output: string[] = []
    const filter = createDevLogFilter((line: string) => output.push(line))

    filter.push('GET /api/shoutbox 2')
    filter.push('00 in 1ms\nGET /api/other 200')
    filter.flush()

    expect(output).toEqual(['GET /api/other 200'])
  })

  it('preserves a multibyte UTF-8 character split across chunks', () => {
    const output: string[] = []
    const filter = createDevLogFilter((line: string) => output.push(line))
    const input = Buffer.from('GET /api/other 200 中文\n')
    const characterStart = input.indexOf(Buffer.from('中'))

    filter.push(input.subarray(0, characterStart + 1))
    filter.push(input.subarray(characterStart + 1))
    filter.flush()

    expect(output).toEqual(['GET /api/other 200 中文\n'])
  })
})
