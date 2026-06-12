import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GALGAME_FILTER_SELECTION,
  DEFAULT_GALGAME_FILTER_VALUE,
  DEFAULT_GALGAME_SORT_FIELD,
  DEFAULT_GALGAME_SORT_ORDER,
  DEFAULT_TAG_COMPANY_MIN_RATING_COUNT,
  isDefaultTagCompanyGalgameFilterState
} from '~/utils/galgameFilter'

const defaultState = {
  page: 1,
  selectedType: DEFAULT_GALGAME_FILTER_VALUE,
  selectedLanguage: DEFAULT_GALGAME_FILTER_VALUE,
  selectedPlatform: DEFAULT_GALGAME_FILTER_VALUE,
  sortField: DEFAULT_GALGAME_SORT_FIELD,
  sortOrder: DEFAULT_GALGAME_SORT_ORDER,
  selectedYears: DEFAULT_GALGAME_FILTER_SELECTION,
  selectedMonths: DEFAULT_GALGAME_FILTER_SELECTION,
  minRatingCount: DEFAULT_TAG_COMPANY_MIN_RATING_COUNT
}

describe('isDefaultTagCompanyGalgameFilterState', () => {
  it('returns true for the canonical tag/company default filter state', () => {
    expect(isDefaultTagCompanyGalgameFilterState(defaultState)).toBe(true)
  })

  it('returns false when pagination or a filter differs from the default state', () => {
    expect(
      isDefaultTagCompanyGalgameFilterState({
        ...defaultState,
        page: 2
      })
    ).toBe(false)
    expect(
      isDefaultTagCompanyGalgameFilterState({
        ...defaultState,
        selectedLanguage: 'ja'
      })
    ).toBe(false)
  })

  it('returns false when sort or rating threshold differs from the default state', () => {
    expect(
      isDefaultTagCompanyGalgameFilterState({
        ...defaultState,
        sortField: 'created'
      })
    ).toBe(false)
    expect(
      isDefaultTagCompanyGalgameFilterState({
        ...defaultState,
        minRatingCount: 5
      })
    ).toBe(false)
  })
})
