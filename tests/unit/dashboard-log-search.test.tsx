import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams()
}))
vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/log',
  useSearchParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push, replace: mocks.push })
}))
vi.mock('next/link', () => ({
  default: ({
    prefetch: _p,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean }) => <a {...props} />
}))
// Plain input so typing can be driven without Radix internals.
vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLInputElement>}
    />
  )
}))

import { DashboardLogs } from '~/components/dashboard/log/DashboardLogs'

describe('management log search box', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.params = new URLSearchParams()
    mocks.get.mockResolvedValue({ logs: [], total: 0 })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/log'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    vi.stubGlobal('HTMLFormElement', dom.window.HTMLFormElement)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const type = async (value: string) => {
    const box = container.querySelector(
      'input[aria-label="搜索日志内容"]'
    ) as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value'
      )!.set!.call(box, value)
      box.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    return box
  }

  it('holds an email search below role 4 and says why', async () => {
    await act(async () => root.render(<DashboardLogs viewerRole={3} />))
    const box = await type('kuro@example.com')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain(
      '只有超级管理员可以按邮箱搜索管理日志'
    )
    expect(box.getAttribute('placeholder')).toContain('不能按邮箱搜索')
  })

  it('runs other searches below role 4', async () => {
    await act(async () => root.render(<DashboardLogs viewerRole={3} />))
    await type('七海')
    expect(mocks.push).toHaveBeenCalled()
    expect(String(mocks.push.mock.calls.at(-1)![0])).toContain('search=')
  })

  it('lets role 4 search by email', async () => {
    await act(async () => root.render(<DashboardLogs viewerRole={4} />))
    const box = await type('kuro@example.com')
    expect(mocks.push).toHaveBeenCalled()
    expect(box.getAttribute('aria-invalid')).toBeNull()
  })
})
