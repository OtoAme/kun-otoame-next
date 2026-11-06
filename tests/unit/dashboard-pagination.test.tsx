// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

import { DashboardPagination } from '~/components/dashboard/page/DashboardPagination'

describe('DashboardPagination', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const renderPager = async (
    props: Partial<React.ComponentProps<typeof DashboardPagination>> = {}
  ) => {
    const onPageChange = props.onPageChange ?? vi.fn()
    await act(async () => {
      root.render(
        <DashboardPagination
          page={1}
          totalPages={5}
          total={120}
          unit="条"
          onPageChange={onPageChange}
          {...props}
        />
      )
    })
    return {
      onPageChange,
      nav: () => dom.window.document.querySelector('[data-page-nav]'),
      input: () =>
        dom.window.document.querySelector<HTMLInputElement>(
          '[aria-label="页码"]'
        )!,
      prev: () =>
        dom.window.document.querySelector<HTMLButtonElement>(
          '[aria-label="上一页"]'
        )!,
      next: () =>
        dom.window.document.querySelector<HTMLButtonElement>(
          '[aria-label="下一页"]'
        )!
    }
  }

  const typePage = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  it('keeps previous, page input and next in one non-wrapping group', async () => {
    const ui = await renderPager()
    const nav = ui.nav()
    expect(nav).not.toBeNull()
    expect(nav?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'shrink-0', 'flex-nowrap'])
    )
    expect(nav?.contains(ui.prev())).toBe(true)
    expect(nav?.contains(ui.input())).toBe(true)
    expect(nav?.contains(ui.next())).toBe(true)
    expect(ui.prev().disabled).toBe(true)
    expect(ui.next().disabled).toBe(false)
  })

  it('jumps to a typed page on Enter and clamps out of range values', async () => {
    const ui = await renderPager()
    await typePage(ui.input(), '3')
    await act(async () => {
      ui.input().dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true
        })
      )
    })
    expect(ui.onPageChange).toHaveBeenCalledWith(3)

    await typePage(ui.input(), '99')
    await act(async () => {
      ui.input().dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true
        })
      )
    })
    expect(ui.onPageChange).toHaveBeenCalledWith(5)
  })

  it('reverts invalid input on blur and does not notify the same page', async () => {
    const ui = await renderPager({ page: 2 })
    await typePage(ui.input(), 'abc')
    await act(async () => {
      ui.input().blur()
    })
    expect(ui.input().value).toBe('2')
    expect(ui.onPageChange).not.toHaveBeenCalled()

    await typePage(ui.input(), '2')
    await act(async () => {
      ui.input().dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true
        })
      )
    })
    expect(ui.onPageChange).not.toHaveBeenCalled()
  })
})
