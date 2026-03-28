import { describe, expect, test } from 'vitest'
import {
  GALGAME_RESOURCE_TYPES,
  PATCH_RESOURCE_TYPES,
  SUPPORTED_PLATFORM,
  getAllowedPlatformsBySectionAndTypes,
  getResourceTypeOptionsBySection,
  isResourceTypeAllowedForSection,
  normalizeLegacyResourceTypes,
  normalizeTypesBySection
} from '~/constants/resource'
import { patchResourceCreateSchema } from '~/validations/patch'

describe('resource classification', () => {
  test('returns section-specific type options', () => {
    const galgameOptions = getResourceTypeOptionsBySection('galgame').map(
      (item) => item.value
    )
    const patchOptions = getResourceTypeOptionsBySection('patch').map(
      (item) => item.value
    )

    expect(new Set(galgameOptions)).toEqual(new Set(GALGAME_RESOURCE_TYPES))
    expect(new Set(patchOptions)).toEqual(new Set(PATCH_RESOURCE_TYPES))
  })

  test('allows only matching section type', () => {
    expect(isResourceTypeAllowedForSection('galgame', 'pc')).toBe(true)
    expect(isResourceTypeAllowedForSection('galgame', 'tool')).toBe(true)
    expect(isResourceTypeAllowedForSection('galgame', 'patch')).toBe(false)
    expect(isResourceTypeAllowedForSection('patch', 'tool')).toBe(true)
    expect(isResourceTypeAllowedForSection('patch', 'mobile')).toBe(false)
  })

  test('deduplicates legacy resource types', () => {
    expect(normalizeLegacyResourceTypes(['pc', 'mobile', 'pc'])).toEqual([
      'pc',
      'mobile'
    ])
  })

  test('normalizes and filters by section', () => {
    expect(normalizeTypesBySection('galgame', ['patch', 'pc'])).toEqual([
      'pc'
    ])
    expect(normalizeTypesBySection('patch', ['pc', 'patch', 'tool'])).toEqual([
      'patch',
      'tool'
    ])
  })

  test('schema rejects mismatched types for section', () => {
    const result = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'patch',
      name: 'test',
      storage: 'user',
      hash: '',
      content: 'https://example.com',
      size: '1MB',
      code: '',
      password: '',
      note: '',
      type: ['pc'],
      language: ['zh-Hans'],
      platform: ['windows']
    })

    expect(result.success).toBe(false)
  })

  test('platform enum uses psv and supports validation', () => {
    expect(SUPPORTED_PLATFORM.includes('psv')).toBe(true)
    expect(SUPPORTED_PLATFORM.includes('ps')).toBe(false)

    const result = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'psv test',
      storage: 'user',
      hash: '',
      content: 'https://example.com',
      size: '1MB',
      code: '',
      password: '',
      note: '',
      type: ['emulator'],
      language: ['zh-Hans'],
      platform: ['psv']
    })

    expect(result.success).toBe(true)
  })

  test('galgame platform options follow type rules', () => {
    expect(getAllowedPlatformsBySectionAndTypes('galgame', [])).toEqual([
      'other'
    ])

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['pc'])
    ).toEqual(['windows', 'macos', 'linux', 'other'])

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['mobile'])
    ).toEqual(['android', 'ios', 'ons', 'krkr', 'tyranor', 'other'])

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['emulator'])
    ).toEqual(['psp', 'ns', 'psv', 'ps2', 'other'])

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['material'])
    ).toEqual(['other'])

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['tool'])
    ).toEqual(SUPPORTED_PLATFORM)

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['pc', 'mobile'])
    ).toEqual([
      'windows',
      'android',
      'macos',
      'ios',
      'linux',
      'ons',
      'krkr',
      'tyranor',
      'other'
    ])
  })

  test('schema rejects invalid platform for selected type', () => {
    const invalid = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'invalid platform test',
      storage: 'user',
      hash: '',
      content: 'https://example.com',
      size: '1MB',
      code: '',
      password: '',
      note: '',
      type: ['pc'],
      language: ['zh-Hans'],
      platform: ['android']
    })

    expect(invalid.success).toBe(false)
  })
})
