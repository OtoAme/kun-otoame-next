import { describe, expect, it } from 'vitest'
import { notificationContent } from '~/utils/notificationContent'

describe('notification template and quoted content', () => {
  it('separates a comment excerpt while preserving punctuation and line breaks', () => {
    const content = '回复了您的评论：第一行：说明\n第二行 <b>原文</b>'
    const parts = notificationContent({
      content,
      type: 'comment',
      eventType: 'comment-reply'
    })
    expect(parts).toEqual({
      template: '回复了您的评论：',
      body: '第一行：说明\n第二行 <b>原文</b>'
    })
    expect(parts.template + parts.body).toBe(content)
  })

  it('separates mention text from the generated mention sentence', () => {
    expect(
      notificationContent({
        type: 'mention',
        eventType: 'mention',
        content: '测试用户 在「测试游戏」的评论区提到了您\n你好\n后续正文'
      })
    ).toEqual({
      template: '测试用户 在「测试游戏」的评论区提到了您\n',
      body: '你好\n后续正文'
    })
  })

  it.each([
    [
      'submission-result',
      '您的投稿《示例》需要修改后重新提交。原因: 请补充截图',
      '请补充截图'
    ],
    [
      'content-adjusted',
      '管理员修改了你发布的游戏资源「示例」。\n\n修改内容:\n类型已调整',
      '类型已调整'
    ],
    ['case-update', '资源「示例」有新的回复：请再试一次', '请再试一次']
  ] as const)(
    'quotes the body of %s without changing the stored text',
    (eventType, content, body) => {
      const parts = notificationContent({ type: 'system', eventType, content })
      expect(parts.body).toBe(body)
      expect(parts.template + parts.body).toBe(content)
    }
  )

  it('preserves an unsplit historical system notice and arbitrary announcement content', () => {
    for (const eventType of [null, 'site-announcement'] as const) {
      const content = '回复了您的评论：这也是公告原文\n保留完整内容'
      expect(
        notificationContent({ type: 'system', eventType, content })
      ).toEqual({ template: '', body: content })
    }
  })
})
