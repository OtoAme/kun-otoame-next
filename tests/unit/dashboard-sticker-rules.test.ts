import { describe, expect, it } from 'vitest'
import {
  checkFiles,
  enableBlocker,
  isValidSticker,
  validatePack
} from '~/components/dashboard/sticker/stickerRules'
import type { AdminSticker, AdminStickerPack } from '~/types/api/admin'

const sticker = (patch: Partial<AdminSticker> = {}): AdminSticker => ({
  id: 's1',
  packId: 1,
  alt: '',
  assetKey: 'stickers/a.webp',
  thumbnailKey: null,
  assetUrl: 'https://x/a.webp',
  thumbnailUrl: null,
  mime: 'image/webp',
  mediaType: 'image',
  status: 1,
  contentHash: null,
  width: 128,
  height: 128,
  size: 1024,
  durationMs: null,
  frameRate: null,
  sortOrder: 0,
  ...patch
})
const pack = (patch: Partial<AdminStickerPack> = {}): AdminStickerPack => ({
  id: 1,
  slug: 'cute_cats',
  name: '猫猫',
  description: '',
  status: 0,
  price: 0,
  isBuiltin: false,
  coverStickerId: null,
  coverUrl: null,
  stickers: [sticker()],
  ...patch
})
const file = (name: string, size: number) => ({ name, size }) as unknown as File

describe('sticker rules', () => {
  it('requires a poster for video stickers and an active asset', () => {
    expect(isValidSticker(sticker())).toBe(true)
    expect(isValidSticker(sticker({ status: 0 }))).toBe(false)
    expect(isValidSticker(sticker({ mediaType: 'video' }))).toBe(false)
    expect(
      isValidSticker(sticker({ mediaType: 'video', thumbnailKey: 'p.webp' }))
    ).toBe(true)
  })

  it('blocks enabling a pack without valid stickers or with an invalid cover', () => {
    expect(enableBlocker(pack())).toBe('')
    expect(
      enableBlocker(pack({ stickers: [sticker({ status: 0 })] }))
    ).toContain('至少需要一张')
    expect(enableBlocker(pack({ coverStickerId: 'missing' }))).toContain('封面')
    expect(enableBlocker(pack({ status: 1, stickers: [] }))).toBe('')
  })

  it('validates slug only when creating', () => {
    expect(
      validatePack({ slug: 'Bad Slug', name: 'a', description: '' }, true).slug
    ).toBeTruthy()
    expect(
      validatePack({ slug: 'Bad Slug', name: 'a', description: '' }, false).slug
    ).toBeUndefined()
    expect(
      validatePack({ slug: 'ok', name: '', description: '' }, false).name
    ).toBeTruthy()
  })

  it('applies the server import limits per file and in total', () => {
    expect(checkFiles([])).toContain('请选择')
    expect(checkFiles([file('a.webp', 600 * 1024)])).toContain('a.webp')
    expect(checkFiles([file('a.webm', 301 * 1024)])).toContain('a.webm')
    expect(checkFiles([file('a.zip', 31 * 1024 * 1024)])).toBe('')
    expect(
      checkFiles([
        file('a.zip', 32 * 1024 * 1024),
        file('b.zip', 32 * 1024 * 1024 + 1)
      ])
    ).toContain('b.zip')
    expect(
      checkFiles(
        Array.from({ length: 3 }, (_, i) => file(`${i}.zip`, 30 * 1024 * 1024))
      )
    ).toContain('总大小')
    expect(
      checkFiles(Array.from({ length: 201 }, () => file('a.webp', 1)))
    ).toContain('200')
  })
})
