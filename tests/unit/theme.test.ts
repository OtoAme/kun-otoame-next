import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KUN_SITE_THEME,
  isKunSiteTheme,
  resolveKunSiteTheme,
  type KunSiteThemeRegistry
} from '~/constants/theme'

type TestTheme =
  | 'touchgal'
  | 'otoame'
  | 'paid'
  | 'disabled'
  | 'deprecated'
  | 'deprecated-to-disabled'
  | 'missing-replacement'
  | 'loop-a'
  | 'loop-b'

const testRegistry: KunSiteThemeRegistry<TestTheme> = {
  touchgal: {
    id: 'touchgal',
    label: '经典主题',
    status: 'enabled',
    availability: 'free',
    previewColor: '#006FEE',
    fallback: 'touchgal',
    sort: 10
  },
  otoame: {
    id: 'otoame',
    label: '乙女主题',
    status: 'enabled',
    availability: 'free',
    previewColor: '#EB6FA9',
    fallback: 'touchgal',
    sort: 20
  },
  paid: {
    id: 'paid',
    label: '付费主题',
    status: 'enabled',
    availability: 'paid',
    previewColor: '#8B5CF6',
    fallback: 'touchgal',
    sort: 30
  },
  disabled: {
    id: 'disabled',
    label: '禁用主题',
    status: 'disabled',
    availability: 'free',
    previewColor: '#64748B',
    fallback: 'touchgal',
    sort: 40
  },
  deprecated: {
    id: 'deprecated',
    label: '下架主题',
    status: 'deprecated',
    availability: 'free',
    previewColor: '#94A3B8',
    fallback: 'touchgal',
    replacementThemeId: 'otoame',
    sort: 50
  },
  'deprecated-to-disabled': {
    id: 'deprecated-to-disabled',
    label: '下架到禁用主题',
    status: 'deprecated',
    availability: 'free',
    previewColor: '#475569',
    fallback: 'touchgal',
    replacementThemeId: 'disabled',
    sort: 60
  },
  'missing-replacement': {
    id: 'missing-replacement',
    label: '缺失替换主题',
    status: 'deprecated',
    availability: 'free',
    previewColor: '#1F2937',
    fallback: 'touchgal',
    replacementThemeId: 'missing' as TestTheme,
    sort: 70
  },
  'loop-a': {
    id: 'loop-a',
    label: '循环 A',
    status: 'deprecated',
    availability: 'free',
    previewColor: '#111827',
    fallback: 'touchgal',
    replacementThemeId: 'loop-b',
    sort: 80
  },
  'loop-b': {
    id: 'loop-b',
    label: '循环 B',
    status: 'deprecated',
    availability: 'free',
    previewColor: '#020617',
    fallback: 'touchgal',
    replacementThemeId: 'loop-a',
    sort: 90
  }
}

const resolveTestTheme = (
  value: unknown,
  options: {
    availableThemeIds?: readonly TestTheme[]
    includeDisabled?: boolean
  } = {}
) =>
  resolveKunSiteTheme(value, {
    registry: testRegistry,
    defaultTheme: DEFAULT_KUN_SITE_THEME,
    ...options
  })

describe('isKunSiteTheme', () => {
  it('accepts known production themes', () => {
    expect(isKunSiteTheme('touchgal')).toBe(true)
    expect(isKunSiteTheme('otoame')).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isKunSiteTheme('unknown')).toBe(false)
    expect(isKunSiteTheme(undefined)).toBe(false)
    expect(isKunSiteTheme(1007)).toBe(false)
  })
})

describe('resolveKunSiteTheme', () => {
  it('falls back to touchgal for unknown values', () => {
    expect(resolveKunSiteTheme('unknown')).toBe('touchgal')
  })

  it('allows enabled free themes in client mode', () => {
    expect(resolveKunSiteTheme('touchgal')).toBe('touchgal')
    expect(resolveKunSiteTheme('otoame')).toBe('otoame')
  })

  it('falls back from disabled themes', () => {
    expect(resolveTestTheme('disabled')).toBe('touchgal')
  })

  it('uses a valid replacement for deprecated themes', () => {
    expect(resolveTestTheme('deprecated')).toBe('otoame')
  })

  it('falls back when a replacement is disabled or missing', () => {
    expect(resolveTestTheme('deprecated-to-disabled')).toBe('touchgal')
    expect(resolveTestTheme('missing-replacement')).toBe('touchgal')
  })

  it('falls back when replacement themes form a loop', () => {
    expect(resolveTestTheme('loop-a')).toBe('touchgal')
  })

  it('treats undefined availableThemeIds as free-client mode', () => {
    expect(resolveTestTheme('paid')).toBe('touchgal')
  })

  it('treats an empty availableThemeIds array as a strict deny list', () => {
    expect(resolveTestTheme('paid', { availableThemeIds: [] })).toBe('touchgal')
  })

  it('allows paid themes only when the server availability list includes them', () => {
    expect(resolveTestTheme('paid', { availableThemeIds: ['paid'] })).toBe(
      'paid'
    )
  })
})
