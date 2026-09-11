import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MoemoepointBalance,
  MoemoepointLedgerEntry,
  MoemoepointLedgerResponse
} from '~/types/api/moemoepoint'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  balance: vi.fn(),
  setUser: vi.fn(),
  identity: {
    uid: 4,
    moemoepoint: 20,
    moemoepointReserved: 5,
    moemoepointAvailable: 15
  },
  searchParams: new URLSearchParams(),
  pathname: '/dashboard/user/4/moemoepoint',
  router: { push: vi.fn(), replace: vi.fn() },
  grant: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: {
    getState: () => ({
      user: mocks.identity,
      setMoemoepointBalance: mocks.balance,
      setUser: mocks.setUser
    })
  }
}))
vi.mock('next/link', () => ({
  default: ({
    prefetch,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a {...props} data-prefetch={String(prefetch)} />
  )
}))
vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLInputElement>}
    />
  )
}))
vi.mock('~/components/dashboard/user/GrantMoemoepointDialog', () => ({
  GrantMoemoepointDialog: (props: {
    user: { id: number; name: string }
    currentUserId: number
    onGranted: (userId: number) => void
  }) => {
    mocks.grant(props)
    return (
      <button onClick={() => props.onGranted(props.user.id)}>发放萌萌点</button>
    )
  }
}))

import {
  isValidCommittedCustomRange,
  useLedger
} from '~/hooks/dashboard/useLedger'
import { DashboardLedger } from '~/components/dashboard/user/DashboardLedger'

type LedgerState = ReturnType<typeof useLedger>
type Response = MoemoepointLedgerResponse | string
type Request = {
  path: string
  query: Record<string, string>
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

const entry = (
  id: number,
  overrides: Partial<MoemoepointLedgerEntry> = {}
): MoemoepointLedgerEntry => ({
  id,
  kind: 'earn',
  balanceDelta: 2,
  reservedDelta: 0,
  availableDelta: 2,
  balanceAfter: { total: 20, reserved: 5, available: 15 },
  reasonCode: 'test',
  reason: `明细原因 ${id}`,
  referenceType: null,
  referenceId: null,
  link: '',
  created: '2026-09-01T16:30:00.000Z',
  ...overrides
})

const ledger = (
  userId = 4,
  overrides: Partial<MoemoepointLedgerResponse> = {}
): MoemoepointLedgerResponse => ({
  user: { id: userId, name: `用户 ${userId}`, avatar: '' },
  balance: { total: 20, reserved: 5, available: 15 },
  records: [entry(1)],
  pagination: { page: 1, limit: 30, total: 61, totalPages: 3 },
  range: { preset: '30d', start: '2026-08-13', end: '2026-09-11' },
  ...overrides
})

const customQuery = (page = 1, limit = 30) =>
  `range=custom&start=2026-06-01&end=2026-08-29&page=${page}&limit=${limit}`

let root: Root | undefined
let dom: JSDOM
let container: HTMLDivElement
let requests: Request[]
let current: LedgerState
let renderedUserId = 4
let renderedCurrentUserId = 4

function Probe() {
  current = useLedger({
    userId: renderedUserId,
    currentUserId: renderedCurrentUserId
  })
  return (
    <div>
      <output>{current.status}</output>
      {current.data?.records.map((record) => (
        <p key={record.id}>{record.reason}</p>
      ))}
    </div>
  )
}

const render = async (presentation = false) => {
  mocks.pathname = `/dashboard/user/${renderedUserId}/moemoepoint`
  await act(async () => {
    root!.render(
      presentation ? (
        <DashboardLedger
          userId={renderedUserId}
          currentUserId={renderedCurrentUserId}
        />
      ) : (
        <Probe />
      )
    )
  })
}

const navigate = async (query: string, presentation = false) => {
  mocks.searchParams = new URLSearchParams(query)
  await render(presentation)
}

const lastRequest = () => requests.at(-1)!
const respond = async (request: Request, value: Response) => {
  await act(async () => request.resolve(value))
}
const fail = async (request: Request) => {
  await act(async () => request.reject(new Error('connection reset')))
}
const pushedQuery = () => {
  const href = mocks.router.push.mock.calls.at(-1)![0] as string
  return new URL(href, 'https://example.com').searchParams
}
const followPush = async (presentation = false) =>
  navigate(pushedQuery().toString(), presentation)
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text
  )!
const click = async (text: string) => {
  expect(button(text), `button ${text}`).toBeDefined()
  await act(async () => button(text).click())
}
const input = async (id: string, value: string) => {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    element.value = value
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const unmount = async () => {
  await act(async () => root?.unmount())
  root = undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T16:30:00.000Z'))
  renderedUserId = 4
  renderedCurrentUserId = 4
  mocks.identity = {
    uid: 4,
    moemoepoint: 20,
    moemoepointReserved: 5,
    moemoepointAvailable: 15
  }
  mocks.balance.mockImplementation((balance: MoemoepointBalance) => {
    mocks.identity = {
      ...mocks.identity,
      moemoepoint: balance.total,
      moemoepointReserved: balance.reserved,
      moemoepointAvailable: balance.available
    }
  })
  mocks.searchParams = new URLSearchParams()
  requests = []
  mocks.get.mockImplementation(
    (path: string, query: Record<string, string>) =>
      new Promise<Response>((resolve, reject) => {
        requests.push({ path, query, resolve, reject })
      })
  )
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://example.com/dashboard/user/4/moemoepoint'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('self', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
  vi.stubGlobal('HTMLFormElement', dom.window.HTMLFormElement)
  vi.stubGlobal('Node', dom.window.Node)
  vi.stubGlobal('Event', dom.window.Event)
  vi.stubGlobal('CustomEvent', dom.window.CustomEvent)
  vi.stubGlobal('DocumentFragment', dom.window.DocumentFragment)
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver)
  vi.stubGlobal(
    'getComputedStyle',
    dom.window.getComputedStyle.bind(dom.window)
  )
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = dom.window.document.getElementById('root') as HTMLDivElement
  root = createRoot(container)
})

afterEach(async () => {
  await unmount()
  dom.window.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('dashboard ledger URL and date selection', () => {
  it.each([
    '',
    'range=all&page=0&limit=101',
    'range=invalid&page=10000000&limit=-1',
    'range=&page=1e2&limit=1.5',
    'page=-1&limit=NaN'
  ])(
    'normalizes invalid range and pagination without sending unsupported filters: %s',
    async (query) => {
      await navigate(query)
      expect(requests).toHaveLength(1)
      expect(lastRequest()).toMatchObject({
        path: '/user/4/moemoepoint/ledger',
        query: { range: '30d', page: '1', limit: '30' }
      })
      expect(current.status).toBe('loading')
      expect(current.data).toBeNull()
    }
  )

  it('preserves valid deep-link pagination, including API-supported limits outside the quick options', async () => {
    await navigate('range=7d&page=9999999&limit=12')
    expect(lastRequest().query).toEqual({
      range: '7d',
      page: '9999999',
      limit: '12'
    })
  })

  it('queries a valid custom deep link immediately and uses applied dates when changing page or limit', async () => {
    await navigate(customQuery(2, 50))
    expect(current.awaiting).toBe(false)
    expect(current.draftStart).toBe('2026-06-01')
    expect(current.draftEnd).toBe('2026-08-29')
    expect(lastRequest().query).toEqual({
      range: 'custom',
      start: '2026-06-01',
      end: '2026-08-29',
      page: '2',
      limit: '50'
    })
    await respond(lastRequest(), ledger())
    await act(async () => current.goToPage(3))
    expect(Object.fromEntries(pushedQuery())).toEqual({
      range: 'custom',
      start: '2026-06-01',
      end: '2026-08-29',
      page: '3',
      limit: '50'
    })
    await followPush()
    expect(lastRequest().query).toMatchObject({
      page: '3',
      start: '2026-06-01',
      end: '2026-08-29'
    })
    await act(async () => current.changeLimit(100))
    expect(Object.fromEntries(pushedQuery())).toEqual({
      range: 'custom',
      start: '2026-06-01',
      end: '2026-08-29',
      page: '1',
      limit: '100'
    })
  })

  it('waits after selecting custom and querying only commits explicitly submitted dates', async () => {
    await navigate('range=30d&page=3&limit=50')
    await respond(lastRequest(), ledger())
    await act(async () => current.selectPreset('custom'))
    await followPush()
    expect(requests).toHaveLength(1)
    expect(current.status).toBe('awaiting')
    await act(async () => {
      current.setDraftStart('2026-06-01')
      current.setDraftEnd('2026-08-29')
    })
    expect(requests).toHaveLength(1)
    const previousPushes = mocks.router.push.mock.calls.length
    await act(async () => {
      current.goToPage(2)
      current.changeLimit(100)
    })
    expect(mocks.router.push).toHaveBeenCalledTimes(previousPushes)
    await act(async () => current.applyCustom())
    expect(Object.fromEntries(pushedQuery())).toEqual({
      range: 'custom',
      start: '2026-06-01',
      end: '2026-08-29',
      page: '1',
      limit: '50'
    })
    await followPush()
    expect(requests).toHaveLength(2)
    expect(current.awaiting).toBe(false)
  })

  it('switches presets immediately and resets the page while preserving the limit', async () => {
    await navigate(customQuery(3, 100))
    await act(async () => current.selectPreset('7d'))
    expect(Object.fromEntries(pushedQuery())).toEqual({
      range: '7d',
      page: '1',
      limit: '100'
    })
    await followPush()
    expect(lastRequest().query).toEqual({
      range: '7d',
      page: '1',
      limit: '100'
    })
  })

  it.each(['page', 'limit', 'user'] as const)(
    'restores committed dates after browser navigation changes only the %s',
    async (changed) => {
      await navigate(customQuery(2, 30))
      await respond(lastRequest(), ledger())
      await act(async () => current.setDraftStart('2026-07-01'))
      expect(current.awaiting).toBe(true)
      if (changed === 'user') renderedUserId = 7
      await navigate(
        customQuery(changed === 'page' ? 1 : 2, changed === 'limit' ? 50 : 30)
      )
      expect(current.draftStart).toBe('2026-06-01')
      expect(current.draftEnd).toBe('2026-08-29')
      expect(current.awaiting).toBe(false)
      expect(lastRequest().query).toMatchObject({
        start: '2026-06-01',
        end: '2026-08-29'
      })
    }
  )

  it('hydrates valid custom dates on browser back and forward without another query click', async () => {
    await navigate(customQuery())
    await respond(lastRequest(), ledger())
    await navigate('range=7d&page=1&limit=30')
    await respond(lastRequest(), ledger())
    await navigate(customQuery())
    expect(requests).toHaveLength(3)
    expect(current.awaiting).toBe(false)
    expect(lastRequest().query).toMatchObject({
      range: 'custom',
      start: '2026-06-01',
      end: '2026-08-29'
    })
  })

  it.each([
    ['2026-06-01', '2026-06-01', true],
    ['2026-06-01', '2026-08-29', true],
    ['2026-06-01', '2026-08-30', false],
    ['2026-06-02', '2026-06-01', false],
    ['2026-02-29', '2026-03-01', false],
    ['2024-02-29', '2024-03-01', true],
    ['2026-04-31', '2026-05-01', false],
    ['2026-6-01', '2026-06-02', false],
    [null, '2026-06-01', false]
  ])(
    'checks real calendar dates and inclusive 1–90 day bounds: %s to %s',
    (start, end, valid) => {
      expect(isValidCommittedCustomRange(start, end)).toBe(valid)
    }
  )

  it.each([
    ['', '2026-06-01', '请选择开始日期和结束日期'],
    ['2026-02-29', '2026-03-01', '日期格式不正确'],
    ['2026-06-02', '2026-06-01', '开始日期不能晚于结束日期'],
    ['2026-06-01', '2026-08-30', '90'],
    ['2026-09-11', '2026-09-12', '日期不能晚于今天']
  ])(
    'keeps invalid dates out of the URL and API: %s to %s',
    async (start, end, message) => {
      await navigate('range=custom')
      await act(async () => {
        current.setDraftStart(start)
        current.setDraftEnd(end)
      })
      await act(async () => current.applyCustom())
      expect(current.draftError).toContain(message)
      expect(current.status).toBe('awaiting')
      expect(requests).toHaveLength(0)
      expect(mocks.router.push).not.toHaveBeenCalled()
    }
  )

  it('waits for correction of an invalid custom deep link instead of requesting it', async () => {
    await navigate('range=custom&start=2026-02-29&end=2026-03-01&page=2')
    expect(current.status).toBe('awaiting')
    expect(current.loading).toBe(false)
    expect(current.data).toBeNull()
    expect(requests).toHaveLength(0)
  })
})

describe('dashboard ledger request ownership and retry', () => {
  it('clears the previous user immediately and ignores that user’s late response', async () => {
    await navigate('range=7d')
    const previous = lastRequest()
    renderedUserId = 7
    await render()
    expect(current.data).toBeNull()
    expect(current.status).toBe('loading')
    await respond(lastRequest(), ledger(7, { records: [entry(7)] }))
    await respond(previous, ledger(4, { records: [entry(4)] }))
    expect(current.data?.user.id).toBe(7)
    expect(current.data?.records[0].id).toBe(7)
    expect(mocks.balance).not.toHaveBeenCalled()
  })

  it('clears loaded records before a new query and ignores an old query failure', async () => {
    await navigate('range=7d')
    await respond(lastRequest(), ledger())
    await act(async () => current.retry())
    const previous = lastRequest()
    await navigate('range=30d')
    expect(current.data).toBeNull()
    expect(current.errorMessage).toBe('')
    await respond(lastRequest(), ledger(4, { records: [entry(30)] }))
    await fail(previous)
    expect(current.data?.records[0].id).toBe(30)
    expect(current.errorMessage).toBe('')
    expect(current.loading).toBe(false)
  })

  it('does not expose a late preset response after custom selection enters its awaiting state', async () => {
    await navigate('range=7d')
    const previous = lastRequest()
    await navigate('range=custom')
    await respond(previous, ledger())
    expect(current.status).toBe('awaiting')
    expect(current.data).toBeNull()
    expect(current.loading).toBe(false)
    expect(mocks.balance).not.toHaveBeenCalled()
  })

  it.each(['business', 'empty', 'network'] as const)(
    'clears stale rows after a %s failure and retries the same applied custom query',
    async (mode) => {
      await navigate(customQuery(2, 50))
      await respond(lastRequest(), ledger())
      await act(async () => current.retry())
      if (mode === 'network') await fail(lastRequest())
      else
        await respond(
          lastRequest(),
          mode === 'business' ? '您没有权限查看该用户的萌萌点明细' : ''
        )
      expect(current.status).toBe('error')
      expect(current.loading).toBe(false)
      expect(current.data).toBeNull()
      expect(current.errorMessage).toContain(
        mode === 'business'
          ? '没有权限'
          : mode === 'empty'
            ? '请求失败'
            : '网络'
      )
      await act(async () => current.retry())
      expect(lastRequest().query).toEqual({
        range: 'custom',
        start: '2026-06-01',
        end: '2026-08-29',
        page: '2',
        limit: '50'
      })
      await respond(lastRequest(), ledger(4, { records: [entry(2)] }))
      expect(current.status).toBe('ready')
      expect(current.errorMessage).toBe('')
      expect(current.data?.records[0].id).toBe(2)
      expect(mocks.router.push).not.toHaveBeenCalled()
    }
  )

  it('accepts only the latest retry when responses arrive in reverse order', async () => {
    await navigate('range=7d')
    const first = lastRequest()
    await act(async () => current.retry())
    await respond(
      lastRequest(),
      ledger(4, { balance: { total: -7, reserved: -3, available: -4 } })
    )
    await respond(first, ledger(4))
    expect(current.data?.balance).toEqual({
      total: -7,
      reserved: -3,
      available: -4
    })
    expect(mocks.identity).toMatchObject({
      moemoepoint: -7,
      moemoepointReserved: -3,
      moemoepointAvailable: -4
    })
    expect(mocks.balance).toHaveBeenCalledTimes(1)
  })

  it.each(['response', 'error'] as const)(
    'ignores a late %s after unmount',
    async (outcome) => {
      await navigate('range=7d')
      const pending = lastRequest()
      await unmount()
      if (outcome === 'response') await respond(pending, ledger())
      else await fail(pending)
      expect(requests).toHaveLength(1)
      expect(mocks.balance).not.toHaveBeenCalled()
      expect(mocks.setUser).not.toHaveBeenCalled()
      expect(mocks.router.push).not.toHaveBeenCalled()
    }
  )

  it('updates all three own balances including negative reserved amounts', async () => {
    await render()
    await respond(
      lastRequest(),
      ledger(4, { balance: { total: -7, reserved: -3, available: -4 } })
    )
    expect(mocks.identity).toMatchObject({
      uid: 4,
      moemoepoint: -7,
      moemoepointReserved: -3,
      moemoepointAvailable: -4
    })
    expect(mocks.balance).toHaveBeenCalledWith({
      total: -7,
      reserved: -3,
      available: -4
    })
    expect(mocks.setUser).not.toHaveBeenCalled()
  })

  it.each(['viewed-user', 'current-user', 'live-login'] as const)(
    'does not overwrite the signed-in balance when the %s identity differs',
    async (different) => {
      if (different === 'viewed-user') renderedUserId = 7
      if (different === 'current-user') renderedCurrentUserId = 7
      await render()
      if (different === 'live-login') mocks.identity.uid = 7
      await respond(
        lastRequest(),
        ledger(renderedUserId, {
          balance: { total: -7, reserved: -3, available: -4 }
        })
      )
      expect(mocks.identity).toMatchObject({
        moemoepoint: 20,
        moemoepointReserved: 5,
        moemoepointAvailable: 15
      })
      expect(mocks.balance).not.toHaveBeenCalled()
      expect(mocks.setUser).not.toHaveBeenCalled()
    }
  )
})

describe('dashboard ledger presentation and grant entry', () => {
  it('uses only the current ledger response identity for the profile and grant entry', async () => {
    await navigate(customQuery(2, 50), true)
    expect(button('发放萌萌点')).toBeUndefined()
    expect(mocks.grant).not.toHaveBeenCalled()
    await respond(
      lastRequest(),
      ledger(4, { user: { id: 4, name: '已授权用户名', avatar: '' } })
    )
    const profile =
      container.querySelector<HTMLAnchorElement>('a[href="/user/4"]')!
    expect(profile.textContent).toBe('已授权用户名')
    expect(profile.dataset.prefetch).toBe('false')
    expect(mocks.grant.mock.calls.at(-1)![0]).toMatchObject({
      user: { id: 4, name: '已授权用户名' },
      currentUserId: 4
    })
    expect(container.querySelector('h2')?.textContent).toBe('用户萌萌点明细')
    await click('发放萌萌点')
    expect(lastRequest().query).toEqual({
      range: 'custom',
      start: '2026-06-01',
      end: '2026-08-29',
      page: '2',
      limit: '50'
    })
    expect(
      requests.every((request) => request.path === '/user/4/moemoepoint/ledger')
    ).toBe(true)
    expect(mocks.router.push).not.toHaveBeenCalled()
    renderedUserId = 7
    await render(true)
    expect(button('发放萌萌点')).toBeUndefined()
    expect(container.textContent).not.toContain('已授权用户名')
  })

  it('does not offer grants when the returned user does not match the requested user', async () => {
    await render(true)
    await respond(lastRequest(), ledger(7))
    expect(button('发放萌萌点')).toBeUndefined()
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('hides applied rows and disables pagination while custom date edits await query', async () => {
    await navigate(customQuery(), true)
    await respond(lastRequest(), ledger())
    expect(container.textContent).toContain('明细原因 1')
    const start =
      container.querySelector<HTMLInputElement>('#ledger-start-date')!
    expect(start.type).toBe('date')
    expect(start.max).toBe('2026-09-11')
    expect(
      container.querySelector('label[for="ledger-start-date"]')?.textContent
    ).toContain('开始日期')
    await input('ledger-start-date', '2026-07-01')
    expect(container.textContent).toContain('请选择日期并查询')
    expect(container.textContent).not.toContain('明细原因 1')
    for (const label of ['上一页', '下一页']) {
      const control = button(label)
      if (control) expect(control.disabled).toBe(true)
    }
    expect(requests).toHaveLength(1)
    await click('查询')
    await followPush(true)
    expect(lastRequest().query).toMatchObject({
      start: '2026-07-01',
      end: '2026-08-29',
      page: '1'
    })
  })

  it('announces date and request errors and lets a failed request recover', async () => {
    await navigate('range=custom', true)
    await click('查询')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '请选择'
    )
    await navigate('range=7d', true)
    await respond(lastRequest(), '')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '请求失败'
    )
    expect(button('重试').disabled).toBe(false)
    await click('重试')
    await respond(lastRequest(), ledger(4, { records: [] }))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('当前时间范围内暂无萌萌点变动记录')
    expect(container.textContent).not.toContain('请选择日期并查询')
  })

  it('renders nine Chinese kinds and a fallback with the returned range and Shanghai timestamps', async () => {
    const kinds = [
      ['opening', '初始余额'],
      ['earn', '获得'],
      ['spend', '消费'],
      ['reserve', '暂扣'],
      ['release', '返还'],
      ['forfeit', '确认扣除'],
      ['refund', '退款'],
      ['reversal', '回退'],
      ['adjustment', '调整'],
      ['future-kind', '其他变动']
    ]
    await render(true)
    await respond(
      lastRequest(),
      ledger(4, {
        records: kinds.map(([kind], index) =>
          entry(index, { kind: kind as MoemoepointLedgerEntry['kind'] })
        ),
        range: { preset: '30d', start: '2026-08-13', end: '2026-09-11' }
      })
    )
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(kinds.length)
    kinds.forEach(([, label], index) => {
      expect(rows[index].textContent).toContain(label)
      expect(rows[index].textContent).toContain('2026/09/02 00:30')
    })
    expect(container.textContent).toContain('当前范围：2026-08-13 ~ 2026-09-11')
    expect(container.querySelector('.md\\:hidden')?.textContent).toContain(
      '其他变动'
    )
  })

  it('keeps reserved deltas and snapshots neutral while showing negative totals, positive deltas and zero accurately', async () => {
    await render(true)
    await respond(
      lastRequest(),
      ledger(4, {
        balance: { total: -7, reserved: -3, available: -4 },
        records: [
          entry(1, {
            balanceDelta: -2,
            reservedDelta: -3,
            availableDelta: 1,
            balanceAfter: { total: -7, reserved: -3, available: -4 }
          }),
          entry(2, { balanceDelta: -0, reservedDelta: 0, availableDelta: 0 })
        ]
      })
    )
    const cards = Array.from(
      container.querySelectorAll('section [data-slot="card"]')
    )
    expect(cards.map((card) => card.textContent)).toEqual([
      '总萌萌点-7',
      '可用萌萌点-4',
      '待结算萌萌点-3'
    ])
    expect(cards[0].querySelector('.text-destructive')?.textContent).toBe('-7')
    expect(cards[1].querySelector('.text-destructive')?.textContent).toBe('-4')
    expect(cards[2].querySelector('.text-destructive')).toBeNull()
    expect(container.textContent).toContain(
      '可用萌萌点 = 总萌萌点 - 待结算萌萌点'
    )
    expect(container.textContent).toContain('当前总萌萌点为负')
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    const deltas = Array.from(
      rows[0].querySelectorAll('td')[2].querySelectorAll('span')
    )
    expect(deltas.map((value) => value.textContent)).toEqual(['-2', '-3', '+1'])
    expect(deltas[0].classList.contains('text-destructive')).toBe(true)
    expect(deltas[1].classList.contains('text-destructive')).toBe(false)
    expect(deltas[1].classList.contains('text-primary')).toBe(false)
    const after = Array.from(
      rows[0].querySelectorAll('td')[3].querySelectorAll('span')
    )
    expect(after.map((value) => value.textContent)).toEqual(['-7', '-3', '-4'])
    expect(after[1].classList.contains('text-destructive')).toBe(false)
    const zeros = Array.from(
      rows[1].querySelectorAll('td')[2].querySelectorAll('span')
    )
    expect(zeros.map((value) => value.textContent)).toEqual(['0', '0', '0'])
    expect(
      zeros.every((value) => !value.classList.contains('text-destructive'))
    ).toBe(true)
  })

  it('renders only safe related links and preserves reason text without interpreting markup', async () => {
    const safe = [
      '/patch/7?from=ledger',
      'https://example.com/item/7',
      'http://example.com/item/8'
    ]
    const unsafe = [
      '//evil.example/path',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,test',
      'https://example.com/\npath',
      '/\t/evil.example',
      '/path\u0000tail',
      'https:\n//evil.example'
    ]
    await render(true)
    await respond(
      lastRequest(),
      ledger(4, {
        records: [...safe, ...unsafe].map((link, index) =>
          entry(index, {
            link,
            reason: `<img src=x onerror=alert(1)> 原因 ${index}`
          })
        )
      })
    )
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    safe.forEach((href, index) =>
      expect(rows[index].querySelector('a')?.getAttribute('href')).toBe(href)
    )
    unsafe.forEach((_, index) =>
      expect(rows[index + safe.length].querySelector('a')).toBeNull()
    )
    expect(rows[0].querySelector('a')?.dataset.prefetch).toBe('false')
    expect(rows[1].querySelector('a')?.rel).toContain('noopener')
    expect(rows[1].querySelector('a')?.rel).toContain('noreferrer')
    expect(rows[0].querySelector('img')).toBeNull()
    expect(rows[0].textContent).toContain('<img src=x onerror=alert(1)>')
    const relatedLinks = Array.from(container.querySelectorAll('a')).filter(
      (link) => link.textContent?.includes('查看相关内容')
    )
    expect(
      relatedLinks.map((link) => link.getAttribute('href')).sort()
    ).toEqual([...safe, ...safe].sort())
  })
})
