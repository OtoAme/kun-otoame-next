import { useUserStore } from '~/store/userStore'
import { useAccountPreferences } from './useAccountPreferences'
import { useSessionRenderState } from '~/components/kun/SessionRenderProvider'
import { getBrowsingKey } from '~/utils/browsingScope'

const publicBrowsingKey = getBrowsingKey('sfw', [])

export const useBrowsingScope = () => {
  const session = useUserStore()
  const preferences = useAccountPreferences()
  const initial = useSessionRenderState()
  const guest = session.sessionStatus === 'guest'
  const ready =
    guest ||
    (session.sessionStatus === 'authenticated' && preferences.snapshot !== null)
  const state = guest
    ? { identity: 'guest', browsingKey: publicBrowsingKey }
    : preferences.snapshot
      ? {
          identity: preferences.snapshot.context,
          browsingKey: getBrowsingKey(
            String(preferences.snapshot.items.nsfw.value),
            preferences.snapshot.blockedTagIds
          )
        }
      : session.sessionStatus === 'checking' && session.sessionGeneration === 0
        ? initial
        : null

  return {
    ready,
    key: state ? JSON.stringify([state.identity, state.browsingKey]) : null,
    isPublic: state?.browsingKey === publicBrowsingKey
  }
}
