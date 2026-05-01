import { describe, expect, it } from 'vitest'
import {
  mergeResourceCodes,
  normalizeResourceContent,
  parseResourceLink
} from '~/utils/resourceLink'

describe('resourceLink', () => {
  it('should parse extraction code from query params', () => {
    expect(parseResourceLink('https://example.com/file?pwd=abcd')).toEqual({
      url: 'https://example.com/file?pwd=abcd',
      code: 'abcd'
    })
  })

  it('should normalize multiple links and preserve multiple codes', () => {
    const result = normalizeResourceContent(`
      https://example.com/a 提取码：aaaa
      https://example.com/b?pwd=bbbb
      https://example.com/c 密码：aaaa
    `)

    expect(result.content).toBe(
      'https://example.com/a,https://example.com/b?pwd=bbbb,https://example.com/c'
    )
    expect(result.codes).toEqual(['aaaa', 'bbbb'])
    expect(result.code).toBe('aaaa, bbbb')
  })

  it('should merge existing and parsed codes without duplicates', () => {
    expect(mergeResourceCodes('aaaa, bbbb', 'bbbb', 'cccc')).toBe(
      'aaaa, bbbb, cccc'
    )
  })
})
