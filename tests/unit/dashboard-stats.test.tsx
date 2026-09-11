import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardStatsSumData, OverviewData } from '~/types/api/admin'
import type { InboxCounts } from '~/types/api/inbox'

const mocks = vi.hoisted(() => {
  const refreshCounts = vi.fn()
  return {
    get: vi.fn(),
    refreshCounts,
    context: {
      counts: null as InboxCounts | null,
      countsLoading: false,
      countsError: '',
      refreshCounts
    }
  }
})
vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('~/components/dashboard/DashboardShell', () => ({
  useDashboard: () => mocks.context
}))
vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />
}))
vi.mock('~/components/dashboard/ui/input', () => ({
  // React onChange stays stale under this harness; map onInput -> onChange.
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLInputElement>)
      }
    />
  )
}))

import { DashboardStats } from '~/components/dashboard/DashboardStats'

const sumData: DashboardStatsSumData = {
  userCount: 120,
  galgameCount: 45,
  galgameResourceCount: 67,
  galgamePatchResourceCount: 23,
  galgameCommentCount: 890,
  ratingCount: 56,
  submissionCount: 34,
  creatorCount: 12,
  pendingCreatorApplyCount: 9
}
const zeroSum: DashboardStatsSumData = {
  userCount: 0,
  galgameCount: 0,
  galgameResourceCount: 0,
  galgamePatchResourceCount: 0,
  galgameCommentCount: 0,
  ratingCount: 0,
  submissionCount: 0,
  creatorCount: 0,
  pendingCreatorApplyCount: 0
}
const overviewData: OverviewData = {
  newUser: 7,
  newActiveUser: 15,
  newGalgame: 3,
  newGalgameResource: 5,
  newComment: 21
}
const zeroOverview: OverviewData = {
  newUser: 0,
  newActiveUser: 0,
  newGalgame: 0,
  newGalgameResource: 0,
  newComment: 0
}
const counts: InboxCounts = {
  pending: { submission: 5, 'resource-apply': 2, feedback: 3, report: 1 },
  todayProcessed: 4
}
const zeroCounts: InboxCounts = {
  pending: { submission: 0, 'resource-apply': 0, feedback: 0, report: 0 },
  todayProcessed: 0
}

describe('dashboard stats', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.counts = counts
    mocks.context.countsLoading = false
    mocks.context.countsError = ''
    mocks.get.mockImplementation((url: string) => {
      if (url === '/admin/stats/sum') return Promise.resolve(sumData)
      if (url === '/admin/stats') return Promise.resolve(overviewData)
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const render = async (role: number) => {
    await act(async () => root.render(<DashboardStats reviewerRole={role} />))
  }
  const cardValue = (label: string): string | null => {
    const target = [
      ...container.querySelectorAll('[data-slot="card-description"]')
    ].find((el) => el.textContent === label)
    return (
      target
        ?.closest('[data-slot="card"]')
        ?.querySelector('[data-slot="card-title"]')?.textContent ?? null
    )
  }
  const section = (id: string) =>
    container.querySelector(`section[aria-labelledby="${id}"]`) as HTMLElement
  const retryIn = (id: string) =>
    [...section(id).querySelectorAll('button')].find(
      (button) => button.textContent === '重试'
    )!
  const submitDays = async (value: string) => {
    const field = container.querySelector(
      'input[aria-label="统计天数"]'
    ) as HTMLInputElement
    await act(async () => {
      field.value = value
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      field
        .closest('form')!
        .dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true })
        )
    })
  }

  it('role 3 never requests stats and shows only inbox todos', async () => {
    await render(3)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(cardValue('待审条目')).toBe('5')
    expect(cardValue('待审资源')).toBe('2')
    expect(cardValue('旧反馈')).toBe('3')
    expect(cardValue('旧举报')).toBe('1')
    expect(cardValue('合计')).toBe('11')
    expect(cardValue('我今日已处理')).toBe('4')
    for (const kind of ['submission', 'resource-apply', 'feedback', 'report']) {
      expect(
        container.querySelector(`a[href="/dashboard/inbox?kinds=${kind}"]`)
      ).not.toBeNull()
    }
    expect(container.querySelector('a[href="/admin/creator"]')).toBeNull()
    expect(container.textContent).not.toContain('总量统计')
    expect(container.textContent).not.toContain('近期统计')
    expect(container.textContent).not.toContain('待审创作者申请')
  })

  it('shows the current four-source distribution without including creator applications', async () => {
    mocks.context.counts = {
      pending: { submission: 3, 'resource-apply': 1, feedback: 0, report: 0 },
      todayProcessed: 4
    }
    await render(4)
    const distribution = container.querySelector(
      '[aria-labelledby="dashboard-pending-distribution-heading"]'
    )
    expect(distribution).not.toBeNull()
    const rows = [...distribution!.querySelectorAll('li')].map(
      (row) => row.textContent
    )
    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain('3 · 75%')
    expect(rows[1]).toContain('1 · 25%')
    expect(rows[2]).toContain('0 · 0%')
    expect(rows[3]).toContain('0 · 0%')
    expect(distribution?.textContent).not.toContain('创作者')
  })

  it('shows an honest empty distribution when all four pending counts are zero', async () => {
    mocks.context.counts = {
      pending: { submission: 0, 'resource-apply': 0, feedback: 0, report: 0 },
      todayProcessed: 4
    }
    await render(3)
    expect(container.textContent).toContain('当前没有待审事项')
    expect(container.textContent).not.toContain('NaN')
    expect(container.textContent).not.toContain('Infinity')
  })

  it('does not render a zero distribution before counts load or when the read fails', async () => {
    mocks.context.counts = null
    mocks.context.countsLoading = true
    await render(3)
    expect(container.textContent).not.toContain('当前待审分布')
    expect(container.textContent).not.toContain('当前没有待审事项')
    mocks.context.countsLoading = false
    mocks.context.countsError = '读取失败'
    await render(3)
    expect(container.textContent).toContain('读取失败')
    expect(container.textContent).not.toContain('当前待审分布')
    expect(container.textContent).not.toContain('当前没有待审事项')
  })

  it('role 4 loads every summary and overview metric', async () => {
    await render(4)
    expect(mocks.get).toHaveBeenCalledWith('/admin/stats/sum')
    expect(mocks.get).toHaveBeenCalledWith('/admin/stats', { days: 1 })
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(cardValue('用户总数')).toBe('120')
    expect(cardValue('条目总数')).toBe('45')
    expect(cardValue('游戏资源总数')).toBe('67')
    expect(cardValue('补丁资源总数')).toBe('23')
    expect(cardValue('评论总数')).toBe('890')
    expect(cardValue('评分总数')).toBe('56')
    expect(cardValue('投稿总数')).toBe('34')
    expect(cardValue('创作者数')).toBe('12')
    expect(cardValue('待审创作者申请数')).toBe('9')
    expect(cardValue('新注册用户')).toBe('7')
    expect(cardValue('最近登录人数')).toBe('15')
    expect(cardValue('新增条目')).toBe('3')
    expect(cardValue('新增资源')).toBe('5')
    expect(cardValue('新增评论')).toBe('21')
  })

  it('keeps pending creator applies out of the four-source total', async () => {
    await render(4)
    expect(cardValue('合计')).toBe('11')
    expect(cardValue('待审创作者申请')).toBe('9')
    expect(
      container.querySelector('a[href="/admin/creator"]')?.textContent
    ).toContain('待审创作者申请')
  })

  it('shows skeletons instead of fake zeros while loading', async () => {
    mocks.context.counts = null
    mocks.context.countsLoading = true
    mocks.get.mockReturnValue(new Promise(() => {}))
    await render(4)
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    const titles = [
      ...container.querySelectorAll('[data-slot="card-title"]')
    ].map((el) => el.textContent)
    expect(titles).not.toContain('0')
    expect(cardValue('合计')).toBeNull()
    expect(cardValue('用户总数')).toBeNull()
  })

  it('renders a real zero only after zero-valued data loads', async () => {
    mocks.context.counts = zeroCounts
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve(url === '/admin/stats/sum' ? zeroSum : zeroOverview)
    )
    await render(4)
    expect(cardValue('合计')).toBe('0')
    expect(cardValue('我今日已处理')).toBe('0')
    expect(cardValue('待审条目')).toBe('0')
    expect(cardValue('用户总数')).toBe('0')
    expect(cardValue('评分总数')).toBe('0')
    expect(cardValue('新注册用户')).toBe('0')
    expect(cardValue('待审创作者申请')).toBe('0')
  })

  it('fails and retries each stats block independently', async () => {
    let sumFails = true
    let overviewFails = true
    mocks.get.mockImplementation((url: string) => {
      if (url === '/admin/stats/sum') {
        return sumFails
          ? Promise.resolve('总量接口维护中')
          : Promise.resolve(sumData)
      }
      return overviewFails
        ? Promise.resolve('近期接口维护中')
        : Promise.resolve(overviewData)
    })
    await render(4)
    expect(container.textContent).toContain('总量接口维护中')
    expect(container.textContent).toContain('近期接口维护中')
    expect(cardValue('用户总数')).toBeNull()
    expect(cardValue('新注册用户')).toBeNull()
    overviewFails = false
    await act(async () => retryIn('dashboard-overview-heading').click())
    expect(cardValue('新注册用户')).toBe('7')
    expect(cardValue('用户总数')).toBeNull()
    expect(container.textContent).toContain('总量接口维护中')
    sumFails = false
    await act(async () => retryIn('dashboard-sum-heading').click())
    expect(cardValue('用户总数')).toBe('120')
    expect(cardValue('新注册用户')).toBe('7')
  })

  it('shows a Chinese error on rejection and never auto retries', async () => {
    mocks.get.mockImplementation((url: string) =>
      url === '/admin/stats/sum'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(overviewData)
    )
    await render(4)
    expect(container.textContent).toContain(
      '获取总量统计失败，请检查网络后重试'
    )
    expect(cardValue('新注册用户')).toBe('7')
    const calls = mocks.get.mock.calls.length
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(mocks.get.mock.calls.length).toBe(calls)
  })

  it('treats an empty string response as an error, not zero', async () => {
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve(url === '/admin/stats/sum' ? '' : overviewData)
    )
    await render(4)
    expect(
      section('dashboard-sum-heading').querySelector('[role="alert"]')
        ?.textContent
    ).toBe('获取总量统计失败')
    expect(cardValue('用户总数')).toBeNull()
  })

  it('surfaces inbox count errors with manual retry via shell context', async () => {
    mocks.context.counts = null
    mocks.context.countsLoading = false
    mocks.context.countsError = '获取待办计数失败'
    await render(3)
    expect(container.textContent).toContain('获取待办计数失败')
    await act(async () => retryIn('dashboard-inbox-heading').click())
    expect(mocks.refreshCounts).toHaveBeenCalledTimes(1)
  })

  it('keeps loaded inbox counts visible next to a refresh error', async () => {
    mocks.context.counts = counts
    mocks.context.countsError = '刷新待办计数失败'
    await render(3)
    expect(cardValue('合计')).toBe('11')
    expect(container.textContent).toContain('刷新待办计数失败')
    await act(async () => retryIn('dashboard-inbox-heading').click())
    expect(mocks.refreshCounts).toHaveBeenCalledTimes(1)
  })

  it.each<[string, number, boolean]>([
    ['1', 1, true],
    ['30', 30, true],
    ['60', 60, true],
    ['0', 0, false],
    ['61', 0, false],
    ['-3', 0, false],
    ['1.5', 0, false],
    ['abc', 0, false],
    ['', 0, false]
  ])(
    'accepts only integer windows within 1..60 (%s)',
    async (input, expected, valid) => {
      await render(4)
      mocks.get.mockClear()
      await submitDays(input)
      if (valid) {
        expect(mocks.get).toHaveBeenCalledTimes(1)
        expect(mocks.get).toHaveBeenCalledWith('/admin/stats', {
          days: expected
        })
      } else {
        expect(mocks.get).not.toHaveBeenCalled()
        expect(container.textContent).toContain('请输入 1 到 60 之间的整数天数')
      }
    }
  )

  it('clears old values on a new window and never lets stale responses win', async () => {
    const pending: Array<(value: OverviewData | string) => void> = []
    mocks.get.mockImplementation((url: string) => {
      if (url === '/admin/stats/sum') return Promise.resolve(sumData)
      return new Promise<OverviewData | string>((resolve) =>
        pending.push(resolve)
      )
    })
    await render(4)
    await submitDays('30')
    expect(cardValue('新注册用户')).toBeNull()
    await submitDays('7')
    expect(pending).toHaveLength(3)
    await act(async () => pending[2]({ ...overviewData, newUser: 70 }))
    expect(cardValue('新注册用户')).toBe('70')
    await act(async () => pending[1]({ ...overviewData, newUser: 30 }))
    expect(cardValue('新注册用户')).toBe('70')
    await act(async () => pending[0](overviewData))
    expect(cardValue('新注册用户')).toBe('70')
  })

  it('masks private stats on downgrade and ignores late responses', async () => {
    let resolveSum!: (value: DashboardStatsSumData | string) => void
    mocks.get.mockImplementation((url: string) => {
      if (url === '/admin/stats/sum') {
        return new Promise<DashboardStatsSumData | string>((resolve) => {
          resolveSum = resolve
        })
      }
      return Promise.resolve(overviewData)
    })
    await render(4)
    expect(cardValue('新注册用户')).toBe('7')
    await act(async () => root.render(<DashboardStats reviewerRole={3} />))
    expect(container.textContent).not.toContain('总量统计')
    expect(container.querySelector('a[href="/admin/creator"]')).toBeNull()
    expect(cardValue('新注册用户')).toBeNull()
    await act(async () => resolveSum(sumData))
    expect(cardValue('用户总数')).toBeNull()
    expect(container.textContent).not.toContain('总量统计')
  })

  it('requests private stats only after an upgrade to role 4', async () => {
    await render(3)
    expect(mocks.get).not.toHaveBeenCalled()
    await act(async () => root.render(<DashboardStats reviewerRole={4} />))
    expect(mocks.get).toHaveBeenCalledWith('/admin/stats/sum')
    expect(mocks.get).toHaveBeenCalledWith('/admin/stats', { days: 1 })
    expect(cardValue('用户总数')).toBe('120')
  })

  it('first render before any request shows skeletons, never failures', () => {
    const html = renderToStaticMarkup(<DashboardStats reviewerRole={4} />)
    expect(html).toContain('总量统计')
    expect(html).toContain('近期统计')
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain('获取总量统计失败')
    expect(html).not.toContain('获取近期统计失败')
    expect(html).not.toContain('加载失败')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('role 3 first render has no stats sections at all', () => {
    const html = renderToStaticMarkup(<DashboardStats reviewerRole={3} />)
    expect(html).toContain('待审事项')
    expect(html).not.toContain('总量统计')
    expect(html).not.toContain('近期统计')
    expect(html).not.toContain('待审创作者申请')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('pairs current terminology labels with their values', async () => {
    await render(4)
    expect(cardValue('条目总数')).toBe('45')
    expect(cardValue('游戏资源总数')).toBe('67')
    expect(cardValue('补丁资源总数')).toBe('23')
    expect(cardValue('新增条目')).toBe('3')
    expect(cardValue('新增资源')).toBe('5')
    const creator = [
      ...container.querySelectorAll('[data-slot="card-description"]')
    ]
      .find((el) => el.textContent === '创作者数')
      ?.closest('[data-slot="card"]')
    expect(creator?.textContent).toContain('当前创作者，不含管理员')
    expect(creator?.textContent).not.toContain('role=2')
  })
})
