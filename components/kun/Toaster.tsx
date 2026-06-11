'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Toaster } from 'react-hot-toast'
import type { ToasterProps } from 'react-hot-toast'

export const KUN_TOASTER_Z_INDEX = 10000

export const KUN_TOASTER_CONTAINER_STYLE = {
  zIndex: KUN_TOASTER_Z_INDEX
} satisfies ToasterProps['containerStyle']

export const KunToaster = () => {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setContainer(document.body)
  }, [])

  if (!container) {
    return null
  }

  return createPortal(
    <Toaster containerStyle={KUN_TOASTER_CONTAINER_STYLE} />,
    container
  )
}
