'use client'

import { useEffect, useRef } from 'react'

interface Props {
  uniqueId: string
  currentView: number
  onViewed?: () => void
}

export const PatchViewBeacon = ({ uniqueId, currentView, onViewed }: Props) => {
  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current) {
      return
    }
    sentRef.current = true

    const payload = { uniqueId, currentView }
    void fetch('/api/patch/views', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'kun-fetch'
      },
      body: JSON.stringify(payload),
      keepalive: true
    })
      .then((response) => {
        if (response.ok) {
          onViewed?.()
        }
      })
      .catch((error) => {
        console.error('Failed to record patch view:', error)
      })
  }, [currentView, onViewed, uniqueId])

  return null
}
