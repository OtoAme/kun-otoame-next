import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { TagDetail } from '~/types/api/tag'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchDelete: vi.fn(),
  kunFetchPost: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchDelete: fetchMock.kunFetchDelete,
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    isLoading: _isLoading,
    onPress,
    startContent: _startContent,
    ...props
  }: {
    children?: React.ReactNode
    onPress?: () => void
    [key: string]: unknown
  }) => (
    <button type="button" onClick={onPress} {...props}>
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

vi.mock('~/store/userStore', () => ({
  useUserStore: (
    selector: (state: {
      user: { uid: number; role: number; blockedTagIds: number[] }
      setUser: (user: unknown) => void
    }) => unknown
  ) =>
    selector({
      user: { uid: 9, role: 1, blockedTagIds: [] },
      setUser: vi.fn()
    })
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

  const renderContainer = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/tag/15'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

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
          initialGalgames={[]}
          initialTotal={0}
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
    fetchMock.kunFetchPost.mockReset()
    routerMock.push.mockReset()
    vi.unstubAllGlobals()
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
})
