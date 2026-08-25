import { create } from 'zustand'
import type {
  PatchSubmission,
  PatchSubmissionGalleryImage,
  PatchSubmissionPayload
} from '~/types/api/patchSubmission'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

interface StoreState {
  submissionId: number
  status: PatchSubmission['status']
  revision: number
  payload: PatchSubmissionPayload
  bannerUrl: string | null
  gallery: PatchSubmissionGalleryImage[]
  externalSource: string
  externalFetchedAt: string | null
  localAssetCount: number
  assetUploadsInFlight: number
  assetDraftLoaded: boolean
  saveState: SaveState
  saveError: string
  /** Set while the current payload still has unsaved changes. */
  pendingSave: boolean

  hydrate: (submission: PatchSubmission) => void
  setPayload: (
    payload:
      | PatchSubmissionPayload
      | ((current: PatchSubmissionPayload) => PatchSubmissionPayload)
  ) => void
  setBannerUrl: (url: string | null) => void
  setGallery: (gallery: PatchSubmissionGalleryImage[]) => void
  setSaveState: (state: SaveState, error?: string) => void
  setRevision: (revision: number) => void
  setPendingSave: (pending: boolean) => void
  setExternalProvenance: (source: string, fetchedAt: string) => void
  setAssetDraftState: (input: {
    localCount?: number
    uploadsInFlight?: number
    loaded?: boolean
  }) => void
  reset: () => void
}

export const emptyPatchSubmissionPayload: PatchSubmissionPayload = {
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
  contentLimit: 'sfw'
}

const initialState = {
  submissionId: 0,
  status: 'draft' as PatchSubmission['status'],
  revision: 1,
  payload: emptyPatchSubmissionPayload,
  bannerUrl: null,
  gallery: [] as PatchSubmissionGalleryImage[],
  externalSource: '',
  externalFetchedAt: null as string | null,
  localAssetCount: 0,
  assetUploadsInFlight: 0,
  assetDraftLoaded: false,
  saveState: 'idle' as SaveState,
  saveError: '',
  pendingSave: false
}

/**
 * Deliberately not persisted. The draft already lives in the database and is
 * loaded per submission id, so a local copy would only add a second source of
 * truth that can disagree with the server after editing on another device.
 */
export const usePatchSubmissionStore = create<StoreState>()((set) => ({
  ...initialState,

  hydrate: (submission) =>
    set((state) => ({
      submissionId: submission.id,
      status: submission.status,
      revision: submission.revision,
      payload: submission.payload,
      bannerUrl: submission.bannerUrl,
      gallery: submission.gallery,
      externalSource: submission.externalSource ?? '',
      externalFetchedAt: submission.externalFetchedAt,
      localAssetCount:
        state.submissionId === submission.id ? state.localAssetCount : 0,
      assetUploadsInFlight:
        state.submissionId === submission.id ? state.assetUploadsInFlight : 0,
      assetDraftLoaded:
        state.submissionId === submission.id ? state.assetDraftLoaded : false,
      saveState: 'idle',
      saveError: '',
      pendingSave: false
    })),

  setPayload: (payload) =>
    set((state) => ({
      payload: typeof payload === 'function' ? payload(state.payload) : payload
    })),

  setBannerUrl: (bannerUrl) => set({ bannerUrl }),
  setGallery: (gallery) => set({ gallery }),
  setSaveState: (saveState, saveError = '') => set({ saveState, saveError }),
  setRevision: (revision) => set({ revision }),
  setPendingSave: (pendingSave) => set({ pendingSave }),
  setExternalProvenance: (externalSource, externalFetchedAt) =>
    set({ externalSource, externalFetchedAt }),
  setAssetDraftState: ({ localCount, uploadsInFlight, loaded }) =>
    set((state) => ({
      localAssetCount: localCount ?? state.localAssetCount,
      assetUploadsInFlight: uploadsInFlight ?? state.assetUploadsInFlight,
      assetDraftLoaded: loaded ?? state.assetDraftLoaded
    })),
  reset: () => set(initialState)
}))
