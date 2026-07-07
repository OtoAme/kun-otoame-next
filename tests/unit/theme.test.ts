import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import {
  DEFAULT_KUN_SITE_THEME,
  KUN_SITE_THEME_COOKIE_MAX_AGE_SECONDS,
  KUN_SITE_THEME_STORAGE_KEY,
  isKunEnabledSiteTheme,
  isKunSiteTheme,
  readKunSiteThemeCookie,
  resolveKunSiteTheme,
  serializeKunSiteThemeCookie,
  type KunSiteThemeRegistry
} from '~/constants/theme'

globalThis.React = React

const nextNavigationMock = vi.hoisted(() => ({
  pathname: '/'
}))

vi.mock('next/navigation', () => ({
  usePathname: () => nextNavigationMock.pathname
}))

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
    label: 'Classic',
    status: 'enabled',
    availability: 'free',
    previewColor: '#006FEE',
    fallback: 'touchgal',
    sort: 10
  },
  otoame: {
    id: 'otoame',
    label: 'Pink',
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

describe('useKunSiteTheme DOM synchronization', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('applies localStorage before stale cookies in the boot script', async () => {
    dom = new JSDOM(
      '<!doctype html><html data-kun-theme="touchgal"><body></body></html>',
      {
        url: 'https://www.otoame.top/',
        runScripts: 'outside-only'
      }
    )

    dom.window.localStorage.setItem(KUN_SITE_THEME_STORAGE_KEY, 'otoame')
    dom.window.document.cookie = serializeKunSiteThemeCookie('touchgal', true)

    const { siteThemeScript } = await import(
      '~/components/kun/theme/SiteThemeScript'
    )

    dom.window.eval(siteThemeScript)

    expect(dom.window.document.documentElement.dataset.kunTheme).toBe('otoame')
    expect(dom.window.localStorage.getItem(KUN_SITE_THEME_STORAGE_KEY)).toBe(
      'otoame'
    )
    expect(readKunSiteThemeCookie(dom.window.document.cookie)).toBe('otoame')
  })

  it('repairs the root theme after client navigation restores a static shell theme', async () => {
    dom = new JSDOM(
      '<!doctype html><html data-kun-theme="touchgal"><body><div id="root"></div></body></html>',
      {
        url: 'https://www.otoame.top/'
      }
    )

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('localStorage', dom.window.localStorage)
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent)
    vi.stubGlobal('StorageEvent', dom.window.StorageEvent)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    dom.window.localStorage.setItem(KUN_SITE_THEME_STORAGE_KEY, 'otoame')
    dom.window.document.cookie = serializeKunSiteThemeCookie('touchgal', true)

    const { SiteThemeRouteSync } = await import(
      '~/components/kun/theme/SiteThemeRouteSync'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(React.createElement(SiteThemeRouteSync))
    })

    expect(dom.window.document.documentElement.dataset.kunTheme).toBe('otoame')
    expect(
      dom.window.document.documentElement.dataset.kunThemeSource
    ).toBe('client')

    await act(async () => {
      dom!.window.document.documentElement.dataset.kunTheme = 'touchgal'
      nextNavigationMock.pathname = '/otomegame'
      root!.render(React.createElement(SiteThemeRouteSync))
    })

    expect(dom.window.document.documentElement.dataset.kunTheme).toBe('otoame')
    expect(dom.window.localStorage.getItem(KUN_SITE_THEME_STORAGE_KEY)).toBe(
      'otoame'
    )
    expect(readKunSiteThemeCookie(dom.window.document.cookie)).toBe('otoame')
  })
})

describe('isKunEnabledSiteTheme', () => {
  it('accepts enabled production themes', () => {
    expect(isKunEnabledSiteTheme('touchgal')).toBe(true)
    expect(isKunEnabledSiteTheme('otoame')).toBe(true)
  })

  it('rejects unknown storage values', () => {
    expect(isKunEnabledSiteTheme('unknown')).toBe(false)
    expect(isKunEnabledSiteTheme(null)).toBe(false)
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

describe('private chat theme color tokens', () => {
  const themesCss = readFileSync(
    resolve(process.cwd(), 'styles/themes.css'),
    'utf8'
  )
  const themeColorSystemDoc = readFileSync(
    resolve(process.cwd(), 'docs/theme-color-system.md'),
    'utf8'
  )

  it('defines semantic chat colors for light and dark modes', () => {
    expect(themesCss).toMatch(
      /html\[data-kun-theme\]\s*{[\s\S]*--kun-chat-own-bubble-bg:[\s\S]*--kun-chat-input-bg:/
    )
    expect(themesCss).toMatch(
      /html\.dark\[data-kun-theme\]\s*{[\s\S]*--kun-chat-own-bubble-bg:[\s\S]*--kun-chat-input-bg:/
    )
    expect(themesCss).toContain('--kun-chat-own-bubble-text')
    expect(themesCss).toContain('--kun-chat-other-bubble-text')
    expect(themesCss).toContain('--kun-chat-muted-text')
  })

  it('uses readable dark-mode text for received chat reply previews', () => {
    const darkChatTokens = themesCss.match(
      /html\.dark\[data-kun-theme\]\s*{(?<body>[\s\S]*?)\n}/
    )?.groups?.body

    expect(darkChatTokens).toContain(
      '--kun-chat-reply-text: hsl(var(--heroui-default-500));'
    )
    expect(darkChatTokens).not.toContain(
      '--kun-chat-reply-text: hsl(var(--heroui-default-200));'
    )
  })

  it('keeps chat token documentation examples valid for Tailwind scanning', () => {
    expect(themeColorSystemDoc).not.toContain('--kun-chat-...')
    expect(themeColorSystemDoc).not.toMatch(
      /\b(?:bg|text|border|ring)-\[var\(--kun-chat-\.\.\.\)\]/
    )
  })
})

describe('site theme cookie helpers', () => {
  it('reads enabled site theme cookie values', () => {
    expect(readKunSiteThemeCookie('foo=bar; kun-site-theme=otoame')).toBe(
      'otoame'
    )
    expect(readKunSiteThemeCookie('kun-site-theme=touchgal')).toBe('touchgal')
  })

  it('ignores missing or invalid site theme cookie values', () => {
    expect(readKunSiteThemeCookie(undefined)).toBeUndefined()
    expect(readKunSiteThemeCookie('foo=bar')).toBeUndefined()
    expect(readKunSiteThemeCookie('kun-site-theme=unknown')).toBeUndefined()
  })

  it('serializes functional site theme cookies without a domain', () => {
    const cookie = serializeKunSiteThemeCookie('otoame', true)

    expect(cookie).toContain('kun-site-theme=otoame')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${KUN_SITE_THEME_COOKIE_MAX_AGE_SECONDS}`)
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain('Domain=')
  })

  it('omits secure for non-https development contexts', () => {
    expect(serializeKunSiteThemeCookie('touchgal')).not.toContain('Secure')
  })
})
