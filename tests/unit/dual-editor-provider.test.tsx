import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

const editorMocks = vi.hoisted(() => ({
  codeMirrorChange: undefined as undefined | ((getCode: () => string) => void),
  saveMarkdown: undefined as undefined | ((value: string) => void)
}))

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockCodemirror(props: {
      markdown: string
      onChange: (getCode: () => string) => void
    }) {
      editorMocks.codeMirrorChange = props.onChange
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
  KunEditor: ({
    valueMarkdown,
    saveMarkdown
  }: {
    valueMarkdown: string
    saveMarkdown: (value: string) => void
  }) => {
    editorMocks.saveMarkdown = saveMarkdown
    return <div data-testid="milkdown-editor">{valueMarkdown}</div>
  }
}))

describe('KunDualEditorProvider', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    dom?.window.close()
    dom = undefined
    editorMocks.codeMirrorChange = undefined
    editorMocks.saveMarkdown = undefined
    vi.unstubAllGlobals()
  })

  it('renders the controlled value in both editors and reports both change paths', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunDualEditorProvider } = await import(
      '~/components/kun/milkdown/DualEditorProvider'
    )
    const onChange = vi.fn()
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)

    await act(async () => {
      root!.render(<KunDualEditorProvider value="第一行" onChange={onChange} />)
    })
    expect(container.textContent?.match(/第一行/g)).toHaveLength(2)

    await act(async () => {
      editorMocks.codeMirrorChange?.(() => '代码更新')
      editorMocks.saveMarkdown?.('所见即所得更新')
    })
    expect(onChange).toHaveBeenNthCalledWith(1, '代码更新')
    expect(onChange).toHaveBeenNthCalledWith(2, '所见即所得更新')

    await act(async () => {
      root!.render(
        <KunDualEditorProvider value="父组件更新" onChange={onChange} />
      )
    })
    expect(container.textContent?.match(/父组件更新/g)).toHaveLength(2)
  })
})
