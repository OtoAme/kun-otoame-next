import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

const userState = vi.hoisted(() => ({
  user: {
    uid: 7,
    name: 'Saya',
    avatar: '',
    moemoepointAvailable: 10,
    moemoepointReserved: 0,
    dailyCheckIn: 1
  },
  setUser: vi.fn(),
  setMoemoepointBalance: vi.fn(),
  logout: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) =>
    selector(userState)
}))

vi.mock('~/store/settingStore', () => ({
  useSettingStore: (selector: (state: { resetData: () => void }) => unknown) =>
    selector({ resetData: vi.fn() })
}))

vi.mock('~/store/messageStore', () => ({
  useMessageStore: (
    selector: (state: { resetUnreadMessageStatus: () => void }) => unknown
  ) => selector({ resetUnreadMessageStatus: vi.fn() })
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('~/components/kun/Sooner', () => ({
  showKunSooner: vi.fn()
}))

vi.mock('~/components/kun/top-bar/NSFWSwitcher', () => ({
  NSFWSwitcher: () => null
}))

vi.mock('@heroui/avatar', () => ({
  Avatar: () => <button type="button" aria-label="头像" />
}))

vi.mock('@heroui/button', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  )
}))

vi.mock('@heroui/modal', () => ({
  Modal: () => null,
  ModalBody: () => null,
  ModalContent: () => null,
  ModalFooter: () => null,
  ModalHeader: () => null,
  useDisclosure: () => ({
    isOpen: false,
    onOpen: vi.fn(),
    onOpenChange: vi.fn()
  })
}))

// Mirrors HeroUI MenuItem: the description line is rendered only for a truthy
// description, which is what decides whether the row is one or two lines.
vi.mock('@heroui/dropdown', () => ({
  Dropdown: ({
    children,
    onOpenChange
  }: {
    children?: React.ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <div>
      <button
        type="button"
        data-testid="open-menu"
        onClick={() => onOpenChange?.(true)}
      />
      {children}
    </div>
  ),
  DropdownTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  DropdownItem: ({
    children,
    description
  }: {
    children?: React.ReactNode
    description?: React.ReactNode
  }) => (
    <li>
      <span data-slot="title">{children}</span>
      {description ? <span data-slot="description">{description}</span> : null}
    </li>
  )
}))

describe('user dropdown workspace entry', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const render = async (element: React.ReactNode) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()
    root = createRoot(container!)
    await act(async () => {
      root!.render(element)
    })
    return container!
  }

  const openMenu = async (container: Element) => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="open-menu"]')!
        .click()
    })
  }

  const workspaceDescription = (container: Element) => {
    const row = [...container.querySelectorAll('li')].find(
      (item) =>
        item.querySelector('[data-slot="title"]')?.textContent === '用户工作台'
    )
    expect(row).toBeDefined()
    return row!.querySelector('[data-slot="description"]')
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    fetchMock.kunFetchGet.mockReset()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps the workspace row on a single line without requesting counts', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ owned: 3, waitingReporter: 1 })
    const { UserDropdown } = await import(
      '~/components/kun/top-bar/UserDropdown'
    )
    const container = await render(<UserDropdown />)

    await openMenu(container)

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
    expect(workspaceDescription(container)).toBeNull()
  })
})
