'use client'

import { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { createRoot } from 'react-dom/client'
import DOMPurify from 'isomorphic-dompurify'
import dynamic from 'next/dynamic'
import { useMounted } from '~/hooks/useMounted'
import { KunLink } from '~/components/kun/milkdown/plugins/components/link/KunLink'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import {
  SAFE_MEDIA_PROTOCOLS,
  sanitizeUserHref,
  sanitizeUserUrl
} from '~/utils/safeUrl'

import './_adjust.scss'

const KunPlyr = dynamic(
  () =>
    import('~/components/kun/milkdown/plugins/components/video/Plyr').then(
      (mod) => mod.KunPlyr
    ),
  { ssr: false }
)

interface Props {
  /** Server-rendered introduction HTML (markdownToHtmlExtend output). */
  html: string
}

/**
 * Renders a patch introduction's HTML and hydrates its embedded links and video
 * players. Shared by the live detail page and the submission preview so the two
 * cannot drift: the same sanitize step, prose styling, and hydration run in
 * both. DOMPurify is applied immediately before injection.
 */
export const PatchIntroductionContent = ({ html }: Props) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const isMounted = useMounted()

  useEffect(() => {
    if (!contentRef.current || !isMounted) {
      return
    }

    const externalLinkElements = contentRef.current.querySelectorAll(
      '[data-kun-external-link]'
    )
    externalLinkElements.forEach((element) => {
      const text = element.getAttribute('data-text')
      const href = element.getAttribute('data-href')
      const safeHref = href ? sanitizeUserHref(href) : null
      if (!text || !safeHref) {
        return
      }
      const root = document.createElement('div')
      root.className = element.className
      element.replaceWith(root)
      const videoRoot = createRoot(root)
      videoRoot.render(
        <KunExternalLink link={safeHref}>{text}</KunExternalLink>
      )
    })

    const videoElements = contentRef.current.querySelectorAll(
      '[data-video-player]'
    )
    videoElements.forEach((element) => {
      const src = element.getAttribute('data-src')
      const safeSrc = src ? sanitizeUserUrl(src, SAFE_MEDIA_PROTOCOLS) : null
      if (!safeSrc) {
        return
      }
      const root = document.createElement('div')
      root.className = element.className
      element.replaceWith(root)
      const videoRoot = createRoot(root)
      videoRoot.render(<KunPlyr src={safeSrc} />)
    })

    const linkElements = contentRef.current.querySelectorAll('[data-kun-link]')
    linkElements.forEach((element) => {
      const href = element.getAttribute('data-href')
      const text = element.getAttribute('data-text')
      const safeHref = href ? sanitizeUserHref(href) : null
      if (!safeHref || !text) return

      const root = document.createElement('div')
      root.className = element.className
      element.replaceWith(root)

      const linkRoot = ReactDOM.createRoot(root)
      linkRoot.render(<KunLink href={safeHref} text={text} />)
    })
  }, [isMounted])

  return (
    <div
      ref={contentRef}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      className="kun-prose max-w-none"
    />
  )
}
