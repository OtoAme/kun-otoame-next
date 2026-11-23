import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchPost: search }))
vi.mock('~/components/kun/Loading', () => ({
  KunLoading: () => <p>loading</p>
}))
vi.mock('~/components/kun/Header', () => ({ KunHeader: () => null }))
vi.mock('~/components/kun/Pagination', () => ({ KunPagination: () => null }))
vi.mock('~/components/galgame/FilterBar', () => ({ FilterBar: () => null }))
vi.mock('~/components/galgame/Card', () => ({
  GalgameCard: ({ patch }: { patch: GalgameCard }) => (
    <article>{patch.name}</article>
  )
}))
vi.mock('~/components/search/SearchHistory', () => ({
  SearchHistory: ({
    setSelectedSuggestions
  }: {
    setSelectedSuggestions: (value: unknown[]) => void
  }) => (
    <button
      onClick={() =>
        setSelectedSuggestions([
          { name: 'test', mode: 'include', type: 'keyword' }
        ])
      }
    >
      search
    </button>
  )
}))
vi.mock('~/components/search/Suggestion', () => ({
  SearchSuggestion: () => null
}))
vi.mock('~/components/search/Option', () => ({ SearchOption: () => null }))
vi.mock('~/components/search/Input', () => ({ SearchInput: () => null }))

let root: Root
let dom: JSDOM
afterEach(async () => {
  await act(async () => root?.unmount())
  dom?.window.close()
  vi.unstubAllGlobals()
})

it('keeps search results and avoids repeating the same search after session confirmation', async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/search' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const { useUserStore } = await import('~/store/userStore')
  const { usePreferenceStore } = await import('~/store/preferenceStore')
  useUserStore.setState({
    sessionStatus: 'authenticated',
    sessionContext: 'test-context',
    sessionGeneration: 0,
    user: { ...useUserStore.getState().user, uid: 7 }
  })
  usePreferenceStore.setState({
    generation: 0,
    status: 'ready',
    applied: {
      uid: 7,
      context: 'test-context',
      version: 0,
      nsfwSelected: true,
      blockedTagIds: [],
      items: { nsfw: { value: 'sfw', version: 0 } }
    }
  })
  search.mockResolvedValue({
    galgames: [{ id: 1, name: 'search result' }],
    total: 1
  })
  const { SearchPage } = await import('~/components/search/Container')
  root = createRoot(document.getElementById('root')!)
  await act(async () => root.render(<SearchPage />))
  await act(async () => document.querySelector('button')!.click())
  const card = document.querySelector('article')
  expect(card?.textContent).toBe('search result')
  await act(async () => useUserStore.getState().setSessionStatus('checking'))
  await act(async () =>
    useUserStore.getState().setSessionStatus('authenticated')
  )
  expect(search).toHaveBeenCalledTimes(1)
  expect(document.querySelector('article')).toBe(card)
})
