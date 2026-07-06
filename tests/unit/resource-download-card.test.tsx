import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import toast from 'react-hot-toast'
import type { PatchResource, PatchResourceLink } from '~/types/api/patch'

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

  const renderCard = async () => {
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
        <ResourceDownloadCard resource={resource} link={previewLink} />
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
})
