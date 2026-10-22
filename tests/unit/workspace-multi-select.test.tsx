import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

import { WorkspaceMultiSelect } from '~/components/dashboard/workspace/WorkspaceMultiSelect'

describe('workspace multi-select touch', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources/9'
    })
    const element = dom.window.Element.prototype
    if (!element.hasPointerCapture) {
      element.hasPointerCapture = () => false
      element.setPointerCapture = () => {}
      element.releasePointerCapture = () => {}
    }
    dom.window.HTMLElement.prototype.scrollIntoView = () => {}
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async () => {
    const { createRoot } = await import('react-dom/client')
    const container = dom!.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceMultiSelect
          label="平台"
          triggerLabel="资源平台"
          options={[
            { value: 'windows', label: 'Windows' },
            { value: 'android', label: 'Android' }
          ]}
          selected={['windows']}
          onChange={() => {}}
        />
      )
    })
    return container
  }

  const trigger = (container: HTMLElement) =>
    container.querySelector('[aria-label="资源平台"]') as HTMLButtonElement

  const pointer = (type: string, pointerType: string, y: number) => {
    const EventTarget = dom!.window.PointerEvent ?? dom!.window.MouseEvent
    return new EventTarget(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 8,
      clientY: y,
      pointerId: 1,
      pointerType
    })
  }

  it('keeps the menu closed while a touch scrolls across the trigger', async () => {
    const container = await mount()
    const button = trigger(container)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      button.dispatchEvent(pointer('pointerdown', 'touch', 20))
      button.dispatchEvent(pointer('pointermove', 'touch', 48))
      button.dispatchEvent(pointer('pointerup', 'touch', 48))
    })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(dom!.window.document.querySelector('[role="menu"]')).toBeNull()
  })

  it('opens on a touch tap', async () => {
    const container = await mount()
    const button = trigger(container)
    await act(async () => {
      button.dispatchEvent(pointer('pointerdown', 'touch', 20))
      button.dispatchEvent(pointer('pointerup', 'touch', 22))
    })
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('passes id, invalid state, and description through the menu button', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = dom!.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceMultiSelect
          id="workspace-resource-type"
          label="类型"
          triggerLabel="资源类型"
          required
          aria-invalid
          aria-describedby="type-error"
          options={[{ value: 'pc', label: '电脑' }]}
          selected={['pc']}
          onChange={() => {}}
        />
      )
    })
    const button = container.querySelector(
      '#workspace-resource-type'
    ) as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('资源类型')
    expect(button.getAttribute('aria-invalid')).toBe('true')
    expect(button.hasAttribute('aria-required')).toBe(false)
    const describedBy = button.getAttribute('aria-describedby') ?? ''
    const [requiredId, errorId] = describedBy.split(' ')
    expect(errorId).toBe('type-error')
    expect(container.querySelector(`#${requiredId}`)?.textContent).toContain(
      '必填'
    )
    button.focus()
    expect(dom!.window.document.activeElement).toBe(button)
  })

  it('clears only a saved value that is missing from the menu', async () => {
    const onChange = vi.fn()
    const { createRoot } = await import('react-dom/client')
    const container = dom!.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceMultiSelect
          label="平台"
          triggerLabel="资源平台"
          options={[
            { value: 'windows', label: 'Windows' },
            { value: 'android', label: 'Android' }
          ]}
          selected={['windows', 'legacy-platform']}
          onChange={onChange}
        />
      )
    })
    expect(container.textContent).toContain('Windows')
    expect(container.textContent).not.toContain('legacy-platform')
    const clear = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('移除不再支持的选项')
    ) as HTMLButtonElement
    expect(clear.disabled).toBe(false)
    await act(async () => {
      clear.click()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['windows'])
  })

  it('does not clear unsupported values while the control is disabled', async () => {
    const onChange = vi.fn()
    const { createRoot } = await import('react-dom/client')
    const container = dom!.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceMultiSelect
          label="平台"
          triggerLabel="资源平台"
          disabled
          options={[
            { value: 'windows', label: 'Windows' },
            { value: 'android', label: 'Android' }
          ]}
          selected={['windows', 'legacy-platform']}
          onChange={onChange}
        />
      )
    })
    const clear = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('移除不再支持的选项')
    ) as HTMLButtonElement
    expect(clear.disabled).toBe(true)
    await act(async () => {
      clear.click()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(
      [...container.querySelectorAll('button')].filter((item) =>
        item.textContent?.includes('移除不再支持的选项')
      )
    ).toHaveLength(1)
  })

  it('opens on a mouse press', async () => {
    const container = await mount()
    const button = trigger(container)
    await act(async () => {
      button.dispatchEvent(pointer('pointerdown', 'mouse', 20))
    })
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})
