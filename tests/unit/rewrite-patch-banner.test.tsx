import React, { act } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchFormData: fetchMock }))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toastMock }))

vi.mock('~/utils/resizeImage', () => ({
  compressDataURLToWebp: vi.fn(async () => new Blob(['original']))
}))

vi.mock('~/components/kun/cropper/KunImageCropper', () => ({
  KunImageCropper: ({
    onImageComplete
  }: {
    onImageComplete?: (croppedImage: string) => void
  }) => (
    <button
      type="button"
      onClick={() => onImageComplete?.('data:image/webp;base64,QUJD')}
    >
      选择封面
    </button>
  )
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isLoading?: boolean
  }) => (
    <button type="button" disabled={isLoading} onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/modal', () => ({
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

import { RewritePatchBanner } from '~/components/edit/rewrite/RewritePatchBanner'

describe('RewritePatchBanner update feedback', () => {
  let dom: JSDOM
  let root: Root
  let onClose: Mock<() => void>
  let originalCreateObjectURL: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/patch/7'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    originalCreateObjectURL = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL'
    )
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => 'blob:preview'
    })

    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const click = async (text: string) => {
    const button = [...dom.window.document.querySelectorAll('button')].find(
      (item) => item.textContent === text
    )
    expect(button, `${text} should be rendered`).toBeDefined()
    await act(async () => {
      button?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const submitBanner = async () => {
    await act(async () => {
      root.render(<RewritePatchBanner patchId={7} onClose={onClose} />)
    })
    await click('选择封面')
    await click('更改')
  }

  it('keeps the dialog open and stays silent about success on a business error', async () => {
    fetchMock.mockResolvedValueOnce('本页面仅管理员可访问')

    await submitBanner()

    expect(toastMock.error).toHaveBeenCalledWith('本页面仅管理员可访问')
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a retryable error when the request never lands', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    await submitBanner()

    expect(toastMock.error).toHaveBeenCalledWith(
      '更新图片失败, 请检查网络后重试'
    )
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('confirms and closes only once the update actually succeeded', async () => {
    fetchMock.mockResolvedValueOnce({})

    await submitBanner()

    expect(toastMock.success).toHaveBeenCalledWith('更新图片成功')
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
