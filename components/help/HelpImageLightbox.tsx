'use client'

import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { KunControlledImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import type { KunImageViewerImage } from '~/components/kun/image-viewer/slides'

/**
 * Opens body images of a help post in the site's lightbox. Every image in
 * the post and its answers shares one gallery, so the viewer can step
 * through the whole thread. Rich content renders as HTML, hence the
 * delegated click handler instead of per-image components.
 */
export const HelpImageLightbox = ({
  rootRef,
  children
}: {
  rootRef: RefObject<HTMLElement | null>
  children: ReactNode
}) => {
  const [images, setImages] = useState<KunImageViewerImage[]>([])
  const [index, setIndex] = useState(-1)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const bodyImages = () =>
      Array.from(root.querySelectorAll<HTMLImageElement>('.kun-prose img'))
    const mark = () =>
      bodyImages().forEach((img) => {
        img.style.cursor = 'zoom-in'
      })
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(root, { childList: true, subtree: true })

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      if (!target.closest('.kun-prose')) return
      const all = bodyImages()
      const at = all.indexOf(target)
      if (at < 0) return
      event.preventDefault()
      setImages(
        all.map((img) => ({
          src: img.currentSrc || img.src,
          alt: img.alt || '',
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined
        }))
      )
      setIndex(at)
    }
    root.addEventListener('click', onClick)
    return () => {
      observer.disconnect()
      root.removeEventListener('click', onClick)
    }
  }, [rootRef])

  return (
    <>
      {children}
      <KunControlledImageViewer
        images={images}
        index={index}
        onClose={() => setIndex(-1)}
        onView={setIndex}
      />
    </>
  )
}
