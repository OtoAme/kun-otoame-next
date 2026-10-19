import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchPost: vi.fn(),
  reportedCallbacks: [] as Array<(view: unknown) => void>,
  cardRenders: [] as Array<Record<string, unknown>>
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: mocks.kunFetchPost
}))
vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    onPress?: () => void
    'aria-label'?: string
  }) => (
    <button type="button" aria-label={ariaLabel} onClick={onPress}>
      {children}
    </button>
  )
}))
vi.mock('isomorphic-dompurify', () => ({
  default: { sanitize: (html: string) => html }
}))
vi.mock('~/components/kun/floating-card/KunUser', () => ({
  KunUser: ({ user }: { user: { name: string } }) => <span>{user.name}</span>
}))
vi.mock('~/components/patch/resource/ResourceLike', () => ({
  ResourceLikeButton: () => <span>like</span>
}))
vi.mock('~/components/patch/resource/kun/markdownToHtml', () => ({
  markdownToHtml: vi.fn(async (markdown: string) => markdown)
}))
vi.mock('~/components/case/ReportResourceButton', () => ({
  ReportResourceButton: ({
    onReported
  }: {
    onReported?: (view: unknown) => void
  }) => {
    mocks.reportedCallbacks.push(onReported!)
    return <button type="button">遇到问题</button>
  }
}))
// 卡片桩：忠实呈现父级下发的 healthUpdate（true = 有更新，null = 回到服务端）
vi.mock('~/components/patch/resource/DownloadCard', () => ({
  ResourceDownloadCard: ({
    link,
    healthUpdate = null
  }: {
    link: { id: number }
    healthUpdate?: {
      health: string
      maintenance?: { revision?: number } | null
    } | null
  }) => (
    <div data-testid={`download-card-${link.id}`}>
      {healthUpdate
        ? `update:${healthUpdate.health}:m${healthUpdate.maintenance?.revision ?? 0}`
        : 'server'}
    </div>
  )
}))

import { ResourceDownload } from '~/components/patch/resource/ResourceDownload'
import type { PatchResource, PatchResourceHealthLink } from '~/types/api/patch'

globalThis.React = React

const link21: PatchResourceHealthLink = {
  id: 21,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 1,
  download: 0,
  version: 2,
  evidenceRound: 1,
  health: 'suspect',
  healthChangedAt: '2026-10-08T00:00:00.000Z',
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'publisher',
  disputeSource: null,
  recentReportCount: 3,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: [],
    canCheck: false,
    canEdit: false
  }
}

const resource: PatchResource = {
  id: 11,
  name: '测试资源',
  section: 'galgame',
  uniqueId: 'ABCDEFGH',
  type: ['pc'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '',
  links: [link21],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 7,
  created: '2026-07-06T00:00:00.000Z',
  user: { id: 3, name: 'Saya', avatar: '', patchCount: 1, role: 2 }
}

describe('ResourceDownload two-step callback provenance (parent tie)', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    mocks.kunFetchPost.mockReset()
    mocks.reportedCallbacks.length = 0
    mocks.cardRenders.length = 0
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (current: PatchResource) => {
    act(() => {
      root?.unmount()
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<ResourceDownload resource={current} />)
    })
    await act(async () => {})
    return container
  }

  it('drops a delayed two-step callback arriving after the read snapshot advanced', async () => {
    const container = await mount(resource)
    // 打开链接列表，让卡片收到 healthUpdate 通道
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label]')!.click()
    })
    const staleCallback = mocks.reportedCallbacks.find(
      (callback): callback is (view: unknown) => void => !!callback
    )!

    // 同快照内的报告结果先按序生效
    await act(async () => {
      staleCallback({
        patchId: 7,
        resourceId: 11,
        linkId: 21,
        version: 2,
        evidenceRound: 2,
        health: 'ok',
        healthChangedAt: '2026-10-09T05:00:00.000Z',
        verifiedAt: '2026-10-09T05:00:00.000Z',
        lastRelinkAt: null,
        ownerType: 'publisher',
        disputeSource: null,
        recentReportCount: 3,
        latestCheck: null,
        capabilities: {
          ownerActions: [],
          resolveActions: [],
          canCheck: false,
          canEdit: false
        }
      })
    })
    expect(container.textContent).toContain('update:ok')

    // 新读取快照到来（同 id 同版本同轮次）：回到服务端事实
    const renewed: PatchResource = {
      ...resource,
      links: [{ ...link21, recentReportCount: 9 } as PatchResourceHealthLink]
    }
    await act(async () => {
      root!.render(<ResourceDownload resource={renewed} />)
    })
    await act(async () => {})
    expect(container.textContent).not.toContain('update:ok')

    // 新快照的成功回包先到：显示新的健康事实（suspect/人数 10）
    const freshCallback =
      mocks.reportedCallbacks[mocks.reportedCallbacks.length - 1]
    await act(async () => {
      freshCallback({
        patchId: 7,
        resourceId: 11,
        linkId: 21,
        version: 2,
        evidenceRound: 1,
        health: 'suspect',
        healthChangedAt: '2026-10-09T06:00:00.000Z',
        verifiedAt: null,
        lastRelinkAt: null,
        ownerType: 'publisher',
        disputeSource: null,
        recentReportCount: 10,
        latestCheck: null,
        capabilities: {
          ownerActions: [],
          resolveActions: [],
          canCheck: false,
          canEdit: false
        }
      })
    })
    expect(container.textContent).toContain('update:suspect')

    // 迟到一步的旧快照回调：携带旧快照标记，被即时丢弃不得复活旧投影
    await act(async () => {
      staleCallback({
        patchId: 7,
        resourceId: 11,
        linkId: 21,
        version: 2,
        evidenceRound: 2,
        health: 'ok',
        healthChangedAt: '2026-10-09T05:00:00.000Z',
        verifiedAt: null,
        lastRelinkAt: null,
        ownerType: 'publisher',
        disputeSource: null,
        recentReportCount: 3,
        latestCheck: null,
        capabilities: {
          ownerActions: [],
          resolveActions: [],
          canCheck: false,
          canEdit: false
        }
      })
    })
    await act(async () => {})
    expect(container.textContent).not.toContain('update:ok')
    // 已收到的新匹配更新不得被旧回调覆盖
    expect(container.textContent).toContain('update:suspect')
  })

  it('merges a late health packet without clearing a newer restriction or moving the card', async () => {
    const container = await mount(resource)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label]')!.click()
    })
    const report = mocks.reportedCallbacks.at(-1)!
    const packet = (
      health: string,
      evidenceRound: number,
      revision: number
    ) => ({
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      version: 2,
      evidenceRound,
      health,
      healthChangedAt: '2026-10-09T05:00:00.000Z',
      verifiedAt: null,
      lastRelinkAt: null,
      ownerType: 'publisher',
      disputeSource: null,
      recentReportCount: 3,
      latestCheck: null,
      capabilities: {
        ownerActions: [],
        resolveActions: [],
        canCheck: false,
        canEdit: false
      },
      maintenance: {
        revision,
        restriction: revision >= 2 ? 'stopped' : null,
        resumesAt: null
      }
    })
    await act(async () => {
      report(packet('ok', 3, 2))
    })
    expect(container.textContent).toContain('update:ok:m2')
    const order = () =>
      [...container.querySelectorAll('[data-testid^="download-card-"]')].map(
        (node) => node.getAttribute('data-testid')
      )
    expect(order()).toEqual(['download-card-21'])

    await act(async () => {
      report(packet('broken', 1, 1))
    })
    expect(container.textContent).toContain('update:ok:m2')
    expect(container.textContent).not.toContain('update:broken')

    await act(async () => {
      report(packet('broken', 4, 1))
    })
    expect(container.textContent).toContain('update:broken:m2')
    expect(order()).toEqual(['download-card-21'])
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })
})
