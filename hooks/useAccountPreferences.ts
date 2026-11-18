'use client'
import { useUserStore } from '~/store/userStore'
import { usePreferenceStore } from '~/store/preferenceStore'
export const useAccountPreferences = () => {
  const session = useUserStore()
  const state = usePreferenceStore()
  const current =
    session.sessionStatus === 'authenticated' &&
    state.generation === session.sessionGeneration &&
    state.applied?.uid === session.user.uid &&
    state.applied.context === session.sessionContext
  return {
    ...state,
    snapshot: current ? state.applied : null,
    drafts: current ? state.drafts : {},
    canEdit: current && state.status === 'ready' && !state.saving
  }
}
