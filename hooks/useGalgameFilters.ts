'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getGalgameListQuery,
  readGalgameFilters,
  type TagCompanyGalgameFilterState
} from '~/utils/galgameFilter'

export const useGalgameFilters = (
  initialFilters: TagCompanyGalgameFilterState | undefined,
  defaultMinRatingCount: number
) => {
  const [filters, setFilters] = useState(
    () =>
      initialFilters ??
      readGalgameFilters(
        new URLSearchParams(
          typeof window === 'undefined' ? '' : window.location.search
        ),
        defaultMinRatingCount
      )
  )
  const filterKey = JSON.stringify(filters)
  const urlFilterKey = useRef(filterKey)
  useEffect(() => {
    const onPopState = () => {
      const next = readGalgameFilters(
        new URLSearchParams(window.location.search),
        defaultMinRatingCount
      )
      urlFilterKey.current = JSON.stringify(next)
      setFilters(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [defaultMinRatingCount])

  useEffect(() => {
    if (urlFilterKey.current === filterKey) return
    urlFilterKey.current = filterKey
    const defaults = getGalgameListQuery(
      readGalgameFilters(new URLSearchParams(), defaultMinRatingCount)
    )
    const query = getGalgameListQuery(filters)
    const params = new URLSearchParams()
    for (const key of Object.keys(query) as (keyof typeof query)[]) {
      if (query[key] !== defaults[key]) params.set(key, String(query[key]))
    }
    const search = params.size ? `?${params}` : ''
    if (search !== window.location.search) {
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}${search}${window.location.hash}`
      )
    }
  }, [filterKey, defaultMinRatingCount])

  const setFilter = <K extends keyof TagCompanyGalgameFilterState>(
    key: K,
    value: TagCompanyGalgameFilterState[K]
  ) => setFilters((current) => ({ ...current, page: 1, [key]: value }))
  const { page: _page, ...values } = filters
  return {
    filters,
    setPage: (value: number) => setFilter('page', value),
    filterProps: {
      ...values,
      defaultMinRatingCount,
      setSelectedType: (value: string) => setFilter('selectedType', value),
      setSelectedLanguage: (value: string) =>
        setFilter('selectedLanguage', value),
      setSelectedPlatform: (value: string) =>
        setFilter('selectedPlatform', value),
      setSortField: (value: TagCompanyGalgameFilterState['sortField']) =>
        setFilter('sortField', value),
      setSortOrder: (value: TagCompanyGalgameFilterState['sortOrder']) =>
        setFilter('sortOrder', value),
      setSelectedYears: (value: string[]) => setFilter('selectedYears', value),
      setSelectedMonths: (value: string[]) =>
        setFilter('selectedMonths', value),
      setMinRatingCount: (value: number) => setFilter('minRatingCount', value)
    }
  }
}
