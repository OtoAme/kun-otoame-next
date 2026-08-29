import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PixelCrop } from 'react-image-crop'
import {
  centerAspectCrop,
  createCroppedImage
} from '~/components/kun/cropper/utils'

describe('centerAspectCrop', () => {
  it('uses the largest centered crop that fits the requested aspect ratio', () => {
    const squareCrop = centerAspectCrop(1000, 1000, 16 / 9)
    expect(squareCrop.width).toBe(100)
    expect(squareCrop.height).toBe(56.25)
    expect(squareCrop.x).toBe(0)
    expect(squareCrop.y).toBe(21.875)

    const tallCrop = centerAspectCrop(900, 1600, 16 / 9)
    expect(tallCrop.width).toBe(100)
    expect(tallCrop.height).toBe(31.640625)
    expect(tallCrop.x).toBe(0)
    expect(tallCrop.y).toBe(34.1796875)

    const wideCrop = centerAspectCrop(1000, 400, 16 / 9)
    expect(wideCrop.width).toBeCloseTo(71.11111111111111)
    expect(wideCrop.height).toBe(100)
    expect(wideCrop.x).toBeCloseTo(14.444444444444446)
    expect(wideCrop.y).toBe(0)
  })
})

describe('createCroppedImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubCanvas = () => {
    const translates: number[][] = []
    const ctx = {
      imageSmoothingQuality: 'low',
      save: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      translate: (x: number, y: number) => {
        translates.push([x, y])
      }
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => 'data:image/webp;base64,Y3JvcHBlZA=='
    }

    vi.stubGlobal('document', { createElement: () => canvas })
    // The canvas used to be inflated by the device pixel ratio, which only grew
    // the upload for a picture sharp re-encodes on the server anyway.
    vi.stubGlobal('window', { devicePixelRatio: 3 })

    return { canvas, ctx, translates }
  }

  it('sizes the canvas from the natural-to-layout ratio alone', async () => {
    const { canvas, translates } = stubCanvas()
    const crop: PixelCrop = { unit: 'px', x: 10, y: 20, width: 100, height: 50 }
    const image = {
      width: 200,
      height: 100,
      naturalWidth: 400,
      naturalHeight: 200
    } as HTMLImageElement

    await createCroppedImage(image, crop)

    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
    expect(translates[0]).toEqual([-20, -40])
  })
})
