import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const downloadCardMock = vi.hoisted(() => ({
  render: vi.fn()
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
  default: {
    sanitize: (html: string) => html
  }
}))

vi.mock('~/components/kun/floating-card/KunUser', () => ({
  KunUser: ({ user }: { user: { name: string } }) => <span>{user.name}</span>
}))

vi.mock('~/components/patch/resource/ResourceLike', () => ({
  ResourceLikeButton: () => <span>like</span>
}))

vi.mock('~/components/patch/resource/kun/markdownToHtml', () => ({
  markdownToHtml: vi.fn(async (markdown: string) => markdown)
}))

vi.mock('~/components/patch/resource/DownloadCard', () => ({
  ResourceDownloadCard: ({
    link,
    restoredLink,
    restoredObtainedExpiresAt
  }: {
    link: PatchResourceLink
    restoredLink?: PatchResourceAccessLink
    restoredObtainedExpiresAt?: string
  }) => {
    downloadCardMock.render({
      link,
      restoredLink,
      restoredObtainedExpiresAt
    })
    return (
      <div data-testid={`download-card-${link.id}`}>
        <button type="button">
          {link.revealed ? '查看已获取链接' : '获取下载链接'}
        </button>
        {restoredLink ? (
          <span>
            restored:{restoredLink.content}:expires:
            {restoredObtainedExpiresAt ?? ''}
          </span>
        ) : null}
      </div>
    )
  }
}))

const link21: PatchResourceLink = {
  id: 21,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 0,
  download: 0
}

const link22: PatchResourceLink = {
  id: 22,
  storage: 's3',
  size: '3 GB',
  hash: 'hash-22',
  sortOrder: 1,
  download: 0
}

const sensitiveLink21: PatchResourceAccessLink = {
  id: 21,
  storage: 'user',
  size: '2 GB',
  content: 'https://pan.example.com/share/21',
  code: 'abcd',
  password: 'secret-21',
  hash: ''
}

const sensitiveLink22: PatchResourceAccessLink = {
  id: 22,
  storage: 's3',
  size: '3 GB',
  content: 'https://storage.example.com/share/22',
  code: '',
  password: 'secret-22',
  hash: 'hash-22'
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
  links: [link21, link22],
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

const withLinks = (
  links: PatchResourceLink[],
  overrides: Partial<PatchResource> = {}
): PatchResource => ({
  ...resource,
  ...overrides,
  links
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ResourceDownload revealed mirror restore', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const renderResourceDownload = async (initialResource: PatchResource) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { ResourceDownload: Component } = await import(
      '~/components/patch/resource/ResourceDownload'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()
    root = createRoot(container!)
    const Harness = ({
      currentResource,
      onLayout
    }: {
      currentResource: PatchResource
      onLayout?: () => void
    }) => {
      React.useLayoutEffect(() => {
        onLayout?.()
      }, [currentResource, onLayout])
      return <Component resource={currentResource} />
    }
    await act(async () => {
      root!.render(<Harness currentResource={initialResource} />)
    })

    const rerender = async (
      nextResource: PatchResource,
      onLayout?: () => void
    ) => {
      await act(async () => {
        root!.render(
          <Harness currentResource={nextResource} onLayout={onLayout} />
        )
      })
    }

    return { container: container!, rerender }
  }

  beforeEach(() => {
    fetchMock.kunFetchPost.mockReset()
    downloadCardMock.render.mockReset()
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

  it('auto-expands and restores only previously revealed mirrors', async () => {
    const resourceWithReveal = withLinks([
      {
        ...link21,
        obtained: true,
        obtainedExpiresAt: '2026-07-11T00:00:00.000Z',
        revealed: true
      },
      {
        ...link22,
        obtained: true,
        obtainedExpiresAt: '2026-07-11T00:00:00.000Z',
        revealed: false
      }
    ])
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      links: [sensitiveLink21],
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })

    const { container } = await renderResourceDownload(resourceWithReveal)
    await flushEffects()

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/download/access/restore',
      { patchId: 7, resourceId: 11, linkIds: [21] }
    )
    expect(container.textContent).toContain(sensitiveLink21.content)
    expect(container.textContent).not.toContain(sensitiveLink22.content)
    expect(
      container.querySelector('[data-testid="download-card-22"]')
    ).not.toBeNull()
  })

  it('stays collapsed and skips restore when no mirror was revealed', async () => {
    const { container } = await renderResourceDownload(
      withLinks([
        { ...link21, obtained: true, revealed: false },
        { ...link22, obtained: true }
      ])
    )
    await flushEffects()

    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid^="download-card-"]')
    ).toBeNull()
  })

  it('reuses one in-flight request when the normalized identity is unchanged', async () => {
    const request = deferred<{
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }>()
    fetchMock.kunFetchPost.mockReturnValueOnce(request.promise)
    const first = withLinks([{ ...link21, revealed: true }, link22])
    const { container, rerender } = await renderResourceDownload(first)

    await rerender(withLinks([{ ...link21, revealed: true }, { ...link22 }]))

    expect(fetchMock.kunFetchPost).toHaveBeenCalledTimes(1)
    request.resolve({
      links: [sensitiveLink21],
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })
    await flushEffects()
    expect(container.textContent).toContain(sensitiveLink21.content)
  })

  it('starts a new request for changed revealed IDs and ignores the old result', async () => {
    const oldRequest = deferred<{
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }>()
    const newRequest = deferred<{
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }>()
    fetchMock.kunFetchPost
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)
    const { container, rerender } = await renderResourceDownload(
      withLinks([{ ...link21, revealed: true }, link22])
    )

    await rerender(
      withLinks([
        { ...link22, revealed: true },
        { ...link21, revealed: true }
      ])
    )

    expect(fetchMock.kunFetchPost).toHaveBeenNthCalledWith(
      2,
      '/patch/resource/download/access/restore',
      { patchId: 7, resourceId: 11, linkIds: [21, 22] }
    )
    newRequest.resolve({
      links: [sensitiveLink22],
      obtainedExpiresAt: '2026-07-12T00:00:00.000Z'
    })
    await flushEffects()
    expect(container.textContent).toContain(sensitiveLink22.content)
    expect(container.textContent).not.toContain(sensitiveLink21.content)

    oldRequest.resolve({
      links: [sensitiveLink21],
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })
    await flushEffects()
    expect(container.textContent).toContain(sensitiveLink22.content)
    expect(container.textContent).not.toContain(sensitiveLink21.content)
  })

  it('never passes old restore output during the render before passive cleanup', async () => {
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      links: [sensitiveLink21],
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })
    const { container, rerender } = await renderResourceDownload(
      withLinks([{ ...link21, obtained: true, revealed: true }])
    )
    await flushEffects()
    expect(container.textContent).toContain(sensitiveLink21.content)

    downloadCardMock.render.mockClear()
    await rerender(withLinks([{ ...link21, obtained: true, revealed: false }]))

    const nextIdentityRenders = downloadCardMock.render.mock.calls.map(
      ([props]) =>
        props as {
          link: PatchResourceLink
          restoredLink?: PatchResourceAccessLink
        }
    )
    expect(nextIdentityRenders.length).toBeGreaterThan(0)
    expect(
      nextIdentityRenders.some(
        ({ link, restoredLink }) =>
          link.revealed === false &&
          restoredLink?.content === sensitiveLink21.content
      )
    ).toBe(false)
    expect(container.textContent).not.toContain(sensitiveLink21.content)
  })

  it('hides an old promise result completed in layout before passive cleanup', async () => {
    type RestoreResponse = {
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }
    let completeOldRequest: ((response: RestoreResponse) => void) | undefined
    const request = {
      then: (onFulfilled: (response: RestoreResponse) => void) => {
        completeOldRequest = onFulfilled
        return { catch: vi.fn() }
      }
    }
    fetchMock.kunFetchPost.mockReturnValueOnce(request)
    const { container, rerender } = await renderResourceDownload(
      withLinks([{ ...link21, obtained: true, revealed: true }])
    )
    expect(completeOldRequest).toBeTypeOf('function')

    downloadCardMock.render.mockClear()
    await rerender(
      withLinks([{ ...link21, obtained: true, revealed: false }]),
      () => {
        completeOldRequest?.({
          links: [sensitiveLink21],
          obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
        })
      }
    )

    const nextIdentityRenders = downloadCardMock.render.mock.calls.map(
      ([props]) =>
        props as {
          link: PatchResourceLink
          restoredLink?: PatchResourceAccessLink
        }
    )
    expect(
      nextIdentityRenders.some(
        ({ link, restoredLink }) =>
          link.revealed === false &&
          restoredLink?.content === sensitiveLink21.content
      )
    ).toBe(false)
    expect(container.textContent).not.toContain(sensitiveLink21.content)
  })

  it.each(['string', 'exception'] as const)(
    'shows one resource-level retry message after a restore %s',
    async (failureKind) => {
      if (failureKind === 'string') {
        fetchMock.kunFetchPost.mockResolvedValueOnce('恢复服务繁忙')
      } else {
        fetchMock.kunFetchPost.mockRejectedValueOnce(
          new Error('restore request failed')
        )
      }

      const { container } = await renderResourceDownload(
        withLinks([
          { ...link21, revealed: true },
          { ...link22, revealed: true }
        ])
      )
      await flushEffects()

      const alerts = container.querySelectorAll('[role="alert"]')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]?.textContent).toBe(
        '已获取链接恢复失败，可点击单条链接重试'
      )
      expect(
        container.querySelectorAll('[data-testid^="download-card-"]')
      ).toHaveLength(2)
      expect(container.textContent).toContain('查看已获取链接')
      expect(container.textContent).not.toContain(sensitiveLink21.content)
      expect(container.textContent).not.toContain(sensitiveLink22.content)
    }
  )

  it('uses patch and resource in the request identity and ignores a switched resource result', async () => {
    const oldRequest = deferred<{
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }>()
    const newRequest = deferred<{
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }>()
    fetchMock.kunFetchPost
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)
    const { container, rerender } = await renderResourceDownload(
      withLinks([{ ...link21, revealed: true }])
    )

    await rerender(
      withLinks([{ ...link21, revealed: true }], {
        id: 12,
        patchId: 8,
        name: '另一个资源'
      })
    )

    expect(fetchMock.kunFetchPost).toHaveBeenNthCalledWith(
      2,
      '/patch/resource/download/access/restore',
      { patchId: 8, resourceId: 12, linkIds: [21] }
    )
    oldRequest.resolve({
      links: [{ ...sensitiveLink21, content: 'https://old.example.com/link' }],
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })
    await flushEffects()
    expect(container.textContent).not.toContain('https://old.example.com/link')

    newRequest.resolve({
      links: [{ ...sensitiveLink21, content: 'https://new.example.com/link' }],
      obtainedExpiresAt: '2026-07-12T00:00:00.000Z'
    })
    await flushEffects()
    expect(container.textContent).toContain('https://new.example.com/link')
  })

  it('does not apply a restore result after unmount', async () => {
    const request = deferred<{
      links: PatchResourceAccessLink[]
      obtainedExpiresAt: string | null
    }>()
    fetchMock.kunFetchPost.mockReturnValueOnce(request.promise)
    const { container } = await renderResourceDownload(
      withLinks([{ ...link21, revealed: true }])
    )

    await act(async () => {
      root?.unmount()
    })
    root = undefined
    request.resolve({
      links: [sensitiveLink21],
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })
    await flushEffects()

    expect(container.textContent).toBe('')
  })
})
