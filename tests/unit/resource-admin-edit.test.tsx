import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchDelete: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn(),
  dialogResources: [] as unknown[],
  user: { uid: 1, name: 'Admin', role: 4 }
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchDelete: mocks.kunFetchDelete,
  kunFetchPost: mocks.kunFetchPost,
  kunFetchPut: mocks.kunFetchPut
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: (
    selector: (state: { user: typeof mocks.user }) => unknown
  ) => selector({ user: mocks.user })
}))

vi.mock('@heroui/react', async () => {
  const R = await import('react')
  return {
    Modal: ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
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
      isLoading,
      isIconOnly,
      startContent
    }: {
      children?: React.ReactNode
      onPress?: () => void
      isDisabled?: boolean
      isLoading?: boolean
      isIconOnly?: boolean
      startContent?: React.ReactNode
    }) => (
      <button
        type="button"
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {startContent}
        {children}
      </button>
    ),
    Textarea: () => <textarea />,
    useDisclosure: () => {
      const [isOpen, setIsOpen] = R.useState(false)
      return {
        isOpen,
        onOpen: () => setIsOpen(true),
        onClose: () => setIsOpen(false),
        onOpenChange: setIsOpen
      }
    }
  }
})

// 编辑弹窗本体由 resource-edit-stable 专测；这里只证明调用方的打开契约。
vi.mock('~/components/patch/resource/edit/EditResourceDialog', () => ({
  EditResourceDialog: ({ resource }: { resource: unknown }) => {
    mocks.dialogResources.push(resource)
    return <div data-testid="edit-dialog" />
  }
}))

import { ResourceEdit } from '~/components/admin/resource/ResourceEdit'
import { ResourceApprovalButton } from '~/components/admin/resource-apply/ApprovalButton'
import { readEditContext } from '~/components/patch/resource/accessResourceLinksForEdit'
import type { AdminResource } from '~/types/api/admin'
import type { PatchResourceHealthLink } from '~/types/api/patch'

globalThis.React = React

/** 后台编辑 DTO 的链接：健康投影 + 完整凭据（已授权读取）。 */
type AdminEditLink = PatchResourceHealthLink & {
  content: string
  code: string
  password: string
}

const healthLink = (
  overrides: Partial<AdminEditLink> = {}
): AdminEditLink => ({
  id: 21,
  storage: 'user',
  size: '2 GB',
  content: 'https://pan.example.com/share',
  code: 'abcd',
  password: 'secret',
  hash: '',
  sortOrder: 1,
  download: 0,
  version: 3,
  evidenceRound: 1,
  health: 'ok',
  healthChangedAt: null,
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'publisher',
  disputeSource: null,
  recentReportCount: 0,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: [],
    canCheck: false,
    canEdit: false
  },
  ...overrides
})

const adminResource = (
  overrides: Partial<AdminResource> = {}
): AdminResource =>
  ({
    id: 11,
    name: '后台资源',
    section: 'galgame',
    uniqueId: 'ABCDEFGH',
    type: ['pc', 'official-zh'],
    language: ['zh-Hans'],
    platform: ['windows'],
    note: '',
    links: [],
    likeCount: 0,
    download: 0,
    isLike: false,
    status: 0,
    userId: 3,
    patchId: 7,
    created: '2026-07-06T00:00:00.000Z',
    user: { id: 3, name: 'Uploader', avatar: '', patchCount: 1, role: 1 },
    patchName: '条目A',
    ...overrides
  }) as AdminResource

describe('admin editor callers (baseline at open)', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dialogResources.length = 0
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (ui: React.ReactElement) => {
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
      root!.render(ui)
    })
    return container
  }

  it('captures the authorized DTO baseline at open without touching the download access channel', async () => {
    const container = await mount(
      <ResourceEdit
        initialResource={adminResource({
          links: [healthLink({ id: 21, version: 3 })] as never,
          baseLinks: [
            { id: 21, version: 3 },
            { id: 22, version: 2 }
          ]
        })}
      />
    )
    await act(async () => {
      container.querySelector('button')!.click()
    })

    expect(container.querySelector('[data-testid="edit-dialog"]')).not.toBeNull()
    expect(mocks.dialogResources.length).toBe(1)
    const context = readEditContext(
      mocks.dialogResources[0] as Parameters<typeof readEditContext>[0]
    )
    expect(context?.baseLinks).toEqual([
      { id: 21, version: 3 },
      { id: 22, version: 2 }
    ])
    // 后台读取已携带凭据：绝不为编辑制造下载授权
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
  })

  it('derives the baseline from link versions when the DTO omits baseLinks', async () => {
    const container = await mount(
      <ResourceEdit
        initialResource={adminResource({
          links: [healthLink({ id: 21, version: 3 })] as never
        })}
      />
    )
    await act(async () => {
      container.querySelector('button')!.click()
    })

    const context = readEditContext(
      mocks.dialogResources[0] as Parameters<typeof readEditContext>[0]
    )
    expect(context?.baseLinks).toEqual([{ id: 21, version: 3 }])
  })

  it('fails closed with refresh guidance when neither baseline source exists', async () => {
    const container = await mount(
      <ResourceEdit
        initialResource={adminResource({
          links: [
            {
              id: 21,
              storage: 'user',
              size: '2 GB',
              content: 'https://pan.example.com/share',
              code: 'abcd',
              password: 'secret',
              hash: '',
              sortOrder: 1,
              download: 0
            }
          ] as never
        })}
      />
    )
    await act(async () => {
      container.querySelector('button')!.click()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith(
      '链接编辑基点缺失，请刷新列表后再试'
    )
    expect(container.querySelector('[data-testid="edit-dialog"]')).toBeNull()
    expect(mocks.dialogResources.length).toBe(0)
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('captures the same baseline for pending apply resources (no grant hydration)', async () => {
    const container = await mount(
      <ResourceApprovalButton
        resource={adminResource({
          links: [healthLink({ id: 31, version: 1 })] as never,
          baseLinks: [{ id: 31, version: 1 }]
        })}
      />
    )
    const editButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('编辑')
    )!
    await act(async () => {
      editButton.click()
    })

    expect(container.querySelector('[data-testid="edit-dialog"]')).not.toBeNull()
    const context = readEditContext(
      mocks.dialogResources[0] as Parameters<typeof readEditContext>[0]
    )
    expect(context?.baseLinks).toEqual([{ id: 31, version: 1 }])
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
  })
})
