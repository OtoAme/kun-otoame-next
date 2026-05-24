export const KUN_SITE_THEMES = ['touchgal', 'otoame'] as const

export type KunSiteTheme = (typeof KUN_SITE_THEMES)[number]
export type KunSiteThemeStatus = 'enabled' | 'disabled' | 'deprecated'
export type KunSiteThemeAvailability = 'free' | 'paid'

export interface KunSiteThemeRegistryItem<TThemeId extends string = string> {
  id: TThemeId
  label: string
  status: KunSiteThemeStatus
  availability: KunSiteThemeAvailability
  previewColor: string
  fallback: TThemeId
  replacementThemeId?: TThemeId
  sort: number
}

export type KunSiteThemeRegistry<TThemeId extends string = string> = Record<
  TThemeId,
  KunSiteThemeRegistryItem<TThemeId>
>

export interface ResolveKunSiteThemeOptions<
  TThemeId extends string = KunSiteTheme
> {
  availableThemeIds?: readonly TThemeId[]
  includeDisabled?: boolean
  registry?: KunSiteThemeRegistry<TThemeId>
  defaultTheme?: TThemeId
}

export const DEFAULT_KUN_SITE_THEME = 'touchgal' satisfies KunSiteTheme
export const KUN_SITE_THEME_STORAGE_KEY = 'kun-site-theme'
export const KUN_SITE_THEME_CHANGE_EVENT = 'kun-site-theme-change'

export const KUN_SITE_THEME_REGISTRY = {
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
  }
} satisfies KunSiteThemeRegistry<KunSiteTheme>

export const KUN_ENABLED_SITE_THEME_IDS = KUN_SITE_THEMES.filter(
  (theme) => KUN_SITE_THEME_REGISTRY[theme].status === 'enabled'
)

export const KUN_SELECTABLE_SITE_THEMES = KUN_ENABLED_SITE_THEME_IDS.filter(
  (theme) => KUN_SITE_THEME_REGISTRY[theme].availability === 'free'
).sort(
  (left, right) =>
    KUN_SITE_THEME_REGISTRY[left].sort - KUN_SITE_THEME_REGISTRY[right].sort
)

export const isKunSiteTheme = (value: unknown): value is KunSiteTheme => {
  return (
    typeof value === 'string' && KUN_SITE_THEMES.includes(value as KunSiteTheme)
  )
}

export function resolveKunSiteTheme(
  value: unknown,
  options?: ResolveKunSiteThemeOptions<KunSiteTheme>
): KunSiteTheme

export function resolveKunSiteTheme<TThemeId extends string>(
  value: unknown,
  options: ResolveKunSiteThemeOptions<TThemeId> & {
    registry: KunSiteThemeRegistry<TThemeId>
    defaultTheme: TThemeId
  }
): TThemeId

export function resolveKunSiteTheme<TThemeId extends string>(
  value: unknown,
  options: ResolveKunSiteThemeOptions<TThemeId> = {}
): TThemeId {
  const registry = (options.registry ??
    KUN_SITE_THEME_REGISTRY) as KunSiteThemeRegistry<TThemeId>
  const defaultTheme = (options.defaultTheme ??
    DEFAULT_KUN_SITE_THEME) as TThemeId
  const availableThemeIds = options.availableThemeIds
  const availableThemeSet = availableThemeIds
    ? new Set<TThemeId>(availableThemeIds)
    : undefined

  const getEntry = (theme: unknown) => {
    if (typeof theme !== 'string') {
      return undefined
    }
    if (!Object.prototype.hasOwnProperty.call(registry, theme)) {
      return undefined
    }
    return registry[theme as TThemeId]
  }

  const isSelectable = (
    entry: KunSiteThemeRegistryItem<TThemeId> | undefined
  ) => {
    if (!entry) {
      return false
    }
    if (!options.includeDisabled && entry.status !== 'enabled') {
      return false
    }
    if (availableThemeSet) {
      return availableThemeSet.has(entry.id)
    }
    return entry.availability === 'free'
  }

  const resolveFallback = (
    entry: KunSiteThemeRegistryItem<TThemeId>,
    visited: Set<TThemeId>
  ) => {
    const replacementThemeId = entry.replacementThemeId
    if (replacementThemeId) {
      if (visited.has(replacementThemeId)) {
        return defaultTheme
      }

      visited.add(replacementThemeId)
      const replacement = getEntry(replacementThemeId)
      return replacement && isSelectable(replacement)
        ? replacement.id
        : defaultTheme
    }

    const fallback = getEntry(entry.fallback)
    return fallback && isSelectable(fallback) ? fallback.id : defaultTheme
  }

  const entry = getEntry(value)
  if (!entry) {
    return defaultTheme
  }

  if (isSelectable(entry)) {
    return entry.id
  }

  return resolveFallback(entry, new Set<TThemeId>([entry.id]))
}
