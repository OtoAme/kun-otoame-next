import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import toast from 'react-hot-toast'
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
    onPress,
    isLoading,
    isDisabled,
    disabled,
    startContent
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isLoading?: boolean
    isDisabled?: boolean
    disabled?: boolean
    startContent?: React.ReactNode
  }) => (
    <button
      type="button"
      disabled={isDisabled || disabled || isLoading}
      onClick={onPress}
    >
      {startContent}
      {isLoading ? '加载中' : children}
    </button>
  )
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({
    children,
    startContent
  }: {
    children?: React.ReactNode
    startContent?: React.ReactNode
  }) => (
    <span>
      {startContent}
      {children}
    </span>
  )
}))

vi.mock('@heroui/snippet', () => ({
  Snippet: ({
    children,
    symbol
  }: {
    children?: React.ReactNode
    symbol?: React.ReactNode
  }) => (
    <span>
      {symbol}
      {children}
    </span>
  )
}))

vi.mock('~/components/kun/external-link/ExternalLink', () => ({
  KunExternalLink: ({
    children,
    link,
    onPress
  }: {
    children?: React.ReactNode
    link: string
    onPress?: () => void
  }) => (
    <a
      href={link}
      onClick={(event) => {
        event.preventDefault()
        onPress?.()
      }}
    >
      {children}
    </a>
  )
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const previewLink: PatchResourceLink = {
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
  links: [previewLink],
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

describe('ResourceDownloadCard access flow', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderCard = async ({
    resourceValue = resource,
    link = previewLink,
    restoredLink,
    restoredObtainedExpiresAt
  }: {
    resourceValue?: PatchResource
    link?: PatchResourceLink
    restoredLink?: PatchResourceAccessLink
    restoredObtainedExpiresAt?: string
  } = {}) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <ResourceDownloadCard
          resource={resourceValue}
          link={link}
          restoredLink={restoredLink}
          restoredObtainedExpiresAt={restoredObtainedExpiresAt}
        />
      )
    })

    return { container: container! }
  }

  beforeEach(() => {
    fetchMock.kunFetchPost.mockReset()
    fetchMock.kunFetchPut.mockReset()
    vi.mocked(toast.error).mockClear()
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

  it('fetches and displays a sensitive link only after the user requests it', async () => {
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'secret',
        hash: ''
      },
      access: {
        kind: 'resource_granted',
        actorType: 'visitor',
        cost: 0,
        obtainedExpiresAt: '2026-07-09T00:00:00.000Z'
      }
    })

    const { container } = await renderCard()

    expect(container.textContent).toContain('获取下载链接')
    expect(container.textContent).not.toContain('https://pan.example.com/share')

    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    await act(async () => {
      button!.click()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/download/access',
      { patchId: 7, resourceId: 11, linkId: 21 }
    )
    expect(container.textContent).toContain('https://pan.example.com/share')
    expect(container.textContent).toContain('提取码')
    expect(container.textContent).toContain('abcd')
    expect(container.textContent).toContain('解压码')
    expect(container.textContent).toContain('secret')
  })

  it('uses the revealed state for links reusable within the resource grant', async () => {
    const obtainedLink: PatchResourceLink = {
      ...previewLink,
      obtained: true,
      obtainedExpiresAt: '2026-07-09T00:00:00.000Z',
      revealed: true
    }
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: '',
        password: '',
        hash: ''
      },
      access: {
        kind: 'reused',
        actorType: 'visitor',
        cost: 0,
        obtainedExpiresAt: '2026-07-09T00:00:00.000Z'
      }
    })

    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    const { container } = await renderCard()

    await act(async () => {
      root!.render(
        <ResourceDownloadCard resource={resource} link={obtainedLink} />
      )
    })

    expect(container.textContent).toContain('查看已获取链接')
    expect(container.textContent).toContain('授权有效期内')
    expect(container.textContent).not.toContain('72 小时')
    expect(container.textContent).not.toContain('https://pan.example.com/share')

    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    await act(async () => {
      button!.click()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/download/access',
      { patchId: 7, resourceId: 11, linkId: 21 }
    )
    expect(container.textContent).toContain('https://pan.example.com/share')
  })

  it('shows a user-visible error when access fails', async () => {
    fetchMock.kunFetchPost.mockResolvedValueOnce('该资源不可访问')

    const { container } = await renderCard()
    const button = container.querySelector('button')
    expect(button).not.toBeNull()

    await act(async () => {
      button!.click()
    })

    expect(toast.error).toHaveBeenCalledWith('该资源不可访问')
    expect(container.textContent).toContain('该资源不可访问')
  })

  it('keeps the obtain action for an unrevealed mirror in an active resource grant', async () => {
    const obtainedButUnrevealed: PatchResourceLink = {
      ...previewLink,
      obtained: true,
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z',
      revealed: false
    }

    const { container } = await renderCard({
      link: obtainedButUnrevealed
    })

    expect(container.textContent).toContain('获取下载链接')
    expect(container.textContent).not.toContain('查看已获取链接')
    expect(container.textContent).toContain('授权有效期内')
    expect(container.textContent).not.toContain('72 小时')
  })

  it('keeps a single-link retry action when a revealed mirror was not restored', async () => {
    const revealedLink: PatchResourceLink = {
      ...previewLink,
      obtained: true,
      obtainedExpiresAt: '2026-07-11T00:00:00.000Z',
      revealed: true
    }

    const { container } = await renderCard({ link: revealedLink })

    expect(container.textContent).toContain('查看已获取链接')
    expect(container.textContent).not.toContain(
      'https://pan.example.com/restored'
    )
  })

  it('hydrates a matching restored mirror without another manual request', async () => {
    const restoredLink: PatchResourceAccessLink = {
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/restored',
      code: 'restore-code',
      password: 'restore-password',
      hash: ''
    }

    const { container } = await renderCard({
      link: { ...previewLink, obtained: true, revealed: true },
      restoredLink,
      restoredObtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain(restoredLink.content)
    expect(container.textContent).toContain('restore-code')
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
  })

  it('ignores a restored mirror with a different link ID', async () => {
    const mismatchedLink: PatchResourceAccessLink = {
      id: 22,
      storage: 'user',
      size: '3 GB',
      content: 'https://pan.example.com/wrong-link',
      code: 'wrong-code',
      password: 'wrong-password',
      hash: ''
    }

    const { container } = await renderCard({
      link: { ...previewLink, obtained: true, revealed: true },
      restoredLink: mismatchedLink,
      restoredObtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain(mismatchedLink.content)
    expect(container.textContent).toContain('查看已获取链接')
  })

  it('clears restore-derived sensitive fields when a new restore omits the mirror', async () => {
    const restoredLink: PatchResourceAccessLink = {
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/stale-restored-link',
      code: 'stale-code',
      password: 'stale-password',
      hash: ''
    }
    const revealedLink = { ...previewLink, obtained: true, revealed: true }
    const { container } = await renderCard({
      link: revealedLink,
      restoredLink,
      restoredObtainedExpiresAt: '2026-07-11T00:00:00.000Z'
    })
    expect(container.textContent).toContain(restoredLink.content)

    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    await act(async () => {
      root!.render(
        <ResourceDownloadCard resource={resource} link={revealedLink} />
      )
    })

    expect(container.textContent).not.toContain(restoredLink.content)
    expect(container.textContent).not.toContain('stale-code')
    expect(container.textContent).toContain('查看已获取链接')
  })

  it('keeps a manual access result after a restore prop is later removed', async () => {
    const manualLink: PatchResourceAccessLink = {
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/manual-link',
      code: 'manual-code',
      password: 'manual-password',
      hash: ''
    }
    const restoredLink: PatchResourceAccessLink = {
      ...manualLink,
      content: 'https://pan.example.com/restore-shadow'
    }
    const revealedLink = { ...previewLink, obtained: true, revealed: true }
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      link: manualLink,
      access: {
        kind: 'reused',
        actorType: 'visitor',
        cost: 0,
        obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
      }
    })
    const { container } = await renderCard({ link: revealedLink })
    await act(async () => {
      container.querySelector('button')!.click()
    })
    expect(container.textContent).toContain(manualLink.content)

    const { ResourceDownloadCard } = await import(
      '~/components/patch/resource/DownloadCard'
    )
    await act(async () => {
      root!.render(
        <ResourceDownloadCard
          resource={resource}
          link={revealedLink}
          restoredLink={restoredLink}
          restoredObtainedExpiresAt="2026-07-11T00:00:00.000Z"
        />
      )
    })
    await act(async () => {
      root!.render(
        <ResourceDownloadCard resource={resource} link={revealedLink} />
      )
    })

    expect(container.textContent).toContain(manualLink.content)
    expect(container.textContent).toContain('manual-code')
    expect(container.textContent).not.toContain(restoredLink.content)
  })
})
