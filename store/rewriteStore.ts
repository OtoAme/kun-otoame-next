import { create } from 'zustand'

export interface PatchGameImage {
  id: number
  url: string
  thumbnail_url?: string | null
  is_nsfw: boolean
}

export type RewriteNewGalleryImageUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'

export interface RewriteNewGalleryImage {
  id: string
  file: File
  isNSFW: boolean
  uploadStatus?: RewriteNewGalleryImageUploadStatus
  uploadError?: string
}

export interface RewritePatchData {
  id: number
  uniqueId: string
  vndbId: string
  vndbRelationId: string
  bangumiId: string
  steamId: string
  dlsiteCode: string
  dlsiteCircleName: string
  dlsiteCircleLink: string
  vndbTags: string[]
  vndbDevelopers: string[]
  bangumiTags: string[]
  bangumiDevelopers: string[]
  steamTags: string[]
  steamDevelopers: string[]
  steamAliases: string[]
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
  newImages: RewriteNewGalleryImage[]
  newBanner: File | null
  watermark: boolean
  galleryOrder: (number | string)[]
  getData: () => RewritePatchData
  setData: (
    data: RewritePatchData | ((current: RewritePatchData) => RewritePatchData)
  ) => void
  setNewImages: (images: RewriteNewGalleryImage[]) => void
  setNewBanner: (file: File | null) => void
  setWatermark: (watermark: boolean) => void
  setGalleryOrder: (order: (number | string)[]) => void
  resetData: () => void
}

const initialState: RewritePatchData = {
  id: 0,
  uniqueId: '',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
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
  setData: (
    data: RewritePatchData | ((current: RewritePatchData) => RewritePatchData)
  ) =>
    set((state: StoreState) => ({
      data: typeof data === 'function' ? data(state.data) : data
    })),
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
