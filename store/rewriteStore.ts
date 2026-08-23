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
  newBannerOriginal: File | null
  watermark: boolean
  galleryOrder: (number | string)[]
  getData: () => RewritePatchData
  seedTarget: (data: RewritePatchData) => void
  setData: (
    data: RewritePatchData | ((current: RewritePatchData) => RewritePatchData)
  ) => void
  setNewImages: (images: RewriteNewGalleryImage[]) => void
  setNewBanner: (file: File | null) => void
  setNewBannerOriginal: (file: File | null) => void
  setWatermark: (watermark: boolean) => void
  setGalleryOrder: (order: (number | string)[]) => void
  clearUploadState: () => void
  resetData: () => void
}

export const initialRewritePatchData: RewritePatchData = {
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

const emptyUploadState: Pick<
  StoreState,
  'newImages' | 'newBanner' | 'newBannerOriginal' | 'galleryOrder'
> = {
  newImages: [],
  newBanner: null,
  newBannerOriginal: null,
  galleryOrder: []
}

export const useRewritePatchStore = create<StoreState>((set, get) => ({
  data: initialRewritePatchData,
  newImages: [],
  newBanner: null,
  newBannerOriginal: null,
  watermark: true,
  galleryOrder: [],
  getData: () => get().data,
  // Opening the edit page always starts a fresh session: files picked in an
  // earlier session are dropped, so a failed upload cannot follow the user into
  // the next visit and pile up as garbage. Retrying failed screenshots is
  // therefore only possible without leaving the edit page.
  seedTarget: (data) => set({ data, ...emptyUploadState }),
  setData: (
    data: RewritePatchData | ((current: RewritePatchData) => RewritePatchData)
  ) =>
    set((state: StoreState) => {
      const nextData = typeof data === 'function' ? data(state.data) : data
      // In-form edits keep the pending files. The id check is only a net for a
      // seeding path that forgets seedTarget: carrying files across targets
      // would upload the previous patch's banner and screenshots to this one.
      if (nextData.id === state.data.id) {
        return { data: nextData }
      }
      return { data: nextData, ...emptyUploadState }
    }),
  setNewImages: (newImages) => set({ newImages }),
  setNewBanner: (newBanner) => set({ newBanner }),
  setNewBannerOriginal: (newBannerOriginal) => set({ newBannerOriginal }),
  setWatermark: (watermark) => set({ watermark }),
  setGalleryOrder: (galleryOrder) => set({ galleryOrder }),
  clearUploadState: () => set(emptyUploadState),
  resetData: () =>
    set({
      data: initialRewritePatchData,
      watermark: true,
      ...emptyUploadState
    })
}))
