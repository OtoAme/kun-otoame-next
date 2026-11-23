import { useUserStore } from '~/store/userStore'
import { useAccountPreferences } from './useAccountPreferences'
import { useSessionRenderState } from '~/components/kun/SessionRenderProvider'
import { getBrowsingKey, getBrowsingScopeKey } from '~/utils/browsingScope'
import type { SessionRenderState } from '~/types/api/session'

const publicBrowsingKey = getBrowsingKey('sfw', [])

export const useBrowsingScope = (initialScope?: SessionRenderState | null) => {
  const session = useUserStore()
  const preferences = useAccountPreferences()
  const layoutState = useSessionRenderState()
  const initial = initialScope === undefined ? layoutState : initialScope
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
      : session.sessionGeneration === 0 &&
          (session.sessionContext === null ||
            session.sessionContext === initial?.identity)
        ? initial
        : null

  return {
    ready,
    key: getBrowsingScopeKey(state)
  }
}
