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
    set({
      submissionId: submission.id,
      status: submission.status,
      revision: submission.revision,
      payload: submission.payload,
      bannerUrl: submission.bannerUrl,
      gallery: submission.gallery,
      externalSource: submission.externalSource ?? '',
      externalFetchedAt: submission.externalFetchedAt,
      saveState: 'idle',
      saveError: '',
      pendingSave: false
    }),

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
  reset: () => set(initialState)
}))
