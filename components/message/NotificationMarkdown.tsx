import { createElement, Fragment, memo, type ReactNode } from 'react'
import Link from 'next/link'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeSanitize from 'rehype-sanitize'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import { sanitizeUserUrl } from '~/utils/safeUrl'

const inlineTags = ['a', 'em', 'strong', 'del', 'code', 'br']
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype, {
    handlers: {
      image: (_, image) => ({ type: 'text', value: image.alt ?? '' })
    }
  })

const processor = (tagNames: string[]) =>
  parser()
    .use(rehypeSanitize, {
      tagNames,
      attributes: { a: ['href'] },
      protocols: { href: ['http', 'https'] }
    })
    .freeze()

const inline = processor(inlineTags)
const block = processor([
  ...inlineTags,
  'p',
  'pre',
  'blockquote',
  'ol',
  'ul',
  'li',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td'
])
type ContentNode = ReturnType<typeof block.runSync>['children'][number]

function renderNode(node: ContentNode, key: number): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null
  const children = node.children.map(renderNode)
  if (node.tagName === 'br' || node.tagName === 'hr')
    return createElement(node.tagName, { key })
  if (node.tagName !== 'a')
    return createElement(node.tagName, { key }, children)

  const href =
    typeof node.properties.href === 'string'
      ? sanitizeUserUrl(node.properties.href, ['http:', 'https:'])
      : null
  if (!href || href.includes('\\') || href.startsWith('//'))
    return <Fragment key={key}>{children}</Fragment>
  if (/^https?:\/\//i.test(href))
    return (
      <KunExternalLink key={key} link={href} showAnchorIcon={false}>
        {children}
      </KunExternalLink>
    )
  return (
    <Link key={key} href={href} prefetch={false}>
      {children}
    </Link>
  )
}

export const NotificationMarkdown = memo(function NotificationMarkdown({
  text,
  inlineOnly = false
}: {
  text: string
  inlineOnly?: boolean
}) {
  const markdown = inlineOnly ? inline : block
  const children = markdown
    .runSync(markdown.parse(text))
    .children.map(renderNode)
  return inlineOnly ? (
    <span className="kun-prose">{children}</span>
  ) : (
    <div className="kun-prose max-w-full whitespace-normal [&>p]:my-0 [&>p+p]:mt-2 [&_pre]:whitespace-pre-wrap [&_pre_code]:whitespace-pre-wrap [&_table]:table-fixed">
      {children}
    </div>
  )
})
