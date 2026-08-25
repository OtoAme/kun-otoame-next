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
    expect(container.querySelector('[data-testid="intro-html"]')?.textContent).toBe(
      '<p>intro</p>'
    )
    expect(container.querySelector('[data-testid="official"]')?.textContent).toBe(
      'https://example.test'
    )
  })

  it('shows tag and company names as chips', async () => {
    const container = await render(basePreview())
    const text = container.textContent ?? ''
    expect(text).toContain('悬疑')
    expect(text).toContain('乙女')
    expect(text).toContain('Idea Factory')
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
})
