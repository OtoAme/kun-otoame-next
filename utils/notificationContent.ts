import type { NotificationEvent } from '~/constants/notification'
import type { Message } from '~/types/api/message'

// Existing notifications store the template and excerpt together. Only split
// recognizable templates for their registered event, preserving every character.
const patterns: Partial<Record<NotificationEvent, RegExp>> = {
  'comment-reply': /^(回复了您的评论[：:])([\s\S]+)$/,
  mention: /^([^\n]+在「[^\n]+」的评论区提到了您\n)([\s\S]+)$/,
  like: /^((?:点赞了您的评论!|有人点赞了您的 OtomeGame 评价) -> )([\s\S]+)$/,
  'help-resource': /^(有用户就您的资源「[^\n]+」发布了求助：)([\s\S]+)$/,
  'help-reply': /^(在求助「[^\n]+」中回复了您：)([\s\S]+)$/,
  'submission-result': /^(您的投稿《[^\n]+》[^\n]+。原因: )([\s\S]+)$/,
  'resource-result':
    /^(你上传的(?:游戏资源|补丁资源)「[^\n]+」未通过审核，原因：)([\s\S]+)$/,
  'creator-result': /^(您的创作者申请被拒绝, 理由: )([\s\S]+)$/,
  'content-adjusted':
    /^(管理员修改了你发布的[^\n]+。\n\n修改内容:\n)([\s\S]+)$/,
  points: /^(管理员为您发放了 \d+ 萌萌点。\n理由: )([\s\S]+)$/,
  'case-update':
    /^([^\n]+(?:有新的回复|有新的「[^\n]+」待处理|已有处理结果：[^：\n]+|被报告者重新打开|的报告者申请网站管理员复核|的原发布者提请以「[^\n]+」结案)：)([\s\S]+)$/,
  'feedback-result': /^(您的反馈已处理!\n\n)([\s\S]+)$/,
  'maintenance-result':
    /^(您反馈的资源链接已有维护结果：(?:发布者已回应|已核实可用|已补链|已停止维护|链接已移除)。)([\s\S]+)$/
}

const historicalEvents: Partial<Record<string, NotificationEvent>> = {
  comment: 'comment-reply',
  mention: 'mention',
  like: 'like',
  apply: 'creator-result'
}

export const notificationContent = (
  message: Pick<Message, 'type' | 'eventType' | 'content'>
) => {
  const event = message.eventType ?? historicalEvents[message.type]
  const match = event ? patterns[event]?.exec(message.content) : undefined
  return match
    ? { template: match[1], body: match[2] }
    : { template: '', body: message.content }
}
