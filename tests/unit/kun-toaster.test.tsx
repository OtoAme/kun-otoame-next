import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

vi.mock('react-hot-toast', () => ({
  Toaster: ({
    containerStyle
  }: {
    containerStyle?: React.CSSProperties
  }) => (
    <div
      data-testid="kun-toaster"
      data-z-index={String(containerStyle?.zIndex)}
    />
  )
}))

describe('KunToaster', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  it('renders toast notifications in the document body above modal overlays', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunToaster } = await import('~/components/kun/Toaster')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunToaster />)
    })
    await act(async () => {})

    const toaster = dom.window.document.querySelector(
      '[data-testid="kun-toaster"]'
    )
    expect(toaster?.parentElement).toBe(dom.window.document.body)
    expect(Number(toaster?.getAttribute('data-z-index'))).toBeGreaterThan(50)
  })
})
