import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { Company } from '~/types/api/company'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('use-debounce', () => ({
  useDebounce: (value: string) => [value]
}))

vi.mock('~/hooks/useMounted', () => ({
  useMounted: () => false
}))

vi.mock('~/components/company/CompanyHeader', () => ({
  CompanyHeader: () => <header>会社列表</header>
}))

vi.mock('~/components/company/SearchCompanies', () => ({
  SearchCompanies: () => <label>搜索会社</label>
}))

vi.mock('~/components/company/CompanyList', () => ({
  CompanyList: ({ companies }: { companies: Company[] }) => (
    <section>
      {companies.map((company) => (
        <article key={company.id}>{company.name}</article>
      ))}
    </section>
  )
}))

vi.mock('@heroui/pagination', () => ({
  Pagination: () => <div data-testid="legacy-pagination" />
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    total,
    page,
    isLoading,
    onPageChange
  }: {
    total: number
    page: number
    isLoading?: boolean
    onPageChange: (page: number) => void
  }) => (
    <button
      type="button"
      data-testid="kun-pagination"
      data-page={page}
      data-total={total}
      data-loading={String(isLoading)}
      onClick={() => onPageChange(page + 1)}
    >
      shared pagination
    </button>
  )
}))

const makeCompany = (id: number): Company => ({
  id,
  name: `Company ${id}`,
  count: 1,
  alias: []
})

describe('Company Container', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderContainer = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/company'
    })
    fetchMock.kunFetchGet.mockResolvedValue({
      companies: [makeCompany(1)],
      total: 250
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { Container } = await import('~/components/company/Container')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <Container initialCompanies={[makeCompany(1)]} initialTotal={250} />
      )
    })

    return container!
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPost.mockReset()
  })

  it('uses the shared pagination component for company page changes', async () => {
    const container = await renderContainer()

    expect(
      container.querySelector('[data-testid="legacy-pagination"]')
    ).toBeNull()
    const pagination = container.querySelector('[data-testid="kun-pagination"]')
    expect(pagination).not.toBeNull()
    expect(pagination?.getAttribute('data-total')).toBe('3')
    expect(pagination?.getAttribute('data-page')).toBe('1')
  })
})
