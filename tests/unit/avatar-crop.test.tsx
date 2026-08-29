import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { Crop } from 'react-image-crop'

globalThis.React = React

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchFormData: fetchMock }))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toastMock }))

const userState = vi.hoisted(() => ({
  user: { uid: 3, name: 'Mio', avatar: '' },
  setUser: vi.fn()
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) =>
    selector(userState)
}))

vi.mock('lucide-react', () => ({ Camera: () => <span /> }))

const cropProps = vi.hoisted(() => ({
  current: null as { onChange?: (pixel: Crop, percent: Crop) => void } | null
}))

vi.mock('react-image-crop', async () => {
  const actual =
    await vi.importActual<typeof import('react-image-crop')>('react-image-crop')
  return {
    ...actual,
    default: (props: {
      children?: React.ReactNode
      onChange?: (pixel: Crop, percent: Crop) => void
    }) => {
      cropProps.current = props
      return <>{props.children}</>
    }
  }
})

vi.mock('@heroui/react', () => ({
  Avatar: () => <span />,
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button type="button" disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
  ),
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false)
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false)
    }
  }
}))

import { AvatarCrop } from '~/components/settings/user/AvatarCrop'

class StubFileReader {
  result: string | null = null
  private listeners: (() => void)[] = []

  addEventListener(type: string, listener: () => void) {
    if (type === 'load') {
      this.listeners.push(listener)
    }
  }

  readAsDataURL() {
    this.result = 'data:image/png;base64,QUJD'
    for (const listener of this.listeners) {
      listener()
    }
  }
}

describe('AvatarCrop percentage crop', () => {
  let dom: JSDOM
  let root: Root
  let drawImage: ReturnType<typeof vi.fn>
  let canvas: { width: number; height: number }

  beforeEach(() => {
    vi.clearAllMocks()
    cropProps.current = null
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/settings/user'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('FileReader', StubFileReader)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    drawImage = vi.fn()
    canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: () => 'data:image/webp;base64,QUJD'
    } as unknown as { width: number; height: number }

    const createElement = dom.window.document.createElement.bind(
      dom.window.document
    )
    vi.spyOn(dom.window.document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions
    ) =>
      tagName === 'canvas'
        ? canvas
        : createElement(tagName, options)) as typeof createElement)

    root = createRoot(dom.window.document.getElementById('root')!)
    fetchMock.mockResolvedValue({ avatar: 'https://img.test/avatar.webp' })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const confirmButton = () =>
    [...dom.window.document.querySelectorAll('button')].find(
      (item) => item.textContent === '确定'
    )

  const openCropper = async (layoutSize: number, { load = true } = {}) => {
    await act(async () => {
      root.render(<AvatarCrop />)
    })

    const input = dom.window.document.querySelector<HTMLInputElement>(
      'input#avatar-upload'
    )
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new dom.window.File(['x'], 'avatar.png', { type: 'image/png' })]
    })
    await act(async () => {
      input?.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })

    const image =
      dom.window.document.querySelector<HTMLImageElement>('img[alt="Upload"]')
    expect(image).not.toBeNull()
    for (const [property, value] of [
      ['width', layoutSize],
      ['height', layoutSize],
      ['naturalWidth', layoutSize * 2],
      ['naturalHeight', layoutSize * 2]
    ] as const) {
      Object.defineProperty(image, property, { configurable: true, value })
    }
    if (load) {
      await act(async () => {
        image?.dispatchEvent(new dom.window.Event('load'))
      })
    }
    return image
  }

  const confirm = async () => {
    const button = confirmButton()
    expect(button).toBeDefined()
    await act(async () => {
      button?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('reads the untouched 50% selection as half the image, not 50 pixels', async () => {
    await openCropper(400)
    await confirm()

    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
    expect(drawImage.mock.calls[0].slice(1)).toEqual([
      200, 200, 400, 400, 0, 0, 200, 200
    ])
  })

  it('refuses to confirm before the image has been laid out', async () => {
    // Until the load event the layout box is 0, so the crop would convert to an
    // empty canvas.
    const image = await openCropper(400, { load: false })
    expect(confirmButton()?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      image?.dispatchEvent(new dom.window.Event('load'))
    })

    expect(confirmButton()?.hasAttribute('disabled')).toBe(false)
  })

  it('re-derives the crop from percentages after the user drags it', async () => {
    await openCropper(400)

    await act(async () => {
      cropProps.current?.onChange?.(
        { unit: 'px', x: 32, y: 32, width: 96, height: 96 },
        { unit: '%', x: 10, y: 10, width: 30, height: 30 }
      )
    })
    await confirm()

    expect(canvas.width).toBe(120)
    expect(canvas.height).toBe(120)
    expect(drawImage.mock.calls[0].slice(1)).toEqual([
      80, 80, 240, 240, 0, 0, 120, 120
    ])
  })
})
