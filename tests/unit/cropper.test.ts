import { describe, expect, it } from 'vitest'
import { centerAspectCrop } from '~/components/kun/cropper/utils'

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
