import { cache } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { getPageIdentity } from './getSessionIdentity'
import { getPageBrowsingPreferences } from './getBrowsingPreferences'
import { getSessionContext } from '~/app/api/utils/sessionIdentity'
import { getBrowsingKey } from '~/utils/browsingScope'
import type { SessionRenderState } from '~/types/api/session'

export const getSessionRenderState = cache(
  async (): Promise<SessionRenderState | null> => {
    try {
      const identity = await getPageIdentity()
      const preferences = await getPageBrowsingPreferences().catch((error) => {
        unstable_rethrow(error)
        return null
      })
      return {
        identity: identity ? getSessionContext(identity) : 'guest',
        browsingKey: preferences
          ? getBrowsingKey(preferences.mode, preferences.blockedTagIds)
          : null
      }
    } catch (error) {
      unstable_rethrow(error)
      // Public authentication entry points remain available during an outage.
      return null
    }
  }
)
