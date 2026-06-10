import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remarkHardBreaks } from '~/components/kun/milkdown/plugins/components/remarkHardBreaks'

describe('milkdown markdown line breaks', () => {
  let dom: JSDOM | undefined
  let editor: Editor | undefined

  afterEach(async () => {
    if (editor?.status === 'Created') {
      await editor.destroy(true)
    }
    editor = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  it('renders a single markdown newline as a hard break in edit previews', async () => {
    dom = new JSDOM('<!doctype html><main id="root"></main>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Node', dom.window.Node)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    vi.stubGlobal('Event', dom.window.Event)
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent)
    vi.stubGlobal(
      'addEventListener',
      dom.window.addEventListener.bind(dom.window)
    )
    vi.stubGlobal(
      'removeEventListener',
      dom.window.removeEventListener.bind(dom.window)
    )
    vi.stubGlobal('dispatchEvent', dom.window.dispatchEvent.bind(dom.window))

    const root = dom.window.document.getElementById('root')
    expect(root).not.toBeNull()

    const localEditor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, '第一行\n第二行')
      })
      .use(remarkHardBreaks)
      .use(commonmark)

    editor = await localEditor.create()

    const view = editor.ctx.get(editorViewCtx)
    expect(view.dom.querySelector('br[data-type="hardbreak"]')).not.toBeNull()
  })
})
