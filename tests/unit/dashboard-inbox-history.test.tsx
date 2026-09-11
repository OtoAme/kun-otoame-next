import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PATCH_SUBMISSION_LIST_PAGE_MAX,
  PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH
} from '~/constants/patchSubmission'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type { AdminSubmissionRow } from '~/app/api/admin/patch-submission/service'
import type {
  InboxItem,
  InboxItemResponse,
  InboxListResponse
} from '~/types/api/inbox'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

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
  usePathname: () => '/dashboard/inbox',
  useSearchParams: () => mocks.searchParams,
  useRouter: () => mocks.router
}))

import {
  INBOX_HISTORY_LIMIT,
  INBOX_SUBMISSION_STATUSES,
  INBOX_SUBMISSION_STATUS_LABELS,
  useInbox,
  type UseInboxReturn
} from '~/hooks/dashboard/useInbox'
import { InboxListPane } from '~/components/dashboard/inbox/InboxListPane'
import { InboxToolbar } from '~/components/dashboard/inbox/InboxToolbar'

interface HistoryResponse {
  submissions: AdminSubmissionRow[]
  total: number
}

type Response = InboxListResponse | InboxItemResponse | HistoryResponse | string

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

const processedItem = (item: InboxItem): InboxItemResponse => ({
  state: 'processed',
  item
})

const historyRow = (
  id: number,
  status: PatchSubmissionStatus,
  name = `投稿 ${id}`
): AdminSubmissionRow => ({
  id,
  status,
  name,
  authorName: '作者',
  authorId: 7,
  submittedAt: '2026-09-01T00:00:00.000Z',
  reviewedAt:
    status === 'pending' || status === 'draft'
      ? null
      : '2026-09-05T00:00:00.000Z',
  updated: '2026-09-05T00:00:00.000Z',
  created: '2026-09-01T00:00:00.000Z'
})

const historyItem = (row: AdminSubmissionRow): InboxItem => ({
  key: `submission:${row.id}`,
  kind: 'submission',
  id: row.id,
  title: row.name,
  subtitle: row.authorName,
  actor: { id: row.authorId, name: row.authorName },
  waitingFrom: row.updated,
  waitingSeconds: 0,
  targetHref: `/admin/submission/${row.id}`,
  badges: [],
  readOnly: false,
  payload: row
})

const history = (
  rows: AdminSubmissionRow[],
  total = rows.length
): HistoryResponse => ({ submissions: rows, total })

const stubInbox = (
  overrides: Partial<UseInboxReturn> = {}
): UseInboxReturn => ({
  kinds: ['submission'],
  search: '',
  order: 'waiting',
  submissionOnly: true,
  submissionStatus: 'pending',
  submissionPage: 1,
  historyMode: false,
  selectionStatus: 'none',
  selection: null,
  selectedKey: null,
  items: [],
  totals: null,
  truncated: null,
  listLoading: false,
  listError: '',
  item: null,
  itemLoading: false,
  itemError: '',
  refreshing: false,
  itemsRef: { current: [] },
  selectItem: vi.fn(),
  clearSelection: vi.fn(),
  toggleKind: vi.fn(),
  setOrder: vi.fn(),
  setSubmissionStatus: vi.fn(),
  setSubmissionPage: vi.fn(),
  submitSearch: vi.fn(),
  retryList: vi.fn(),
  retryItem: vi.fn(),
  refreshAll: vi.fn(async () => {}),
  onProcessed: vi.fn(),
  onStateChanged: vi.fn(async () => {}),
  ...overrides
})

describe('dashboard inbox submission history mode', () => {
  let root: Root | undefined
  let dom: JSDOM
  let container: HTMLElement
  let current: UseInboxReturn
  let requests: Request[]

  function Probe() {
    current = useInbox({ refreshCounts: mocks.refreshCounts })
    return (
      <div>
        <output data-testid="selection">{current.selectedKey}</output>
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
  const historyRequests = () =>
    requests.filter((request) => request.path === '/admin/patch-submission')
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
  const lastPushParams = () =>
    new URL(
      mocks.router.push.mock.calls.at(-1)![0] as string,
      'https://example.com'
    ).searchParams
  const lastReplaceParams = () =>
    new URL(
      mocks.router.replace.mock.calls.at(-1)![0] as string,
      'https://example.com'
    ).searchParams
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
      url: 'https://example.com/dashboard/inbox'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal(
      'getComputedStyle',
      dom.window.getComputedStyle.bind(dom.window)
    )
    vi.stubGlobal('HTMLFormElement', dom.window.HTMLFormElement)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    container = dom.window.document.getElementById(
      'root'
    )! as unknown as HTMLElement
    root = createRoot(container)
  })

  afterEach(async () => {
    await unmount()
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('exposes the seven legacy statuses in the legacy order with their labels', () => {
    expect(INBOX_HISTORY_LIMIT).toBe(50)
    expect(INBOX_SUBMISSION_STATUSES).toEqual([
      'pending',
      'draft',
      'changes_requested',
      'rejected',
      'published',
      'violation',
      'deleted'
    ])
    expect(
      INBOX_SUBMISSION_STATUSES.map(
        (status) => INBOX_SUBMISSION_STATUS_LABELS[status]
      )
    ).toEqual([
      '待审核',
      '草稿',
      '要求修改',
      '已驳回',
      '已发布',
      '违规关闭',
      '已删除'
    ])
  })

  it('keeps the submission-only default on the unified pending queue and strips history params on navigation', async () => {
    await navigate('kinds=submission&submissionStatus=pending&submissionPage=2')
    expect(current.submissionOnly).toBe(true)
    expect(current.historyMode).toBe(false)
    expect(current.submissionStatus).toBe('pending')
    expect(listRequests()).toHaveLength(1)
    expect(historyRequests()).toHaveLength(0)
    expect(listRequests()[0].query).toEqual({
      kinds: 'submission',
      search: '',
      order: 'waiting',
      limitPerKind: 50
    })
    await respond(listRequests()[0], queue([submission(1)]))
    await act(async () => {
      current.selectItem(current.items[0])
    })
    const params = lastPushParams()
    expect(params.get('submissionStatus')).toBeNull()
    expect(params.get('submissionPage')).toBeNull()
    expect(params.get('kind')).toBe('submission')
    expect(params.get('id')).toBe('1')
  })

  it('reads a non-pending status from the legacy history endpoint and adapts rows to inbox items', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&submissionPage=2&search=%20Moon%20'
    )
    expect(current.historyMode).toBe(true)
    expect(current.submissionStatus).toBe('published')
    expect(current.submissionPage).toBe(2)
    expect(listRequests()).toHaveLength(0)
    expect(historyRequests()).toHaveLength(1)
    expect(historyRequests()[0].query).toEqual({
      status: 'published',
      query: 'Moon',
      page: 2,
      limit: INBOX_HISTORY_LIMIT
    })
    const row = historyRow(9, 'published', '月之彼方')
    await respond(historyRequests()[0], history([row], 120))
    expect(current.items).toHaveLength(1)
    const item = current.items[0]
    expect(item.key).toBe('submission:9')
    expect(item.kind).toBe('submission')
    expect(item.title).toBe('月之彼方')
    expect(item.subtitle).toBe('作者')
    expect(item.readOnly).toBe(false)
    expect(item.badges).toEqual([])
    expect(item.payload).toEqual(row)
    expect(current.itemsRef.current).toEqual(current.items)
    expect(current.totals).toEqual({
      submission: 120,
      'resource-apply': 0,
      feedback: 0,
      report: 0
    })
    expect(current.truncated).toEqual({
      submission: false,
      'resource-apply': false,
      feedback: false,
      report: false
    })
    expect(current.listLoading).toBe(false)
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', '/admin/inbox'],
    ['draft', '/admin/patch-submission'],
    ['changes_requested', '/admin/patch-submission'],
    ['rejected', '/admin/patch-submission'],
    ['published', '/admin/patch-submission'],
    ['violation', '/admin/patch-submission'],
    ['deleted', '/admin/patch-submission']
  ] as const)(
    'routes the %s status to %s without touching the other endpoint',
    async (status, path) => {
      await navigate(`kinds=submission&submissionStatus=${status}`)
      expect(current.submissionStatus).toBe(status)
      expect(current.historyMode).toBe(status !== 'pending')
      expect(requests).toHaveLength(1)
      expect(requests[0].path).toBe(path)
      if (path === '/admin/patch-submission') {
        expect(requests[0].query).toEqual({
          status,
          query: '',
          page: 1,
          limit: INBOX_HISTORY_LIMIT
        })
      }
    }
  )

  it.each(['archived', 'PUBLISHED', 'pending%20'])(
    'falls back to the unified pending queue for unknown status %s',
    async (raw) => {
      await navigate(`kinds=submission&submissionStatus=${raw}`)
      expect(current.submissionStatus).toBe('pending')
      expect(current.historyMode).toBe(false)
      expect(listRequests()).toHaveLength(1)
      expect(historyRequests()).toHaveLength(0)
    }
  )

  it.each([
    '0',
    '-1',
    'abc',
    '1.5',
    String(PATCH_SUBMISSION_LIST_PAGE_MAX + 1)
  ])('falls back to page 1 for invalid history page %s', async (raw) => {
    await navigate(
      `kinds=submission&submissionStatus=published&submissionPage=${raw}`
    )
    expect(current.submissionPage).toBe(1)
    expect(historyRequests()).toHaveLength(1)
    expect(historyRequests()[0].query).toMatchObject({ page: 1 })
  })

  it('ignores history params whenever another source is selected and drops them on the next navigation', async () => {
    await navigate(
      'kinds=submission,report&submissionStatus=published&submissionPage=3'
    )
    expect(current.submissionOnly).toBe(false)
    expect(current.historyMode).toBe(false)
    expect(historyRequests()).toHaveLength(0)
    expect(listRequests()).toHaveLength(1)
    expect(listRequests()[0].query).toMatchObject({
      kinds: 'submission,report'
    })
    await respond(listRequests()[0], queue([submission(1)]))
    await act(async () => {
      current.selectItem(current.items[0])
    })
    const params = lastPushParams()
    expect(params.get('kinds')).toBe('submission,report')
    expect(params.get('submissionStatus')).toBeNull()
    expect(params.get('submissionPage')).toBeNull()
  })

  it('adding another source leaves history mode and returns to the pending queue', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&submissionPage=2'
    )
    await respond(
      historyRequests()[0],
      history([historyRow(1, 'published')], 60)
    )
    expect(current.historyMode).toBe(true)
    await act(async () => {
      current.toggleKind('report', true)
    })
    const params = lastPushParams()
    expect(params.get('kinds')).toBe('submission,report')
    expect(params.get('submissionStatus')).toBeNull()
    expect(params.get('submissionPage')).toBeNull()
    await navigate(params.toString())
    expect(current.historyMode).toBe(false)
    expect(listRequests().at(-1)!.query).toMatchObject({
      kinds: 'submission,report'
    })
    expect(historyRequests()).toHaveLength(1)
  })

  it('switching status resets the page and the selection and ignores the late detail', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&submissionPage=3&kind=submission&id=9'
    )
    await respond(
      historyRequests()[0],
      history([historyRow(9, 'published')], 120)
    )
    expect(current.selectedKey).toBe('submission:9')
    expect(itemRequests()).toHaveLength(1)
    await act(async () => {
      current.setSubmissionStatus('rejected')
    })
    const params = lastPushParams()
    expect(params.get('submissionStatus')).toBe('rejected')
    expect(params.get('submissionPage')).toBeNull()
    expect(params.get('kind')).toBeNull()
    expect(params.get('id')).toBeNull()
    await navigate(params.toString())
    expect(current.selectedKey).toBeNull()
    expect(current.item).toBeNull()
    expect(current.itemLoading).toBe(false)
    expect(historyRequests().at(-1)!.query).toEqual({
      status: 'rejected',
      query: '',
      page: 1,
      limit: INBOX_HISTORY_LIMIT
    })
    await respond(itemRequests()[0], processedItem(submission(9)))
    expect(current.item).toBeNull()
  })

  it('switching the status back to pending returns to the unified queue and drops history params', async () => {
    await navigate('kinds=submission&submissionStatus=published')
    await respond(historyRequests()[0], history([historyRow(1, 'published')]))
    await act(async () => {
      current.setSubmissionStatus('pending')
    })
    const params = lastPushParams()
    expect(params.get('submissionStatus')).toBeNull()
    expect(params.get('submissionPage')).toBeNull()
    await navigate(params.toString())
    expect(current.historyMode).toBe(false)
    expect(listRequests().at(-1)!.path).toBe('/admin/inbox')
    expect(listRequests().at(-1)!.query).toMatchObject({ kinds: 'submission' })
    expect(historyRequests()).toHaveLength(1)
  })

  it('submits a history search to the history endpoint and resets page and selection', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&submissionPage=2&kind=submission&id=9'
    )
    await respond(
      historyRequests()[0],
      history([historyRow(9, 'published')], 60)
    )
    await respond(itemRequests()[0], processedItem(submission(9)))
    await act(async () => {
      current.submitSearch('  外部ID词  ')
    })
    const params = lastPushParams()
    expect(params.get('search')).toBe('外部ID词')
    expect(params.get('submissionStatus')).toBe('published')
    expect(params.get('submissionPage')).toBeNull()
    expect(params.get('kind')).toBeNull()
    expect(params.get('id')).toBeNull()
    await navigate(params.toString())
    expect(historyRequests().at(-1)!.query).toEqual({
      status: 'published',
      query: '外部ID词',
      page: 1,
      limit: INBOX_HISTORY_LIMIT
    })
  })

  it('changes the page within the current status and keeps the status param', async () => {
    await navigate('kinds=submission&submissionStatus=published')
    await respond(
      historyRequests()[0],
      history([historyRow(1, 'published')], 120)
    )
    await act(async () => {
      current.setSubmissionPage(2)
    })
    const params = lastPushParams()
    expect(params.get('submissionStatus')).toBe('published')
    expect(params.get('submissionPage')).toBe('2')
    await navigate(params.toString())
    expect(historyRequests().at(-1)!.query).toMatchObject({
      status: 'published',
      page: 2
    })
    await respond(
      historyRequests().at(-1)!,
      history([historyRow(51, 'published', '第二页条目')], 120)
    )
    expect(current.items.map((item) => item.title)).toEqual(['第二页条目'])
  })

  it('ignores a late response from a previous page', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&submissionPage=1'
    )
    const stale = historyRequests()[0]
    await navigate(
      'kinds=submission&submissionStatus=published&submissionPage=2'
    )
    await respond(
      historyRequests()[1],
      history([historyRow(2, 'published', '第二页')], 120)
    )
    await respond(
      stale,
      history([historyRow(1, 'published', '第一页迟到')], 120)
    )
    expect(current.items.map((item) => item.title)).toEqual(['第二页'])
    expect(current.listLoading).toBe(false)
    expect(current.listError).toBe('')
  })

  it('ignores a late failure from a previous status', async () => {
    await navigate('kinds=submission&submissionStatus=published')
    const stale = historyRequests()[0]
    await navigate('kinds=submission&submissionStatus=rejected')
    await respond(
      historyRequests()[1],
      history([historyRow(3, 'rejected', '驳回条目')])
    )
    await fail(stale, '旧状态请求失败')
    expect(current.items.map((item) => item.title)).toEqual(['驳回条目'])
    expect(current.listError).toBe('')
    expect(current.listLoading).toBe(false)
  })

  it('reloads the current history list when a conflict changes status or search membership', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&search=月&kind=submission&id=9'
    )
    await respond(
      historyRequests()[0],
      history(
        [historyRow(9, 'published', '月'), historyRow(10, 'published', '月10')],
        2
      )
    )
    await respond(
      itemRequests()[0],
      processedItem(historyItem(historyRow(9, 'published', '月')))
    )
    let refresh!: Promise<void>
    await act(async () => {
      refresh = current.onStateChanged('submission:9')
    })
    await respond(
      itemRequests()[1],
      processedItem(historyItem(historyRow(9, 'rejected', 'changed')))
    )
    expect(historyRequests()).toHaveLength(2)
    expect(historyRequests()[1].query).toMatchObject({
      status: 'published',
      query: '月'
    })
    await respond(
      historyRequests()[1],
      history([historyRow(10, 'published', '月10')])
    )
    await refresh
    expect(current.items.map((item) => item.key)).toEqual(['submission:10'])
    expect(current.totals?.submission).toBe(1)
    expect(current.item?.data.state).toBe('processed')
    expect(current.itemLoading).toBe(false)
    expect(listRequests()).toHaveLength(0)
    expect(mocks.refreshCounts).not.toHaveBeenCalled()
  })

  it('refreshes pending counts after a successful action while history rows are authoritatively reloaded', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&kind=submission&id=9'
    )
    await respond(
      historyRequests()[0],
      history([historyRow(9, 'published'), historyRow(10, 'published')], 2)
    )
    await respond(itemRequests()[0], processedItem(submission(9)))
    await act(async () => {
      current.onProcessed('submission:9')
    })
    const params = lastReplaceParams()
    expect(params.get('submissionStatus')).toBe('published')
    expect(params.get('id')).toBe('10')
    expect(current.items.map((item) => item.key)).toEqual([
      'submission:9',
      'submission:10'
    ])
    expect(mocks.refreshCounts).toHaveBeenCalledTimes(1)
    expect(historyRequests()).toHaveLength(2)
    await respond(
      historyRequests()[1],
      history([historyRow(9, 'published'), historyRow(10, 'published')], 2)
    )
    expect(current.items.map((item) => item.key)).toEqual([
      'submission:9',
      'submission:10'
    ])
    expect(current.totals?.submission).toBe(2)
  })

  it('normalizes history URL, request and submitted searches to the legacy 107-character limit', async () => {
    const long = '测'.repeat(200)
    await navigate(`kinds=submission&submissionStatus=published&search=${long}`)
    const normalized = long.slice(0, PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH)
    expect(current.search).toBe(normalized)
    expect(historyRequests()[0].query.query).toBe(normalized)
    await act(async () => current.submitSearch(long))
    expect(lastPushParams().get('search')).toBe(normalized)
    await navigate(`kinds=submission&search=${long}`)
    expect(current.search).toBe(long)
    await act(async () => current.setSubmissionStatus('draft'))
    expect(lastPushParams().get('search')).toBe(normalized)
  })

  it.each([
    { page: 9999, total: 1, expected: 1 },
    { page: 3, total: 150, expected: 2 }
  ])(
    'replaces an empty history page $page with $expected while preserving its query',
    async ({ page, total, expected }) => {
      await navigate(
        `kinds=submission&submissionStatus=rejected&search=月&submissionPage=${page}`
      )
      await respond(historyRequests()[0], history([], total))
      expect(mocks.router.replace).toHaveBeenCalledTimes(1)
      const params = lastReplaceParams()
      expect(Number(params.get('submissionPage') ?? '1')).toBe(expected)
      expect(params.get('submissionStatus')).toBe('rejected')
      expect(params.get('search')).toBe('月')
      await navigate(params.toString())
      await respond(
        historyRequests()[1],
        history(
          [historyRow(8, 'rejected', '月')],
          expected * INBOX_HISTORY_LIMIT
        )
      )
      expect(current.items[0].title).toBe('月')
    }
  )

  it('does not redirect an empty first history page', async () => {
    await navigate('kinds=submission&submissionStatus=draft')
    await respond(historyRequests()[0], history([]))
    expect(mocks.router.replace).not.toHaveBeenCalled()
    expect(current.listLoading).toBe(false)
  })

  it.each([
    'kinds=submission&submissionStatus=rejected&kind=submission&id=9',
    'kinds=submission&submissionStatus=published&search=new&kind=submission&id=9',
    'kinds=submission&submissionStatus=published&submissionPage=2&kind=submission&id=9'
  ])(
    'refetches the same selected key when the history query changes: %s',
    async (query) => {
      await navigate(
        'kinds=submission&submissionStatus=published&kind=submission&id=9'
      )
      await respond(
        historyRequests()[0],
        history([historyRow(9, 'published')], 100)
      )
      await respond(
        itemRequests()[0],
        processedItem(historyItem(historyRow(9, 'published')))
      )
      await navigate(query)
      expect(itemRequests()).toHaveLength(2)
      expect(current.item).toBeNull()
      expect(current.itemLoading).toBe(true)
    }
  )

  it('never applies an old conflict result to a newer history search for another selected key', async () => {
    await navigate(
      'kinds=submission&submissionStatus=published&search=old&kind=submission&id=9'
    )
    await respond(
      historyRequests()[0],
      history([historyRow(9, 'published', 'old')])
    )
    await respond(
      itemRequests()[0],
      processedItem(historyItem(historyRow(9, 'published', 'old')))
    )
    let refresh!: Promise<void>
    await act(async () => {
      refresh = current.onStateChanged('submission:9')
    })
    const stale = itemRequests()[1]
    await navigate(
      'kinds=submission&submissionStatus=published&search=new&kind=submission&id=10'
    )
    await respond(
      historyRequests()[1],
      history([historyRow(9, 'published', 'new')])
    )
    await respond(
      itemRequests()[2],
      processedItem(historyItem(historyRow(10, 'published', 'new selection')))
    )
    await respond(
      stale,
      processedItem(historyItem(historyRow(9, 'published', 'stale old')))
    )
    await refresh
    expect(current.items.map((item) => item.title)).toEqual(['new'])
    expect(current.item?.key).toBe('submission:10')
    expect(current.itemLoading).toBe(false)
  })
  it('only reads the existing inbox item and patch-submission endpoints while browsing history', async () => {
    await navigate(
      'kinds=submission&submissionStatus=violation&kind=submission&id=4'
    )
    await respond(historyRequests()[0], history([historyRow(4, 'violation')]))
    await respond(itemRequests()[0], processedItem(submission(4)))
    let refresh!: Promise<void>
    await act(async () => {
      refresh = current.onStateChanged('submission:4')
    })
    await respond(itemRequests()[1], processedItem(submission(4)))
    if (historyRequests().length > 1)
      await respond(
        historyRequests().at(-1)!,
        history([historyRow(4, 'violation')])
      )
    await refresh
    let all!: Promise<void>
    await act(async () => {
      all = current.refreshAll()
    })
    await respond(
      historyRequests().at(-1)!,
      history([historyRow(4, 'violation')])
    )
    await respond(itemRequests()[2], processedItem(submission(4)))
    await act(async () => {
      await all
    })
    const paths = Array.from(
      new Set(requests.map((request) => request.path))
    ).sort()
    expect(paths).toEqual(['/admin/inbox/item', '/admin/patch-submission'])
    for (const request of historyRequests()) {
      expect(Object.keys(request.query).sort()).toEqual([
        'limit',
        'page',
        'query',
        'status'
      ])
    }
    expect(mocks.refreshCounts).toHaveBeenCalled()
  })

  it('loads a selected history entry through the existing inbox item endpoint', async () => {
    await navigate(
      'kinds=submission&submissionStatus=deleted&kind=submission&id=5'
    )
    await respond(historyRequests()[0], history([historyRow(5, 'deleted')]))
    expect(itemRequests()).toHaveLength(1)
    expect(itemRequests()[0].query).toEqual({ kind: 'submission', id: 5 })
    await respond(itemRequests()[0], processedItem(submission(5)))
    expect(current.item).toEqual({
      key: 'submission:5',
      data: processedItem(submission(5))
    })
  })

  describe('history presentation', () => {
    const renderPane = async (inbox: UseInboxReturn) => {
      await act(async () => {
        root!.render(<InboxListPane inbox={inbox} />)
      })
    }
    const renderToolbar = async (inbox: UseInboxReturn) => {
      function ToolbarWrapper() {
        const searchRef = React.useRef<HTMLInputElement | null>(null)
        return (
          <InboxToolbar
            inbox={inbox}
            searchRef={searchRef}
            helpOpen={false}
            onHelpOpenChange={() => {}}
          />
        )
      }
      await act(async () => {
        root!.render(<ToolbarWrapper />)
      })
    }
    const text = () => container.textContent ?? ''
    const buttonByText = (label: string) =>
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(label)
      )

    it('shows the status filter only when the submission source stands alone', async () => {
      await renderToolbar(stubInbox({ submissionOnly: true }))
      expect(
        container.querySelector('button[aria-label="条目状态"]')
      ).not.toBeNull()
      await renderToolbar(
        stubInbox({ submissionOnly: false, kinds: ['submission', 'report'] })
      )
      expect(
        container.querySelector('button[aria-label="条目状态"]')
      ).toBeNull()
    })

    it('keeps the pending placeholder and order select outside history mode', async () => {
      await renderToolbar(stubInbox({ historyMode: false }))
      const input = container.querySelector('#inbox-search')!
      expect(input.getAttribute('placeholder')).toBe('搜索待办事项')
      expect(
        container.querySelector('button[aria-label="排序方式"]')
      ).not.toBeNull()
      expect(input.getAttribute('maxlength')).toBe('300')
    })

    it('searches by title, author or external ID and hides the order select in history mode', async () => {
      await renderToolbar(
        stubInbox({ historyMode: true, submissionStatus: 'published' })
      )
      const placeholder = container
        .querySelector('#inbox-search')!
        .getAttribute('placeholder')
      expect(placeholder).toContain('标题')
      expect(placeholder).toContain('投稿人')
      expect(placeholder).toContain('外部ID')
      expect(
        container.querySelector('button[aria-label="排序方式"]')
      ).toBeNull()
      expect(
        container.querySelector('#inbox-search')?.getAttribute('maxlength')
      ).toBe(String(PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH))
    })

    it('renders the real status and review time instead of a waiting duration in history mode', async () => {
      const row = historyRow(9, 'published', '月之彼方')
      await renderPane(
        stubInbox({
          historyMode: true,
          submissionStatus: 'published',
          submissionPage: 2,
          items: [historyItem(row)],
          totals: {
            submission: 120,
            'resource-apply': 0,
            feedback: 0,
            report: 0
          },
          truncated: {
            submission: false,
            'resource-apply': false,
            feedback: false,
            report: false
          }
        })
      )
      expect(text()).toContain('「已发布」条目')
      expect(text()).toContain('第 2 / 3 页，共 120 条')
      expect(text()).toContain('已发布')
      expect(text()).toContain('审核于')
      expect(text()).not.toContain('等待')
      expect(text()).not.toContain('去旧后台')
    })

    it('falls back to the update time for entries that were never reviewed', async () => {
      const row = {
        ...historyRow(3, 'draft', '草稿条目'),
        reviewedAt: '2026-09-02T00:00:00.000Z'
      }
      await renderPane(
        stubInbox({
          historyMode: true,
          submissionStatus: 'draft',
          items: [historyItem(row)],
          totals: {
            submission: 1,
            'resource-apply': 0,
            feedback: 0,
            report: 0
          },
          truncated: {
            submission: false,
            'resource-apply': false,
            feedback: false,
            report: false
          }
        })
      )
      expect(text()).toContain(`更新于 ${formatChinaDateTime(row.updated)}`)
      expect(text()).not.toContain(formatChinaDateTime(row.reviewedAt))
      expect(text()).toContain('草稿')
      expect(text()).not.toContain('等待')
    })

    it('shows the status-specific empty state in history mode', async () => {
      await renderPane(
        stubInbox({
          historyMode: true,
          submissionStatus: 'published',
          items: [],
          totals: {
            submission: 0,
            'resource-apply': 0,
            feedback: 0,
            report: 0
          },
          truncated: {
            submission: false,
            'resource-apply': false,
            feedback: false,
            report: false
          }
        })
      )
      expect(text()).toContain('「已发布」状态暂无条目')
      await renderPane(
        stubInbox({
          historyMode: true,
          submissionStatus: 'published',
          search: '不存在',
          items: []
        })
      )
      expect(text()).toContain('没有找到匹配的条目')
    })

    it('paginates within the status through the inbox callbacks and respects the bounds', async () => {
      const setSubmissionPage = vi.fn()
      const base: Partial<UseInboxReturn> = {
        historyMode: true,
        submissionStatus: 'published',
        items: [historyItem(historyRow(1, 'published'))],
        totals: {
          submission: 120,
          'resource-apply': 0,
          feedback: 0,
          report: 0
        },
        truncated: {
          submission: false,
          'resource-apply': false,
          feedback: false,
          report: false
        },
        setSubmissionPage
      }
      await renderPane(stubInbox({ ...base, submissionPage: 1 }))
      expect(buttonByText('上一页')!.disabled).toBe(true)
      expect(buttonByText('下一页')!.disabled).toBe(false)
      await act(async () => {
        buttonByText('下一页')!.click()
      })
      expect(setSubmissionPage).toHaveBeenCalledWith(2)

      setSubmissionPage.mockClear()
      await renderPane(stubInbox({ ...base, submissionPage: 3 }))
      expect(buttonByText('下一页')!.disabled).toBe(true)
      expect(buttonByText('上一页')!.disabled).toBe(false)
      await act(async () => {
        buttonByText('上一页')!.click()
      })
      expect(setSubmissionPage).toHaveBeenCalledWith(2)
    })

    it('keeps the pending queue presentation unchanged outside history mode', async () => {
      await renderPane(
        stubInbox({
          historyMode: false,
          items: [submission(1)],
          totals: {
            submission: 1,
            'resource-apply': 0,
            feedback: 0,
            report: 0
          },
          truncated: {
            submission: false,
            'resource-apply': false,
            feedback: false,
            report: false
          }
        })
      )
      expect(text()).toContain('待办列表')
      expect(text()).toContain('等待 1 分钟')
      expect(text()).toContain('待审条目')
      expect(buttonByText('下一页')).toBeUndefined()
    })
  })
})
