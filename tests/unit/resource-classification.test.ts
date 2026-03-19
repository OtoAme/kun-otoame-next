import { describe, expect, test } from 'vitest'
import {
    GALGAME_RESOURCE_TYPES,
    PATCH_RESOURCE_TYPES,
    SUPPORTED_PLATFORM,
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
        expect(isResourceTypeAllowedForSection('galgame', 'patch')).toBe(false)
        expect(isResourceTypeAllowedForSection('patch', 'tool')).toBe(true)
        expect(isResourceTypeAllowedForSection('patch', 'mobile')).toBe(false)
    })

    test('normalizes legacy app type into mobile', () => {
        expect(normalizeLegacyResourceTypes(['app', 'mobile', 'pc'])).toEqual([
            'mobile',
            'pc'
        ])
    })

    test('normalizes and filters by section', () => {
        expect(normalizeTypesBySection('galgame', ['app', 'patch', 'pc'])).toEqual([
            'mobile',
            'pc'
        ])
        expect(normalizeTypesBySection('patch', ['app', 'patch', 'tool'])).toEqual([
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
            type: ['pc'],
            language: ['zh-Hans'],
            platform: ['psv']
        })

        expect(result.success).toBe(true)
    })
})
