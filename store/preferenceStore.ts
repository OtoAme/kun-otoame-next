import { create } from 'zustand'
import type {
  NsfwMode,
  PreferenceChange,
  PreferenceSnapshot
} from '~/types/api/preferences'

export interface PreferenceDraft extends PreferenceChange {
  uid: number
  context: string
  generation: number
}
interface PreferenceState {
  applied: PreferenceSnapshot | null
  generation: number | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  observedVersion: number | null
  drafts: Record<string, PreferenceDraft>
  conflicts: string[]
  saving: boolean
  error: string | null
  legacyNsfw: NsfwMode | null
}
const initial: PreferenceState = {
  applied: null,
  generation: null,
  status: 'idle',
  observedVersion: null,
  drafts: {},
  conflicts: [],
  saving: false,
  error: null,
  legacyNsfw: null
}
export const usePreferenceStore = create<PreferenceState>()(() => ({
  ...initial
}))
export const resetPreferences = () =>
  usePreferenceStore.setState({ ...initial, drafts: {}, conflicts: [] })
