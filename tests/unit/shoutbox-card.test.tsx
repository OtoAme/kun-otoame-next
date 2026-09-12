import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchPut: vi.fn(),
  kunFetchDelete: vi.fn(),
  kunFetchPost: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  currentUid: 0,
  currentRole: 1
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPut: mocks.kunFetchPut,
  kunFetchDelete: mocks.kunFetchDelete,
  kunFetchPost: mocks.kunFetchPost
}))

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError }
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('~/store/userStore', () => {
  const store = {
    get user() {
      return { uid: mocks.currentUid, role: mocks.currentRole }
    }
  }
  const useUserStore = (selector: (state: typeof store) => unknown) =>
    selector(store)
  useUserStore.getState = () => store
  return { useUserStore }
})

vi.mock('@heroui/avatar', () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    startContent,
    href,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
    startContent?: React.ReactNode
    href?: string
    'aria-label'?: string
  }) =>
    href ? (
      <a href={href} aria-label={ariaLabel}>
        {startContent}
        {children}
      </a>
    ) : (
      <button
        aria-label={ariaLabel}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {startContent}
        {children}
      </button>
    )
}))

vi.mock('@heroui/card', () => ({
  Card: ({
    children,
    id,
    className
  }: {
    children?: React.ReactNode
    id?: string
    className?: string
  }) => (
    <div id={id} className={className}>
      {children}
    </div>
  ),
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@heroui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}))

vi.mock('@heroui/input', () => ({
  Textarea: ({
    value,
    onValueChange,
    'aria-label': ariaLabel
  }: {
    value?: string
    onValueChange?: (value: string) => void
    'aria-label'?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onInput={(event) => onValueChange?.(event.currentTarget.value)}
    />
  )
}))

vi.mock('@heroui/modal', () => ({
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false)
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
      onOpenChange: setIsOpen
    }
  }
}))

import { ShoutboxCard } from '~/components/shoutbox/ShoutboxCard'
import type { ShoutboxItem } from '~/types/api/shoutbox'

const makeItem = (overrides: Partial<ShoutboxItem> = {}): ShoutboxItem => ({
  id: 42,
  user: { id: 7, name: '作者', avatar: '' },
  content: '今晚八点开荒，欢迎来看',
  link: '',
  official: false,
  level: 'normal',
  status: 0,
  cost: 50,
  patch: null,
  effectiveFrom: null,
  effectiveTo: null,
  editedAt: null,
  hiddenAt: null,
  refundedAt: null,
  reportable: true,
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  ...overrides
})

const clickButton = async (container: HTMLElement, label: string) => {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button')
  ).find((candidate) => candidate.textContent?.includes(label))
  expect(button, `button ${label}`).not.toBeNull()
  await act(async () => {
    button!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const fillTextarea = async (textarea: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )!.set!
    setter.call(textarea, value)
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

// Compact rows carry icon-only author actions whose accessible name is the
// aria-label; the mocked Button renders it on the element.
const clickIconButton = async (container: HTMLElement, label: string) => {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  )
  expect(button, `icon button ${label}`).not.toBeNull()
  await act(async () => {
    button!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ShoutboxCard', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderCard = async (
    item: ShoutboxItem,
    options: {
      currentUserId?: number
      showStatus?: boolean
      highlight?: boolean
      compact?: boolean
      onChanged?: (item: ShoutboxItem) => void
      onDeleted?: (id: number) => void
    } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/shoutbox'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <ShoutboxCard
          item={item}
          currentUserId={options.currentUserId ?? 0}
          showStatus={options.showStatus ?? false}
          highlight={options.highlight ?? false}
          compact={options.compact ?? false}
          onChanged={options.onChanged}
          onDeleted={options.onDeleted}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentUid = 0
    mocks.currentRole = 1
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

  it('lets the author self-delete a hidden-pending-review message after confirmation', async () => {
    const onDeleted = vi.fn()
    mocks.kunFetchDelete.mockResolvedValue({})
    await renderCard(
      makeItem({ status: 2, hiddenAt: new Date().toISOString() }),
      { currentUserId: 7, showStatus: true, onDeleted }
    )

    // Status label is shown on the author's own record; a hidden message can
    // still be self-deleted but no longer edited.
    expect(container.textContent).toContain('隐藏待复核')
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('编辑')
      )
    ).toBe(false)
    // The timestamp is a deterministic <time dateTime> element, safe for
    // SSR and first hydration.
    expect(
      container.querySelector('time')?.getAttribute('dateTime')
    ).toBeTruthy()

    await clickButton(container, '删除')
    // The confirmation dialog is open; nothing has been written yet.
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(mocks.kunFetchDelete).not.toHaveBeenCalled()

    await clickButton(container, '确认删除')
    expect(mocks.kunFetchDelete).toHaveBeenCalledWith('/shoutbox', {
      shoutboxId: 42
    })
    expect(onDeleted).toHaveBeenCalledWith(42)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('小喇叭已删除')
  })

  it('lets the author edit a public message once inside the five-minute window', async () => {
    const onChanged = vi.fn()
    const updated = makeItem({
      content: '改到八点一刻',
      editedAt: new Date().toISOString()
    })
    mocks.kunFetchPut.mockResolvedValue(updated)
    await renderCard(makeItem(), { currentUserId: 7, onChanged })

    await clickButton(container, '编辑')
    await fillTextarea(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="编辑小喇叭"]'
      )!,
      '改到八点一刻'
    )
    await clickButton(container, '保存')

    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/shoutbox', {
      shoutboxId: 42,
      content: '改到八点一刻'
    })
    expect(onChanged).toHaveBeenCalledWith(updated)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('小喇叭已更新')
    // The spent edit chance closes locally: even before the parent swaps in
    // the updated item, the edit entry must not reappear.
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('编辑')
      )
    ).toBe(false)
  })

  it('offers no edit entry once the message was edited or the window closed', async () => {
    await renderCard(makeItem({ editedAt: new Date().toISOString() }), {
      currentUserId: 7
    })
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('编辑')
      )
    ).toBe(false)
  })

  it("hides the report entry on the author's own message", async () => {
    mocks.currentUid = 7
    await renderCard(makeItem(), { currentUserId: 7 })
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('举报')
      )
    ).toBe(false)
  })

  it('offers the report entry on an official message for other users', async () => {
    mocks.currentUid = 99
    await renderCard(
      makeItem({
        official: true,
        level: 'important',
        cost: 0,
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
      }),
      { currentUserId: 99 }
    )
    // The official badge chip is gone; the level chip stays.
    expect(container.textContent).not.toContain('官方')
    expect(container.textContent).toContain('重要')
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('举报')
      )
    ).toBe(true)
  })

  it('shows guests the report entry but routes them to the login prompt', async () => {
    mocks.currentUid = 0
    await renderCard(makeItem(), { currentUserId: 0 })

    await clickButton(container, '举报')
    expect(container.textContent).toContain('举报小喇叭需要先登录账号')
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it("submits a report for another user's message and closes with a success toast", async () => {
    mocks.currentUid = 99
    mocks.kunFetchPost.mockResolvedValue({})
    await renderCard(makeItem(), { currentUserId: 99 })

    await clickButton(container, '举报')
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="举报原因"]'
    )!
    await fillTextarea(textarea, '垃圾广告')
    await clickButton(container, '提交举报')

    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/shoutbox/report', {
      shoutboxId: 42,
      content: '垃圾广告'
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '举报已提交，站方会进行复核'
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the draft and the dialog open when the report is refused', async () => {
    mocks.currentUid = 99
    mocks.kunFetchPost.mockResolvedValue('您已经举报过这条小喇叭')
    await renderCard(makeItem(), { currentUserId: 99 })

    await clickButton(container, '举报')
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="举报原因"]'
    )!
    await fillTextarea(textarea, '垃圾广告')
    await clickButton(container, '提交举报')

    expect(mocks.toastError).toHaveBeenCalledWith('您已经举报过这条小喇叭')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="举报原因"]'
      )?.value
    ).toBe('垃圾广告')
  })

  // The server marks every message by a super administrator reportable:
  // false, ordinary or official alike. For ordinary users and guests the
  // entry, the dialogs and any path to the report API are all gone; the
  // role >= 3 review navigation is not a report and stays.
  it('offers no report entry or dialog on a non-reportable ordinary message', async () => {
    mocks.currentUid = 99
    await renderCard(makeItem({ reportable: false }), { currentUserId: 99 })

    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('举报')
      )
    ).toBe(false)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('offers no report entry on a non-reportable official message either', async () => {
    mocks.currentUid = 99
    await renderCard(
      makeItem({
        official: true,
        level: 'important',
        cost: 0,
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: new Date(Date.now() + 3_600_000).toISOString(),
        reportable: false
      }),
      { currentUserId: 99 }
    )

    expect(container.textContent).toContain('重要')
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('举报')
      )
    ).toBe(false)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('shows guests no entry at all on a non-reportable message — not even the login prompt', async () => {
    mocks.currentUid = 0
    await renderCard(makeItem({ reportable: false }), {
      compact: true,
      currentUserId: 0
    })

    expect(container.querySelector('button[aria-label="举报"]')).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    // The fixed-width action slot keeps its reserve when the entry is gone.
    expect(container.querySelector('.w-16')).not.toBeNull()
  })

  it('keeps the navigation-only review entry for administrators on a non-reportable message', async () => {
    mocks.currentUid = 99
    mocks.currentRole = 3
    await renderCard(makeItem({ reportable: false }), {
      compact: true,
      currentUserId: 99
    })

    const entry = container.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/shoutbox?shoutbox=42"]'
    )
    expect(entry).not.toBeNull()
    expect(entry?.getAttribute('aria-label')).toBe('审查小喇叭')
    expect(container.querySelector('button[aria-label="举报"]')).toBeNull()
    // The fixed-width action slot keeps its reserve either way.
    expect(container.querySelector('.w-16')).not.toBeNull()

    await act(async () => {
      entry!.click()
      await Promise.resolve()
    })
    // The entry only navigates: no report dialog, no submission.
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('compact mode renders the inline colon row with the anchor id, the highlight ring and the report entry for other users', async () => {
    await renderCard(makeItem(), {
      compact: true,
      highlight: true,
      currentUserId: 99
    })

    const row = container.querySelector('#shoutbox-42')
    expect(row?.className).toContain('ring-2')
    expect(container.textContent).toContain('作者')
    expect(container.textContent).toContain('：今晚八点开荒，欢迎来看')
    // The icon-only report entry stays available to other users.
    expect(container.querySelector('button[aria-label="举报"]')).not.toBeNull()
  })

  it('compact mode lets the author edit in place and keeps the draft when the save is refused', async () => {
    const onChanged = vi.fn()
    mocks.kunFetchPut.mockResolvedValue('正文包含被屏蔽的内容')
    await renderCard(makeItem(), { compact: true, currentUserId: 7, onChanged })

    await clickIconButton(container, '编辑')
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="编辑小喇叭"]'
    )!
    await fillTextarea(textarea, '改到八点一刻')
    await clickButton(container, '保存')

    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/shoutbox', {
      shoutboxId: 42,
      content: '改到八点一刻'
    })
    expect(mocks.toastError).toHaveBeenCalledWith('正文包含被屏蔽的内容')
    // A refused save keeps the draft and stays in editing mode.
    expect(onChanged).not.toHaveBeenCalled()
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="编辑小喇叭"]'
      )?.value
    ).toBe('改到八点一刻')
  })

  it('compact mode keeps the author self-delete confirmation flow', async () => {
    const onDeleted = vi.fn()
    mocks.kunFetchDelete.mockResolvedValue({})
    await renderCard(makeItem(), { compact: true, currentUserId: 7, onDeleted })

    await clickIconButton(container, '删除')
    // The confirmation dialog is open; nothing has been written yet.
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(mocks.kunFetchDelete).not.toHaveBeenCalled()

    await clickButton(container, '确认删除')
    expect(mocks.kunFetchDelete).toHaveBeenCalledWith('/shoutbox', {
      shoutboxId: 42
    })
    expect(onDeleted).toHaveBeenCalledWith(42)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('小喇叭已删除')
  })

  it("gives role-3 administrators a navigation-only review entry on other users' compact rows", async () => {
    mocks.currentUid = 99
    mocks.currentRole = 3
    await renderCard(makeItem(), { compact: true, currentUserId: 99 })

    const entry = container.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/shoutbox?shoutbox=42"]'
    )
    expect(entry).not.toBeNull()
    expect(entry?.getAttribute('aria-label')).toBe('审查小喇叭')
    // No report trigger at all for administrators.
    expect(container.querySelector('button[aria-label="举报"]')).toBeNull()

    await act(async () => {
      entry!.click()
      await Promise.resolve()
    })
    // The entry only navigates: no report dialog, no submission.
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('gives role-4 administrators the same review entry with a visible label on the full card', async () => {
    mocks.currentUid = 99
    mocks.currentRole = 4
    await renderCard(makeItem(), { currentUserId: 99 })

    const entry = container.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/shoutbox?shoutbox=42"]'
    )
    expect(entry?.textContent).toContain('审查小喇叭')
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === '举报'
      )
    ).toBe(false)
  })

  it("hides the report/review entry on the administrator's own message too", async () => {
    mocks.currentUid = 7
    mocks.currentRole = 3
    await renderCard(makeItem(), { compact: true, currentUserId: 7 })

    expect(container.querySelector('a[href^="/dashboard/shoutbox"]')).toBeNull()
    expect(container.querySelector('button[aria-label="举报"]')).toBeNull()
  })

  it('normalizes manual newlines in the edit draft, initial and freshly typed', async () => {
    mocks.kunFetchPut.mockResolvedValue(
      makeItem({ content: '改到 八点', editedAt: new Date().toISOString() })
    )
    await renderCard(makeItem({ content: '第一行\n第二行' }), {
      compact: true,
      currentUserId: 7
    })

    await clickIconButton(container, '编辑')
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="编辑小喇叭"]'
    )!
    // A stored newline renders as a space in the draft.
    expect(textarea.value).toBe('第一行 第二行')

    await fillTextarea(textarea, '改到\n八点')
    expect(textarea.value).toBe('改到 八点')
    await clickButton(container, '保存')
    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/shoutbox', {
      shoutboxId: 42,
      content: '改到 八点'
    })
  })
})
