import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  InboxItem,
  InboxItemResponse,
  InboxListResponse
} from '~/types/api/inbox'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  refreshCounts: vi.fn(),
  toastError: vi.fn(),
  searchParams: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() }
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.kunFetchGet }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => mocks.searchParams,
  useRouter: () => mocks.router
}))

import { useInbox, type UseInboxReturn } from '~/hooks/dashboard/useInbox'

type Response = InboxListResponse | InboxItemResponse | string
type Request = {
  path: string
  query: Record<string, unknown>
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

const submission = (id: number, title = `投稿 ${id}`): InboxItem => ({
  key: `submission:${id}`,
  kind: 'submission',
  id,
  title,
  subtitle: '作者',
  actor: { id: 7, name: '作者' },
  waitingFrom: '2026-09-01T00:00:00.000Z',
  waitingSeconds: 60,
  targetHref: `/admin/submission/${id}`,
  badges: ['投稿'],
  readOnly: false,
  payload: {
    id,
    status: 'pending',
    name: title,
    authorName: '作者',
    authorId: 7,
    submittedAt: '2026-09-01T00:00:00.000Z',
    reviewedAt: null,
    created: '2026-09-01T00:00:00.000Z',
    updated: '2026-09-01T00:00:00.000Z'
  }
})

const queue = (
  items: InboxItem[],
  total = items.length
): InboxListResponse => ({
  items,
  totals: { submission: total, 'resource-apply': 0, feedback: 0, report: 0 },
  truncated: {
    submission: total > items.length,
    'resource-apply': false,
    feedback: false,
    report: false
  }
})

const pending = (item: InboxItem): InboxItemResponse => ({
  state: 'pending',
  item
})
const processed = (item: InboxItem): InboxItemResponse => ({
  state: 'processed',
  item:
    item.kind === 'submission'
      ? { ...item, payload: { ...item.payload, status: 'published' } }
      : item
})

describe('dashboard inbox request and selection state', () => {
  let root: Root | undefined
  let dom: JSDOM
  let current: UseInboxReturn
  let requests: Request[]

  function Probe() {
    current = useInbox({ refreshCounts: mocks.refreshCounts })
    return (
      <div>
        <output data-testid="selection">{current.selectedKey}</output>
        <output data-testid="detail-state">{current.item?.data.state}</output>
        {current.items.map((item) => (
          <div key={item.key}>{item.title}</div>
        ))}
      </div>
    )
  }

  const navigate = async (query: string) => {
    mocks.searchParams = new URLSearchParams(query)
    await act(async () => {
      root!.render(<Probe />)
    })
  }

  const listRequests = () =>
    requests.filter((request) => request.path === '/admin/inbox')
  const itemRequests = () =>
    requests.filter((request) => request.path === '/admin/inbox/item')
  const respond = async (request: Request, response: Response) => {
    await act(async () => {
      request.resolve(response)
    })
  }
  const fail = async (request: Request, message: string) => {
    await act(async () => {
      request.reject(new Error(message))
    })
  }
  const unmount = async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
  }

  beforeEach(() => {
    vi.clearAllMocks()
    requests = []
    mocks.refreshCounts.mockResolvedValue(undefined)
    mocks.searchParams = new URLSearchParams()
    mocks.kunFetchGet.mockImplementation(
      (path: string, query: Record<string, unknown>) =>
        new Promise<Response>((resolve, reject) =>
          requests.push({ path, query, resolve, reject })
        )
    )
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.com/dashboard'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await unmount()
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('sends the selected sources and full-backlog search to the API and trusts its matching rows', async () => {
    await navigate('kinds=submission,report&search=%20Moon%20&order=kind')
    expect(listRequests()).toHaveLength(1)
    expect(listRequests()[0].query).toEqual({
      kinds: 'submission,report',
      search: 'Moon',
      order: 'kind',
      limitPerKind: 50
    })
    const matchByAuthor = submission(17, '标题不含搜索词的作者匹配项')
    await respond(listRequests()[0], queue([matchByAuthor], 75))
    expect(current.items).toEqual([matchByAuthor])
    expect(current.totals?.submission).toBe(75)
    expect(current.truncated?.submission).toBe(true)
    expect(itemRequests()).toHaveLength(0)
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
  })

  it('submits search through URL state and requests the new server search without changing selected sources', async () => {
    await navigate('kinds=feedback,report')
    await respond(listRequests()[0], queue([]))
    await act(async () => {
      current.submitSearch('  页面打不开  ')
    })
    const href = mocks.router.push.mock.calls.at(-1)![0] as string
    const params = new URL(href, 'https://example.com').searchParams
    expect(params.get('kinds')).toBe('feedback,report')
    expect(params.get('search')).toBe('页面打不开')
    await navigate(params.toString())
    expect(listRequests().at(-1)!.query).toMatchObject({
      kinds: 'feedback,report',
      search: '页面打不开'
    })
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
  })

  it('loads a selected item outside the candidate window without adding it to the queue or its totals', async () => {
    await navigate('kinds=submission&kind=submission&id=99')
    await respond(listRequests()[0], queue([submission(1), submission(2)], 100))
    await respond(itemRequests()[0], pending(submission(99)))
    expect(current.selectedKey).toBe('submission:99')
    expect(current.item).toEqual({
      key: 'submission:99',
      data: pending(submission(99))
    })
    expect(current.items.map((item) => item.key)).toEqual([
      'submission:1',
      'submission:2'
    ])
    expect(current.totals?.submission).toBe(100)
    expect(current.truncated?.submission).toBe(true)
  })

  it('keeps B selected when an older A detail request completes afterwards', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    const firstA = itemRequests()[0]
    await navigate('kinds=submission&kind=submission&id=2')
    await respond(itemRequests()[1], pending(submission(2, 'B 当前详情')))
    await respond(firstA, pending(submission(1, 'A 过期详情')))
    expect(current.selectedKey).toBe('submission:2')
    expect(current.item).toMatchObject({
      key: 'submission:2',
      data: { item: { title: 'B 当前详情' } }
    })
    expect(current.itemError).toBe('')
    expect(listRequests()).toHaveLength(1)
  })

  it('does not let an old pending detail replace the processed state returned by a same-item conflict refresh', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    const originalDetail = itemRequests()[0]
    let refresh!: Promise<void>
    await act(async () => {
      refresh = current.onStateChanged('submission:1')
    })
    await respond(itemRequests()[1], processed(submission(1)))
    await refresh
    expect(current.item?.data.state).toBe('processed')
    expect(current.itemLoading).toBe(false)
    await respond(originalDetail, pending(submission(1)))
    expect(current.item?.data.state).toBe('processed')
    expect(current.items.map((item) => item.key)).toEqual(['submission:2'])
    expect(current.itemLoading).toBe(false)
    expect(listRequests()).toHaveLength(1)
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
  })

  it('keeps the latest processed state when two conflict refreshes finish in reverse order', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    await respond(itemRequests()[0], pending(submission(1)))
    let earlier!: Promise<void>
    let later!: Promise<void>
    await act(async () => {
      earlier = current.onStateChanged('submission:1')
      later = current.onStateChanged('submission:1')
    })
    await respond(itemRequests()[2], processed(submission(1)))
    await later
    expect(current.item?.data.state).toBe('processed')
    expect(current.items.map((item) => item.key)).toEqual(['submission:2'])
    await respond(itemRequests()[1], pending(submission(1, '旧待审快照')))
    await earlier
    expect(current.item?.data.state).toBe('processed')
    expect(current.items.map((item) => item.key)).toEqual(['submission:2'])
    expect(current.itemsRef.current.map((item) => item.key)).toEqual([
      'submission:2'
    ])
    expect(current.totals?.submission).toBe(1)
    expect(current.itemLoading).toBe(false)
    expect(listRequests()).toHaveLength(1)
  })

  it('refreshes the conflicted A item without replacing currently selected B or refetching the whole list', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    await respond(itemRequests()[0], pending(submission(1)))
    await navigate('kinds=submission&kind=submission&id=2')
    await respond(itemRequests()[1], pending(submission(2)))
    let refresh!: Promise<void>
    await act(async () => {
      refresh = current.onStateChanged('submission:1')
    })
    await respond(itemRequests()[2], { state: 'missing', item: null })
    await refresh
    expect(current.item?.key).toBe('submission:2')
    expect(current.items.map((item) => item.key)).toEqual(['submission:2'])
    expect(listRequests()).toHaveLength(1)
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
  })

  it('keeps a fresh item retry ahead of an older conflict response for the same submission', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    await respond(itemRequests()[0], pending(submission(1)))
    let conflict!: Promise<void>
    await act(async () => {
      conflict = current.onStateChanged('submission:1')
    })
    await act(async () => current.retryItem())
    const resubmitted = submission(1, '刚重新提交的投稿')
    await respond(itemRequests()[2], pending(resubmitted))
    await respond(itemRequests()[1], processed(submission(1)))
    await conflict
    expect(current.item?.data).toEqual(pending(resubmitted))
    expect(current.items.map((item) => item.key)).toEqual([
      'submission:1',
      'submission:2'
    ])
    expect(current.totals?.submission).toBe(2)
  })

  it('removes only the captured processed key after the reviewer has selected another item', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(
      listRequests()[0],
      queue([submission(1), submission(2), submission(3)])
    )
    await respond(itemRequests()[0], pending(submission(1)))
    const completeA = current.onProcessed
    await navigate('kinds=submission&kind=submission&id=2')
    await respond(itemRequests()[1], pending(submission(2)))
    await act(async () => {
      completeA('submission:1')
    })
    expect(current.selectedKey).toBe('submission:2')
    expect(current.items.map((item) => item.key)).toEqual([
      'submission:2',
      'submission:3'
    ])
    expect(current.itemsRef.current.map((item) => item.key)).toEqual([
      'submission:2',
      'submission:3'
    ])
    expect(mocks.router.replace).not.toHaveBeenCalled()
    expect(mocks.refreshCounts).toHaveBeenCalledOnce()
  })

  it('preserves the current source, search and order when an old success callback advances the selection', async () => {
    await navigate('kinds=submission&search=旧搜索&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    await respond(itemRequests()[0], pending(submission(1)))
    const completeA = current.onProcessed
    await navigate(
      'kinds=submission,report&search=新搜索&order=kind&kind=submission&id=1'
    )
    await respond(listRequests()[1], queue([submission(1), submission(3)]))
    await act(async () => {
      completeA('submission:1')
    })
    const href = mocks.router.replace.mock.calls.at(-1)![0] as string
    const params = new URL(href, 'https://example.com').searchParams
    expect(params.get('search')).toBe('新搜索')
    expect(params.get('kinds')).toBe('submission,report')
    expect(params.get('order')).toBe('kind')
    expect(params.get('id')).toBe('3')
    expect(current.items.map((item) => item.key)).toEqual(['submission:3'])
    expect(listRequests().at(-1)!.query).toMatchObject({
      search: '新搜索',
      kinds: 'submission,report',
      order: 'kind'
    })
  })

  it.each(['retryList', 'refreshAll'] as const)(
    'shows a submission with the same ID again when the author resubmits and %s receives its pending row',
    async (refreshMethod) => {
      await navigate('kinds=submission&kind=submission&id=1')
      await respond(listRequests()[0], queue([submission(1), submission(2)]))
      await respond(itemRequests()[0], pending(submission(1)))

      await act(async () => {
        current.onProcessed('submission:1')
      })
      const href = mocks.router.replace.mock.calls.at(-1)![0] as string
      await navigate(
        new URL(href, 'https://example.com').searchParams.toString()
      )
      await respond(itemRequests()[1], pending(submission(2)))
      await respond(listRequests()[1], queue([submission(2)]))
      expect(current.items.map((item) => item.key)).toEqual(['submission:2'])

      const resubmitted = submission(1, '作者修改后重新提交')
      let refresh: Promise<void> | undefined
      await act(async () => {
        if (refreshMethod === 'refreshAll') refresh = current.refreshAll()
        else current.retryList()
      })
      await respond(listRequests()[2], queue([submission(2), resubmitted]))
      if (refreshMethod === 'refreshAll') {
        await respond(itemRequests()[2], pending(submission(2)))
        await refresh
      }

      expect(current.items).toEqual([submission(2), resubmitted])
      expect(current.itemsRef.current).toEqual([submission(2), resubmitted])
      expect(current.totals?.submission).toBe(2)
      expect(current.truncated?.submission).toBe(false)
      expect(current.selectedKey).toBe('submission:2')
    }
  )

  it.each([
    ['search', 'kinds=submission&search=新的关键词'],
    ['sources', 'kinds=feedback']
  ])(
    'does not expose the previous queue as the new %s result while loading',
    async (_name, nextQuery) => {
      await navigate('kinds=submission')
      await respond(listRequests()[0], queue([submission(1, '旧结果')], 80))
      await navigate(nextQuery)
      expect(current.listLoading).toBe(true)
      expect(current.items).toEqual([])
      expect(current.totals).toBeNull()
      expect(current.truncated).toBeNull()
      expect(current.itemsRef.current).toEqual([])
    }
  )

  it.each([
    ['search', 'kinds=submission&search=新的关键词'],
    ['sources', 'kinds=feedback']
  ])(
    'does not advertise the old queue and counts when the new %s query fails',
    async (_name, nextQuery) => {
      await navigate('kinds=submission')
      await respond(listRequests()[0], queue([submission(1, '旧结果')], 80))
      await navigate(nextQuery)
      await respond(listRequests()[1], '查询失败，请重试')
      expect(current.listError).toBe('查询失败，请重试')
      expect(current.listLoading).toBe(false)
      expect(current.items).toEqual([])
      expect(current.totals).toBeNull()
      expect(current.truncated).toBeNull()
      expect(current.itemsRef.current).toEqual([])
    }
  )

  it('ignores an older query failure after the current query has loaded', async () => {
    await navigate('kinds=submission&search=旧搜索')
    const previous = listRequests()[0]
    await navigate('kinds=submission&search=新搜索')
    await respond(listRequests()[1], queue([submission(2, '新搜索结果')]))
    await fail(previous, '旧请求失败')
    expect(current.items.map((item) => item.title)).toEqual(['新搜索结果'])
    expect(current.listError).toBe('')
    expect(current.listLoading).toBe(false)
  })

  it('does not launch refresh requests, counts or navigation when a review finishes after unmount', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1), submission(2)]))
    await respond(itemRequests()[0], pending(submission(1)))
    const completeA = current.onProcessed
    const beforeUnmount = requests.length
    await unmount()
    await act(async () => {
      completeA('submission:1')
    })
    expect(requests).toHaveLength(beforeUnmount)
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
    expect(mocks.router.replace).not.toHaveBeenCalled()
  })

  it('does not display a conflict refresh error after leaving the inbox', async () => {
    await navigate('kinds=submission&kind=submission&id=1')
    await respond(listRequests()[0], queue([submission(1)]))
    await respond(itemRequests()[0], pending(submission(1)))
    let refresh!: Promise<void>
    await act(async () => {
      refresh = current.onStateChanged('submission:1')
    })
    const conflictRequest = itemRequests()[1]
    await unmount()
    await fail(conflictRequest, '离开页面后到达的错误')
    await refresh
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it.each(['2147483648', '9999999999', '01', '1e2', '0', '-1'])(
    'does not request a selected item with invalid PostgreSQL integer ID %s',
    async (id) => {
      await navigate(`kinds=submission&kind=submission&id=${id}`)
      expect(current.selectionStatus).toBe('invalid')
      expect(current.selectedKey).toBeNull()
      expect(itemRequests()).toHaveLength(0)
      expect(listRequests()).toHaveLength(1)
    }
  )
})
