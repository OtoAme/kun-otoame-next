import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PatchResource } from '~/types/api/patch'

globalThis.React = React

const userState = vi.hoisted(() => ({
  user: { uid: 0, role: 1 }
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) =>
    selector(userState)
}))

vi.mock('~/components/patch/resource/ResourceInfo', () => ({
  ResourceInfo: () => <div data-testid="resource-info" />
}))

vi.mock('~/components/patch/resource/ResourceDownload', () => ({
  ResourceDownload: () => <div data-testid="resource-download" />
}))

vi.mock('~/components/patch/resource/accessResourceLinksForEdit', () => ({
  accessResourceLinksForEdit: vi.fn()
}))

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: () => <div data-testid="loading" />
}))

vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => <div>{message}</div>
}))

vi.mock('~/config/moyu-moe', () => ({
  kunMoyuMoe: {
    titleShort: 'OtoAme',
    domain: { forum: 'https://forum.example.com' }
  }
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn() }
}))

vi.mock('lucide-react', () => ({
  Edit: () => <span data-testid="edit-icon" />,
  MoreHorizontal: () => <span data-testid="more-icon" />,
  Trash2: () => <span data-testid="trash-icon" />
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled: _isDisabled,
    isIconOnly: _isIconOnly,
    isLoading: _isLoading,
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
  Card: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
  ),
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Dropdown: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownItem: ({
    children,
    onPress
  }: {
    children?: React.ReactNode
    onPress?: () => void
  }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownTrigger: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  User: ({ name }: { name?: string }) => <div>{name}</div>,
  Tab: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

const resource: PatchResource = {
  id: 10,
  name: '测试资源',
  section: 'galgame',
  uniqueId: 'abc12345',
  type: ['pc'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '',
  links: [],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 7,
  patchId: 30,
  created: '2026-06-29T00:00:00.000Z',
  user: {
    id: 7,
    name: '资源作者',
    avatar: '',
    patchCount: 1,
    role: 1
  }
}

describe('ResourceTabs resource operation visibility', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderTabs = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/game'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { ResourceTabs } = await import('~/components/patch/resource/Tabs')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ResourceTabs
          vndbId="vndb-1"
          resources={[resource]}
          setEditResource={vi.fn()}
          onOpenEdit={vi.fn()}
          onOpenDelete={vi.fn()}
          setDeleteResourceId={vi.fn()}
          selectedSection="galgame"
          setSelectedSection={vi.fn()}
        />
      )
    })

    return container!
  }

  beforeEach(() => {
    userState.user = { uid: 0, role: 1 }
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it.each([
    ['guest', 0, 1],
    ['another ordinary user', 8, 1],
    ['creator without ownership', 8, 2]
  ])('hides the operation button for a %s', async (_label, uid, role) => {
    userState.user = { uid, role }
    const container = await renderTabs()

    expect(container.querySelector('[aria-label="资源操作"]')).toBeNull()
  })

  it.each([
    ['the resource owner', 7, 1],
    ['an administrator', 8, 3]
  ])('shows the operation button for %s', async (_label, uid, role) => {
    userState.user = { uid, role }
    const container = await renderTabs()

    expect(container.querySelector('[aria-label="资源操作"]')).not.toBeNull()
  })
})
