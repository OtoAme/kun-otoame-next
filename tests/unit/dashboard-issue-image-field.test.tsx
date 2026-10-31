import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
// The lightbox has its own coverage; record which image a click opens.
vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    images,
    children
  }: {
    images: { src: string }[]
    children: (open: (index: number) => void) => React.ReactNode
  }) => <>{children((index) => mocks.open(images[index].src))}</>
}))

import {
  IssueImageField,
  imagePasteHandler
} from '~/components/dashboard/issue/IssueImageField'
import { CaseConversation } from '~/components/dashboard/case/CaseConversation'
import type { CaseMessage } from '~/types/api/case'

type Uploads = Parameters<typeof IssueImageField>[0]['uploads']

const uploadsStub = (overrides: Partial<Uploads> = {}): Uploads => ({
  images: [],
  keys: [],
  uploading: false,
  error: '',
  full: false,
  add: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
  reset: vi.fn(),
  ...overrides
})

describe('console image field', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/case'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const file = (name: string, type: string) =>
    new dom.window.File(['x'], name, { type }) as unknown as File
  const fileList = (files: File[]) => files as unknown as FileList
  const dispatch = async (
    target: Element,
    type: string,
    init: Record<string, unknown>
  ) => {
    const event = new dom.window.Event(type, {
      bubbles: true,
      cancelable: true
    })
    Object.assign(event, init)
    await act(async () => {
      target.dispatchEvent(event)
    })
    return event
  }
  const zone = () => container.querySelector('[data-image-drop]')!

  it('uploads dropped images and ignores other files', async () => {
    const uploads = uploadsStub()
    await act(async () => root.render(<IssueImageField uploads={uploads} />))
    const png = file('a.png', 'image/png')
    await dispatch(zone(), 'drop', {
      dataTransfer: { files: fileList([png, file('a.txt', 'text/plain')]) }
    })
    expect(uploads.add).toHaveBeenCalledWith([png])
  })

  it('uploads a pasted image and leaves a text paste alone', async () => {
    const uploads = uploadsStub()
    await act(async () => root.render(<IssueImageField uploads={uploads} />))
    const shot = file('shot.png', 'image/png')
    const pasted = await dispatch(zone(), 'paste', {
      clipboardData: { files: fileList([shot]) }
    })
    expect(uploads.add).toHaveBeenCalledWith([shot])
    expect(pasted.defaultPrevented).toBe(true)

    const text = await dispatch(zone(), 'paste', {
      clipboardData: { files: fileList([]) }
    })
    expect(uploads.add).toHaveBeenCalledTimes(1)
    expect(text.defaultPrevented).toBe(false)
  })

  it('takes no more images once the limit is reached', async () => {
    const uploads = uploadsStub({ full: true })
    await act(async () => root.render(<IssueImageField uploads={uploads} />))
    await dispatch(zone(), 'drop', {
      dataTransfer: { files: fileList([file('a.png', 'image/png')]) }
    })
    expect(uploads.add).not.toHaveBeenCalled()
    expect(zone().getAttribute('aria-disabled')).toBe('true')
    expect(container.textContent).toContain('已添加 3 张图片')
  })

  it('lets the reply box take a pasted screenshot', () => {
    const uploads = uploadsStub()
    const shot = file('shot.webp', 'image/webp')
    const preventDefault = vi.fn()
    imagePasteHandler(uploads)({
      clipboardData: { files: fileList([shot]) },
      preventDefault
    } as never)
    expect(uploads.add).toHaveBeenCalledWith([shot])
    expect(preventDefault).toHaveBeenCalled()
    // A text paste into the box is untouched.
    const textPrevent = vi.fn()
    imagePasteHandler(uploads)({
      clipboardData: { files: fileList([]) },
      preventDefault: textPrevent
    } as never)
    expect(textPrevent).not.toHaveBeenCalled()
  })

  it('opens message images in the lightbox and keeps the new-tab link', async () => {
    const message = {
      id: 1,
      kind: 'reply',
      event: null,
      body: '截图如下',
      created: '2026-10-29T00:00:00.000Z',
      author: { id: 7, name: '报告者', avatar: '' },
      images: ['/case/a.png', '/case/b.png']
    } as unknown as CaseMessage
    await act(async () =>
      root.render(<CaseConversation messages={[message]} reporterId={7} />)
    )
    const links = [
      ...container.querySelectorAll('a[aria-label^="放大查看附图"]')
    ]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/case/a.png',
      '/case/b.png'
    ])
    await act(async () => {
      ;(links[1] as HTMLAnchorElement).click()
    })
    expect(mocks.open).toHaveBeenCalledWith('/case/b.png')
  })
})
