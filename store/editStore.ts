import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface CreatePatchData {
  name: string
  introduction: string
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
  setData: (
    data: CreatePatchData | ((current: CreatePatchData) => CreatePatchData)
  ) => void
  resetData: () => void
}

type PersistedStoreState = Partial<StoreState> & {
  data?: Partial<CreatePatchData>
}

export const createPatchEditStoreKey = 'kun-patch-edit-store'

export const initialCreatePatchData: CreatePatchData = {
  name: '',
  introduction: '',
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
      data: initialCreatePatchData,
      getData: () => (get() as StoreState).data,
      setData: (
        data: CreatePatchData | ((current: CreatePatchData) => CreatePatchData)
      ) =>
        set((state: StoreState) => ({
          data: typeof data === 'function' ? data(state.data) : data
        })),
      resetData: () => set({ data: initialCreatePatchData })
    }),
    {
      name: 'kun-patch-edit-store',
      storage: createJSONStorage(() => window.localStorage),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedStoreState | undefined
        const current = currentState as StoreState

        return {
          ...current,
          ...(persisted ?? {}),
          data: {
            ...initialCreatePatchData,
            ...(persisted?.data ?? {})
          }
        }
      }
    }
  ) as any
)
