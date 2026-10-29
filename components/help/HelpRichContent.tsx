'use client'

import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import DOMPurify from 'isomorphic-dompurify'
import { useMounted } from '~/hooks/useMounted'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import { sanitizeUserHref } from '~/utils/safeUrl'
import { cn } from '~/utils/cn'

/** Server-rendered markdown HTML, with the comment area's link handling. */
/**
 * `answer` shows body images as small inline thumbnails so answers stay
 * compact; the lightbox opens the full image. Posts keep the larger preview.
 */
export const HelpRichContent = ({
  html,
  variant = 'post'
}: {
  html: string
  variant?: 'post' | 'answer'
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useMounted()

  useEffect(() => {
    if (!ref.current || !mounted) return
    ref.current
      .querySelectorAll('[data-kun-external-link]')
      .forEach((element) => {
        const text = element.getAttribute('data-text')
        const href = element.getAttribute('data-href')
        const safeHref = href ? sanitizeUserHref(href) : null
        if (!text || !safeHref) return
        const root = document.createElement('span')
        root.className = element.className
        element.replaceWith(root)
        createRoot(root).render(
          <KunExternalLink link={safeHref}>{text}</KunExternalLink>
        )
      })
  }, [html, mounted])

  return (
    <div
      ref={ref}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      className={cn(
        'kun-prose kun-comment-content max-w-none break-words',
        // The renderer already turns each line break into <br>; the shared
        // pre-line rule would draw every break around an image twice.
        '[&_p]:!whitespace-normal [&_img]:!my-2',
        variant === 'answer' &&
          '[&_img]:!mr-2 [&_img]:!inline-block [&_img]:!h-28 [&_img]:!max-h-28 [&_img]:!w-auto [&_img]:!max-w-48 [&_img]:!object-cover [&_img]:align-top'
      )}
    />
  )
}
