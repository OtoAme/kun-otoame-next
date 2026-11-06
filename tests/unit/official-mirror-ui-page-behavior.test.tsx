// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BASIS = 'ab'.repeat(32)
const LONG_LINK = 'https://example.com/' + 'l'.repeat(180)

type Pending = {
  url: string
  params: Record<string, unknown>
  resolve: (value: unknown) => void
}

const nav = vi.hoisted(() => {
  let snapshot = new URLSearchParams()
  const listeners = new Set<() => void>()
  return {
    pathname: '/dashboard/backup',
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
    },
    reset(query: string) {
      snapshot = new URLSearchParams(query)
      listeners.forEach((listener) => listener())
    },
    push(href: string) {
      snapshot = new URL(href, 'http://localhost').searchParams
      listeners.forEach((listener) => listener())
    }
  }
})

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn()
}))

vi.mock('next/navigation', async () => {
  const ReactModule = await import('react')
  return {
    usePathname: () => nav.pathname,
    useRouter: () => ({
      push: (href: string) => nav.push(href),
      replace: (href: string) => nav.push(href)
    }),
    useSearchParams: () =>
      ReactModule.useSyncExternalStore(
        nav.subscribe,
        nav.getSnapshot,
        nav.getSnapshot
      )
  }
})
vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.get,
  kunFetchPost: mocks.post,
  kunFetchPut: vi.fn(),
  kunFetchDelete: vi.fn()
}))
vi.mock('~/components/dashboard/inbox/ResourceEditForm', () => ({
  ResourceEditForm: ({
    resource,
    successMessage
  }: {
    resource: { id: number }
    successMessage?: string
  }) => (
    <div data-testid="resource-editor">
      编辑资源 #{resource.id} {successMessage}
    </div>
  )
}))

import { DashboardBackup } from '~/components/dashboard/official-mirror/DashboardBackup'
import { DashboardResourceMerges } from '~/components/dashboard/official-mirror/DashboardResourceMerges'
import { MERGE_BATCH_STORAGE_KEY } from '~/components/dashboard/official-mirror/merge/useMergeBatchList'

const gets: Pending[] = []
const posts: Pending[] = []

const backupRow = (
  resourceId: number,
  patchUniqueId: string,
  authorId: number
) => ({
  resourceId,
  name: `卡片${resourceId}`,
  section: 'galgame',
  patchId: 4,
  patchUniqueId,
  patchName: `游戏${resourceId}`,
  publisher: { id: authorId, name: `发布者${authorId}` },
  download: 3,
  externalLinkCount: 1,
  latestExternalChangeAt: null,
  backupAt: null,
  tab: 'unbacked' as const,
  waitSince: null
})

const backupList = (rows: ReturnType<typeof backupRow>[]) => ({
  items: rows,
  total: rows.length,
  page: 1,
  limit: 30,
  counts: { unbacked: rows.length, rebackup: 1, ignored: 0 },
  oldest: { unbacked: null, rebackup: null }
})

const backupDetail = (row: ReturnType<typeof backupRow>) => ({
  ...row,
  note: '备份备注',
  links: [
    {
      id: 1,
      storage: 'user',
      content: LONG_LINK,
      size: '',
      version: 1,
      sortOrder: 1,
      changedAt: null,
      backedUpAt: null
    }
  ],
  ignore: null,
  rebackupDismissedAt: null,
  basis: BASIS
})

type Section = 'galgame' | 'patch'

const card = (
  id: number,
  name: string,
  authorId: number,
  section: Section = 'galgame'
) => ({
  id,
  name,
  section,
  patchId: 4,
  patchUniqueId: 'abcd1234',
  patchName: '游戏甲',
  publisher: { id: authorId, name: `发布者${authorId}` },
  download: 2,
  created: '2026-11-01T00:00:00.000Z',
  status: 0
})

type RowOptions = {
  pairClass?: 'high' | 'manual'
  recommendState?: 'recommended' | 'close' | 'insufficient' | 'none' | null
  recommend?: number | null
  hasStaffBackup?: boolean
  handled?: boolean
}

const mergeRow = (userId: number, options: RowOptions = {}) => ({
  userResource: card(userId, `用户卡片${userId}`, 7),
  pairClass: options.pairClass ?? 'high',
  candidateCount: 1,
  candidates: [],
  blocks: [],
  officialCount: 2,
  hasStaffBackup: options.hasStaffBackup ?? false,
  recommendState:
    options.recommendState === undefined
      ? 'recommended'
      : options.recommendState,
  recommendation:
    options.recommend === null
      ? null
      : {
          staffResourceId: options.recommend ?? userId + 10,
          staffName: `站方卡片${options.recommend ?? userId + 10}`
        },
  handledAt: options.handled ? '2026-11-02T00:00:00.000Z' : null,
  handledBy: options.handled ? { id: 3, name: '管理员甲' } : null
})

const mergeList = (
  rows: ReturnType<typeof mergeRow>[],
  counts = { pending: rows.length, dismissed: 3, merged: 5 }
) => ({
  items: rows,
  total: rows.length,
  page: 1,
  limit: 30,
  counts,
  oldestPending: null
})

type OptionExtra = {
  recommended?: boolean
  highConfidence?: boolean
  mergeable?: boolean
  dismissable?: boolean
  record?: 'dismissed' | null
  section?: Section
  blocks?: { code: string; message: string }[]
}

const optionOf = (staffId: number, extra: OptionExtra = {}) => ({
  staff: {
    ...card(staffId, `站方卡片${staffId}`, 8, extra.section ?? 'galgame'),
    hasStaffBackup: true
  },
  sameSection: (extra.section ?? 'galgame') === 'galgame',
  signals: [
    { signal: 'type', hit: true, user: ['pc'], staff: ['pc'] },
    { signal: 'language', hit: false, user: ['zh-Hans'], staff: ['ja'] }
  ],
  hits: 1,
  recommended: extra.recommended ?? false,
  highConfidence: extra.highConfidence ?? false,
  mergeable: extra.mergeable ?? true,
  dismissable: extra.dismissable ?? true,
  blocks: extra.blocks ?? [],
  record: extra.record ?? null
})

const optionsOf = (
  userId: number,
  options: ReturnType<typeof optionOf>[],
  history: unknown[] = []
) => ({
  user: {
    ...card(userId, `用户卡片${userId}`, 7),
    hasStaffBackup: false,
    eligible: true
  },
  recommendState: 'recommended',
  options,
  history
})

const previewOf = (
  userId: number,
  staffId: number,
  pairClass: 'high' | 'manual',
  extra: Record<string, unknown> = {}
) => ({
  classification: pairClass,
  canMerge: true,
  blocks: [],
  basis: BASIS,
  user: card(userId, `用户卡片${userId}`, 7),
  staff: card(staffId, `站方卡片${staffId}`, 8),
  survivorPreview: {
    name: `用户卡片${userId}`,
    type: ['pc'],
    language: ['zh-Hans'],
    platform: ['windows'],
    note: '用户备注\n站方备份说明',
    noteAppended: true,
    links: [
      {
        id: 9,
        storage: 'touchgal',
        content: LONG_LINK,
        size: '12MB',
        version: 1,
        sortOrder: 2,
        changedAt: null,
        backedUpAt: '2026-11-01T00:00:00.000Z'
      },
      {
        id: 4,
        storage: 'touchgal',
        content: 'https://example.com/user-link',
        size: '',
        version: 1,
        sortOrder: 1,
        changedAt: null,
        backedUpAt: null
      }
    ]
  },
  fieldComparison: [{ field: '链接数', user: '1', staff: '1' }],
  staffLikeCount: 4,
  exitedPairs: [],
  ...extra
})

const mergedResult = (
  userResourceId: number,
  staffResourceId: number,
  cacheRefreshed: boolean
) => ({
  alreadyMerged: false,
  userResourceId,
  staffResourceId,
  resourceId: userResourceId,
  patchId: 4,
  patchUniqueId: 'abcd1234',
  section: 'galgame' as const,
  movedLinkIds: [9],
  noteAppended: true,
  cacheRefreshed
})

describe('official mirror page behavior', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    gets.length = 0
    posts.length = 0
    nav.pathname = '/dashboard/backup'
    nav.reset('id=11')
    mocks.get.mockImplementation(
      (url: string, params?: Record<string, unknown>) => {
        return new Promise((resolve) => {
          gets.push({ url, params: params ?? {}, resolve })
        })
      }
    )
    mocks.post.mockImplementation(
      (url: string, body?: Record<string, unknown>) => {
        return new Promise((resolve) => {
          posts.push({ url, params: body ?? {}, resolve })
        })
      }
    )
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/backup'
    })
    const element = dom.window.Element.prototype
    if (!element.hasPointerCapture) {
      element.hasPointerCapture = () => false
      element.setPointerCapture = () => {}
      element.releasePointerCapture = () => {}
    }
    dom.window.HTMLElement.prototype.scrollIntoView = () => {}
    dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        width: 1280,
        height: 900,
        top: 0,
        left: 0,
        right: 1280,
        bottom: 900,
        x: 0,
        y: 0,
        toJSON() {
          return {}
        }
      }) as DOMRect
    // The merge page reads the 768px breakpoint; jsdom has no matchMedia.
    dom.window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false
    })) as unknown as typeof dom.window.matchMedia
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    for (const key of [
      'HTMLElement',
      'HTMLFormElement',
      'HTMLInputElement',
      'HTMLButtonElement',
      'HTMLTextAreaElement',
      'HTMLAnchorElement',
      'Element',
      'Node',
      'NodeFilter',
      'DocumentFragment',
      'MutationObserver',
      'CustomEvent',
      'Event',
      'SVGElement'
    ] as const) {
      vi.stubGlobal(key, dom.window[key])
    }
    vi.stubGlobal(
      'getComputedStyle',
      dom.window.getComputedStyle.bind(dom.window)
    )
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('React', React)
    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    // The resizable panels read the observer from the element's window.
    ;(dom.window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      NoopResizeObserver
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const text = () => dom.window.document.body.textContent ?? ''
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
  }
  const click = async (element: Element) => {
    await act(async () => {
      if (element instanceof dom.window.HTMLElement) {
        element.dispatchEvent(
          new dom.window.MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0
          })
        )
        element.click()
      } else {
        element.dispatchEvent(
          new dom.window.MouseEvent('click', {
            bubbles: true,
            cancelable: true
          })
        )
      }
    })
    await settle()
  }
  const buttonNamed = (name: string, exact = false) => {
    const found = [...dom.window.document.querySelectorAll('button')].find(
      (item) => {
        const label = item.textContent?.trim() ?? ''
        return exact ? label === name : label.includes(name)
      }
    )
    if (!found)
      throw new Error(`找不到按钮 ${name}。当前：${text().slice(0, 400)}`)
    return found
  }
  const hasButton = (name: string) =>
    [...dom.window.document.querySelectorAll('button')].some(
      (item) => item.textContent?.trim() === name
    )
  const dialogEl = () =>
    dom.window.document.querySelector('[role="alertdialog"]')
  const dialogButton = (name: string) => {
    const found = [...(dialogEl()?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent?.trim() === name
    )
    if (!found)
      throw new Error(`对话框里没有 ${name}。当前：${dialogEl()?.textContent}`)
    return found
  }
  const confirmDialog = async (name: string) => {
    await settle()
    await click(dialogButton(name))
  }
  const tickDialogCheckbox = async () => {
    const box = dialogEl()?.querySelector('[role="checkbox"]')
    if (!box) throw new Error('对话框里没有确认勾选')
    await click(box)
  }
  const resolveUrl = async (
    url: string,
    body: unknown,
    params?: Record<string, unknown>
  ) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const index = gets.findIndex(
        (item) =>
          item.url === url &&
          (!params ||
            Object.entries(params).every(
              ([key, value]) => item.params[key] === value
            ))
      )
      if (index >= 0) {
        const [item] = gets.splice(index, 1)
        await act(async () => {
          item.resolve(body)
        })
        await settle()
        return
      }
      await act(async () => {
        await Promise.resolve()
      })
    }
    throw new Error(
      `没有请求 ${url}。已有：${gets.map((item) => `${item.url}${JSON.stringify(item.params)}`).join(',')}`
    )
  }
  const takeGet = (url: string, params?: Record<string, unknown>) => {
    const index = gets.findIndex(
      (item) =>
        item.url === url &&
        (!params ||
          Object.entries(params).every(
            ([key, value]) => item.params[key] === value
          ))
    )
    if (index < 0) throw new Error(`没有请求 ${url}`)
    return gets.splice(index, 1)[0]!
  }
  const postNamed = (url: string) => posts.filter((item) => item.url === url)
  const resolvePost = async (item: Pending | undefined, body: unknown) => {
    if (!item) throw new Error('没有这个写请求')
    await act(async () => {
      item.resolve(body)
    })
    await settle()
  }

  const mountBackup = async () => {
    const rows = [backupRow(11, 'abcd1234', 7), backupRow(12, 'efgh5678', 8)]
    await act(async () => {
      root.render(<DashboardBackup reviewer={{ id: 3, role: 3 }} />)
    })
    await resolveUrl('/admin/backup', backupList(rows))
    await resolveUrl('/admin/backup', backupList(rows))
    await resolveUrl('/admin/backup/detail', backupDetail(rows[0]), {
      resourceId: 11
    })
  }

  it('keeps three backup tabs, cancels without a write, and retries cache without saving again', async () => {
    await mountBackup()
    expect(text()).toContain('未备份')
    expect(text()).toContain('待重新备份')
    expect(text()).toContain('已忽略')
    expect(text()).toContain(LONG_LINK)
    expect(
      dom.window.document.querySelector('.break-all')?.textContent
    ).toContain(LONG_LINK)
    const candidate = [...dom.window.document.querySelectorAll('a')].find(
      (item) => item.textContent?.includes('核对合并候选')
    )
    expect(candidate?.getAttribute('href')).toBe(
      '/dashboard/resource-merges?id=11'
    )

    await click(buttonNamed('忽略', true))
    expect(text()).toContain('忽略后，这张卡片保持不备份')
    await click(buttonNamed('取消'))
    expect(posts).toEqual([])

    await click(buttonNamed('忽略', true))
    await confirmDialog('忽略')
    expect(postNamed('/admin/backup/ignore')).toHaveLength(1)
    expect(postNamed('/admin/backup/ignore')[0]?.params).toEqual({
      resourceId: 11
    })
    await act(async () => {
      posts[0]?.resolve({
        changed: true,
        resourceId: 11,
        tab: 'ignored',
        cacheRefreshed: false
      })
    })
    expect(text()).toContain('已保存，页面缓存没有刷新')
    const refresh = buttonNamed('仅刷新缓存')
    await click(refresh)
    expect(postNamed('/admin/backup/ignore')).toHaveLength(1)
    expect(postNamed('/admin/backup/refresh-cache')).toEqual([
      expect.objectContaining({
        params: { uniqueIds: ['abcd1234'], authorIds: [7] }
      })
    ])
    await act(async () => {
      postNamed('/admin/backup/refresh-cache')[0]?.resolve({
        uniqueIds: ['abcd1234'],
        authorIds: [7],
        cacheRefreshed: true
      })
    })
    expect(text()).toContain('页面缓存已刷新')
    expect(postNamed('/admin/resource-merges/merge')).toEqual([])
    await click(buttonNamed('待重新备份'))
    expect(nav.getSnapshot().get('tab')).toBe('rebackup')
    await click(buttonNamed('已忽略'))
    expect(nav.getSnapshot().get('tab')).toBe('ignored')
  })

  it('does not open an editor for a late response from another resource', async () => {
    await mountBackup()
    await click(buttonNamed('去添加备份'))
    const editorCall = gets.find((item) => item.url === '/admin/resource')
    expect(editorCall?.params).toMatchObject({ resourceId: 11 })
    const row = [...dom.window.document.querySelectorAll('tr')].find((item) =>
      item.textContent?.includes('游戏12')
    )
    if (!row) throw new Error('找不到第二张卡片')
    await click(row)
    await resolveUrl(
      '/admin/backup/detail',
      backupDetail(backupRow(12, 'efgh5678', 8)),
      {
        resourceId: 12
      }
    )
    await act(async () => {
      editorCall?.resolve({
        resources: [{ id: 11, baseLinks: [{ id: 1 }] }]
      })
    })
    await settle()
    expect(
      dom.window.document.querySelector('[data-testid="resource-editor"]')
    ).toBeNull()
    expect(text()).not.toContain('添加站方备份')

    await click(buttonNamed('去添加备份'))
    const current = gets.find(
      (item) => item.url === '/admin/resource' && item.params.resourceId === 12
    )
    await act(async () => {
      current?.resolve({
        resources: [{ id: 12, baseLinks: [{ id: 2 }] }]
      })
    })
    await settle()
    expect(text()).toContain('编辑资源 #12')
    const previous = [...dom.window.document.querySelectorAll('tr')].find(
      (item) => item.textContent?.includes('游戏11')
    )
    if (!previous) throw new Error('找不到第一张卡片')
    await click(previous)
    expect(
      dom.window.document.querySelector('[data-testid="resource-editor"]')
    ).toBeNull()
  })

  const dropFinishedBackup = async (remainingId: number) => {
    const remaining = backupRow(remainingId, 'efgh5678', 8)
    await resolveUrl('/admin/backup', backupList([remaining]), { limit: 1 })
    await resolveUrl('/admin/backup', backupList([remaining]))
  }

  it('keeps the cache failure after the finished backup leaves the list', async () => {
    await mountBackup()
    await click(buttonNamed('忽略', true))
    await confirmDialog('忽略')
    await act(async () => {
      postNamed('/admin/backup/ignore')[0]?.resolve({
        changed: true,
        resourceId: 11,
        tab: 'ignored',
        cacheRefreshed: false
      })
    })
    expect(text()).toContain('已保存，页面缓存没有刷新')
    await dropFinishedBackup(12)
    expect(text()).toContain('卡片12')
    expect(text()).not.toContain('卡片11')
    expect(text()).not.toContain(LONG_LINK)
    expect(text()).not.toContain('资源 #11')
    expect(text()).toContain('选择一条资源查看全文与操作')
    expect(text()).toContain('已保存，页面缓存没有刷新')
    await click(buttonNamed('仅刷新缓存', true))
    expect(postNamed('/admin/backup/ignore')).toHaveLength(1)
    expect(postNamed('/admin/backup/refresh-cache')).toEqual([
      expect.objectContaining({
        params: { uniqueIds: ['abcd1234'], authorIds: [7] }
      })
    ])
    expect(postNamed('/admin/backup/unignore')).toEqual([])
    expect(postNamed('/admin/backup/dismiss')).toEqual([])
  })

  // ---------------------------------------------------------------- merges

  const defaultRows = () => [
    mergeRow(21, { pairClass: 'high', recommend: 31 }),
    mergeRow(22, {
      pairClass: 'manual',
      recommendState: 'close',
      recommend: null,
      hasStaffBackup: true
    }),
    mergeRow(24, { pairClass: 'high', recommend: 34 }),
    mergeRow(25, { pairClass: 'manual', recommend: 35 }),
    mergeRow(26, {
      pairClass: 'manual',
      recommendState: 'none',
      recommend: null
    })
  ]

  /** 31 recommended high, 41 other mergeable, 51 other section, 61 dismissed. */
  const options21 = () =>
    optionsOf(21, [
      optionOf(31, { recommended: true, highConfidence: true }),
      optionOf(41),
      optionOf(51, {
        section: 'patch',
        mergeable: false,
        dismissable: false,
        blocks: [
          {
            code: 'section_mismatch',
            message: '与用户资源不在同一分区，不能合并'
          }
        ]
      }),
      optionOf(61, {
        mergeable: false,
        dismissable: false,
        record: 'dismissed',
        blocks: [{ code: 'pair_dismissed', message: '这一对已被驳回' }]
      })
    ])

  const highOptions = (userId: number) =>
    optionsOf(userId, [
      optionOf(userId + 10, { recommended: true, highConfidence: true })
    ])

  const mountMerges = async (
    query = 'id=21',
    rows = defaultRows(),
    options: unknown = options21()
  ) => {
    nav.pathname = '/dashboard/resource-merges'
    nav.reset(query)
    await act(async () => {
      root.render(<DashboardResourceMerges />)
    })
    await resolveUrl('/admin/resource-merges', mergeList(rows))
    const id = Number(new URLSearchParams(query).get('id'))
    await resolveUrl('/admin/resource-merges/options', options, {
      userResourceId: id
    })
    return rows
  }

  const openRow = async (
    userId: number,
    options: unknown,
    previewBody: unknown
  ) => {
    const row = dom.window.document.querySelector(
      `[data-merge-row="${userId}"]`
    )
    if (!row) throw new Error(`找不到用户卡片${userId}`)
    await click(row)
    await resolveUrl('/admin/resource-merges/options', options, {
      userResourceId: userId
    })
    if (previewBody) {
      const body = previewBody as {
        user: { id: number }
        staff: { id: number }
      }
      await resolveUrl('/admin/resource-merges/preview', previewBody, {
        userResourceId: body.user.id,
        staffResourceId: body.staff.id
      })
    }
  }

  const iframeSrcs = () =>
    [...dom.window.document.querySelectorAll('iframe')].map((item) =>
      item.getAttribute('src')
    )

  it('opens the card by id, shows tab counts, previews and the match strips', async () => {
    await mountMerges()
    const listCall = mocks.get.mock.calls.find(
      ([url]) => url === '/admin/resource-merges'
    )
    expect(listCall?.[1]).toEqual({
      page: 1,
      limit: 30,
      searchType: 'content',
      tab: 'pending'
    })
    expect(mocks.get).toHaveBeenCalledWith('/admin/resource-merges/options', {
      userResourceId: 21
    })
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high'),
      {
        userResourceId: 21,
        staffResourceId: 31
      }
    )

    const headings = [...dom.window.document.querySelectorAll('h1, h2')].filter(
      (item) => item.textContent?.trim() === '资源合并'
    )
    expect(headings).toHaveLength(1)
    const tabs = [...dom.window.document.querySelectorAll('[role="tab"]')].map(
      (item) => item.textContent?.trim()
    )
    expect(tabs).toEqual(
      expect.arrayContaining(['待处理5', '已驳回3', '已合并5'])
    )
    expect(text()).toContain('批量合并清单（0）')

    const rowText = (id: number) =>
      dom.window.document.querySelector(`[data-merge-row="${id}"]`)
        ?.textContent ?? ''
    expect(rowText(21)).toContain('游戏甲 · 游戏资源 · 发布者7 · 官方 2')
    expect(rowText(21)).toContain('高置信')
    expect(rowText(22)).toContain('需人工核对')
    expect(rowText(22)).toContain('已有站方备份')
    expect(rowText(25)).toContain('推荐 #35')
    expect(rowText(26)).toContain('无可合并项')

    expect(text()).toContain('用户资源 #21 · 游戏甲 · 游戏资源 · 社区资源')
    expect(text()).toContain('本游戏的官方资源（4）')
    const srcs = iframeSrcs()
    expect(srcs).toContain('/preview/resource-card/21')
    expect(srcs).toContain('/preview/resource-card/31')
    expect(srcs).toContain('/preview/resource-card/41')
    expect(srcs).not.toContain('/preview/resource-card/51')
    const staffFrame = dom.window.document.querySelector(
      'iframe[src="/preview/resource-card/31"]'
    )
    expect(staffFrame?.getAttribute('loading')).toBe('lazy')
    expect(
      dom.window.document
        .querySelector('iframe[src="/preview/resource-card/21"]')
        ?.getAttribute('loading')
    ).toBeNull()
    for (const src of srcs) {
      expect(src).not.toMatch(/code|password|download|restore/)
    }

    const strip31 =
      dom.window.document.querySelector('[data-merge-option="31"]')
        ?.textContent ?? ''
    expect(strip31).toContain('当前配对')
    expect(strip31).toContain('推荐')
    expect(strip31).toContain('高置信 · 可批量合并')
    expect(strip31).toContain('✓ 类型')
    expect(strip31).toContain('✗ 语言：简体中文 / 日本語')
    const typeSignal = dom.window.document.querySelector(
      '[data-merge-option="31"] [data-signal="type"]'
    )
    const languageSignal = dom.window.document.querySelector(
      '[data-merge-option="31"] [data-signal="language"]'
    )
    expect(typeSignal?.getAttribute('data-hit')).toBe('true')
    expect(languageSignal?.getAttribute('data-hit')).toBe('false')
    expect(typeSignal?.className).toMatch(/text-green-700/)
    expect(languageSignal?.className).toMatch(/text-destructive/)
    expect(languageSignal?.className).not.toMatch(/text-muted-foreground/)
    const userPane = dom.window.document.querySelector(
      '[data-merge-pane="user"]'
    )
    const staffPane = dom.window.document.querySelector(
      '[data-merge-pane="staff"]'
    )
    expect(userPane).not.toBeNull()
    expect(staffPane).not.toBeNull()
    expect(userPane?.className).toMatch(/@\[56rem\]:overflow-y-auto/)
    expect(staffPane?.className).toMatch(/@\[56rem\]:overflow-y-auto/)
    expect(userPane?.className).toMatch(/@\[56rem\]:border-r/)
    const strip41 =
      dom.window.document.querySelector('[data-merge-option="41"]')
        ?.textContent ?? ''
    expect(strip41).toContain('设为当前配对')
    expect(strip41).not.toContain('高置信 · 可批量合并')
    expect(text()).toContain('当前配对：#21 ← #31')

    const outcome =
      dom.window.document.querySelector('[aria-label="合并此配对的结果"]')
        ?.textContent ?? ''
    expect(outcome).toContain(
      '#31 站方卡片31 删除，指向 #31 的旧链接改为定位到 #21。'
    )
    expect(outcome).toContain(
      '#21 保留名称、类型、语言、平台和发布者，仍在社区资源分组。'
    )
    expect(outcome).toContain(
      '合并后共 2 条链接：原有 1 条在前，移入 1 条在后。'
    )
    expect(outcome).toContain('站方备注以「站方备份说明」追加在备注末尾。')
    expect(outcome).toContain('获取次数合计 4（2 + 2）。')
    expect(outcome).toContain('#31 的 4 个点赞不迁移。')
    expect(outcome).toContain('合并后有 2 条站方备份链接。')
    expect(outcome).toContain(LONG_LINK)
    expect(
      dom.window.document.querySelector(
        '[aria-label="合并此配对的结果"] .break-all'
      )?.textContent
    ).toContain('https://example.com/user-link')

    await click(buttonNamed('不可合并（2）'))
    expect(iframeSrcs()).toContain('/preview/resource-card/51')
    const strip51 =
      dom.window.document.querySelector('[data-merge-option="51"]')
        ?.textContent ?? ''
    expect(strip51).toContain('与用户资源不在同一分区，不能合并')
    expect(strip51).toContain('工具补丁')

    await click(buttonNamed('合并后预览', true))
    expect(iframeSrcs()).toContain('/preview/resource-merge?user=21&staff=31')
    expect(posts).toEqual([])
  })

  it('merges through the checked dialog, writes nothing on cancel, and opens the next row', async () => {
    await mountMerges()
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high', {
        exitedPairs: [
          { staffResourceId: 41, staffName: '站方卡片41', retained: true }
        ]
      }),
      { userResourceId: 21, staffResourceId: 31 }
    )
    await click(buttonNamed('合并此配对', true))
    expect(dialogEl()?.textContent).toContain(
      '#31 站方卡片31 并入 #21 用户卡片21，#31 随后删除。#21 保留名称、属性和发布者，仍在社区资源分组。'
    )
    expect(dialogEl()?.textContent).toContain(
      '#41 与 #21 的配对退出，#41 保留。'
    )
    expect(dialogEl()?.textContent).toContain('已核实两张卡片为同一份内容')
    expect(dialogButton('合并').disabled).toBe(true)
    await click(dialogButton('合并'))
    expect(posts).toEqual([])
    await click(dialogButton('取消'))
    expect(dialogEl()).toBeNull()
    expect(posts).toEqual([])

    await click(buttonNamed('合并此配对', true))
    expect(dialogButton('合并').disabled).toBe(true)
    await tickDialogCheckbox()
    expect(dialogButton('合并').disabled).toBe(false)
    expect(dialogButton('合并').getAttribute('data-variant')).toBe(
      'destructive'
    )
    await confirmDialog('合并')
    expect(postNamed('/admin/resource-merges/merge')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/merge')[0]?.params).toEqual({
      userResourceId: 21,
      staffResourceId: 31,
      basis: BASIS,
      contentConfirmed: true
    })
    await resolvePost(
      postNamed('/admin/resource-merges/merge')[0],
      mergedResult(21, 31, false)
    )
    expect(text()).toContain(
      '#31 站方卡片31 已并入 #21 用户卡片21。页面缓存没有刷新。'
    )
    expect(nav.getSnapshot().get('id')).toBe('22')
    expect(gets.some((item) => item.url === '/admin/resource-merges')).toBe(
      true
    )
    await resolveUrl(
      '/admin/resource-merges',
      mergeList(defaultRows().filter((row) => row.userResource.id !== 21))
    )
    await resolveUrl(
      '/admin/resource-merges/options',
      optionsOf(22, [optionOf(32)]),
      { userResourceId: 22 }
    )
    expect(text()).toContain('用户资源 #22')
    expect(text()).toContain(
      '#31 站方卡片31 已并入 #21 用户卡片21。页面缓存没有刷新。'
    )

    await click(buttonNamed('仅刷新缓存', true))
    expect(postNamed('/admin/resource-merges/merge')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/batch')).toEqual([])
    expect(postNamed('/admin/backup/refresh-cache')).toEqual([
      expect.objectContaining({
        params: { uniqueIds: ['abcd1234'], authorIds: [7, 8] }
      })
    ])
    await resolvePost(postNamed('/admin/backup/refresh-cache')[0], {
      uniqueIds: ['abcd1234'],
      authorIds: [7, 8],
      cacheRefreshed: true
    })
    expect(text()).toContain('已并入 #21 用户卡片21。页面缓存已刷新。')
  })

  it('dismisses one pair and stays while the card still has pending pairs', async () => {
    await mountMerges()
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high'),
      {
        userResourceId: 21,
        staffResourceId: 31
      }
    )
    await click(buttonNamed('驳回此配对', true))
    expect(dialogEl()?.textContent).toContain('#21 与 #31 的配对移入已驳回。')
    await click(dialogButton('取消'))
    expect(posts).toEqual([])
    await click(buttonNamed('驳回此配对', true))
    await confirmDialog('驳回')
    expect(postNamed('/admin/resource-merges/dismiss')[0]?.params).toEqual({
      userResourceId: 21,
      staffResourceId: 31
    })
    await resolvePost(postNamed('/admin/resource-merges/dismiss')[0], {
      changed: true
    })
    expect(nav.getSnapshot().get('id')).toBe('21')
    await resolveUrl(
      '/admin/resource-merges/options',
      optionsOf(21, [
        optionOf(41),
        optionOf(31, {
          mergeable: false,
          dismissable: false,
          record: 'dismissed'
        })
      ]),
      { userResourceId: 21 }
    )
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 41, 'manual'),
      {
        userResourceId: 21,
        staffResourceId: 41
      }
    )
    expect(text()).toContain('当前配对：#21 ← #41')
    expect(postNamed('/admin/resource-merges/merge')).toEqual([])
  })

  it('dismisses every pending pair of the card and opens the next row', async () => {
    await mountMerges()
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high'),
      {
        userResourceId: 21,
        staffResourceId: 31
      }
    )
    await click(buttonNamed('驳回全部配对', true))
    expect(dialogEl()?.textContent).toContain(
      '#21 当前的 2 个配对全部移入已驳回。'
    )
    await confirmDialog('驳回')
    expect(postNamed('/admin/resource-merges/dismiss-card')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/dismiss-card')[0]?.params).toEqual(
      {
        userResourceId: 21,
        staffResourceIds: [31, 41]
      }
    )
    await resolvePost(postNamed('/admin/resource-merges/dismiss-card')[0], {
      changed: true,
      dismissed: [31, 41],
      unchanged: [],
      skipped: []
    })
    expect(nav.getSnapshot().get('id')).toBe('22')
    expect(postNamed('/admin/resource-merges/dismiss')).toEqual([])
  })

  it('reopens a dismissed pair with a non-destructive confirmation', async () => {
    const rows = [
      mergeRow(21, { handled: true, recommendState: null, recommend: null }),
      mergeRow(22, { handled: true, recommendState: null, recommend: null })
    ]
    await mountMerges('tab=dismissed&id=21', rows, options21())
    expect(
      dom.window.document.querySelector('[data-merge-row="21"]')?.textContent
    ).toContain('管理员甲 · 2026/11/02 08:00')
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 61, 'manual', {
        canMerge: false,
        blocks: [{ code: 'pair_dismissed', message: '这一对已被驳回' }]
      }),
      { userResourceId: 21, staffResourceId: 61 }
    )
    expect(text()).toContain('当前配对：#21 ← #61')
    expect(hasButton('合并此配对')).toBe(false)
    await click(buttonNamed('重开此配对', true))
    expect(dialogEl()?.textContent).toContain('#21 与 #61 的配对回到待处理。')
    expect(dialogButton('重开').getAttribute('data-variant')).toBe('default')
    await confirmDialog('重开')
    expect(postNamed('/admin/resource-merges/reopen')[0]?.params).toEqual({
      userResourceId: 21,
      staffResourceId: 61
    })
    await resolvePost(postNamed('/admin/resource-merges/reopen')[0], {
      changed: true
    })
    expect(nav.getSnapshot().get('id')).toBe('22')
  })

  it('keeps the merged tab read-only and shows who merged the card', async () => {
    const rows = [
      mergeRow(21, { handled: true, recommendState: null, recommend: null })
    ]
    await mountMerges(
      'tab=merged&id=21',
      rows,
      optionsOf(
        21,
        [
          optionOf(51, {
            section: 'patch',
            mergeable: false,
            dismissable: false
          })
        ],
        [
          {
            staffResourceId: 31,
            staffName: '已合并的站方卡片 31',
            status: 'merged',
            handledAt: '2026-11-02T00:00:00.000Z',
            handledBy: { id: 3, name: '管理员甲' },
            movedLinkIds: [9]
          }
        ]
      )
    )
    expect(text()).toContain('已合并：#21 ← #31 · 管理员甲 · 2026/11/02 08:00')
    expect(text()).toContain('#31 已合并的站方卡片 31 · 已合并 · 管理员甲')
    for (const name of [
      '合并此配对',
      '加入批量合并清单',
      '驳回此配对',
      '驳回全部配对',
      '重开此配对',
      '设为当前配对'
    ]) {
      expect(hasButton(name)).toBe(false)
    }
    expect(
      gets.some((item) => item.url === '/admin/resource-merges/preview')
    ).toBe(false)
    expect(iframeSrcs()).toContain('/preview/resource-card/21')
    expect(posts).toEqual([])
  })

  it('stays on the card and names the pairs a card dismissal skipped', async () => {
    await mountMerges()
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high'),
      {
        userResourceId: 21,
        staffResourceId: 31
      }
    )
    await click(buttonNamed('驳回全部配对', true))
    await confirmDialog('驳回')
    await resolvePost(postNamed('/admin/resource-merges/dismiss-card')[0], {
      changed: true,
      dismissed: [31],
      unchanged: [],
      skipped: [{ staffResourceId: 41, reason: '站方卡片已不存在' }]
    })
    expect(nav.getSnapshot().get('id')).toBe('21')
    expect(text()).toContain('已驳回 1 个配对。')
    expect(text()).toContain('#41 未驳回：站方卡片已不存在')
    expect(
      gets.some(
        (item) =>
          item.url === '/admin/resource-merges/options' &&
          item.params.userResourceId === 21
      )
    ).toBe(true)
  })

  it('collects high pairs in the batch list, keeps it across a remount and runs it', async () => {
    await mountMerges('id=21', defaultRows(), highOptions(21))
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high'),
      {
        userResourceId: 21,
        staffResourceId: 31
      }
    )
    const addCurrent = async () => {
      await click(buttonNamed('加入批量合并清单', true))
      expect(dialogEl()?.textContent).toContain('已核实两张卡片为同一份内容')
      expect(dialogButton('加入清单').disabled).toBe(true)
      await tickDialogCheckbox()
      await confirmDialog('加入清单')
    }
    await addCurrent()
    expect(posts).toEqual([])
    expect(text()).toContain('批量合并清单（1）')
    expect(buttonNamed('已在清单中', true).disabled).toBe(true)

    await openRow(24, highOptions(24), previewOf(24, 34, 'high'))
    await addCurrent()
    await openRow(25, highOptions(25), previewOf(25, 35, 'high'))
    await addCurrent()
    expect(text()).toContain('批量合并清单（3）')

    // A manual pair offers no way into the list.
    await openRow(
      22,
      optionsOf(22, [optionOf(32, { recommended: true })]),
      previewOf(22, 32, 'manual')
    )
    expect(hasButton('加入批量合并清单')).toBe(false)
    expect(hasButton('合并此配对')).toBe(true)

    const stored = JSON.parse(
      dom.window.sessionStorage.getItem(MERGE_BATCH_STORAGE_KEY) ?? '[]'
    ) as { userResourceId: number; basis: string; pairClass: string }[]
    expect(stored.map((item) => item.userResourceId)).toEqual([21, 24, 25])
    expect(
      stored.every((item) => item.basis === BASIS && item.pairClass === 'high')
    ).toBe(true)

    await act(async () => root.unmount())
    gets.length = 0
    root = createRoot(dom.window.document.getElementById('root')!)
    await mountMerges('id=21', defaultRows(), highOptions(21))
    expect(text()).toContain('批量合并清单（3）')

    await click(buttonNamed('批量合并清单（3）', true))
    expect(text()).toContain('3 对 · 仅限高置信配对 · 每批最多 50 对')
    const sheet = () =>
      dom.window.document.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(sheet()).toContain('用户卡片21')
    expect(sheet()).toContain('← 站方卡片31')
    expect(sheet()).toContain('游戏甲 · 游戏资源')
    const removeButton = dom.window.document.querySelector(
      'button[aria-label="移除 #24 ← #34"]'
    )
    if (!removeButton) throw new Error('没有移除按钮')
    await click(removeButton)
    expect(text()).toContain('2 对 · 仅限高置信配对 · 每批最多 50 对')
    expect(
      JSON.parse(
        dom.window.sessionStorage.getItem(MERGE_BATCH_STORAGE_KEY) ?? '[]'
      )
    ).toHaveLength(2)

    await click(buttonNamed('合并 2 对', true))
    expect(dialogEl()?.textContent).toContain(
      '清单中的 2 对逐对合并，各对的站方卡片随后删除。'
    )
    await click(dialogButton('取消'))
    expect(posts).toEqual([])
    await click(buttonNamed('合并 2 对', true))
    await confirmDialog('合并')
    expect(postNamed('/admin/resource-merges/batch')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/batch')[0]?.params).toEqual({
      pairs: [
        {
          userResourceId: 21,
          staffResourceId: 31,
          basis: BASIS,
          contentConfirmed: true
        },
        {
          userResourceId: 25,
          staffResourceId: 35,
          basis: BASIS,
          contentConfirmed: true
        }
      ]
    })
    gets.length = 0
    await resolvePost(postNamed('/admin/resource-merges/batch')[0], {
      outcomes: [
        {
          userResourceId: 21,
          staffResourceId: 31,
          status: 'merged',
          result: mergedResult(21, 31, false)
        }
      ],
      remaining: [{ userResourceId: 25, staffResourceId: 35 }]
    })
    const results =
      dom.window.document.querySelector('[aria-label="上次结果"]')
        ?.textContent ?? ''
    expect(results).toContain('用户卡片21 ← 站方卡片31')
    expect(results).toContain('已合并')
    expect(results).toContain('页面缓存没有刷新。')
    expect(results).toContain('用户卡片25 ← 站方卡片35')
    expect(results).toContain('未开始')
    expect(text()).toContain('1 对 · 仅限高置信配对 · 每批最多 50 对')
    expect(gets.some((item) => item.url === '/admin/resource-merges')).toBe(
      true
    )
    expect(
      gets.some(
        (item) =>
          item.url === '/admin/resource-merges/options' &&
          item.params.userResourceId === 21
      )
    ).toBe(true)

    const retry = dom.window.document.querySelector(
      'button[aria-label="仅刷新缓存 #21 ← #31"]'
    )
    if (!retry) throw new Error('没有仅刷新缓存')
    await click(retry)
    expect(postNamed('/admin/resource-merges/batch')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/merge')).toEqual([])
    expect(
      postNamed('/admin/backup/refresh-cache').map((item) => item.params)
    ).toEqual([{ uniqueIds: ['abcd1234'], authorIds: [7, 8] }])
    await resolvePost(postNamed('/admin/backup/refresh-cache')[0], {
      uniqueIds: ['abcd1234'],
      authorIds: [7, 8],
      cacheRefreshed: true
    })
    expect(
      dom.window.document.querySelector('[aria-label="上次结果"]')?.textContent
    ).toContain('页面缓存已刷新。')
    await click(buttonNamed('关闭结果', true))
    expect(
      dom.window.document.querySelector('[aria-label="上次结果"]')
    ).toBeNull()
  })

  it('records the skip reason of a batch pair by name', async () => {
    dom.window.sessionStorage.setItem(
      MERGE_BATCH_STORAGE_KEY,
      JSON.stringify([
        {
          userResourceId: 24,
          staffResourceId: 34,
          basis: BASIS,
          contentConfirmed: true,
          pairClass: 'high',
          patchUniqueId: 'abcd1234',
          authorId: 7,
          staffAuthorId: 8,
          userName: '用户卡片24',
          staffName: '站方卡片34',
          patchName: '游戏甲',
          section: 'galgame'
        },
        {
          userResourceId: 22,
          staffResourceId: 32,
          basis: BASIS,
          contentConfirmed: true,
          pairClass: 'manual',
          patchUniqueId: 'abcd1234',
          authorId: 7,
          staffAuthorId: 8,
          userName: '人工配对',
          staffName: '站方卡片32',
          patchName: '游戏甲',
          section: 'galgame'
        }
      ])
    )
    await mountMerges('id=21', defaultRows(), highOptions(21))
    expect(text()).toContain('批量合并清单（1）')
    await click(buttonNamed('批量合并清单（1）', true))
    expect(text()).not.toContain('人工配对')
    await click(buttonNamed('合并 1 对', true))
    await confirmDialog('合并')
    await resolvePost(postNamed('/admin/resource-merges/batch')[0], {
      outcomes: [
        {
          userResourceId: 24,
          staffResourceId: 34,
          status: 'skipped',
          reason: '核对基点已变化'
        }
      ],
      remaining: []
    })
    const results =
      dom.window.document.querySelector('[aria-label="上次结果"]')
        ?.textContent ?? ''
    expect(results).toContain('用户卡片24 ← 站方卡片34')
    expect(results).toContain('已跳过：核对基点已变化')
    expect(text()).toContain('0 对 · 仅限高置信配对 · 每批最多 50 对')
  })

  it('drops late options, previews and writes from a previous selection', async () => {
    nav.pathname = '/dashboard/resource-merges'
    nav.reset('id=21')
    await act(async () => {
      root.render(<DashboardResourceMerges />)
    })
    await resolveUrl('/admin/resource-merges', mergeList(defaultRows()))
    const lateOptions = takeGet('/admin/resource-merges/options', {
      userResourceId: 21
    })
    await openRow(
      22,
      optionsOf(22, [optionOf(32)]),
      previewOf(22, 32, 'manual')
    )
    await act(async () => {
      lateOptions.resolve(options21())
    })
    await settle()
    expect(text()).toContain('用户资源 #22')
    expect(text()).toContain('当前配对：#22 ← #32')
    expect(text()).not.toContain('当前配对：#21')

    // Late preview of the previous pair on the same card.
    await openRow(21, options21(), null)
    const latePreview = takeGet('/admin/resource-merges/preview', {
      userResourceId: 21,
      staffResourceId: 31
    })
    const choose41 = [
      ...dom.window.document.querySelectorAll('[data-merge-option="41"] button')
    ].find((item) => item.textContent?.trim() === '设为当前配对')
    if (!choose41) throw new Error('没有设为当前配对')
    await click(choose41)
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 41, 'manual'),
      {
        userResourceId: 21,
        staffResourceId: 41
      }
    )
    await act(async () => {
      latePreview.resolve(previewOf(21, 31, 'high'))
    })
    await settle()
    expect(text()).toContain('当前配对：#21 ← #41')
    const outcome =
      dom.window.document.querySelector('[aria-label="合并此配对的结果"]')
        ?.textContent ?? ''
    expect(outcome).toContain('#41 站方卡片41 删除')
    expect(outcome).not.toContain('#31 站方卡片31 删除')

    // A merge answered after the admin moved to another card does not move them.
    await click(buttonNamed('合并此配对', true))
    await tickDialogCheckbox()
    await confirmDialog('合并')
    expect(postNamed('/admin/resource-merges/merge')[0]?.params).toEqual({
      userResourceId: 21,
      staffResourceId: 41,
      basis: BASIS,
      contentConfirmed: true
    })
    await act(async () => {
      nav.reset('id=24')
    })
    await resolveUrl('/admin/resource-merges/options', highOptions(24), {
      userResourceId: 24
    })
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(24, 34, 'high'),
      {
        userResourceId: 24,
        staffResourceId: 34
      }
    )
    await resolvePost(
      postNamed('/admin/resource-merges/merge')[0],
      mergedResult(21, 41, true)
    )
    expect(nav.getSnapshot().get('id')).toBe('24')
    expect(text()).toContain('当前配对：#24 ← #34')
    expect(text()).toContain(
      '#41 站方卡片41 已并入 #21 用户卡片21。页面缓存已刷新。'
    )
    expect(text()).not.toContain('没有确认这次操作是否已经写入')
  })
})
