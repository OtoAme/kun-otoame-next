import { describe, expect, it } from 'vitest'
import {
  isCompanyIdentityValueWithinLimit,
  normalizeCompanyValue
} from '~/app/api/company/identity/normalize'

describe('company identity normalization', () => {
  it('normalizes width, case and whitespace with NFKC', () => {
    expect(normalizeCompanyValue('  ＰＡＬＥＴＴＥ\t Studio  ')).toBe(
      'palette studio'
    )
  })

  it('does not guess by stripping legal or studio suffixes', () => {
    expect(normalizeCompanyValue('Palette Co., Ltd.')).toBe('palette co., ltd.')
    expect(normalizeCompanyValue('Palette Studio')).toBe('palette studio')
  })

  it('rejects a raw value whose compatibility expansion exceeds storage', () => {
    expect('ﬃ'.repeat(107)).toHaveLength(107)
    expect(isCompanyIdentityValueWithinLimit('ﬃ'.repeat(107))).toBe(false)
  })
})
