import type { MessageUnreadStatus } from './message'
import type { UserState } from '~/store/userStore'

export interface UserSession {
  context: string
  user: UserState
  unread: MessageUnreadStatus | null
}

export interface SessionRenderState {
  identity: string
  browsingKey: string | null
}
