import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockCodemirror(props: { markdown: string }) {
      return <div data-testid="codemirror">{props.markdown}</div>
    }
}))

vi.mock('@heroui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tab: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  )
}))

vi.mock('~/components/kun/milkdown/Editor', () => ({
  KunEditor: ({ valueMarkdown }: { valueMarkdown: string }) => (
    <div data-testid="milkdown-editor">{valueMarkdown}</div>
  )
}))

describe('KunDualEditorProvider', () => {
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

  it('rerenders create introduction preview when the store introduction changes', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('localStorage', dom.window.localStorage)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunDualEditorProvider } = await import(
      '~/components/kun/milkdown/DualEditorProvider'
    )
    const { initialCreatePatchData, useCreatePatchStore } = await import(
      '~/store/editStore'
    )

    useCreatePatchStore.setState({
      data: {
        ...initialCreatePatchData,
        introduction: '第一行'
      }
    })

    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunDualEditorProvider storeName="patchCreate" />)
    })

    expect(container!.textContent).toContain('第一行')

    await act(async () => {
      useCreatePatchStore.getState().setData((current) => ({
        ...current,
        introduction: '第一行\n第二行'
      }))
    })
    await act(async () => {})

    expect(container!.textContent).toContain('第二行')
  })

  it('rerenders rewrite introduction preview when the store introduction changes', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('localStorage', dom.window.localStorage)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunDualEditorProvider } = await import(
      '~/components/kun/milkdown/DualEditorProvider'
    )
    const { useRewritePatchStore } = await import('~/store/rewriteStore')

    useRewritePatchStore.setState({
      data: {
        ...useRewritePatchStore.getState().data,
        introduction: '旧简介'
      }
    })

    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunDualEditorProvider storeName="patchRewrite" />)
    })

    expect(container!.textContent).toContain('旧简介')

    await act(async () => {
      useRewritePatchStore.getState().setData((current) => ({
        ...current,
        introduction: '新简介\n第二行'
      }))
    })
    await act(async () => {})

    expect(container!.textContent).toContain('第二行')
  })
})
