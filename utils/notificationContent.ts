import type { NotificationEvent } from '~/constants/notification'
import type { Message } from '~/types/api/message'

export const formatCommentReplyNotification = (
  original: string,
  reply: string
) => {
  const originalCharacters = Array.from(original.replace(/\s+/g, ' ').trim())
  const excerpt =
    originalCharacters.length > 107
      ? originalCharacters.slice(0, 107).join('') + '…'
      : originalCharacters.join('')
  const heading = `回复了你的评论「${excerpt}」\nTA 的回复内容：\n`
  // PostgreSQL varchar(10007) counts Unicode characters, including the heading.
  const room = 10007 - Array.from(heading).length
  const characters = Array.from(reply)
  return (
    heading +
    (characters.length <= room
      ? reply
      : characters.slice(0, room - 1).join('') + '…')
  )
}

const caseExcerpt =
  /^([^\n]+?(?:有新的回复|有新的「[^」\n]+」待处理|已有处理结果：(?!开启者撤回：)[^：\n]+|被报告者重新打开|的报告者申请网站管理员复核|的原发布者提请以「[^」\n]+」结案)：)([\s\S]+)$/

// Each template captures its generated introduction and the submitted excerpt.
const patterns: Partial<Record<NotificationEvent | 'pr', RegExp>> = {
  pr: /^(拒绝了您的更新请求\.\.\. 理由: )([\s\S]+)$/,
  'comment-reply': /^(回复了您的评论[：:])([\s\S]+)$/,
  mention: /^([^\n]+在「[^\n]+」的评论区提到了您\n)([\s\S]+)$/,
  like: /^((?:点赞了您的评论!|有人点赞了您的 OtomeGame 评价) -> )([\s\S]+)$/,
  'help-resource': /^(有用户就您的资源「[^」\n]+」发布了求助：)([\s\S]+)$/,
  'help-reply': /^(在求助「[^」\n]+」中回复了您：)([\s\S]+)$/,
  'submission-result': /^(您的投稿《[^\n]+?》[^\n]+?。原因: )([\s\S]+)$/,
  'resource-result':
    /^(你上传的(?:游戏资源|补丁资源)「[^\n]+?」未通过审核，原因：)([\s\S]+)$/,
  'creator-result': /^(您的创作者申请被拒绝, 理由: )([\s\S]+)$/,
  points: /^(管理员为您发放了 \d+ 萌萌点。\n理由: )([\s\S]+)$/,
  'case-update': caseExcerpt,
  'case-follow': caseExcerpt,
  'maintenance-result':
    /^(您反馈的资源链接已有维护结果：(?:发布者已回应|已核实可用|已补链|已停止维护|链接已移除)。)([\s\S]+)$/
}

const historicalEvents: Partial<Record<string, NotificationEvent | 'pr'>> = {
  comment: 'comment-reply',
  mention: 'mention',
  like: 'like',
  apply: 'creator-result',
  pr: 'pr',
  report: 'report-result'
}

const plain = (text: string) => ({ text, quoted: false })
const quote = (text: string) => ({ text, quoted: true })

const resultTemplates = [
  {
    event: 'feedback-result',
    prefix: /^您的反馈已处理!\n\n反馈原因: /,
    reply: '\n反馈处理回复: ',
    defaults: ['无处理留言']
  },
  {
    event: 'report-result',
    prefix: /^您的举报已处理!\n\n举报类型: (?:评价|评论)\n举报原因: /,
    reply: '\n举报处理回复: ',
    defaults: ['已处理']
  },
  {
    event: 'report-result',
    prefix: /^您的举报已驳回!\n\n举报类型: (?:评价|评论)\n举报原因: /,
    reply: '\n举报驳回回复: ',
    defaults: ['已驳回']
  },
  {
    event: 'report-result',
    prefix: /^您的小喇叭举报已(?:受理|驳回)!\n\n举报原因: /,
    reply: '\n处理回复: ',
    defaults: ['已处理', '举报已驳回']
  }
]

interface NotificationPart {
  text: string
  quoted: boolean
  markdown?: boolean
  inlineExcerpt?: { before: string; source: string; after: string }
}

export const notificationContent = ({
  content,
  type,
  eventType
}: Pick<Message, 'type' | 'eventType' | 'content'>): NotificationPart[] => {
  if (eventType === 'site-announcement') return [quote(content)]
  const event = eventType ?? historicalEvents[type]
  if (event === 'comment-reply') {
    const reply =
      /^(回复了你的评论「)([^\n]*)(」\nTA 的回复内容：\n)([\s\S]+)$/.exec(
        content
      )
    if (reply) {
      const [, before, source, after, body] = reply
      return [
        {
          ...plain(before + source + after),
          inlineExcerpt: { before, source, after }
        },
        { ...quote(body), markdown: true }
      ]
    }
  }
  if (event === 'report-result' || event === 'feedback-result') {
    for (const template of resultTemplates) {
      if (template.event !== event) continue
      const prefix = template.prefix.exec(content)?.[0]
      if (!prefix) continue
      const fields = content.slice(prefix.length).split(template.reply)
      // Stored text cannot distinguish repeated labels from a user's own words.
      if (fields.length !== 2) break
      const [reason, reply] = fields
      return [
        plain(prefix),
        quote(reason),
        plain(template.reply),
        template.defaults.includes(reply) ? plain(reply) : quote(reply)
      ].filter((part) => part.text.length > 0)
    }
  }
  const match = event && patterns[event]?.exec(content)
  if (!match) return [plain(content)]
  const markdown =
    event === 'comment-reply' ||
    event === 'mention' ||
    (event === 'like' &&
      type === 'like' &&
      match[1].startsWith('点赞了您的评论'))
  return [plain(match[1]), { ...quote(match[2]), markdown }]
}
