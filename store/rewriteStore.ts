import { create } from 'zustand'

export interface PatchGameImage {
  id: number
  url: string
  is_nsfw: boolean
}

export interface RewritePatchData {
  id: number
  uniqueId: string
  vndbId: string
  name: string
  introduction: string
  officialUrl: string
  alias: string[]
  tag: string[]
  contentLimit: string
  released: string
  images: PatchGameImage[]
  bannerUrl: string
  isDuplicate: boolean
}

interface StoreState {
  data: RewritePatchData
  newImages: { id: string; file: File; isNSFW: boolean }[]
  newBanner: File | null
  watermark: boolean
  galleryOrder: (number | string)[]
  getData: () => RewritePatchData
  setData: (data: RewritePatchData) => void
  setNewImages: (images: { id: string; file: File; isNSFW: boolean }[]) => void
  setNewBanner: (file: File | null) => void
  setWatermark: (watermark: boolean) => void
  setGalleryOrder: (order: (number | string)[]) => void
  resetData: () => void
}

const initialState: RewritePatchData = {
  id: 0,
  uniqueId: '',
  vndbId: '',
  name: '',
  introduction: '',
  officialUrl: '',
  alias: [],
  tag: [],
  contentLimit: 'sfw',
  released: '',
  images: [],
  bannerUrl: '',
  isDuplicate: false
}

export const useRewritePatchStore = create<StoreState>((set, get) => ({
  data: initialState,
  newImages: [],
  newBanner: null,
  watermark: true,
  galleryOrder: [],
  getData: () => get().data,
  setData: (data) => set({ data }),
  setNewImages: (newImages) => set({ newImages }),
  setNewBanner: (newBanner) => set({ newBanner }),
  setWatermark: (watermark) => set({ watermark }),
  setGalleryOrder: (galleryOrder) => set({ galleryOrder }),
  resetData: () =>
    set({
      data: initialState,
      newImages: [],
      newBanner: null,
      watermark: true,
      galleryOrder: []
    })
}))

