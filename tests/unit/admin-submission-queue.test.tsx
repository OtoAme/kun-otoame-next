import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

globalThis.React = React

const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('@bprogress/next', () => ({ useRouter: () => routerMock }))

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    total,
    page,
    onPageChange
  }: {
    total: number
    page: number
    onPageChange: (page: number) => void
  }) => (
    <div data-testid="pagination" data-total={total} data-page={page}>
      <button type="button" onClick={() => onPageChange(page + 1)}>
        下一页
      </button>
    </div>
  )
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    href,
    onPress,
    type
  }: {
    children?: React.ReactNode
    href?: string
    onPress?: () => void
    type?: 'button' | 'submit' | 'reset'
  }) =>
    href ? (
      <a href={href}>{children}</a>
    ) : (
      <button type={type ?? 'button'} onClick={onPress}>
        {children}
      </button>
    ),
  Card: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="chip">{children}</span>
  ),
  Input: ({
    label,
    value,
    onValueChange,
    isClearable
  }: {
    label?: string
    value?: string
    onValueChange?: (value: string) => void
    isClearable?: boolean
    onClear?: () => void
  }) => (
    <input
      aria-label={label}
      data-clearable={isClearable ? 'true' : 'false'}
      value={value ?? ''}
      onInput={(event) =>
        onValueChange?.((event.target as HTMLInputElement).value)
      }
      onChange={() => {}}
    />
  ),
  Tab: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Tabs: ({
    children,
    onSelectionChange,
    selectedKey
  }: {
    children?: React.ReactNode
    onSelectionChange?: (key: React.Key) => void
    selectedKey?: React.Key
  }) => (
    <div role="tablist">
      {React.Children.toArray(children)
        .filter(React.isValidElement)
        .map((tab) => {
          const key = String(tab.key ?? '').replace(/^\.\$/, '')
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === String(selectedKey)}
              onClick={() => onSelectionChange?.(key)}
            >
              {(tab.props as { title?: React.ReactNode }).title}
            </button>
          )
        })}
    </div>
  )
}))

import { AdminSubmissionQueue } from '~/components/admin/submission/AdminSubmissionQueue'

const submission = (
  overrides: Partial<AdminSubmissionRow> = {}
): AdminSubmissionRow => ({
  id: 1,
  status: 'pending',
  name: 'Some game',
  authorName: 'Author',
  authorId: 2,
  submittedAt: '2026-08-27T00:00:00.000Z',
  reviewedAt: null,
  updated: '2026-08-26T00:00:00.000Z',
  created: '2026-08-25T00:00:00.000Z',
  ...overrides
})

describe('AdminSubmissionQueue', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/admin/submission'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const render = async ({
    submissions = [submission()],
    total = 1,
    query = '',
    status = 'pending' as PatchSubmissionStatus,
    page = 1,
    limit = 50
  } = {}) => {
    await act(async () => {
      root.render(
        <AdminSubmissionQueue
          submissions={submissions}
          total={total}
          query={query}
          status={status}
          page={page}
          limit={limit}
        />
      )
    })
    return dom.window.document
  }

  const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy()
    await act(async () => {
      element?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
  }

  const typeSearch = async (document: Document, value: string) => {
    const input = document.querySelector('input')
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value'
      )?.set
      setValue?.call(input, value)
      input?.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  const byText = (document: Document, selector: string, text: string) =>
    [...document.querySelectorAll(selector)].find(
      (element) => element.textContent?.trim() === text
    )

  const pushedUrl = () => {
    expect(routerMock.push).toHaveBeenCalledTimes(1)
    return new URL(
      routerMock.push.mock.calls[0][0] as string,
      'http://localhost'
    )
  }

  const chipTexts = (document: Document) =>
    [...document.querySelectorAll('[data-testid="chip"]')].map((chip) =>
      chip.textContent?.trim()
    )

  it('sends a status switch back to the first page while keeping the search', async () => {
    const document = await render({ status: 'pending', query: 'fate', page: 4 })

    await click(byText(document, '[role="tab"]', '已驳回'))

    const url = pushedUrl()
    expect(url.searchParams.get('status')).toBe('rejected')
    expect(url.searchParams.get('page')).toBeNull()
    expect(url.searchParams.get('query')).toBe('fate')
  })

  it('does not navigate when the reviewer picks the tab already open', async () => {
    const document = await render({ status: 'pending' })

    await click(byText(document, '[role="tab"]', '待审核'))

    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it('keeps the status and the search while paging', async () => {
    const document = await render({
      status: 'published',
      query: 'fate',
      page: 2,
      total: 120
    })

    await click(byText(document, 'button', '下一页'))

    const url = pushedUrl()
    expect(url.searchParams.get('status')).toBe('published')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('query')).toBe('fate')
  })

  it('hides the pager until there is a second page', async () => {
    expect(
      (await render({ total: 50, limit: 50 })).querySelector(
        '[data-testid="pagination"]'
      )
    ).toBeNull()

    const document = await render({ total: 51, limit: 50 })
    const pager = document.querySelector('[data-testid="pagination"]')

    expect(pager?.getAttribute('data-total')).toBe('2')
  })

  it('keeps the status but resets the page when a new search is run', async () => {
    const document = await render({ status: 'rejected', query: '', page: 5 })

    await typeSearch(document, '  fate  ')
    await click(byText(document, 'button', '搜索'))

    const url = pushedUrl()
    expect(url.searchParams.get('status')).toBe('rejected')
    expect(url.searchParams.get('page')).toBeNull()
    expect(url.searchParams.get('query')).toBe('fate')
  })

  it('runs the same search when the reviewer submits the form with Enter', async () => {
    const document = await render({ status: 'rejected', query: '', page: 5 })

    await typeSearch(document, '  fate  ')
    await act(async () => {
      document
        .querySelector('form')
        ?.dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true })
        )
    })

    const url = pushedUrl()
    expect(url.searchParams.get('status')).toBe('rejected')
    expect(url.searchParams.get('page')).toBeNull()
    expect(url.searchParams.get('query')).toBe('fate')
  })

  it('offers a clear affordance on the search box', async () => {
    const document = await render()

    expect(
      document.querySelector('input')?.getAttribute('data-clearable')
    ).toBe('true')
  })

  it('shows when a pending submission entered the queue', async () => {
    const document = await render({
      status: 'pending',
      submissions: [submission({ status: 'pending' })]
    })

    expect(chipTexts(document)).toContain('2026/08/27 08:00')
  })

  it('says so when a pending row was never submitted', async () => {
    const document = await render({
      status: 'pending',
      submissions: [submission({ status: 'pending', submittedAt: null })]
    })

    expect(chipTexts(document)).toContain('未提交')
  })

  it('shows when a draft was last edited, since it was never reviewed', async () => {
    const document = await render({
      status: 'draft',
      submissions: [submission({ status: 'draft', submittedAt: null })]
    })

    expect(chipTexts(document)).toContain('更新于 2026/08/26 08:00')
  })

  it('shows when a decided submission was reviewed', async () => {
    const document = await render({
      status: 'rejected',
      submissions: [
        submission({
          status: 'rejected',
          reviewedAt: '2026-08-28T00:00:00.000Z'
        })
      ]
    })

    expect(chipTexts(document)).toContain('审核于 2026/08/28 08:00')
  })

  it('falls back to the edit time for a status that carries no review date', async () => {
    const document = await render({
      status: 'changes_requested',
      submissions: [submission({ status: 'changes_requested' })]
    })

    expect(chipTexts(document)).toContain('更新于 2026/08/26 08:00')
  })

  it('counts and names the status currently on screen', async () => {
    const document = await render({ status: 'violation', total: 7 })

    expect(chipTexts(document)).toContain('违规关闭 7')
  })

  it('names the status in the empty state too', async () => {
    const document = await render({
      status: 'published',
      submissions: [],
      total: 0
    })

    expect(document.body.textContent).toContain('当前没有已发布的投稿。')
    expect(chipTexts(document)).toContain('已发布 0')
  })
})
