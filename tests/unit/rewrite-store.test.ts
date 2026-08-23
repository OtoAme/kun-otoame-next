import { beforeEach, describe, expect, it } from 'vitest'
import {
  initialRewritePatchData,
  useRewritePatchStore
} from '~/store/rewriteStore'

const createFile = (name: string) =>
  new File([Buffer.from(name)], name, { type: 'image/avif' })

const seedPendingUploads = (patchId: number) => {
  useRewritePatchStore.setState({
    data: {
      ...initialRewritePatchData,
      id: patchId,
      uniqueId: `patch-${patchId}`,
      name: `游戏 ${patchId}`,
      images: [{ id: 900, url: 'https://img.example/900.avif', is_nsfw: false }]
    },
    newImages: [
      {
        id: 'pending-image',
        file: createFile('screenshot.avif'),
        isNSFW: false,
        uploadStatus: 'failed',
        uploadError: '网络错误'
      }
    ],
    newBanner: createFile('banner.avif'),
    newBannerOriginal: createFile('banner-original.webp'),
    galleryOrder: [900, 'pending-image']
  })
}

describe('rewrite patch store', () => {
  beforeEach(() => {
    useRewritePatchStore.getState().resetData()
  })

  it('drops pending uploads when a different patch becomes the edit target', () => {
    seedPendingUploads(41)

    useRewritePatchStore.getState().setData({
      ...initialRewritePatchData,
      id: 42,
      uniqueId: 'patch-42',
      name: '游戏 42'
    })

    const state = useRewritePatchStore.getState()
    expect(state.data.id).toBe(42)
    expect(state.newImages).toEqual([])
    expect(state.newBanner).toBeNull()
    expect(state.newBannerOriginal).toBeNull()
    expect(state.galleryOrder).toEqual([])
  })

  it('drops pending uploads when the same patch is opened for editing again', () => {
    seedPendingUploads(41)

    useRewritePatchStore.getState().seedTarget({
      ...initialRewritePatchData,
      id: 41,
      uniqueId: 'patch-41',
      name: '游戏 41',
      images: [
        { id: 900, url: 'https://img.example/900.avif', is_nsfw: false },
        { id: 901, url: 'https://img.example/901.avif', is_nsfw: false }
      ]
    })

    const state = useRewritePatchStore.getState()
    expect(state.data.images).toHaveLength(2)
    expect(state.newImages).toEqual([])
    expect(state.newBanner).toBeNull()
    expect(state.newBannerOriginal).toBeNull()
    expect(state.galleryOrder).toEqual([])
  })

  it('keeps pending uploads through in-place field edits', () => {
    seedPendingUploads(41)

    useRewritePatchStore.getState().setData((current) => ({
      ...current,
      name: '改名后的游戏'
    }))

    const state = useRewritePatchStore.getState()
    expect(state.data.name).toBe('改名后的游戏')
    expect(state.newImages).toHaveLength(1)
    expect(state.newBanner).not.toBeNull()
    expect(state.newBannerOriginal).not.toBeNull()
    expect(state.galleryOrder).toEqual([900, 'pending-image'])
  })

  it('keeps failed screenshots for a retry that never leaves the edit page', () => {
    seedPendingUploads(41)

    useRewritePatchStore.getState().setData({
      ...useRewritePatchStore.getState().data,
      images: [
        { id: 900, url: 'https://img.example/900.avif', is_nsfw: false },
        { id: 902, url: 'https://img.example/902.avif', is_nsfw: false }
      ]
    })

    expect(useRewritePatchStore.getState().newImages).toEqual([
      expect.objectContaining({
        id: 'pending-image',
        uploadStatus: 'failed',
        uploadError: '网络错误'
      })
    ])
  })

  it('clears consumed uploads after a submit without discarding patch data', () => {
    seedPendingUploads(41)

    useRewritePatchStore.getState().clearUploadState()

    const state = useRewritePatchStore.getState()
    expect(state.data.id).toBe(41)
    expect(state.data.name).toBe('游戏 41')
    expect(state.newImages).toEqual([])
    expect(state.newBanner).toBeNull()
    expect(state.newBannerOriginal).toBeNull()
    expect(state.galleryOrder).toEqual([])
  })
})
