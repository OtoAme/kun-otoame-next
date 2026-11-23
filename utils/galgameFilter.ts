import type { SortField, SortOrder } from '~/components/galgame/_sort'

export const DEFAULT_GALGAME_SORT_FIELD: SortField = 'resource_update_time'
export const DEFAULT_GALGAME_SORT_ORDER: SortOrder = 'desc'
export const DEFAULT_GALGAME_FILTER_VALUE = 'all'
export const DEFAULT_GALGAME_FILTER_SELECTION = ['all']
export const DEFAULT_GALGAME_YEAR_STRING = JSON.stringify(
  DEFAULT_GALGAME_FILTER_SELECTION
)
export const DEFAULT_GALGAME_MONTH_STRING = JSON.stringify(
  DEFAULT_GALGAME_FILTER_SELECTION
)
export const DEFAULT_GALGAME_MIN_RATING_COUNT = 10
export const DEFAULT_TAG_COMPANY_MIN_RATING_COUNT = 0

export interface TagCompanyGalgameFilterState {
  page: number
  selectedType: string
  selectedLanguage: string
  selectedPlatform: string
  sortField: SortField
  sortOrder: SortOrder
  selectedYears: string[]
  selectedMonths: string[]
  minRatingCount: number
}

export const getSearchParamValue = (
  value: string | string[] | null | undefined
) => {
  return Array.isArray(value) ? value[0] : (value ?? undefined)
}

const isStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  )
}

export const parseGalgameFilterArray = (value: string | null | undefined) => {
  if (!value) {
    return [...DEFAULT_GALGAME_FILTER_SELECTION]
  }

  try {
    const parsed = JSON.parse(value)

    return isStringArray(parsed)
      ? parsed
      : [...DEFAULT_GALGAME_FILTER_SELECTION]
  } catch {
    return [...DEFAULT_GALGAME_FILTER_SELECTION]
  }
}

export const parsePositiveIntParam = (
  value: string | null | undefined,
  fallback: number
) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }

  return Math.floor(parsed)
}

export const parseNonNegativeIntParam = (
  value: string | null | undefined,
  fallback: number
) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return Math.floor(parsed)
}

export const readGalgameFilters = (
  params: URLSearchParams,
  defaultMinRatingCount = DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
): TagCompanyGalgameFilterState => {
  const sortField = params.get('sortField')
  const sortOrder = params.get('sortOrder')
  return {
    page: parsePositiveIntParam(params.get('page'), 1),
    selectedType: params.get('selectedType') || DEFAULT_GALGAME_FILTER_VALUE,
    selectedLanguage:
      params.get('selectedLanguage') || DEFAULT_GALGAME_FILTER_VALUE,
    selectedPlatform:
      params.get('selectedPlatform') || DEFAULT_GALGAME_FILTER_VALUE,
    sortField: [
      'resource_update_time',
      'created',
      'view',
      'download',
      'favorite',
      'rating'
    ].includes(sortField ?? '')
      ? (sortField as SortField)
      : DEFAULT_GALGAME_SORT_FIELD,
    sortOrder: sortOrder === 'asc' ? 'asc' : DEFAULT_GALGAME_SORT_ORDER,
    selectedYears: parseGalgameFilterArray(params.get('yearString')),
    selectedMonths: parseGalgameFilterArray(params.get('monthString')),
    minRatingCount: params.has('minRatingCount')
      ? parseNonNegativeIntParam(
          params.get('minRatingCount'),
          defaultMinRatingCount
        )
      : defaultMinRatingCount
  }
}

export const getGalgameListQuery = (filters: TagCompanyGalgameFilterState) => {
  const { selectedYears, selectedMonths, ...query } = filters
  return {
    ...query,
    limit: 24,
    yearString: JSON.stringify(selectedYears),
    monthString: JSON.stringify(selectedMonths),
    minRatingCount: filters.sortField === 'rating' ? filters.minRatingCount : 0
  }
}
