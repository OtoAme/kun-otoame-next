import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PixelCrop } from 'react-image-crop'

globalThis.React = React

const createCroppedImageMock = vi.hoisted(() =>
  vi.fn(
    async (
      _image: HTMLImageElement,
      _crop: PixelCrop,
      _scale?: number,
      _rotate?: number
    ) => 'data:image/webp;base64,Y3JvcHBlZA=='
  )
)

vi.mock('~/components/kun/cropper/utils', async () => {
  const actual = await vi.importActual<
    typeof import('~/components/kun/cropper/utils')
  >('~/components/kun/cropper/utils')
  return { ...actual, createCroppedImage: createCroppedImageMock }
})

vi.mock('react-image-crop', async () => {
  const actual =
    await vi.importActual<typeof import('react-image-crop')>('react-image-crop')
  return {
    ...actual,
    default: ({ children }: { children?: React.ReactNode }) => <>{children}</>
  }
})

vi.mock('@heroui/react', () => ({
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
  Slider: ({ label }: { label?: string }) => <div aria-label={label} />,
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
  )
}))

import { KunImageCropperModal } from '~/components/kun/cropper/KunImageCropperModal'

describe('KunImageCropperModal crop geometry', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/edit/create'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const render = async (imgSrc: string) => {
    await act(async () => {
      root.render(
        <KunImageCropperModal
          isOpen={true}
          imgSrc={imgSrc}
          onOpenMosaic={() => {}}
          onClose={() => {}}
        />
      )
    })
  }

  const confirmButton = () =>
    [...dom.window.document.querySelectorAll('button')].find(
      (button) => button.textContent === '裁剪图片'
    )

  const loadImage = async (layout: number, natural: number) => {
    const image =
      dom.window.document.querySelector<HTMLImageElement>('img[alt="Crop me"]')
    expect(image).not.toBeNull()
    for (const [property, value] of [
      ['width', layout],
      ['height', Math.round((layout * 9) / 16)],
      ['naturalWidth', natural],
      ['naturalHeight', Math.round((natural * 9) / 16)]
    ] as const) {
      Object.defineProperty(image, property, {
        configurable: true,
        value
      })
    }
    await act(async () => {
      image?.dispatchEvent(new dom.window.Event('load'))
    })
  }

  const loadSquareImage = async (layout: number) => {
    const image =
      dom.window.document.querySelector<HTMLImageElement>('img[alt="Crop me"]')
    for (const property of ['width', 'height'] as const) {
      Object.defineProperty(image, property, {
        configurable: true,
        value: layout
      })
    }
    await act(async () => {
      image?.dispatchEvent(new dom.window.Event('load'))
    })
  }

  const confirm = async () => {
    const button = confirmButton()
    expect(button?.disabled).toBe(false)
    await act(async () => {
      button?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const lastPixelCrop = () => createCroppedImageMock.mock.calls.at(-1)?.[1]

  it('crops the whole frame when the image already matches the aspect ratio', async () => {
    await render('data:image/webp;base64,YQ==')
    await loadImage(800, 1600)
    await confirm()

    expect(createCroppedImageMock).toHaveBeenCalledTimes(1)
    expect(lastPixelCrop()).toEqual({
      unit: 'px',
      x: 0,
      y: 0,
      width: 800,
      height: 450
    })
  })

  it('crops the centered aspect band of an image that does not match', async () => {
    await render('data:image/webp;base64,Yg==')
    await loadSquareImage(800)
    await confirm()

    expect(lastPixelCrop()).toEqual({
      unit: 'px',
      x: 0,
      y: 175,
      width: 800,
      height: 450
    })
  })

  it('measures a replacement image instead of reusing the previous crop', async () => {
    await render('data:image/webp;base64,YQ==')
    await loadImage(800, 1600)
    await confirm()

    await render('data:image/webp;base64,Yw==')
    expect(confirmButton()?.disabled).toBe(true)
    await loadImage(400, 800)
    await confirm()

    expect(createCroppedImageMock).toHaveBeenCalledTimes(2)
    expect(lastPixelCrop()).toEqual({
      unit: 'px',
      x: 0,
      y: 0,
      width: 400,
      height: 225
    })
  })

  it('refuses to crop before the image has reported its layout size', async () => {
    await render('data:image/webp;base64,YQ==')

    expect(confirmButton()?.disabled).toBe(true)
    expect(createCroppedImageMock).not.toHaveBeenCalled()
  })
})
