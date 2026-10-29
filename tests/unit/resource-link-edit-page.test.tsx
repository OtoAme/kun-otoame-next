import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn(),
  router: { push: vi.fn() },
  params: { id: '7' },
  searchParams: new URLSearchParams('linkId=21')
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost,
  kunFetchPut: mocks.kunFetchPut
}))
vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
  useSearchParams: () => mocks.searchParams,
  useRouter: () => mocks.router
}))
vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint?: string }) => <div>{hint}</div>
}))
vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button type="button" disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  )
}))
vi.mock('@heroui/react', () => ({
  Modal: ({
    isOpen,
    children
  }: {
    isOpen: boolean
    children?: React.ReactNode
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button type="button" disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  useDisclosure: ({ defaultOpen = false } = {}) => {
    const ReactLib = React
    const [isOpen, setIsOpen] = ReactLib.useState(defaultOpen)
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
      onOpenChange: setIsOpen
    }
  }
}))

// 编辑弹窗的子表单与本测试无关（其行为由 resource-edit-stable 等套件覆盖）
vi.mock('~/components/patch/resource/publish/ResourceSectionSelect', () => ({
  ResourceSectionSelect: () => <div />
}))
vi.mock('~/components/patch/resource/publish/ResourceLinksInput', () => ({
  ResourceLinksInput: () => <div data-testid="links-input" />
}))
vi.mock('~/components/patch/resource/publish/ResourceDetailsForm', () => ({
  ResourceDetailsForm: () => <div />
}))

import { ResourceLinkEditClient } from '~/components/admin/resource/ResourceLinkEditClient'
import type { AdminResource } from '~/types/api/admin'

globalThis.React = React

const adminResource = (): AdminResource =>
  ({
    id: 7,
    name: '隐藏资源',
    section: 'galgame',
    uniqueId: 'HIDEXXXX',
    patchName: '条目A',
    type: ['pc', 'official-zh'],
    language: ['zh-Hans'],
    platform: ['windows'],
    note: '',
    links: [
      {
        id: 21,
        storage: 'touchgal',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'secret',
        hash: '',
        sortOrder: 1,
        download: 0,
        version: 2,
        evidenceRound: 1,
        health: 'broken',
        healthChangedAt: '2026-10-08T00:00:00.000Z',
        verifiedAt: null,
        lastRelinkAt: null,
        ownerType: 'staff',
        disputeSource: null,
        recentReportCount: 4,
        latestCheck: null,
        capabilities: {
          ownerActions: [],
          resolveActions: [],
          canCheck: false,
          canEdit: true
        }
      }
    ],
    baseLinks: [{ id: 21, version: 2 }],
    likeCount: 0,
    download: 0,
    isLike: false,
    status: 1,
    userId: 3,
    patchId: 3,
    created: '2026-07-06T00:00:00.000Z',
    user: { id: 3, name: 'Uploader', avatar: '', patchCount: 1, role: 1 }
  }) as unknown as AdminResource

describe('legacy authorized link editor route (broken-link inbox)', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params = { id: '7' }
    mocks.searchParams = new URLSearchParams('linkId=21')
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async () => {
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
      root!.render(<ResourceLinkEditClient />)
    })
    await act(async () => {})
    return container
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )

  it('hydrates the authorized DTO (incl. hidden resources) and saves with the full baseline, never touching download access', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      resources: [adminResource()],
      total: 1
    })
    mocks.kunFetchPut.mockResolvedValue({
      ...adminResource(),
      linkChecks: []
    })

    const container = await mount()
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/resource', {
      page: 1,
      limit: 1,
      resourceId: 7
    })
    // 绝不为编辑制造下载授权
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPut).toHaveBeenCalledTimes(1)
    const [url, body] = mocks.kunFetchPut.mock.calls[0]
    expect(url).toBe('/admin/resource')
    expect(body.resourceId).toBe(7)
    expect(body.baseLinks).toEqual([{ id: 21, version: 2 }])
    expect(body.links[0].id).toBe(21)
    expect(body.links[0].content).toBe('https://pan.example.com/share')
    // 成功后回到问题处理页的资源盘链接失效列表（列表与计数由读面刷新）
    expect(mocks.router.push).toHaveBeenCalledWith(
      '/dashboard/case?view=broken-link'
    )
  })

  it('cancels without any write and returns to the broken-link list', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      resources: [adminResource()],
      total: 1
    })
    const container = await mount()

    await act(async () => {
      findButton(container, '取消')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
    expect(mocks.router.push).toHaveBeenCalledWith(
      '/dashboard/case?view=broken-link'
    )
  })

  it('keeps the draft and does not navigate away on a stale-baseline 409', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      resources: [adminResource()],
      total: 1
    })
    mocks.kunFetchPut.mockResolvedValue('该资源已被他人修改，请刷新后重试')
    const container = await mount()

    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPut).toHaveBeenCalledTimes(1)
    expect(mocks.toast.error).toHaveBeenCalledWith(
      '该资源已被他人修改，请刷新后重试'
    )
    expect(container.textContent).toContain('您的修改已保留')
    expect(mocks.router.push).not.toHaveBeenCalled()
  })

  it('shows truthful guidance on empty, mismatched or unauthorized responses', async () => {
    mocks.kunFetchGet.mockResolvedValueOnce({ resources: [], total: 0 })
    let container = await mount()
    expect(container.textContent).toContain('该资源不存在或当前不可访问')
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    act(() => {
      root?.unmount()
    })
    root = undefined
    mocks.kunFetchGet.mockResolvedValueOnce({
      resources: [{ ...adminResource(), id: 99 }],
      total: 1
    })
    container = await mount()
    expect(container.textContent).toContain('该资源不存在或当前不可访问')

    act(() => {
      root?.unmount()
    })
    root = undefined
    mocks.kunFetchGet.mockResolvedValueOnce('本页面仅管理员可访问')
    container = await mount()
    expect(container.textContent).toContain('本页面仅管理员可访问')
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('rejects an invalid route id before any request', async () => {
    mocks.params = { id: 'abc' }
    const container = await mount()
    expect(container.textContent).toContain('链接参数不正确')
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()
  })
})
