import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  axiosPost: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const workspaceUser = vi.hoisted(() => ({
  id: 8,
  name: '作者',
  role: 2
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost
}))
vi.mock('axios', () => ({
  default: { post: mocks.axiosPost }
}))
vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/components/dashboard/ui/dialog', () => ({
  Dialog: ({
    open,
    children
  }: {
    open?: boolean
    children?: React.ReactNode
  }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

import { WorkspaceResourceUpload } from '~/components/dashboard/workspace/WorkspaceResourceUpload'
import { WorkspaceUserProvider } from '~/components/dashboard/workspace/WorkspaceShell'

describe('workspace resource upload isolation', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    workspaceUser.role = 2
    mocks.kunFetchGet.mockResolvedValue({
      images: [
        { id: 'img-1', data: 'data:image/gif;base64,AAAA', isWhiteHair: true }
      ],
      sessionId: 'captcha-session'
    })
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
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources/9'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    const uploaded = vi.fn()
    const activity: boolean[] = []
    await act(async () => {
      root!.render(
        <WorkspaceUserProvider user={{ ...workspaceUser }}>
          <WorkspaceResourceUpload
            onUploaded={uploaded}
            onUploadingChange={(active) => activity.push(active)}
          />
        </WorkspaceUserProvider>
      )
    })
    return { container, uploaded, activity }
  }

  const choose = async (container: HTMLElement, name = 'game.zip') => {
    const file = new File(['abc'], name, { type: 'application/zip' })
    const input = container.querySelector(
      'input[aria-label="上传资源文件"]'
    ) as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      input.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    await act(async () => {})
    return file
  }

  it('does not upload when captcha verification returns after cancel', async () => {
    let resolveVerify: ((value: unknown) => void) | undefined
    mocks.kunFetchPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve
        })
    )
    const { container, uploaded, activity } = await mount()
    await choose(container)
    expect(activity.at(-1)).toBe(true)
    const dialog = dom!.window.document.querySelector('[role="dialog"]')!
    const tile = dialog.querySelector('canvas')?.parentElement as HTMLElement
    await act(async () => {
      tile.click()
    })
    await act(async () => {
      ;[...dialog.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('确定'))!
        .click()
    })
    await act(async () => {
      ;[...dialog.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('取消'))!
        .click()
    })
    resolveVerify?.({ code: 'late-code' })
    await act(async () => {})
    await act(async () => {})
    expect(mocks.axiosPost).not.toHaveBeenCalled()
    expect(uploaded).not.toHaveBeenCalled()
    expect(container.textContent).toContain('game.zip')
    expect(activity.at(-1)).toBe(false)
  })

  it('ignores an upload response that arrives after the slot unmounts', async () => {
    workspaceUser.role = 3
    let resolveUpload: ((value: unknown) => void) | undefined
    mocks.axiosPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    const { container, uploaded } = await mount()
    await choose(container)
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    resolveUpload?.({
      data: {
        filetype: 's3',
        uploadId: 'up-late',
        fileHash: 'abc',
        fileSize: '1MB'
      }
    })
    await act(async () => {})
    expect(uploaded).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('文件已上传')
  })
})
