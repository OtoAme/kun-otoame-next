export const NOTIFICATION_CATEGORIES = [
  'interaction',
  'help',
  'review',
  'maintenance',
  'account'
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]
export const NOTIFICATION_PREFERENCE_SCHEMA = 'notifications-v1'

export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory,
  string
> = {
  interaction: '互动消息',
  help: '求助动态',
  review: '投稿审核',
  maintenance: '问题处理',
  account: '官方消息'
}

const event = (
  category: NotificationCategory,
  label: string,
  type: string,
  optional = false
) => ({ category, label, type, optional, defaultEnabled: true })

export const NOTIFICATION_EVENTS = {
  'comment-reply': event('interaction', '评论回复', 'comment', true),
  mention: event('interaction', '提及', 'mention', true),
  like: event('interaction', '点赞', 'like', true),
  favorite: event('interaction', '收藏', 'favorite', true),
  follow: event('interaction', '被关注', 'follow', true),
  'help-answer': event('help', '本人求助的新回答', 'comment', true),
  'help-reply': event('help', '回答回复', 'comment', true),
  'help-resource': event('help', '与本人资源有关的求助', 'feedback', true),
  'help-follow-answer': event('help', '关注求助的新回答', 'system', true),
  'help-follow-resolved': event('help', '关注求助的解决进展', 'system', true),
  'help-accepted': event('help', '采纳与奖励结果', 'system'),
  'creator-application': event('review', '创作者申请待处理', 'apply'),
  'creator-result': event('review', '创作者申请结果', 'apply'),
  'submission-pending': event('review', '投稿待审核', 'system'),
  'submission-result': event('review', '投稿审核结果', 'system'),
  'resource-pending': event('review', '资源待审核', 'system'),
  'resource-result': event('review', '资源审核结果', 'system'),
  'content-adjusted': event('review', '本人内容的管理调整', 'system'),
  'maintenance-required': event(
    'maintenance',
    '待本人处理的链接反馈',
    'system'
  ),
  'maintenance-result': event('maintenance', '本人反馈的维护结果', 'system'),
  'case-update': event('maintenance', '本人参与事项的回复与进展', 'system'),
  'case-follow': event('maintenance', '仅因关注收到的事项进展', 'system', true),
  'case-reminder': event('maintenance', '事项处理期限提醒', 'system'),
  'report-result': event('maintenance', '本人举报的处理结果', 'report'),
  'feedback-result': event('maintenance', '本人反馈的处理结果', 'system'),
  'site-announcement': event('account', '普通站务公告', 'system', true),
  moderation: event('account', '管理处置结果', 'system'),
  points: event('account', '萌萌点账务结果', 'system')
} as const

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS
export const isNotificationEvent = (
  value: string
): value is NotificationEvent => Object.hasOwn(NOTIFICATION_EVENTS, value)

export const NOTIFICATION_SUBSCRIPTIONS = Object.entries(NOTIFICATION_EVENTS)
  .filter(([, definition]) => definition.optional)
  .map(([name]) => `notification:${name}`)

export const isNotificationSubscription = (key: string) =>
  NOTIFICATION_SUBSCRIPTIONS.includes(key)

export const notificationCategory = (
  eventType: string | null | undefined,
  type: string
): NotificationCategory => {
  if (eventType && isNotificationEvent(eventType))
    return NOTIFICATION_EVENTS[eventType].category
  if (['like', 'favorite', 'comment', 'follow', 'mention'].includes(type))
    return 'interaction'
  if (['apply', 'pr'].includes(type)) return 'review'
  if (['feedback', 'report'].includes(type)) return 'maintenance'
  return 'account'
}

export const isNotificationSequence = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n

export const isNotificationVersion = (value: unknown): value is string =>
  isNotificationSequence(value) && value !== '0'
