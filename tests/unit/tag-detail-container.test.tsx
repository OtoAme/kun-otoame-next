import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { TagDetail } from '~/types/api/tag'
import type { SessionRenderState } from '~/types/api/session'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchDelete: vi.fn(),
  kunFetchPatch: vi.fn(),
  kunFetchPost: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchDelete: fetchMock.kunFetchDelete,
  kunFetchPatch: fetchMock.kunFetchPatch,
  KunFetchError: class extends Error {},
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    isLoading: _isLoading,
    onPress,
    isDisabled,
    startContent: _startContent,
    ...props
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isLoading?: boolean
    isDisabled?: boolean
    startContent?: React.ReactNode
    [key: string]: unknown
  }) => (
    <button
      type="button"
      onClick={onPress}
      disabled={Boolean(isDisabled)}
      {...props}
    >
      {children}
    </button>
  )
}))

vi.mock('@heroui/modal', () => ({
  useDisclosure: () => ({
    isOpen: false,
    onOpen: vi.fn(),
    onClose: vi.fn()
  })
}))

vi.mock('lucide-react', () => ({
  CircleOff: () => <span data-testid="circle-off-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('~/components/galgame/Card', () => ({
  GalgameCard: ({ patch }: { patch: GalgameCard }) => (
    <article data-testid="galgame-card">{patch.name}</article>
  )
}))

vi.mock('~/components/galgame/FilterBar', () => ({
  FilterBar: ({ setSortField }: { setSortField: (value: string) => void }) => (
    <button type="button" onClick={() => setSortField('created')}>
      切换排序
    </button>
  )
}))

vi.mock('~/components/kun/Header', () => ({
  KunHeader: ({
    name,
    endContent,
    headerEndContent
  }: {
    name: string
    endContent?: React.ReactNode
    headerEndContent?: React.ReactNode
  }) => (
    <header>
      <h1>{name}</h1>
      {headerEndContent}
      {endContent}
    </header>
  )
}))

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint: string }) => (
    <div data-testid="tag-loading">{hint}</div>
  )
}))

vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => (
    <div data-testid="tag-null">{message}</div>
  )
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: () => <button type="button">下一页</button>
}))

vi.mock('~/components/kun/floating-card/KunUser', () => ({
  KunUser: () => <div data-testid="tag-user" />
}))

vi.mock('~/components/tag/detail/EditTagModal', () => ({
  EditTagModal: () => <div data-testid="edit-tag-modal" />
}))

vi.mock('~/components/tag/detail/DeleteTagModal', () => ({
  DeleteTagModal: () => <button type="button">删除标签</button>
}))

const makeTag = (): TagDetail => ({
  id: 15,
  name: 'Tag',
  count: 1,
  alias: [],
  introduction: '',
  created: '2026-01-01T00:00:00.000Z',
  user: {
    id: 1,
    name: 'User',
    avatar: ''
  }
})

const makeGalgame = (id: number, name: string): GalgameCard => ({
  id,
  uniqueId: `test${id.toString().padStart(4, '0')}`,
  name,
  banner: `/banner-${id}.webp`,
  view: 0,
  download: 0,
  type: ['game'],
  language: ['zh-cn'],
  platform: ['windows'],
  tags: [],
  created: '2026-01-01T00:00:00.000Z',
  _count: {
    favorite_folder: 0,
    resource: 0,
    comment: 0
  },
  averageRating: 0
})

describe('TagDetailContainer', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderContainer = async (
    initialGalgames: GalgameCard[] = [],
    initialScope?: SessionRenderState
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/tag/15'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    useUserStore.setState({
      user: { ...useUserStore.getState().user, uid: 9 },
      sessionStatus: 'authenticated',
      sessionContext: 'a'.repeat(64),
      sessionGeneration: 0
    })
    usePreferenceStore.setState({
      generation: 0,
      status: 'ready',
      applied: {
        uid: 9,
        context: 'a'.repeat(64),
        version: 0,
        nsfwSelected: true,
        blockedTagIds: [],
        items: { nsfw: { value: 'sfw', version: 0 } }
      }
    })
    const { TagDetailContainer } = await import(
      '~/components/tag/detail/Container'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <TagDetailContainer
          initialTag={makeTag()}
          initialGalgames={initialGalgames}
          initialTotal={initialGalgames.length}
          initialScope={initialScope}
        />
      )
    })

    return container!
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchDelete.mockReset()
    fetchMock.kunFetchPatch.mockReset()
    fetchMock.kunFetchPost.mockReset()
    routerMock.push.mockReset()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('fetches tag games on first mount even when filters are at defaults', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(1, '标签首屏列表')],
      total: 1
    })

    const container = await renderContainer()

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/tag/otomegame',
      expect.objectContaining({
        tagId: 15,
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'resource_update_time',
        sortOrder: 'desc',
        page: 1,
        limit: 24,
        minRatingCount: 0
      })
    )

    await act(async () => {})

    expect(container.textContent).toContain('标签首屏列表')
  })

  it('keeps a matching server tag list through confirmation and does not fetch after logout', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ galgames: [], total: 0 })
    const container = await renderContainer(
      [makeGalgame(1, '服务器标签列表')],
      {
        identity: 'a'.repeat(64),
        browsingKey: '["sfw",[]]'
      }
    )
    const card = container.querySelector('[data-testid="galgame-card"]')
    const { useUserStore } = await import('~/store/userStore')
    await act(async () => useUserStore.getState().setSessionStatus('checking'))
    await act(async () =>
      useUserStore.getState().setSessionStatus('authenticated')
    )
    expect(container.querySelector('[data-testid="galgame-card"]')).toBe(card)
    expect(container.textContent).toContain('服务器标签列表')
    await act(async () => useUserStore.getState().logout())
    expect(container.textContent).toContain('请登录后查看标签详细信息')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('uses versioned tag saving and preserves an unrelated display draft', async () => {
    const snapshot = {
      uid: 9,
      context: 'a'.repeat(64),
      version: 0,
      nsfwSelected: true,
      blockedTagIds: [] as number[],
      items: {
        nsfw: { value: 'sfw', version: 0 },
        'email-notice': { value: false, version: 0 },
        'blocked-tag:15': { value: false, version: 0 }
      }
    }
    fetchMock.kunFetchGet.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/user/preferences')
          ? snapshot
          : { galgames: [], total: 0 }
      )
    )
    fetchMock.kunFetchPatch.mockResolvedValue({
      ...snapshot,
      version: 1,
      blockedTagIds: [15],
      items: {
        ...snapshot.items,
        'blocked-tag:15': { value: true, version: 1 }
      }
    })
    const container = await renderContainer()
    const { editPreference } = await import('~/utils/preferenceClient')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    await act(async () => editPreference('nsfw', 'all'))
    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.includes('屏蔽该标签')
    )!
    await act(async () => button.click())
    expect(fetchMock.kunFetchPatch).toHaveBeenCalledWith('/user/preferences', {
      uid: 9,
      context: 'a'.repeat(64),
      changes: [{ key: 'blocked-tag:15', value: true, version: 0 }]
    })
    expect(container.textContent).toContain('取消屏蔽')
    expect(usePreferenceStore.getState().drafts.nsfw.value).toBe('all')
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(fetchMock.kunFetchDelete).not.toHaveBeenCalled()
  })
})
