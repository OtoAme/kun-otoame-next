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
  kunFetchPost: vi.fn()
}))

const cardMock = vi.hoisted(() => ({
  shown: [] as {
    id: number
    content?: string
    password?: string
    code?: string
  }[]
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: fetchMock.kunFetchPost
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
  KunUser: () => <span>user</span>
}))

vi.mock('~/components/patch/resource/ResourceLike', () => ({
  ResourceLikeButton: () => null
}))

vi.mock('~/components/patch/resource/kun/markdownToHtml', () => ({
  markdownToHtml: vi.fn(async () => '')
}))

vi.mock('~/components/case/ReportResourceButton', () => ({
  ReportResourceButton: () => null
}))

vi.mock('~/components/patch/resource/DownloadCard', () => ({
  isOpenAccessDeadline: (value?: string, now = Date.now()) => {
    if (!value) return false
    const time = Date.parse(value)
    return Number.isFinite(time) && time > now
  },
  ResourceDownloadCard: ({
    link,
    restoredLink
  }: {
    link: PatchResourceLink
    restoredLink?: PatchResourceAccessLink
  }) => {
    cardMock.shown.push({
      id: link.id,
      content: restoredLink?.content,
      password: restoredLink?.password,
      code: restoredLink?.code
    })
    return (
      <div>
        <span>{restoredLink?.content ?? ''}</span>
        <span>{restoredLink?.code ?? ''}</span>
        <span>{restoredLink?.password ?? ''}</span>
      </div>
    )
  }
}))

const link = (id: number, revealedExpiresAt: string): PatchResourceLink => ({
  id,
  storage: 'user',
  size: '1 GB',
  hash: '',
  sortOrder: id,
  download: 0,
  revealed: true,
  revealedExpiresAt
})

const resource = (id: number, links: PatchResourceLink[]): PatchResource => ({
  id,
  name: '资源',
  section: 'galgame',
  uniqueId: 'ABCDEFGH',
  type: ['game'],
  language: ['zh'],
  platform: ['windows'],
  note: '',
  links,
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
})

const restored = (
  id: number,
  secret: string,
  revealedExpiresAt: string
): PatchResourceAccessLink => ({
  id,
  storage: 'user',
  size: '1 GB',
  content: secret,
  code: `code-${id}`,
  password: `pass-${id}`,
  hash: '',
  revealedExpiresAt
})

describe('official mirror parent credential expiry', () => {
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

  const toggleLinks = async (container: HTMLElement) => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="下载 OtomeGame 资源"]'
        )
        ?.click()
    })
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchPost.mockReset()
    cardMock.shown = []
  })

  it('drops the earlier restored link while folded and keeps the later link without a grant label', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'))
    const early = 'https://pan.example.test/early'
    const later = 'https://pan.example.test/later'
    fetchMock.kunFetchPost.mockResolvedValue({
      links: [
        restored(21, early, '2026-11-04T00:00:02.000Z'),
        restored(22, later, '2026-11-04T00:01:00.000Z')
      ],
      obtainedExpiresAt: '2026-11-04T00:02:00.000Z'
    })
    const { ResourceDownload } = await import(
      '~/components/patch/resource/ResourceDownload'
    )
    const container = await mount(
      <ResourceDownload
        resource={resource(11, [
          link(21, '2026-11-04T00:00:02.000Z'),
          link(22, '2026-11-04T00:01:00.000Z')
        ])}
      />
    )
    expect(container.textContent).toContain(early)
    expect(container.textContent).toContain(later)

    await toggleLinks(container)
    expect(container.textContent).not.toContain(early)
    expect(container.textContent).not.toContain('本次获取有效至')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001)
    })
    cardMock.shown = []
    await toggleLinks(container)

    expect(container.textContent).not.toContain(early)
    expect(container.textContent).not.toContain('code-21')
    expect(container.textContent).not.toContain('pass-21')
    expect(container.textContent).toContain(later)
    expect(container.textContent).toContain('pass-22')
    expect(container.textContent).not.toContain('本次获取有效至')
    expect(container.textContent).not.toContain('2026-11-04T00:02:00.000Z')
    expect(
      cardMock.shown.find((item) => item.id === 21)?.content
    ).toBeUndefined()
    expect(cardMock.shown.find((item) => item.id === 22)?.content).toBe(later)
  })

  it('drops a late restore response after the resource target changes', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    const first = new Promise((resolve) => {
      resolveFirst = resolve
    })
    fetchMock.kunFetchPost.mockImplementation(
      (_url: string, body: { resourceId: number }) => {
        if (body.resourceId === 11) return first
        return Promise.resolve({ links: [], obtainedExpiresAt: null })
      }
    )
    const { ResourceDownload } = await import(
      '~/components/patch/resource/ResourceDownload'
    )
    const secret = 'https://pan.example.test/stale-target'
    const container = await mount(
      <ResourceDownload
        resource={resource(11, [link(21, '2099-01-01T00:00:00.000Z')])}
      />
    )
    await act(async () => {
      root!.render(
        <ResourceDownload
          resource={resource(99, [link(31, '2099-01-01T00:00:00.000Z')])}
        />
      )
    })
    await act(async () => {
      resolveFirst({
        links: [restored(21, secret, '2099-01-01T00:00:00.000Z')],
        obtainedExpiresAt: '2099-01-01T00:00:00.000Z'
      })
    })

    expect(container.textContent).not.toContain(secret)
    expect(container.textContent).not.toContain('pass-21')
    expect(cardMock.shown.some((item) => item.content === secret)).toBe(false)
  })
})
