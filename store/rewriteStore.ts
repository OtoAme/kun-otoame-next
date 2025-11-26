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
  alias: string[]
  tag: string[]
  contentLimit: string
  released: string
  images: PatchGameImage[]
  bannerUrl: string
}

interface StoreState {
  data: RewritePatchData
  newImages: { id: string; file: File; isNSFW: boolean }[]
  newBanner: File | null
  watermark: boolean
  getData: () => RewritePatchData
  setData: (data: RewritePatchData) => void
  setNewImages: (images: { id: string; file: File; isNSFW: boolean }[]) => void
  setNewBanner: (file: File | null) => void
  setWatermark: (watermark: boolean) => void
  resetData: () => void
}

const initialState: RewritePatchData = {
  id: 0,
  uniqueId: '',
  vndbId: '',
  name: '',
  introduction: '',
  alias: [],
  tag: [],
  contentLimit: 'sfw',
  released: '',
  images: [],
  bannerUrl: ''
}

export const useRewritePatchStore = create<StoreState>()((set, get) => ({
  data: initialState,
  newImages: [],
  newBanner: null,
  watermark: true,
  getData: () => get().data,
  setData: (data: RewritePatchData) => set({ data }),
  setNewImages: (newImages) => set({ newImages }),
  setNewBanner: (newBanner) => set({ newBanner }),
  setWatermark: (watermark) => set({ watermark }),
  resetData: () =>
    set({ data: initialState, newImages: [], newBanner: null, watermark: false })
}))

