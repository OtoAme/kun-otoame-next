import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    isDisabled,
    isIconOnly: _isIconOnly,
    isLoading,
    onPress,
    ...props
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isIconOnly?: boolean
    isLoading?: boolean
    onPress?: () => void
    [key: string]: unknown
  }) => (
    <button
      type="button"
      disabled={isDisabled || isLoading}
      onClick={onPress}
      {...props}
    >
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    onKeyDown,
    onBlur,
    ...props
  }: {
    value?: string
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
    onBlur?: React.FocusEventHandler<HTMLInputElement>
    [key: string]: unknown
  }) => (
    <input
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      {...props}
    />
  )
}))

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="chevron-left" />,
  ChevronRight: () => <span data-testid="chevron-right" />
}))

describe('KunPagination', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderPagination = async (
    props: React.ComponentProps<
      (typeof import('~/components/kun/Pagination'))['KunPagination']
    >
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    Object.defineProperty(dom.window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true })
    })
    Object.defineProperty(dom.window, 'scrollTo', {
      configurable: true,
      value: vi.fn()
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunPagination } = await import('~/components/kun/Pagination')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunPagination {...props} />)
    })

    return container!
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('scrolls to the top as soon as the page changes', async () => {
    const onPageChange = vi.fn()
    const container = await renderPagination({
      total: 3,
      page: 1,
      onPageChange
    })

    const buttons = container.querySelectorAll('button')
    const nextButton = buttons[buttons.length - 1]

    await act(async () => {
      nextButton.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(onPageChange).toHaveBeenCalledWith(2)
    expect(dom!.window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'auto'
    })
  })

  it('honors disableScrollToTop while still changing pages', async () => {
    const onPageChange = vi.fn()
    const container = await renderPagination({
      total: 3,
      page: 1,
      onPageChange,
      disableScrollToTop: true
    })

    const buttons = container.querySelectorAll('button')
    const nextButton = buttons[buttons.length - 1]

    await act(async () => {
      nextButton.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(onPageChange).toHaveBeenCalledWith(2)
    expect(dom!.window.scrollTo).not.toHaveBeenCalled()
  })
})
