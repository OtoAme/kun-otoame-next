import React, { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isIconOnly: _isIconOnly,
    isLoading: _isLoading,
    ...props
  }: {
    children?: React.ReactNode
    onPress?: () => void
    [key: string]: unknown
  }) => (
    <button type="button" onClick={onPress} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}))

const { KunMarkdownEditor } = await import(
  '~/components/kun/editor/MarkdownEditor'
)

let dom: JSDOM
let container: HTMLDivElement
let root: Root
let latestValue = ''

const Harness = ({
  onUploadImage,
  onUploadingChange
}: {
  onUploadImage?: (file: File) => Promise<{ url: string } | string>
  onUploadingChange?: (uploading: boolean) => void
}) => {
  const [value, setValue] = useState('')
  latestValue = value
  return (
    <KunMarkdownEditor
      value={value}
      onChange={setValue}
      onUploadImage={onUploadImage}
      onUploadingChange={onUploadingChange}
    />
  )
}

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const dropFiles = async (target: Element, files: File[]) => {
  const dataTransfer = {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file
    })),
    types: ['Files'],
    dropEffect: 'none'
  }
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = new dom.window.Event(type, {
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    await act(async () => {
      target.dispatchEvent(event)
    })
  }
  await flush()
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/'
  })
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator
  })
  globalThis.HTMLElement = dom.window.HTMLElement
  // React's IE input polyfill probes these when the DOM arrives after react-dom.
  for (const name of ['attachEvent', 'detachEvent']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      configurable: true,
      value: vi.fn()
    })
  }
  globalThis.File = dom.window.File
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  latestValue = ''
})

afterEach(() => {
  act(() => root.unmount())
  dom.window.close()
})

describe('KunMarkdownEditor image upload', () => {
  it('uploads dropped images and inserts them as markdown', async () => {
    const upload = vi.fn(async (file: File) => ({
      url: `https://img.example.com/${file.name}`
    }))
    await act(async () => {
      root.render(<Harness onUploadImage={upload} />)
    })

    expect(container.textContent).toContain('拖动图片到这里，或点击选择图片')
    const file = new dom.window.File(['x'], 'shot.png', { type: 'image/png' })
    await dropFiles(container.querySelector('.kun-editor')!, [file])

    expect(upload).toHaveBeenCalledTimes(1)
    expect(latestValue).toContain('![图片](https://img.example.com/shot.png)')
  })

  it('uploads images chosen through the file input', async () => {
    const upload = vi.fn(async () => ({ url: 'https://img.example.com/a.webp' }))
    await act(async () => {
      root.render(<Harness onUploadImage={upload} />)
    })

    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]'
    )!
    expect(input.getAttribute('accept')).toContain('image/avif')
    const file = new dom.window.File(['x'], 'a.webp', { type: 'image/webp' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await flush()

    expect(upload).toHaveBeenCalledTimes(1)
    expect(latestValue).toContain('![图片](https://img.example.com/a.webp)')
  })

  it('rejects files that are not allowed images', async () => {
    const upload = vi.fn()
    await act(async () => {
      root.render(<Harness onUploadImage={upload} />)
    })

    const file = new dom.window.File(['x'], 'notes.txt', { type: 'text/plain' })
    await dropFiles(container.querySelector('.kun-editor')!, [file])

    expect(upload).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '只能上传 JPG、PNG、WebP、AVIF 图片'
    )
  })

  it('reports upload state and refuses a second batch while uploading', async () => {
    let finish: (value: { url: string }) => void = () => undefined
    const upload = vi.fn(
      () =>
        new Promise<{ url: string }>((resolve) => {
          finish = resolve
        })
    )
    const states: boolean[] = []
    await act(async () => {
      root.render(
        <Harness
          onUploadImage={upload}
          onUploadingChange={(value) => states.push(value)}
        />
      )
    })

    const editor = container.querySelector('.kun-editor')!
    const first = new dom.window.File(['x'], 'one.png', { type: 'image/png' })
    await dropFiles(editor, [first])
    expect(states).toEqual([true])
    expect(container.textContent).toContain('图片上传中')

    // A drop during the upload is still captured by the editor, so the
    // browser does not navigate to the image, but it is not uploaded.
    const second = new dom.window.File(['y'], 'two.png', { type: 'image/png' })
    await dropFiles(editor, [second])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '上一批图片还在上传'
    )

    await act(async () => {
      finish({ url: 'https://img.example.com/one.png' })
    })
    await flush()
    expect(states).toEqual([true, false])
    expect(latestValue).toContain('![图片](https://img.example.com/one.png)')
    expect(latestValue).not.toContain('two.png')
  })

  it('shows no upload area or file input without an upload handler', async () => {
    await act(async () => {
      root.render(<Harness />)
    })

    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.textContent).not.toContain('拖动图片到这里')
  })
})
