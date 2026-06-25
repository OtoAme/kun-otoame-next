import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { CompanyDetail } from '~/types/api/company'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('@heroui/react', () => ({
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
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('@heroui/modal', () => ({
  useDisclosure: () => ({
    isOpen: false,
    onOpen: vi.fn(),
    onClose: vi.fn()
  })
}))

vi.mock('@heroui/link', () => ({
  Link: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('lucide-react', () => ({
  Pencil: () => <span data-testid="pencil-icon" />
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
    <div data-testid="company-loading">{hint}</div>
  )
}))

vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => (
    <div data-testid="company-null">{message}</div>
  )
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    onPageChange
  }: {
    onPageChange: (page: number) => void
  }) => (
    <button type="button" onClick={() => onPageChange(2)}>
      下一页
    </button>
  )
}))

vi.mock('~/components/kun/floating-card/KunUser', () => ({
  KunUser: () => <div data-testid="company-user" />
}))

vi.mock('~/components/company/form/CompanyFormModal', () => ({
  CompanyFormModal: () => <div data-testid="company-form-modal" />
}))

vi.mock('~/components/company/detail/DeleteCompanyModal', () => ({
  DeleteCompanyModal: () => <button type="button">删除会社</button>
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: { user: { role: number } }) => unknown) =>
    selector({ user: { role: 1 } })
}))

const makeCompany = (): CompanyDetail => ({
  id: 4,
  name: 'Company',
  count: 1,
  alias: [],
  introduction: '',
  primary_language: [],
  official_website: [],
  parent_brand: [],
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

describe('CompanyDetailContainer', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderContainer = async (
    props: React.ComponentProps<
      (typeof import('~/components/company/detail/Container'))['CompanyDetailContainer']
    >,
    options: { cookie?: string; strictMode?: boolean } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/company/4'
    })
    if (options.cookie) {
      dom.window.document.cookie = options.cookie
    }

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { CompanyDetailContainer } = await import(
      '~/components/company/detail/Container'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        options.strictMode ? (
          <React.StrictMode>
            <CompanyDetailContainer {...props} />
          </React.StrictMode>
        ) : (
          <CompanyDetailContainer {...props} />
        )
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
    routerMock.push.mockReset()
    routerMock.refresh.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses the static SFW company list for anonymous default filters', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端列表')],
      total: 1
    })

    const container = await renderContainer({
      initialCompany: makeCompany(),
      initialGalgames: [makeGalgame(1, '服务端全年龄会社列表')],
      initialTotal: 1,
      initialVisibility: 'pending'
    })

    await act(async () => {})

    expect(container.textContent).toContain('服务端全年龄会社列表')
    expect(container.textContent).not.toContain('客户端列表')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('does not refetch the anonymous static company list under StrictMode', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端列表')],
      total: 1
    })

    const container = await renderContainer(
      {
        initialCompany: makeCompany(),
        initialGalgames: [makeGalgame(1, '服务端全年龄会社列表')],
        initialTotal: 1,
        initialVisibility: 'pending'
      },
      { strictMode: true }
    )

    await act(async () => {})

    expect(container.textContent).toContain('服务端全年龄会社列表')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('fetches personalized company results on first mount for all-mode users', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端混合会社列表')],
      total: 1
    })

    const container = await renderContainer(
      {
        initialCompany: makeCompany(),
        initialGalgames: [makeGalgame(1, '服务端全年龄会社列表')],
        initialTotal: 1,
        initialVisibility: 'pending'
      },
      {
        cookie: 'kun-patch-setting-store|state|data|kunNsfwEnable=all'
      }
    )

    expect(container.textContent).not.toContain('服务端全年龄会社列表')
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/company/otomegame',
      expect.objectContaining({
        companyId: 4,
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

    expect(container.textContent).toContain('客户端混合会社列表')
  })
})
