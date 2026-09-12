import { describe, expect, it } from 'vitest'
import { normalizeShoutboxContent } from '~/utils/shoutboxContent'

describe('normalizeShoutboxContent', () => {
  it('turns all supported line separators into spaces without trimming', () => {
    expect(
      normalizeShoutboxContent('  甲\r\n乙\r丙\n丁\u2028戊\u2029  ')
    ).toBe('  甲 乙 丙 丁 戊   ')
  })
})
