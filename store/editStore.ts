import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface CreatePatchData {
  name: string
  introduction: string
  vndbId: string
  vndbRelationId: string
  dlsiteCode: string
  officialUrl: string
  alias: string[]
  tag: string[]
  released: string
  contentLimit: string
  isDuplicate: boolean
}

export interface CreatePatchRequestData extends CreatePatchData {
  banner: Blob | null
  gallery?: Blob[]
  galleryMetadata?: string
}

interface StoreState {
  data: CreatePatchData
  getData: () => CreatePatchData
  setData: (data: CreatePatchData) => void
  resetData: () => void
}

const initialState: CreatePatchData = {
  name: '',
  introduction: '',
  vndbId: '',
  vndbRelationId: '',
  dlsiteCode: '',
  officialUrl: '',
  alias: [],
  tag: [],
  released: '',
  contentLimit: 'sfw',
  isDuplicate: false
}

export const useCreatePatchStore = create<StoreState>()(
  persist(
    (set, get) => ({
      data: initialState,
      getData: () => (get() as StoreState).data,
      setData: (data: CreatePatchData) => set({ data }),
      resetData: () => set({ data: initialState })
    }),
    {
      name: 'kun-patch-edit-store',
      storage: createJSONStorage(() => localStorage)
    }
  ) as any
)
