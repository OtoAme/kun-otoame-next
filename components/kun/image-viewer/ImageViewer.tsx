'use client'

import { useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'
import type { ReactNode } from 'react'
import { lightboxConfig } from './config'

interface Props {
  images: {
    src: string
    alt: string
    width?: number
    height?: number
  }[]
  children: (openLightbox: (index: number) => void) => ReactNode
}

export const KunImageViewer = ({ images, children }: Props) => {
  const [index, setIndex] = useState(-1)
  const lightboxImages = images.map(({ src, width, height }) => ({
    src,
    width,
    height
  }))

  const openLightbox = (index: number) => setIndex(index)
  const closeLightbox = () => setIndex(-1)

  return (
    <>
      {children(openLightbox)}
      <Lightbox
        index={index}
        slides={lightboxImages}
        open={index >= 0}
        close={closeLightbox}
        on={{
          click: closeLightbox
        }}
        {...lightboxConfig}
      />
    </>
  )
}
