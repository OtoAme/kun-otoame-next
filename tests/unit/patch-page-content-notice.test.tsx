import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pageData: vi.fn(),
  identity: vi.fn(),
  nsfwHeader: vi.fn(),
  metadata: vi.fn(),
  header: vi.fn()
}))

vi.mock('~/app/(site)/[id]/actions', () => ({
  kunGetPatchPageDataActions: mocks.pageData
}))
vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.identity
}))
vi.mock('~/utils/actions/getNSFWHeader', () => ({
  getNSFWHeader: mocks.nsfwHeader
}))
vi.mock('~/app/(site)/[id]/metadata', () => ({
  generateKunMetadataTemplate: mocks.metadata
}))
vi.mock('~/components/patch/header/Container', () => ({
  PatchHeaderContainer: mocks.header
}))
vi.mock('~/components/error/ErrorComponent', () => ({
  ErrorComponent: ({ error }: { error: string }) => (
    <div role="alert">{error}</div>
  )
}))
vi.mock('~/components/kun/BreadcrumbTitle', () => ({
  KunBreadcrumbTitle: ({ title }: { title: string }) => <h1>{title}</h1>
}))
vi.mock('next/image', () => ({
  default: ({
    priority: _priority,
    ...props
  }: React.ComponentProps<'img'> & {
    priority?: boolean
  }) => <img {...props} alt={props.alt} />
}))

import Page, { generateMetadata } from '~/app/(site)/[id]/page'

const params = () => Promise.resolve({ id: 'AbCd1234' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('React', React)
  mocks.identity.mockResolvedValue({ uid: 7 })
  mocks.nsfwHeader.mockResolvedValue({ content_limit: 'sfw' })
  mocks.pageData.mockResolvedValue({ blockedBy: 'content-preference' })
  mocks.header.mockReturnValue(<p>visible content</p>)
})

afterEach(() => vi.unstubAllGlobals())

describe('patch content preference notice', () => {
  it.each([
    { uid: 7, mode: 'sfw', message: '请在右上角菜单开启 NSFW 内容显示后查看' },
    { uid: null, mode: 'sfw', message: '请登录后查看' },
    { uid: 7, mode: 'nsfw', message: '请在右上角菜单开启 SFW 内容显示后查看' }
  ])(
    'shows the appropriate notice for user $uid in $mode mode',
    async ({ uid, mode, message }) => {
      mocks.identity.mockResolvedValue(uid ? { uid } : null)
      mocks.nsfwHeader.mockResolvedValue({ content_limit: mode })

      const html = renderToStaticMarkup(await Page({ params: params() }))

      expect(html).toContain(message)
      expect(html).not.toContain('role="alert"')
      expect(mocks.header).not.toHaveBeenCalled()
    }
  )

  it('keeps blocked page metadata empty and excluded from indexing', async () => {
    const metadata = await generateMetadata({ params: params() })

    expect(metadata).toMatchObject({
      title: '',
      description: null,
      openGraph: null,
      twitter: null,
      robots: { index: false, follow: false }
    })
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it('renders content after the server permits the saved preference', async () => {
    const blocked = renderToStaticMarkup(await Page({ params: params() }))
    expect(blocked).toContain('开启 NSFW')

    mocks.nsfwHeader.mockResolvedValue({})
    mocks.pageData.mockResolvedValue({
      patch: {
        name: 'allowed title',
        alias: [],
        platform: [],
        uniqueId: 'AbCd1234',
        contentLimit: 'nsfw'
      },
      intro: { introduction: 'allowed body' }
    })
    const allowed = renderToStaticMarkup(await Page({ params: params() }))

    expect(allowed).toContain('visible content')
    expect(allowed).toContain('allowed title')
    expect(allowed).not.toContain('开启 NSFW')
  })

  it('preserves other content errors', async () => {
    mocks.pageData.mockResolvedValue('当前内容不可见')
    const html = renderToStaticMarkup(await Page({ params: params() }))

    expect(html).toContain('role="alert"')
    expect(html).toContain('当前内容不可见')
    expect(mocks.header).not.toHaveBeenCalled()
  })
})
