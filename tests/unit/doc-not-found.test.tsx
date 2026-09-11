import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPostBySlug: vi.fn(),
  getAllPosts: vi.fn(),
  getAdjacentPosts: vi.fn(),
  generateMetadata: vi.fn(),
  notFound: vi.fn(),
  missing: Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), {
    digest: 'NEXT_HTTP_ERROR_FALLBACK;404'
  })
}))

vi.mock('~/lib/mdx/getPosts', () => ({
  getPostBySlug: mocks.getPostBySlug,
  getAllPosts: mocks.getAllPosts,
  getAdjacentPosts: mocks.getAdjacentPosts
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('~/app/(site)/doc/[...slug]/metadata', () => ({
  generateKunMetadataTemplate: mocks.generateMetadata
}))
vi.mock('~/lib/mdx/CustomMDX', () => ({
  CustomMDX: ({ source }: { source: string }) => <div>{source}</div>
}))
vi.mock('~/components/doc/TableOfContents', () => ({
  TableOfContents: () => null
}))
vi.mock('~/components/doc/Navigation', () => ({
  KunBottomNavigation: () => null
}))
vi.mock('~/components/doc/BlogHeader', () => ({ BlogHeader: () => null }))
vi.mock('~/components/kun/BreadcrumbTitle', () => ({
  KunBreadcrumbTitle: () => null
}))

import Page, { generateMetadata } from '~/app/(site)/doc/[...slug]/page'

const params = () => Promise.resolve({ slug: ['m01-missing', 'nested'] })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('React', React)
  mocks.notFound.mockImplementation(() => {
    throw mocks.missing
  })
  mocks.getAdjacentPosts.mockReturnValue({ prev: null, next: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each([
  { name: 'page', read: () => Page({ params: params() }) },
  { name: 'metadata', read: () => generateMetadata({ params: params() }) }
])('nested document $name', ({ read }) => {
  it('uses the Next.js 404 boundary when the requested MDX file does not exist', async () => {
    mocks.getPostBySlug.mockImplementation(() => {
      throw Object.assign(new Error('missing document'), { code: 'ENOENT' })
    })

    await expect(read()).rejects.toBe(mocks.missing)
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.getPostBySlug).toHaveBeenCalledWith('m01-missing/nested')
    expect(mocks.getAdjacentPosts).not.toHaveBeenCalled()
    expect(mocks.generateMetadata).not.toHaveBeenCalled()
  })

  it.each([
    Object.assign(new Error('document read denied'), { code: 'EACCES' }),
    new SyntaxError('invalid frontmatter')
  ])('preserves errors other than a missing file: %s', async (error) => {
    mocks.getPostBySlug.mockImplementation(() => {
      throw error
    })

    await expect(read()).rejects.toBe(error)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})

describe('existing documents', () => {
  const blog = {
    slug: 'notice/start',
    content: '原有文档正文',
    frontmatter: { title: '网站说明' }
  }

  it('still renders the requested document and its adjacent navigation', async () => {
    mocks.getPostBySlug.mockReturnValue(blog)
    const page = await Page({
      params: Promise.resolve({ slug: ['notice', 'start'] })
    })

    expect(renderToStaticMarkup(page)).toContain('原有文档正文')
    expect(mocks.getAdjacentPosts).toHaveBeenCalledWith('notice/start')
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('still builds metadata from the loaded document', async () => {
    mocks.getPostBySlug.mockReturnValue(blog)
    const metadata = { title: '网站说明' }
    mocks.generateMetadata.mockReturnValue(metadata)

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: ['notice', 'start'] })
      })
    ).resolves.toEqual(metadata)
    expect(mocks.generateMetadata).toHaveBeenCalledWith(blog)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
