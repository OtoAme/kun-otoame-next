import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type {
  PatchResource,
  PatchResourceAccessLink,
  PatchResourceLink
} from '~/types/api/patch'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: fetchMock.kunFetchPost,
  kunFetchPut: fetchMock.kunFetchPut
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress
  }: {
    children?: React.ReactNode
    onPress?: () => void
  }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@heroui/snippet', () => ({
  Snippet: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@heroui/react', async () => {
  const R = await import('react')
  return {
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
      isLoading,
      startContent,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      onPress?: () => void
      isDisabled?: boolean
      isLoading?: boolean
      startContent?: React.ReactNode
      'aria-label'?: string
    }) => (
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {startContent}
        {children}
      </button>
    ),
    Checkbox: ({
      children,
      isSelected,
      onValueChange
    }: {
      children?: React.ReactNode
      isSelected?: boolean
      onValueChange?: (checked: boolean) => void
    }) => (
      <label>
        <input
          type="checkbox"
          checked={!!isSelected}
          onChange={(event) => onValueChange?.(event.target.checked)}
        />
        {children}
      </label>
    ),
    Radio: () => null,
    RadioGroup: ({ children }: { children?: React.ReactNode }) => (
      <div role="radiogroup">{children}</div>
    ),
    Popover: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    PopoverTrigger: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    PopoverContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Card: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    CardBody: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    useDisclosure: () => {
      const [isOpen, setOpen] = R.useState(false)
      return {
        isOpen,
        onOpen: () => setOpen(true),
        onClose: () => setOpen(false),
        onOpenChange: setOpen
      }
    }
  }
})

vi.mock('~/components/kun/external-link/ExternalLink', () => ({
  KunExternalLink: ({
    children,
    link
  }: {
    children?: React.ReactNode
    link: string
  }) => <a href={link}>{children}</a>
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

vi.mock('isomorphic-dompurify', () => ({
  default: { sanitize: (html: string) => html }
}))

vi.mock('~/components/kun/floating-card/KunUser', () => ({
  KunUser: () => <span>user</span>
}))

vi.mock('~/components/patch/resource/ResourceLike', () => ({
  ResourceLikeButton: () => <span>like</span>
}))

vi.mock('~/components/patch/resource/kun/markdownToHtml', () => ({
  markdownToHtml: vi.fn(async (markdown: string) => markdown)
}))

vi.mock('~/components/case/ReportResourceButton', () => ({
  ReportResourceButton: () => <button type="button">遇到问题</button>
}))

const link: PatchResourceLink = {
  id: 21,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 0,
  download: 0
}

const resource: PatchResource = {
  id: 11,
  name: '测试资源',
  section: 'galgame',
  uniqueId: 'ABCDEFGH',
  type: ['game'],
  language: ['zh'],
  platform: ['windows'],
  note: '',
  links: [link],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 7,
  created: '2026-07-06T00:00:00.000Z',
  user: {
    id: 3,
    name: 'Saya',
    avatar: '',
    patchCount: 1,
    role: 2
  }
}

const secret = 'https://pan.example.test/secret-link'
const accessBody = (revealedExpiresAt: string) => ({
  link: {
    id: 21,
    version: 1,
    storage: 'user',
    size: '2 GB',
    content: secret,
    code: 'abcd',
    password: 'secret-pass',
    hash: '',
    revealedExpiresAt
  },
  access: {
    kind: 'resource_granted' as const,
    actorType: 'user' as const,
    cost: 0,
    obtainedExpiresAt: '2099-01-01T00:00:00.000Z'
  }
})

const restored = (revealedExpiresAt: string): PatchResourceAccessLink => ({
  id: 21,
  storage: 'user',
  size: '2 GB',
  content: secret,
  code: 'abcd',
  password: 'secret-pass',
  hash: '',
  revealedExpiresAt
})

describe('official mirror per-link credential expiry', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const mount = async (node: React.ReactNode) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    dom.window.setTimeout = globalThis.setTimeout.bind(globalThis)
    dom.window.clearTimeout = globalThis.clearTimeout.bind(globalThis)
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = dom.window.document.getElementById('root')
    root = createRoot(container!)
    await act(async () => {
      root!.render(node)
    })
    return container!
  }

  const clickAccess = async (container: HTMLElement) => {
    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.includes('获取下载链接')
    )
    expect(button).toBeTruthy()
    await act(async () => {
      button!.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
    fetchMock.kunFetchPost.mockReset()
  })

  it('removes credentials from the card when the link deadline fires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'))
    const cleared = vi.fn()
    fetchMock.kunFetchPost.mockResolvedValue(
      accessBody('2026-11-04T00:00:02.000Z')
    )
    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={link}
        onCredentialsCleared={cleared}
      />
    )
    await clickAccess(container)
    expect(container.textContent).toContain(secret)
    expect(container.textContent).toContain('abcd')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001)
    })

    expect(container.textContent).not.toContain(secret)
    expect(container.textContent).not.toContain('abcd')
    expect(container.textContent).not.toContain('secret-pass')
    expect(container.textContent).toContain('获取下载链接')
    expect(cleared).toHaveBeenCalledWith(21)
  })

  it('drops credentials when the card switches resource before a late response', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined
    fetchMock.kunFetchPost.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    )
    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    const container = await mount(
      <ResourceDownloadCard resource={resource} link={link} />
    )
    await clickAccess(container)
    await act(async () => {
      root!.render(
        <ResourceDownloadCard resource={{ ...resource, id: 99 }} link={link} />
      )
    })
    await act(async () => {
      resolveFetch(accessBody('2099-01-01T00:00:00.000Z'))
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain(secret)
    expect(container.textContent).not.toContain('secret-pass')
  })

  it('discards a response whose link deadline has already passed', async () => {
    fetchMock.kunFetchPost.mockResolvedValue(
      accessBody('2020-01-01T00:00:00.000Z')
    )
    const cleared = vi.fn()
    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={link}
        onCredentialsCleared={cleared}
      />
    )
    await clickAccess(container)
    expect(container.textContent).not.toContain(secret)
    expect(container.textContent).not.toContain('secret-pass')
    expect(cleared).toHaveBeenCalledWith(21)
  })

  it('hides the grant deadline and still clears restored credentials on expiry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'))
    const revealedLink: PatchResourceLink = {
      ...link,
      revealed: true,
      revealedExpiresAt: '2026-11-04T00:00:02.000Z',
      obtainedExpiresAt: '2026-11-04T00:01:00.000Z'
    }
    fetchMock.kunFetchPost.mockResolvedValue({
      links: [restored('2026-11-04T00:00:02.000Z')],
      obtainedExpiresAt: '2026-11-04T00:01:00.000Z'
    })
    const { ResourceDownload } = await import(
      '~/components/patch/resource/ResourceDownload'
    )
    const container = await mount(
      <ResourceDownload resource={{ ...resource, links: [revealedLink] }} />
    )
    expect(container.textContent).toContain(secret)
    expect(container.textContent).not.toContain('本次获取有效至')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001)
    })

    expect(container.textContent).not.toContain(secret)
    expect(container.textContent).not.toContain('abcd')
    expect(container.textContent).not.toContain('secret-pass')
    expect(container.textContent).not.toContain('本次获取有效至')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(container.textContent).not.toContain('本次获取有效至')
  })
})
