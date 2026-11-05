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

vi.mock('next/navigation', () => {
  const ReactModule = require('react') as typeof import('react')
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

const card = (id: number, name: string, authorId: number) => ({
  id,
  name,
  section: 'galgame' as const,
  patchId: 4,
  patchUniqueId: 'abcd1234',
  patchName: '游戏甲',
  publisher: { id: authorId, name: `发布者${authorId}` },
  download: 2,
  created: '2026-11-01T00:00:00.000Z',
  status: 0
})

const mergeRow = (
  userId: number,
  staffIds: number[],
  pairClass: 'high' | 'manual'
) => ({
  userResource: card(userId, `用户卡片${userId}`, 7),
  pairClass,
  candidateCount: staffIds.length,
  candidates: staffIds.map((staffResourceId) => ({
    staffResourceId,
    staffName: `站方${staffResourceId}`,
    staffStatus: 0,
    pairClass,
    blocks: []
  })),
  blocks: []
})

const mergeList = (rows: ReturnType<typeof mergeRow>[]) => ({
  items: rows,
  total: rows.length,
  page: 1,
  limit: 30,
  counts: { pending: rows.length, dismissed: 0, merged: 0 },
  oldestPending: null
})

const previewOf = (
  userId: number,
  staffId: number,
  pairClass: 'high' | 'manual'
) => ({
  classification: pairClass,
  canMerge: true,
  blocks: [],
  basis: BASIS,
  user: card(userId, `用户卡片${userId}`, 7),
  staff: card(staffId, `站方卡片${staffId}`, 8),
  survivorPreview: {
    name: '合并后的名字',
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
        storage: 'user',
        content: 'https://example.com/user-link',
        size: '',
        version: 1,
        sortOrder: 1,
        changedAt: null,
        backedUpAt: null
      }
    ]
  },
  fieldComparison: [{ field: '名称', user: '用户卡片', staff: '站方卡片' }],
  exitedPairs: []
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
    mocks.get.mockImplementation((url: string, params?: Record<string, unknown>) => {
      return new Promise((resolve) => {
        gets.push({ url, params: params ?? {}, resolve })
      })
    })
    mocks.post.mockImplementation((url: string, body?: Record<string, unknown>) => {
      return new Promise((resolve) => {
        posts.push({ url, params: body ?? {}, resolve })
      })
    })
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
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
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
          new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
        )
      }
    })
    await settle()
  }
  const buttonNamed = (name: string, exact = false) => {
    const found = [...dom.window.document.querySelectorAll('button')].find((item) => {
      const label = item.textContent?.trim() ?? ''
      return exact ? label === name : label.includes(name)
    })
    if (!found) throw new Error(`找不到按钮 ${name}。当前：${text().slice(0, 400)}`)
    return found
  }
  const confirmDialog = async (name: string) => {
    await settle()
    const dialog = dom.window.document.querySelector('[role="alertdialog"]')
    const found = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent?.trim() === name
    )
    if (!found) throw new Error(`对话框里没有 ${name}`)
    await click(found)
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
      `没有请求 ${url}。已有：${gets.map((item) => item.url).join(',')}`
    )
  }
  const postNamed = (url: string) => posts.filter((item) => item.url === url)

  const mountBackup = async () => {
    const rows = [
      backupRow(11, 'abcd1234', 7),
      backupRow(12, 'efgh5678', 8)
    ]
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
    expect(dom.window.document.querySelector('.break-all')?.textContent).toContain(
      LONG_LINK
    )
    const candidate = [...dom.window.document.querySelectorAll('a')].find((item) =>
      item.textContent?.includes('核对合并候选')
    )
    expect(candidate?.getAttribute('href')).toBe(
      `/dashboard/resource-merges?search=${encodeURIComponent('卡片11')}`
    )

    await click(buttonNamed('忽略', true))
    expect(text()).toContain('忽略后，这张卡片保持不备份')
    await click(buttonNamed('取消'))
    expect(posts).toEqual([])

    await click(buttonNamed('忽略', true))
    await confirmDialog('忽略')
    expect(postNamed('/admin/backup/ignore')).toHaveLength(1)
    expect(postNamed('/admin/backup/ignore')[0]?.params).toEqual({ resourceId: 11 })
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
    await resolveUrl('/admin/backup/detail', backupDetail(backupRow(12, 'efgh5678', 8)), {
      resourceId: 12
    })
    await act(async () => {
      editorCall?.resolve({
        resources: [{ id: 11, baseLinks: [{ id: 1 }] }]
      })
    })
    await settle()
    expect(dom.window.document.querySelector('[data-testid="resource-editor"]')).toBeNull()
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
    const previous = [...dom.window.document.querySelectorAll('tr')].find((item) =>
      item.textContent?.includes('游戏11')
    )
    if (!previous) throw new Error('找不到第一张卡片')
    await click(previous)
    expect(dom.window.document.querySelector('[data-testid="resource-editor"]')).toBeNull()
  })

  const mountMerges = async () => {
    nav.pathname = '/dashboard/resource-merges'
    nav.reset('id=21')
    const rows = [
      mergeRow(21, [31, 41], 'high'),
      mergeRow(22, [32], 'manual'),
      mergeRow(24, [34], 'high'),
      mergeRow(25, [35], 'high')
    ]
    await act(async () => {
      root.render(<DashboardResourceMerges />)
    })
    await resolveUrl('/admin/resource-merges', mergeList(rows))
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 31, 'high'),
      { userResourceId: 21, staffResourceId: 31 }
    )
    return rows
  }

  const confirmVisiblePair = async () => {
    const box = dom.window.document.querySelector('[role="checkbox"]')
    if (!box) throw new Error(`没有内容确认。当前：${text().slice(0, 500)}`)
    await click(box)
  }

  it('shows the merged card and does not write when confirmation is cancelled', async () => {
    await mountMerges()
    const cardText = dom.window.document.querySelector(
      '[aria-label="合并后的卡片"]'
    )?.textContent
    expect(cardText).toContain('合并后的名字')
    expect(cardText).toContain('PC游戏')
    expect(cardText).toContain('简体中文')
    expect(cardText).toContain('Windows')
    expect(cardText).toContain('用户备注')
    expect(cardText).toContain('站方备份说明')
    expect(cardText).toContain('已附上站方备注')
    const links = [
      ...dom.window.document.querySelectorAll('[aria-label="合并后的卡片"] li')
    ].map((item) => item.textContent ?? '')
    expect(links[0]).toContain('https://example.com/user-link')
    expect(links[0]).toContain('无大小')
    expect(links[0]).toContain('无站方备份')
    expect(links[1]).toContain(LONG_LINK)
    expect(links[1]).toContain('12MB')
    expect(links[1]).toContain('站方备份')
    expect(dom.window.document.querySelector('[aria-label="合并后的卡片"] .break-all')?.className).toContain(
      'break-all'
    )
    expect(text()).not.toContain('password')
    expect(text()).not.toContain('哈希')
    const body = text()
    const markers = ['分类：', '候选站方卡片', '合并后的卡片', '字段对照']
    let at = -1
    for (const marker of markers) {
      const next = body.indexOf(marker)
      expect(next).toBeGreaterThan(at)
      at = next
    }
    expect(body).toContain('待处理')
    expect(body).not.toContain('待合并')
    expect(body).not.toContain('已搁置')

    await confirmVisiblePair()
    await click(buttonNamed('合并这一对'))
    expect(text()).toContain('站方卡片并入这张用户卡片')
    await click(buttonNamed('取消'))
    expect(posts).toEqual([])
    expect(
      dom.window.document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')
    ).toBe('true')
  })

  it('batches only confirmed high pairs and retries cache per merged item', async () => {
    await mountMerges()
    await confirmVisiblePair()
    const selectRow = async (userId: number, staffId: number, pairClass: 'high' | 'manual') => {
      const row = [...dom.window.document.querySelectorAll('tr')].find((item) =>
        item.textContent?.includes(`用户卡片${userId}`)
      )
      if (!row) throw new Error(`找不到用户卡片${userId}`)
      await click(row)
      await resolveUrl(
        '/admin/resource-merges/preview',
        previewOf(userId, staffId, pairClass),
        { userResourceId: userId, staffResourceId: staffId }
      )
      await confirmVisiblePair()
    }
    await selectRow(22, 32, 'manual')
    await selectRow(24, 34, 'high')
    expect(
      [...dom.window.document.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === '合并所选'
      )
    ).toBe(false)
    await act(async () => {
      nav.reset('id=21&pairClass=high')
    })
    await resolveUrl(
      '/admin/resource-merges',
      mergeList([
        mergeRow(21, [31, 41], 'high'),
        mergeRow(24, [34], 'high'),
        mergeRow(25, [35], 'high')
      ])
    )
    if (gets.some((item) => item.url === '/admin/resource-merges/preview')) {
      await resolveUrl(
        '/admin/resource-merges/preview',
        previewOf(21, 31, 'high'),
        { userResourceId: 21, staffResourceId: 31 }
      )
    }
    expect(buttonNamed('合并所选', true)).toBeTruthy()
    await click(buttonNamed('合并所选', true))
    expect(text()).toContain('将合并 2 对已逐对确认的高置信配对')
    await click(buttonNamed('取消', true))
    expect(posts).toEqual([])

    await click(buttonNamed('合并所选', true))
    await confirmDialog('合并所选')
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
          userResourceId: 24,
          staffResourceId: 34,
          basis: BASIS,
          contentConfirmed: true
        }
      ]
    })
    await selectRow(25, 35, 'high')
    await act(async () => {
      postNamed('/admin/resource-merges/batch')[0]?.resolve({
        outcomes: [
          {
            userResourceId: 21,
            staffResourceId: 31,
            status: 'merged',
            result: mergedResult(21, 31, false)
          },
          {
            userResourceId: 24,
            staffResourceId: 34,
            status: 'skipped',
            reason: '内容未确认'
          }
        ],
        remaining: [{ userResourceId: 26, staffResourceId: 36 }]
      })
    })
    expect(text()).toContain('#21 / #31 已合并，保留 #21')
    expect(text()).toContain('#24 / #34 未合并：内容未确认')
    expect(text()).toContain('#26 / #36 未开始')
    expect(text()).toContain('页面缓存没有刷新')
    expect(
      dom.window.document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')
    ).toBe('true')
    await click(buttonNamed('仅刷新缓存'))
    expect(postNamed('/admin/resource-merges/batch')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/merge')).toEqual([])
    expect(postNamed('/admin/backup/refresh-cache')[0]?.params).toEqual({
      uniqueIds: ['abcd1234'],
      authorIds: [7, 8]
    })
  })

  it('keeps a newly confirmed pair when an older merge response arrives', async () => {
    await mountMerges()
    await confirmVisiblePair()
    await click(buttonNamed('合并这一对', true))
    await confirmDialog('合并')
    expect(postNamed('/admin/resource-merges/merge')[0]?.params).toMatchObject({
      userResourceId: 21,
      staffResourceId: 31,
      contentConfirmed: true
    })
    await click(buttonNamed('#41 站方41'))
    await resolveUrl(
      '/admin/resource-merges/preview',
      previewOf(21, 41, 'high'),
      { userResourceId: 21, staffResourceId: 41 }
    )
    await confirmVisiblePair()
    await act(async () => {
      postNamed('/admin/resource-merges/merge')[0]?.resolve(
        mergedResult(21, 31, false)
      )
    })
    expect(
      dom.window.document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')
    ).toBe('true')
    expect(text()).toContain('站方卡片41')
    expect(text()).not.toContain('没有确认这次操作是否已经写入')
    expect(text()).not.toContain('已合并，页面缓存没有刷新')
    expect(postNamed('/admin/resource-merges/merge')).toHaveLength(1)
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

  it('keeps the cache failure after the merged pair leaves the list', async () => {
    await mountMerges()
    await confirmVisiblePair()
    await click(buttonNamed('合并这一对', true))
    await confirmDialog('合并')
    await act(async () => {
      postNamed('/admin/resource-merges/merge')[0]?.resolve(
        mergedResult(21, 31, false)
      )
    })
    expect(text()).toContain('已合并，页面缓存没有刷新')
    await resolveUrl(
      '/admin/resource-merges',
      mergeList([
        mergeRow(22, [32], 'manual'),
        mergeRow(24, [34], 'high'),
        mergeRow(25, [35], 'high')
      ])
    )
    expect(
      dom.window.document.querySelector('[aria-label="合并后的卡片"]')
    ).toBeNull()
    expect(dom.window.document.querySelector('[role="checkbox"]')).toBeNull()
    expect(text()).not.toContain('配对 #21')
    expect(text()).not.toContain(LONG_LINK)
    expect(text()).toContain('用户卡片22')
    expect(text()).toContain('选择一条配对查看全文与操作')
    expect(text()).toContain('已合并，页面缓存没有刷新')
    await click(buttonNamed('仅刷新缓存', true))
    expect(postNamed('/admin/resource-merges/merge')).toHaveLength(1)
    expect(postNamed('/admin/resource-merges/batch')).toEqual([])
    expect(postNamed('/admin/resource-merges/dismiss')).toEqual([])
    expect(postNamed('/admin/backup/refresh-cache')).toEqual([
      expect.objectContaining({
        params: { uniqueIds: ['abcd1234'], authorIds: [7, 8] }
      })
    ])
  })
})
