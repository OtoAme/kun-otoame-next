import {
  getAdjacentPosts,
  getAllPosts,
  getPostBySlug
} from '~/lib/mdx/getPosts'
import { CustomMDX } from '~/lib/mdx/CustomMDX'
import { TableOfContents } from '~/components/doc/TableOfContents'
import { KunBottomNavigation } from '~/components/doc/Navigation'
import { generateKunMetadataTemplate } from './metadata'
import { BlogHeader } from '~/components/doc/BlogHeader'
import { KunBreadcrumbTitle } from '~/components/kun/BreadcrumbTitle'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{
    slug: string[]
  }>
}

const getPostOrNotFound = (slug: string) => {
  try {
    return getPostBySlug(slug)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      notFound()
    }
    throw error
  }
}

export const generateStaticParams = async () => {
  const posts = getAllPosts()
  return posts.map((post) => ({
    slug: post.slug.split('/')
  }))
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { slug } = await params
  const url = slug.join('/')
  const blog = getPostOrNotFound(url)
  return generateKunMetadataTemplate(blog)
}

export default async function Kun({ params }: Props) {
  const { slug } = await params
  const url = slug.join('/')
  const { content, frontmatter } = getPostOrNotFound(url)
  const { prev, next } = getAdjacentPosts(url)

  return (
    <div className="flex w-full">
      <KunBreadcrumbTitle routeKey={`/doc/${url}`} title={frontmatter.title} />
      <div className="w-full lg:w-[calc(100%-16rem)] px-3 sm:px-6">
        <BlogHeader frontmatter={frontmatter} />
        <article className="kun-prose">
          <CustomMDX source={content} />
        </article>
        <KunBottomNavigation prev={prev} next={next} />
      </div>

      <div>
        <TableOfContents />
      </div>
    </div>
  )
}
