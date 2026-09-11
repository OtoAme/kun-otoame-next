import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser } from '~/types/api/admin'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  searchParams: new URLSearchParams(),
  router: { push: vi.fn() },
  editProps: new Map<
    number,
    { user: AdminUser; onUpdated: (id: number) => void }
  >(),
  deleteProps: new Map<
    number,
    { user: AdminUser; currentUserId: number; onDeleted: (id: number) => void }
  >(),
  grantProps: new Map<
    number,
    {
      user: AdminUser
      currentUserId: number
      onGranted?: (uid: number) => void
    }
  >()
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/user',
  useSearchParams: () => mocks.searchParams,
  useRouter: () => mocks.router
}))
vi.mock('next/link', () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean }) => <a {...props} />
}))
vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />
}))
vi.mock('~/components/dashboard/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string; size?: string }) => (
    <button {...props} />
  )
}))
vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLInputElement>)
      }
    />
  )
}))
vi.mock('~/components/dashboard/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))
vi.mock('~/components/dashboard/ui/skeleton', () => ({
  Skeleton: () => <span aria-hidden="true" />
}))
vi.mock('~/components/dashboard/ui/table', () => ({
  Table: (props: React.ComponentProps<'table'>) => <table {...props} />,
  TableHeader: (props: React.ComponentProps<'thead'>) => <thead {...props} />,
  TableBody: (props: React.ComponentProps<'tbody'>) => <tbody {...props} />,
  TableRow: (props: React.ComponentProps<'tr'>) => <tr {...props} />,
  TableHead: (props: React.ComponentProps<'th'>) => <th {...props} />,
  TableCell: (props: React.ComponentProps<'td'>) => <td {...props} />
}))
// Keep selected values, option ranges and labels; Radix behavior is covered separately.
vi.mock('~/components/dashboard/ui/select', async () => {
  const R = await import('react')
  const SelectTrigger = (_props: {
    'aria-label'?: string
    children?: React.ReactNode
  }) => null
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => {
      const elements = R.Children.toArray(children).filter(
        R.isValidElement
      ) as React.ReactElement<{
        'aria-label'?: string
        children?: React.ReactNode
      }>[]
      const trigger = elements.find((element) => element.type === SelectTrigger)
      const content = elements.find((element) => element.type === SelectContent)
      return (
        <select
          aria-label={trigger?.props['aria-label']}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {content?.props.children}
        </select>
      )
    },
    SelectTrigger,
    SelectContent,
    SelectItem: (props: React.ComponentProps<'option'>) => (
      <option {...props} />
    ),
    SelectValue: () => null
  }
})
vi.mock('~/components/dashboard/user/UserEditDialog', () => ({
  UserEditDialog: (props: {
    user: AdminUser
    onUpdated: (id: number) => void
  }) => {
    mocks.editProps.set(props.user.id, props)
    return (
      <button onClick={() => props.onUpdated(props.user.id)}>
        编辑 {props.user.id}
      </button>
    )
  }
}))
vi.mock('~/components/dashboard/user/DeleteUserDialog', () => ({
  DeleteUserDialog: (props: {
    user: AdminUser
    currentUserId: number
    onDeleted: (id: number) => void
  }) => {
    mocks.deleteProps.set(props.user.id, props)
    return (
      <button onClick={() => props.onDeleted(props.user.id)}>
        删除 {props.user.id}
      </button>
    )
  }
}))
vi.mock('~/components/dashboard/user/GrantMoemoepointDialog', () => ({
  GrantMoemoepointDialog: (props: {
    user: AdminUser
    currentUserId: number
    onGranted?: (uid: number) => void
  }) => {
    mocks.grantProps.set(props.user.id, props)
    return <button>发点 {props.user.id}</button>
  }
}))

import { useUsers } from '~/hooks/dashboard/useUsers'
import { DashboardUsers } from '~/components/dashboard/user/DashboardUsers'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'

type Result = { users: AdminUser[]; total: number } | string
interface Request {
  path: string
  query: Record<string, unknown>
  resolve: (response: unknown) => void
  reject: (error: Error) => void
}
const user = (id: number, overrides: Partial<AdminUser> = {}): AdminUser => ({
  id,
  name: `用户 ${id}`,
  email: `user${id}@example.test`,
  enable2FA: false,
  bio: '简介',
  avatar: '',
  role: 1,
  status: 0,
  moemoepoint: -5,
  dailyImageCount: 2,
  created: '2026-09-01T16:05:00.000Z',
  _count: { patch: 7, patch_resource: 11 },
  ...overrides
})
const rows = (users: AdminUser[], total = users.length): Result => ({
  users,
  total
})

let dom: JSDOM
let root: Root | undefined
let current: ReturnType<typeof useUsers>
let requests: Request[]
let view: 'hook' | 'page'
function Probe() {
  current = useUsers()
  return <output>{current.users.map((row) => row.name).join(',')}</output>
}
const render = async (query: string, mode = view) => {
  view = mode
  mocks.searchParams = new URLSearchParams(query)
  await act(async () =>
    root!.render(
      mode === 'hook' ? <Probe /> : <DashboardUsers currentUserId={44} />
    )
  )
}
const respond = async (request: Request, response: unknown) => {
  await act(async () => request.resolve(response))
}
const reject = async (request: Request) => {
  await act(async () => request.reject(new Error('isolated network failure')))
}
const latest = () => requests.at(-1)!
const pushedQuery = () =>
  new URL(mocks.router.push.mock.calls.at(-1)![0], 'https://example.test')
    .searchParams
const followPush = async () => render(pushedQuery().toString())
const click = async (name: string) => {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent === name
  )
  expect(button, `button ${name}`).toBeDefined()
  await act(async () => button!.click())
}
const input = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="搜索用户"]')!
const typeSearch = async (value: string) => {
  await act(async () => {
    input().value = value
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const advance = async (milliseconds: number) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
  })
}
const unmount = async () => {
  await act(async () => root?.unmount())
  root = undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.searchParams = new URLSearchParams()
  mocks.editProps.clear()
  mocks.deleteProps.clear()
  mocks.grantProps.clear()
  requests = []
  view = 'hook'
  mocks.get.mockImplementation(
    (path: string, query: Record<string, unknown>) =>
      new Promise((resolve, reject) =>
        requests.push({ path, query, resolve, reject })
      )
  )
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://example.test/dashboard/user'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => {
  await unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
  dom.window.close()
  vi.unstubAllGlobals()
})

describe('dashboard user query and request state', () => {
  it.each(['name', 'email', 'id'])(
    'passes the selected %s search and pagination to the existing API without filtering its response locally',
    async (searchType) => {
      await render(`page=9&limit=500&search=9999999&searchType=${searchType}`)
      expect(requests).toHaveLength(1)
      expect(latest().path).toBe('/admin/user')
      expect(latest().query).toEqual({
        page: 9,
        limit: 500,
        search: '9999999',
        searchType
      })
      const serverMatch = user(123, { name: '服务端全量范围匹配项' })
      await respond(latest(), rows([serverMatch], 4001))
      expect(current.users).toEqual([serverMatch])
      expect(current.total).toBe(4001)
    }
  )

  it.each(['10000000', '9999999999999999999999999999999', '3.5', '-1', 'abc'])(
    'blocks invalid ID search %s before making any HTTP request',
    async (search) => {
      await render(`searchType=id&search=${search}`)
      expect(current.query.idSearchError).not.toBeNull()
      expect(current.users).toEqual([])
      expect(current.loading).toBe(false)
      expect(requests).toHaveLength(0)
    }
  )

  it('uses bounded defaults for malformed URL state and caps search at the existing 300 character limit', async () => {
    await render(
      `page=9007199254740993&limit=501&searchType=unknown&search=${'x'.repeat(310)}`
    )
    expect(latest().query).toEqual({
      page: 1,
      limit: 30,
      searchType: 'name',
      search: 'x'.repeat(300)
    })
  })

  it('restores the full URL query on back and forward navigation', async () => {
    await render('page=2&limit=50&search=alice&searchType=name')
    await respond(latest(), rows([user(1)], 51))
    await render('page=4&limit=100&search=mail&searchType=email')
    await respond(latest(), rows([user(2)], 401))
    await render('page=2&limit=50&search=alice&searchType=name')
    expect(current.query).toMatchObject({
      page: 2,
      limit: 50,
      search: 'alice',
      searchType: 'name'
    })
    expect(current.users).toEqual([])
    expect(latest().query).toMatchObject({
      page: 2,
      limit: 50,
      search: 'alice',
      searchType: 'name'
    })
    expect(mocks.router.push).not.toHaveBeenCalled()
  })

  it('keeps the newer query result when an older request succeeds or fails later', async () => {
    await render('search=old')
    const old = latest()
    await render('search=middle')
    const middle = latest()
    await render('search=current')
    await respond(latest(), rows([user(3, { name: '当前结果' })]))
    await respond(old, rows([user(1)]))
    await reject(middle)
    expect(current.users[0].name).toBe('当前结果')
    expect(current.error).toBeNull()
    expect(current.loading).toBe(false)
  })

  it('ignores a pre-navigation response after returning to the same query key', async () => {
    await render('search=A')
    const oldA = latest()
    await render('search=B')
    const oldB = latest()
    await render('search=A')
    const newA = latest()
    await respond(oldA, rows([user(1, { name: '旧 A' })]))
    expect(current.users).toEqual([])
    expect(current.loading).toBe(true)
    await respond(newA, rows([user(2, { name: '新 A' })]))
    await reject(oldB)
    expect(current.users[0].name).toBe('新 A')
    expect(current.error).toBeNull()
  })

  it('keeps only the latest response when two refreshes of the same query overlap', async () => {
    await render('search=current')
    await respond(latest(), rows([user(1)]))
    await act(async () => current.refresh())
    const first = latest()
    await act(async () => current.refresh())
    const second = latest()
    expect(current.refreshing).toBe(true)
    await respond(second, rows([user(2)], 20))
    await respond(first, '旧刷新失败')
    expect(current.users.map((row) => row.id)).toEqual([2])
    expect(current.total).toBe(20)
    expect(current.error).toBeNull()
    expect(current.refreshing).toBe(false)
  })

  it.each(['服务端拒绝', '', null, { users: null, total: 3 }])(
    'recovers from string or malformed server results: %j',
    async (badResponse) => {
      await render('search=retry')
      await respond(latest(), badResponse)
      expect(current.error).toBeTruthy()
      expect(current.users).toEqual([])
      expect(current.loading).toBe(false)
      await act(async () => current.refresh())
      await respond(latest(), rows([user(7)]))
      expect(current.error).toBeNull()
      expect(current.users[0].id).toBe(7)
    }
  )

  it('recovers from a rejected request and prevents its error leaking into another query', async () => {
    await render('search=failed')
    await reject(latest())
    expect(current.error).toContain('网络错误')
    await render('search=good')
    expect(current.error).toBeNull()
    expect(current.loading).toBe(true)
    await respond(latest(), rows([user(8)]))
    expect(current.users[0].id).toBe(8)
  })

  it('refreshes the live query when an old delete dialog completes after a search change', async () => {
    await render('page=2&limit=30&search=old&searchType=name')
    await respond(latest(), rows([user(31)], 31))
    const oldCallback = current.notifyDeleted
    await render('page=3&limit=50&search=new&searchType=email')
    await respond(latest(), rows([user(101)], 101))
    const before = requests.length
    await act(async () => oldCallback(31))
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(requests).toHaveLength(before + 1)
    expect(latest().query).toEqual({
      page: 3,
      limit: 50,
      search: 'new',
      searchType: 'email'
    })
  })

  it('refreshes the live query when an old edit dialog completes after navigation', async () => {
    await render('page=2&limit=30&search=old')
    await respond(latest(), rows([user(31)], 31))
    const oldCallback = current.notifyUpdated
    await render('page=4&limit=100&search=new&searchType=email')
    await respond(latest(), rows([user(301)], 301))
    await act(async () => oldCallback(31))
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(latest().query).toEqual({
      page: 4,
      limit: 100,
      search: 'new',
      searchType: 'email'
    })
  })

  it('moves back one page only when the deleted UID is the visible last result', async () => {
    await render('page=3&limit=30&search=target&searchType=name')
    await respond(latest(), rows([user(61)], 61))
    await act(async () => current.notifyDeleted(61))
    expect(Object.fromEntries(pushedQuery())).toEqual({
      page: '2',
      limit: '30',
      search: 'target',
      searchType: 'name'
    })
    await followPush()
    expect(latest().query.page).toBe(2)
  })

  it.each([undefined, 999])(
    'does not shorten the current last page for an unrelated deleted UID %s',
    async (id) => {
      await render('page=3&limit=30&search=current&searchType=name')
      await respond(latest(), rows([user(61)], 61))
      await act(async () => current.notifyDeleted(id))
      expect(mocks.router.push).not.toHaveBeenCalled()
      expect(latest().query).toMatchObject({ page: 3, search: 'current' })
    }
  )

  it('uses the current page size and search when the old deleted UID also belongs to the new result', async () => {
    await render('page=2&limit=30&search=old')
    await respond(latest(), rows([user(61)], 31))
    const callback = current.notifyDeleted
    await render('page=4&limit=20&search=new&searchType=email')
    await respond(latest(), rows([user(61)], 61))
    await act(async () => callback(61))
    expect(Object.fromEntries(pushedQuery())).toEqual({
      page: '3',
      limit: '20',
      search: 'new',
      searchType: 'email'
    })
  })

  it('keeps a new mount independent of late success from an unmounted request', async () => {
    await render('search=old')
    const old = latest()
    await unmount()
    root = createRoot(document.getElementById('root')!)
    await render('search=current')
    await respond(latest(), rows([user(7)]))
    await respond(old, rows([user(1)]))
    expect(current.users.map((row) => row.id)).toEqual([7])
    expect(mocks.router.push).not.toHaveBeenCalled()
  })
})

describe('dashboard user list controls and wiring', () => {
  it('links the actual negative balance directly to that user ledger', async () => {
    await render('', 'page')
    await respond(latest(), rows([user(17, { moemoepoint: -5 })]))
    const link = document.querySelector(
      'a[href="/dashboard/user/17/moemoepoint"]'
    )!
    expect(link.textContent?.trim()).toBe('-5')
    expect(link.getAttribute('aria-label')).toContain('17')
    expect(document.querySelector('tbody')?.textContent).not.toContain(
      '萌萌点明细'
    )
  })

  it('refreshes the current search after a grant without copying the previous user balance into it', async () => {
    await render('search=old', 'page')
    await respond(latest(), rows([user(17, { moemoepoint: -5 })]))
    const granted = mocks.grantProps.get(17)?.onGranted
    expect(granted).toEqual(expect.any(Function))
    await render('search=new')
    await respond(latest(), rows([user(18, { moemoepoint: 30 })]))
    await act(async () => granted!(17))
    expect(latest().query.search).toBe('new')
    await respond(latest(), rows([user(18, { moemoepoint: 40 })]))
    expect(
      document
        .querySelector('a[href="/dashboard/user/18/moemoepoint"]')
        ?.textContent?.trim()
    ).toBe('40')
    expect(
      document.querySelector('a[href="/dashboard/user/17/moemoepoint"]')
    ).toBeNull()
  })

  it('debounces typing for 500 ms and resets page while preserving size and selected search type', async () => {
    await render('page=4&limit=100&searchType=email', 'page')
    await typeSearch('  first ')
    await advance(300)
    await typeSearch('  second@example.test  ')
    await advance(499)
    expect(mocks.router.push).not.toHaveBeenCalled()
    await advance(1)
    expect(Object.fromEntries(pushedQuery())).toEqual({
      page: '1',
      limit: '100',
      search: 'second@example.test',
      searchType: 'email'
    })
    expect(mocks.router.push).toHaveBeenCalledTimes(1)
    await followPush()
    expect(latest().query.search).toBe('second@example.test')
  })

  it('submits the search form immediately on Enter without a second debounced navigation', async () => {
    await render('page=4&limit=50&searchType=name', 'page')
    await typeSearch('输入搜索')
    await act(async () =>
      input()
        .closest('form')!
        .dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true })
        )
    )
    expect(pushedQuery().get('search')).toBe('输入搜索')
    expect(pushedQuery().get('page')).toBe('1')
    await advance(1000)
    expect(mocks.router.push).toHaveBeenCalledTimes(1)
  })

  it.each([
    'page=2&limit=30&searchType=name',
    'page=1&limit=100&searchType=name',
    'page=1&limit=30&searchType=email'
  ])(
    'cancels pending typing when external navigation changes %s with the same search text',
    async (destination) => {
      await render('page=1&limit=30&search=old&searchType=name', 'page')
      await typeSearch('尚未提交')
      await advance(100)
      await render(`${destination}&search=old`)
      expect(input().value).toBe('old')
      await advance(1000)
      expect(mocks.router.push).not.toHaveBeenCalled()
    }
  )

  it('preserves further typing while the previous own search navigation finishes', async () => {
    await render('search=old', 'page')
    await typeSearch('first')
    await advance(500)
    const firstDestination = pushedQuery().toString()
    await typeSearch('second')
    await render(firstDestination)
    expect(input().value).toBe('second')
    await advance(500)
    expect(pushedQuery().get('search')).toBe('second')
    expect(mocks.router.push).toHaveBeenCalledTimes(2)
  })

  it('does not mistake external pagination with the submitted text for its own search navigation', async () => {
    await render('page=1&limit=30&search=old&searchType=name', 'page')
    await typeSearch('submitted')
    await advance(500)
    await typeSearch('new pending input')
    await render('page=2&limit=30&search=submitted&searchType=name')
    expect(input().value).toBe('submitted')
    await advance(1000)
    expect(mocks.router.push).toHaveBeenCalledTimes(1)
  })

  it('cancels pending search navigation when the list unmounts', async () => {
    await render('', 'page')
    await typeSearch('尚未提交')
    await unmount()
    await advance(1000)
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
  })

  it('offers the existing page sizes and moves search-type changes to page one', async () => {
    await render('page=3&limit=50&search=current', 'page')
    const size = document.querySelector<HTMLSelectElement>(
      'select[aria-label="每页条数"]'
    )!
    expect([...size.options].map((option) => option.value)).toEqual([
      '30',
      '50',
      '100',
      '500'
    ])
    expect(size.value).toBe('50')
    const type = document.querySelector<HTMLSelectElement>(
      'select[aria-label="搜索类型"]'
    )!
    expect([...type.options].map((option) => option.value)).toEqual([
      'name',
      'email',
      'id'
    ])
    await act(async () => {
      type.value = 'email'
      type.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    expect(Object.fromEntries(pushedQuery())).toEqual({
      page: '1',
      limit: '50',
      search: 'current',
      searchType: 'email'
    })
    expect(input().maxLength).toBe(300)
  })

  it('renders server rows, role/status labels, Shanghai dates and exact dialog targets', async () => {
    await render('', 'page')
    const record = user(17, {
      name: '测试管理员',
      role: 3,
      status: 2,
      avatar: 'https://images.example.test/avatar.webp'
    })
    await respond(latest(), rows([record]))
    const row = document.querySelector('tbody tr')!
    expect(row.textContent).toContain('测试管理员')
    expect(row.textContent).toContain(record.email)
    expect(row.textContent).toContain('管理员')
    expect(row.textContent).toContain('封禁')
    expect(row.textContent).toContain(formatChinaDateTime(record.created))
    expect(row.querySelector('a[href="/user/17"]')).not.toBeNull()
    expect(
      row.querySelector('a[href="/dashboard/user/17/moemoepoint"]')
    ).not.toBeNull()
    expect(row.querySelector('img')?.getAttribute('width')).toBe('32')
    expect(mocks.editProps.get(17)?.user).toEqual(record)
    expect(mocks.grantProps.get(17)).toEqual({
      user: record,
      currentUserId: 44,
      onGranted: expect.any(Function)
    })
    expect(mocks.deleteProps.get(17)).toMatchObject({
      user: record,
      currentUserId: 44
    })
    await click('编辑 17')
    expect(requests).toHaveLength(2)
    expect(latest().query).toEqual({
      page: 1,
      limit: 30,
      search: '',
      searchType: 'name'
    })
  })

  it('shows a readable failure and retries without rendering an undefined list', async () => {
    await render('', 'page')
    await respond(latest(), '用户列表暂时不可用')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      '用户列表暂时不可用'
    )
    await click('重试')
    await respond(latest(), rows([]))
    expect(document.body.textContent).toContain('暂无用户数据')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps invalid large ID searches local and displays the range error', async () => {
    await render('searchType=id&search=99999999999999999999999999999', 'page')
    expect(requests).toHaveLength(0)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      '1-9999999'
    )
    expect(
      [...document.querySelectorAll('button')]
        .filter((button) =>
          ['刷新', '上一页', '下一页'].includes(button.textContent ?? '')
        )
        .every((button) => button.disabled)
    ).toBe(true)
  })
})
