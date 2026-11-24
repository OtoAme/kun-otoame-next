import { getSessionContext } from '~/app/api/utils/sessionIdentity'
import type { KunGalgamePayload } from '~/app/api/utils/jwt'
import { NotificationServiceError } from './errors'

export const requireNotificationSession = (
  request: Pick<Request, 'headers'>,
  payload: KunGalgamePayload
) => {
  const context = request.headers.get('X-Kun-Notification-Session')
  if (context !== null && context !== getSessionContext(payload))
    throw new NotificationServiceError(
      409,
      'NOTIFICATION_CONTEXT_CHANGED',
      '登录会话已变化，请重新确认后查看通知'
    )
}
