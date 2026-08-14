import { describe, expect, test } from 'vitest'
import {
  canSelectChineseSupportType,
  GALGAME_RESOURCE_TYPES,
  PATCH_RESOURCE_TYPES,
  SUPPORTED_PLATFORM,
  hasChineseSupportType,
  hasResourceTypeWithoutChineseSupport,
  getAllowedPlatformsBySectionAndTypes,
  getResourceTypeOptionsBySection,
  isResourceTypeAllowedForSection,
  normalizeLegacyResourceTypes,
  normalizeTypesBySection,
  requiresChineseSupportType
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
    expect(normalizeTypesBySection('galgame', ['patch', 'pc'])).toEqual(['pc'])
    expect(normalizeTypesBySection('patch', ['pc', 'patch', 'tool'])).toEqual([
      'patch',
      'tool'
    ])
  })

  test('requires a Chinese support type for game resource types', () => {
    expect(requiresChineseSupportType(['pc'])).toBe(true)
    expect(requiresChineseSupportType(['tool'])).toBe(false)
    expect(requiresChineseSupportType(['pc', 'material'])).toBe(true)
    expect(canSelectChineseSupportType(['material'])).toBe(false)
    expect(canSelectChineseSupportType(['tool'])).toBe(false)
    expect(canSelectChineseSupportType(['pc', 'material'])).toBe(true)
    expect(hasChineseSupportType(['official-zh'])).toBe(true)
    expect(hasChineseSupportType(['pc'])).toBe(false)
    expect(hasResourceTypeWithoutChineseSupport(['material'])).toBe(true)
    expect(hasResourceTypeWithoutChineseSupport(['tool'])).toBe(true)

    const missingChineseSupport = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'missing Chinese support',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['pc'],
      language: ['ja'],
      platform: ['windows']
    })

    expect(missingChineseSupport.success).toBe(false)
    if (!missingChineseSupport.success) {
      expect(missingChineseSupport.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['type'],
          message: '请选择中文支持情况：官中、民汉、机翻、生肉'
        })
      )
    }

    const mixedGameAndMaterialWithoutChineseSupport =
      patchResourceCreateSchema.safeParse({
        patchId: 1,
        section: 'galgame',
        name: 'game and material without Chinese support',
        links: [
          {
            storage: 'user',
            hash: '',
            content: 'https://example.com',
            size: '1MB',
            code: '',
            password: ''
          }
        ],
        note: '',
        type: ['pc', 'material'],
        language: ['zh-Hans'],
        platform: ['windows']
      })

    expect(mixedGameAndMaterialWithoutChineseSupport.success).toBe(false)
    if (!mixedGameAndMaterialWithoutChineseSupport.success) {
      expect(
        mixedGameAndMaterialWithoutChineseSupport.error.issues
      ).toContainEqual(
        expect.objectContaining({
          path: ['type'],
          message: '请选择中文支持情况：官中、民汉、机翻、生肉'
        })
      )
    }

    const validGameResource = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'localized game',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['pc', 'official-zh'],
      language: ['zh-Hans'],
      platform: ['windows']
    })

    const toolResource = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'tool resource',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['tool'],
      language: ['other'],
      platform: ['windows']
    })

    const mixedGameAndMaterialResource = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'game and material resource',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['pc', 'material', 'official-zh'],
      language: ['zh-Hans'],
      platform: ['windows']
    })

    const materialResource = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'material resource',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['material'],
      language: ['other'],
      platform: ['other']
    })

    expect(validGameResource.success).toBe(true)
    expect(mixedGameAndMaterialResource.success).toBe(true)
    expect(toolResource.success).toBe(true)
    expect(materialResource.success).toBe(true)

    const materialWithChineseSupport = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'material with Chinese support',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['material', 'official-zh'],
      language: ['zh-Hans'],
      platform: ['other']
    })

    expect(materialWithChineseSupport.success).toBe(false)
    if (!materialWithChineseSupport.success) {
      expect(materialWithChineseSupport.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['type'],
          message: '资料集或工具不允许选择中文支持类型'
        })
      )
    }

    const toolWithChineseSupport = patchResourceCreateSchema.safeParse({
      patchId: 1,
      section: 'galgame',
      name: 'tool with Chinese support',
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['tool', 'machine'],
      language: ['other'],
      platform: ['windows']
    })

    expect(toolWithChineseSupport.success).toBe(false)
    if (!toolWithChineseSupport.success) {
      expect(toolWithChineseSupport.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['type'],
          message: '资料集或工具不允许选择中文支持类型'
        })
      )
    }
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
      links: [
        {
          storage: 'user',
          hash: '',
          content: 'https://example.com',
          size: '1MB',
          code: '',
          password: ''
        }
      ],
      note: '',
      type: ['emulator', 'official-zh'],
      language: ['zh-Hans'],
      platform: ['psv']
    })

    expect(result.success).toBe(true)
  })

  test('galgame platform options follow type rules', () => {
    expect(getAllowedPlatformsBySectionAndTypes('galgame', [])).toEqual([
      'other'
    ])

    expect(getAllowedPlatformsBySectionAndTypes('galgame', ['pc'])).toEqual([
      'windows',
      'macos',
      'linux',
      'other'
    ])

    expect(getAllowedPlatformsBySectionAndTypes('galgame', ['mobile'])).toEqual(
      ['android', 'ios', 'ons', 'krkr', 'tyranor', 'other']
    )

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['emulator'])
    ).toEqual(['psp', 'ns', 'psv', 'ps2', 'other'])

    expect(
      getAllowedPlatformsBySectionAndTypes('galgame', ['material'])
    ).toEqual(['other'])

    expect(getAllowedPlatformsBySectionAndTypes('galgame', ['tool'])).toEqual(
      SUPPORTED_PLATFORM
    )

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
      type: ['pc', 'official-zh'],
      language: ['zh-Hans'],
      platform: ['android']
    })

    expect(invalid.success).toBe(false)
  })
})
