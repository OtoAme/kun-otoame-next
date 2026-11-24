import { describe, expect, it } from 'vitest'
import type { Message } from '~/types/api/message'
import {
  formatCommentReplyNotification,
  notificationContent
} from '~/utils/notificationContent'

describe('notification template and quoted content', () => {
  const examples: [Message['eventType'], string, string, string[]][] = [
    [
      'comment-reply',
      'comment',
      '回复了您的评论：第一行：说明\n第二行 <b>原文</b>',
      ['第一行：说明\n第二行 <b>原文</b>']
    ],
    [
      'mention',
      'mention',
      '测试用户 在「测试游戏」的评论区提到了您\n你好\n后续正文',
      ['你好\n后续正文']
    ],
    [
      'submission-result',
      'system',
      '您的投稿《示例》需要修改后重新提交。原因: 请补充截图',
      ['请补充截图']
    ],
    [
      'content-adjusted',
      'system',
      '管理员修改了你发布的游戏资源「示例」。\n\n修改内容:\n类型已调整',
      []
    ],
    [
      'case-update',
      'system',
      '资源「示例」有新的回复：请再试一次',
      ['请再试一次']
    ],
    [
      'case-follow',
      'system',
      '资源「示例」已有处理结果：已修正：已补上图片',
      ['已补上图片']
    ],
    [
      'case-update',
      'system',
      '链接问题已有处理结果：开启者撤回：报告者已撤回，事项结束。',
      []
    ],
    [
      null,
      'pr',
      '拒绝了您的更新请求... 理由: 第一行\n第二行',
      ['第一行\n第二行']
    ],
    [null, 'pr', '合并了您的更新请求!', []],
    [null, 'system', '回复了您的评论：这是历史系统通知\n保留完整内容', []],
    [
      'site-announcement',
      'system',
      '回复了您的评论：这也是公告原文\n保留完整内容',
      ['回复了您的评论：这也是公告原文\n保留完整内容']
    ],
    ['follow', 'follow', '关注了您!', []],
    [
      'feedback-result',
      'system',
      '您的反馈已处理!\n\n反馈原因: 链接为空\n反馈处理回复: 无处理留言',
      ['链接为空']
    ],
    [
      'report-result',
      'report',
      '您的小喇叭举报已受理!\n\n举报原因: 原文\n处理回复: 处理\n回复',
      ['原文', '处理\n回复']
    ],
    [
      null,
      'report',
      '您的举报已处理!\n\n举报类型: 评论\n举报原因: 原文\n举报处理回复: 已处理',
      ['原文']
    ],
    [
      'feedback-result',
      'system',
      '您的反馈已处理!\n\n反馈原因: 第一行\n反馈处理回复: 引用的标签\n反馈处理回复: 回应',
      []
    ]
  ]
  it('labels the reply and quotes its own multiline text separately from the original comment', () => {
    const parts = notificationContent({
      type: 'comment',
      eventType: 'comment-reply',
      content:
        '回复了你的评论「原评论」\nTA 的回复内容：\n第一行\n回复了您的评论：仍然是回复正文'
    })
    expect(
      parts.filter((part) => part.quoted).map((part) => part.text)
    ).toEqual(['第一行\n回复了您的评论：仍然是回复正文'])
    expect(parts[0].text).toContain('原评论')
    expect(parts[0].text).toContain('TA 的回复内容')
  })

  it('marks a shortened original comment and preserves the full reply', () => {
    const original = '🌸'.repeat(107)
    for (const [input, expected] of [
      [original, original],
      [original + '尾', original + '…']
    ]) {
      const content = formatCommentReplyNotification(input, '正文')
      const parts = notificationContent({
        type: 'comment',
        eventType: 'comment-reply',
        content
      })
      expect(parts[0].inlineExcerpt?.source).toBe(expected)
      expect(parts[1].text).toBe('正文')
    }
  })

  it('fits a maximum-length comment in storage and clips at a Unicode character boundary', () => {
    const content = formatCommentReplyNotification(
      '原评论\n有「标点」',
      '🌸'.repeat(10007)
    )
    const parts = notificationContent({
      type: 'comment',
      eventType: 'comment-reply',
      content
    })
    expect(Array.from(content)).toHaveLength(10007)
    expect(parts[1].text).toMatch(/^🌸+…$/u)
  })

  it.each(examples)(
    'preserves %s/%s text and quotes only its input fields (%s)',
    (eventType, type, content, quotes) => {
      const parts = notificationContent({ type, eventType, content })
      expect(parts.map((part) => part.text).join('')).toBe(content)
      expect(
        parts.filter((part) => part.quoted).map((part) => part.text)
      ).toEqual(quotes)
    }
  )
})
