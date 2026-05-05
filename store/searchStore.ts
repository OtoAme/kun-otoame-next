import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SearchSuggestionType } from '~/types/api/search'

export interface CreateSearchData {
  searchHistory: SearchSuggestionType[][]
  searchInIntroduction: boolean
  searchInAlias: boolean
  searchInTag: boolean
}

const initialState: CreateSearchData = {
  searchHistory: [],
  searchInIntroduction: false,
  searchInAlias: true,
  searchInTag: false
}

interface SearchStoreState {
  data: CreateSearchData
  getData: () => CreateSearchData
  setData: (data: CreateSearchData) => void
  resetData: () => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const sanitizeSuggestion = (value: unknown): SearchSuggestionType | null => {
  if (!isRecord(value)) {
    return null
  }

  const type = value.type
  const mode = value.mode
  const name = value.name
  if (
    (type !== 'keyword' && type !== 'tag' && type !== 'company') ||
    typeof name !== 'string' ||
    !name.trim()
  ) {
    return null
  }

  return {
    type,
    mode: mode === 'exclude' ? 'exclude' : 'include',
    ...(typeof value.id === 'number' ? { id: value.id } : {}),
    name: name.trim()
  }
}

const sanitizeSearchHistory = (value: unknown): SearchSuggestionType[][] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      const suggestions = Array.isArray(item) ? item : [item]
      return suggestions
        .map((suggestion) => sanitizeSuggestion(suggestion))
        .filter((suggestion): suggestion is SearchSuggestionType =>
          Boolean(suggestion)
        )
    })
    .filter((item) => item.length > 0)
}

export const sanitizeSearchData = (value: unknown): CreateSearchData => {
  if (!isRecord(value)) {
    return initialState
  }

  return {
    searchHistory: sanitizeSearchHistory(value.searchHistory),
    searchInIntroduction:
      typeof value.searchInIntroduction === 'boolean'
        ? value.searchInIntroduction
        : initialState.searchInIntroduction,
    searchInAlias:
      typeof value.searchInAlias === 'boolean'
        ? value.searchInAlias
        : initialState.searchInAlias,
    searchInTag:
      typeof value.searchInTag === 'boolean'
        ? value.searchInTag
        : initialState.searchInTag
  }
}

export const useSearchStore = create<SearchStoreState>()(
  persist(
    (set, get) => ({
      data: initialState,
      getData: () => get().data,
      setData: (data: CreateSearchData) =>
        set({ data: sanitizeSearchData(data) }),
      resetData: () => set({ data: initialState })
    }),
    {
      name: 'kun-patch-search-store',
      storage: createJSONStorage(() => window.localStorage),
      merge: (persistedState, currentState) => {
        const persistedData = isRecord(persistedState)
          ? sanitizeSearchData(persistedState.data)
          : initialState

        return {
          ...currentState,
          data: persistedData
        }
      }
    }
  )
)
