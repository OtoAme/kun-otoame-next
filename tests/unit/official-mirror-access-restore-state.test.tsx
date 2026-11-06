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
  clear: undefined as ((linkId: number) => void) | undefined,
  restored: undefined as string | undefined
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('@heroui/react', () => ({
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
  isOpenAccessDeadline: (value?: string) =>
    Boolean(value) && Date.parse(value!) > Date.now(),
  ResourceDownloadCard: ({
    restoredLink,
    onCredentialsCleared
  }: {
    restoredLink?: PatchResourceAccessLink
    onCredentialsCleared?: (linkId: number) => void
  }) => {
    cardMock.clear = onCredentialsCleared
    cardMock.restored = restoredLink?.content
    return (
      <div>
        <span>{restoredLink?.content ?? ''}</span>
        <span>{restoredLink?.password ?? ''}</span>
        <button type="button" onClick={() => onCredentialsCleared?.(21)}>
          到期
        </button>
      </div>
    )
  }
}))

const link: PatchResourceLink = {
  id: 21,
  storage: 'user',
  size: '1 GB',
  hash: '',
  sortOrder: 0,
  download: 0,
  revealed: true
}

const resource: PatchResource = {
  id: 11,
  name: '资源',
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

const sensitive = {
  id: 21,
  storage: 'user',
  size: '1 GB',
  content: 'https://pan.example.test/held',
  code: 'code',
  password: 'held-pass',
  hash: ''
}

describe('official mirror restore credential state', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const mount = async (node: React.ReactNode) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
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

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchPost.mockReset()
    cardMock.clear = undefined
    cardMock.restored = undefined
  })

  it('does not keep an already expired restore payload in parent state', async () => {
    fetchMock.kunFetchPost.mockResolvedValue({
      links: [
        {
          ...sensitive,
          revealedExpiresAt: '2020-01-01T00:00:00.000Z'
        }
      ],
      obtainedExpiresAt: '2099-01-01T00:00:00.000Z'
    })
    const { ResourceDownload } = await import(
      '~/components/patch/resource/ResourceDownload'
    )
    const container = await mount(<ResourceDownload resource={resource} />)
    expect(container.textContent).not.toContain('https://pan.example.test/held')
    expect(container.textContent).not.toContain('held-pass')
    expect(cardMock.restored).toBeUndefined()
  })

  it('deletes restored credentials from parent state when the link expires', async () => {
    fetchMock.kunFetchPost.mockResolvedValue({
      links: [
        {
          ...sensitive,
          revealedExpiresAt: '2099-01-01T00:00:00.000Z'
        }
      ],
      obtainedExpiresAt: '2099-01-01T00:00:00.000Z'
    })
    const { ResourceDownload } = await import(
      '~/components/patch/resource/ResourceDownload'
    )
    const container = await mount(<ResourceDownload resource={resource} />)
    expect(container.textContent).toContain('https://pan.example.test/held')
    expect(container.textContent).toContain('held-pass')

    await act(async () => {
      cardMock.clear?.(21)
    })

    expect(container.textContent).not.toContain('https://pan.example.test/held')
    expect(container.textContent).not.toContain('held-pass')
    expect(cardMock.restored).toBeUndefined()
  })
})
