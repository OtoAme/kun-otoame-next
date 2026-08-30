import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PatchImage } from '~/types/api/patch'
import type { PatchSubmissionPublishPreview } from '~/app/api/patch-submission/publishPreview'

globalThis.React = React

// HeroUI surfaces reference DOM globals at module scope; stub the primitives so
// the test isolates the projection logic instead of booting the whole library.
vi.mock('@heroui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

// The heavy children are exercised by their own tests; here we isolate the
// projection -> chips / placeholder / gallery-mapping logic.
const galleryMock = vi.hoisted(() => ({ images: [] as PatchImage[] }))
vi.mock('~/components/patch/gallery/Gallery', () => ({
  Gallery: ({ images }: { images: PatchImage[] }) => {
    galleryMock.images = images
    return <div data-testid="gallery" />
  }
}))
const infoMock = vi.hoisted(() => ({ intro: undefined as unknown }))
vi.mock('~/components/patch/introduction/Info', () => ({
  Info: ({ intro }: { intro: unknown }) => {
    infoMock.intro = intro
    return <div data-testid="info" />
  }
}))
vi.mock('~/components/patch/introduction/OfficialUrl', () => ({
  PatchOfficialUrl: ({ url }: { url: string }) =>
    url ? <div data-testid="official">{url}</div> : null
}))
vi.mock('~/components/patch/introduction/PatchIntroductionContent', () => ({
  PatchIntroductionContent: ({ html }: { html: string }) => (
    <div data-testid="intro-html">{html}</div>
  )
}))
vi.mock('@heroui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
// Record the lightbox index a click asks for and the images it was given,
// without booting the real viewer.
const lightboxMock = vi.hoisted(() => ({
  opened: [] as number[],
  images: [] as { src: string; alt: string }[]
}))
vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    images,
    children
  }: {
    images: { src: string; alt: string }[]
    children: (open: (index: number) => void) => React.ReactNode
  }) => {
    lightboxMock.images = images
    return (
      <div data-testid="banner-viewer">
        {children((index) => lightboxMock.opened.push(index))}
      </div>
    )
  }
}))

import { GALGAME_AGE_LIMIT_MAP } from '~/constants/galgame'
import { PatchSubmissionPreviewView } from '~/components/submission/PatchSubmissionPreviewView'

const basePreview = (
  overrides: Partial<PatchSubmissionPublishPreview> = {}
): PatchSubmissionPublishPreview => ({
  name: 'Collar x Malice',
  introduction: 'raw',
  introductionHtml: '<p>intro</p>',
  aliases: ['カラマリ'],
  tagNames: ['悬疑', '乙女'],
  companyNames: ['Idea Factory'],
  officialUrl: 'https://example.test',
  released: '2016-10-13',
  contentLimit: 'sfw',
  externalIds: {
    vndbId: 'v19',
    vndbRelationId: '',
    bangumiId: '',
    steamId: '',
    dlsiteCode: ''
  },
  bannerUrl: 'https://img.test/banner.avif',
  bannerOriginalUrl: 'https://img.test/banner-full.avif',
  gallery: [
    {
      id: 1,
      imageUrl: 'https://img.test/1.avif',
      thumbnailUrl: 'https://img.test/thumb-1.avif',
      isNSFW: false,
      displayOrder: 0
    },
    {
      id: 2,
      imageUrl: null,
      thumbnailUrl: null,
      isNSFW: false,
      displayOrder: 1
    }
  ],
  ...overrides
})

let dom: JSDOM
let root: Root | null = null

const render = async (preview: PatchSubmissionPublishPreview) => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost'
  })
  globalThis.document = dom.window.document
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  const container = dom.window.document.getElementById('root')!
  await act(async () => {
    root = createRoot(container)
    root.render(<PatchSubmissionPreviewView preview={preview} />)
  })
  return container
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
})

describe('PatchSubmissionPreviewView', () => {
  it('renders the title, introduction html and official url', async () => {
    const container = await render(basePreview())
    expect(container.querySelector('h1')?.textContent).toBe('Collar x Malice')
    expect(
      container.querySelector('[data-testid="intro-html"]')?.textContent
    ).toBe('<p>intro</p>')
    expect(
      container.querySelector('[data-testid="official"]')?.textContent
    ).toBe('https://example.test')
  })

  it('shows tag and company names as chips', async () => {
    const container = await render(basePreview())
    const text = container.textContent ?? ''
    expect(text).toContain('悬疑')
    expect(text).toContain('乙女')
    expect(text).toContain('Idea Factory')
  })

  it('shows a neutral explanation without exposing identity details when company review is needed', async () => {
    const container = await render(basePreview({ companyNeedsReview: true }))
    const text = container.textContent ?? ''
    expect(text).toContain('会社信息需管理员确认')
    expect(text).toContain('这不表示投稿内容填写错误')
    expect(text).not.toContain('company ID')
  })

  it('falls back to placeholders when there are no tags or companies', async () => {
    const container = await render(
      basePreview({ tagNames: [], companyNames: [] })
    )
    const text = container.textContent ?? ''
    expect(text).toContain('这个 OtomeGame 暂时没有标签')
    expect(text).toContain('这个 OtomeGame 本体暂未添加所属会社信息')
  })

  it('passes only gallery entries with a real image url, mapped to PatchImage', async () => {
    await render(basePreview())
    expect(galleryMock.images).toEqual([
      {
        id: 1,
        url: 'https://img.test/1.avif',
        thumbnailUrl: 'https://img.test/thumb-1.avif',
        isNSFW: false
      }
    ])
  })

  it('feeds the metadata block the external ids and aliases', async () => {
    await render(basePreview())
    expect(infoMock.intro).toMatchObject({
      vndbId: 'v19',
      alias: ['カラマリ'],
      released: '2016-10-13'
    })
  })

  it('shows the age-rating badge for the preview content limit', async () => {
    const sfw = await render(basePreview({ contentLimit: 'sfw' }))
    expect(sfw.textContent).toContain(GALGAME_AGE_LIMIT_MAP['sfw'])

    const nsfw = await render(basePreview({ contentLimit: 'nsfw' }))
    expect(nsfw.textContent).toContain(GALGAME_AGE_LIMIT_MAP['nsfw'])
  })

  it('opens the lightbox at the banner when the banner is clicked', async () => {
    lightboxMock.opened = []
    const container = await render(basePreview())
    const banner = container.querySelector(
      '[data-testid="banner-viewer"] div'
    ) as HTMLElement
    expect(banner).toBeTruthy()
    await act(async () => {
      banner.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
    expect(lightboxMock.opened).toEqual([0])
  })

  it('feeds the original banner to the lightbox, cropped banner to the box', async () => {
    await render(basePreview())
    expect(lightboxMock.images[0].src).toBe('https://img.test/banner-full.avif')

    await render(basePreview({ bannerOriginalUrl: null }))
    expect(lightboxMock.images[0].src).toBe('https://img.test/banner.avif')
  })
})
