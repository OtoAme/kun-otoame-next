import type { SessionRenderState } from '~/types/api/session'

export const getBrowsingKey = (mode: string, blockedTagIds: number[]) =>
  JSON.stringify([
    mode,
    [...blockedTagIds].sort((first, second) => first - second)
  ])

export const getBrowsingScopeKey = (state: SessionRenderState | null) =>
  state?.browsingKey
    ? JSON.stringify([state.identity, state.browsingKey])
    : null
