'use client'

import { useState } from 'react'
import { cn } from '~/lib/dashboard/utils'

const FALLBACK_BANNER = '/otoame.avif'

/**
 * Banner thumbnail with the site-wide mini.avif convention: a stored avif
 * banner resolves to its `-mini.avif` variant, and empty or failed loads fall
 * back to the site placeholder.
 */
export function WorkspaceBanner({
  banner,
  alt,
  className
}: {
  banner: string | null | undefined
  alt: string
  className?: string
}) {
  const source = banner ? banner.replace(/\.avif$/, '-mini.avif') : ''
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const failed = Boolean(source) && failedSource === source
  const src = source && !failed ? source : FALLBACK_BANNER
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (!source || src === FALLBACK_BANNER) return
        setFailedSource(source)
      }}
      className={cn('size-full rounded-lg object-cover', className)}
    />
  )
}
