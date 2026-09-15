import { describe, expect, it } from 'vitest'

import {
  caseMessageAuthorLabel,
  caseResolutionLabel,
  caseSystemEventText,
  caseTargetText
} from '~/components/case/caseDisplay'
import type { CaseMessage, CaseSummary } from '~/types/api/case'

const makeMessage = (overrides: Partial<CaseMessage>): CaseMessage => ({
  id: 1,
  kind: 'reply',
  event: null,
  body: '',
  author: null,
  payload: null,
  created: '2026-09-13T00:00:00.000Z',
  ...overrides
})

const makeTarget = (
  overrides: Partial<CaseSummary['target']>
): CaseSummary['target'] => ({
  targetType: 'resource',
  targetId: 7,
  deleted: false,
  patch: null,
  resource: null,
  ...overrides
})

describe('caseDisplay helpers', () => {
  it('labels message authors without inventing identity', () => {
    expect(
      caseMessageAuthorLabel(makeMessage({ kind: 'system', event: 'resolved' }))
    ).toBe('系统')
    expect(
      caseMessageAuthorLabel(
        makeMessage({ author: { id: 2, name: '发布者甲', avatar: '' } })
      )
    ).toBe('发布者甲')
    // 后端裁剪后的匿名报告者：author 为 null，前端只能显示「报告者」
    expect(caseMessageAuthorLabel(makeMessage({ author: null }))).toBe('报告者')
  })

  it('renders system events from body and never leaks payload identity fields', () => {
    expect(
      caseSystemEventText(
        makeMessage({
          kind: 'system',
          event: 'escalated',
          body: '发布者 7 天未处理，已升级为站方处理'
        })
      )
    ).toBe('发布者 7 天未处理，已升级为站方处理')

    expect(
      caseSystemEventText(
        makeMessage({ kind: 'system', event: 'hidden', body: '' })
      )
    ).toBe('资源已被隐藏')

    // body 为空时回落到事件文案并附结论，payload 中的身份字段不参与渲染
    const resolved = makeMessage({
      kind: 'system',
      event: 'resolved',
      body: '',
      payload: {
        resolution: 'repaired',
        from_owner_id: 42,
        actor_type: 'staff'
      }
    })
    const text = caseSystemEventText(resolved)
    expect(text).toBe('已结案：已修正')
    expect(text).not.toContain('42')
  })

  it('formats targets with deleted placeholder and patch context', () => {
    expect(
      caseTargetText({
        targetType: 'resource',
        targetId: 7,
        target: makeTarget({ deleted: true })
      })
    ).toBe('资源已删除')

    expect(
      caseTargetText({
        targetType: 'patch',
        targetId: 3,
        target: makeTarget({
          targetType: 'patch',
          patch: { id: 3, uniqueId: 'abc', name: '条目A' }
        })
      })
    ).toBe('条目A')

    expect(
      caseTargetText({
        targetType: 'resource',
        targetId: 7,
        target: makeTarget({
          resource: {
            id: 7,
            name: '资源X',
            section: 'galgame',
            patchId: 3,
            patch: { id: 3, uniqueId: 'abc', name: '条目A' },
            status: 0
          },
          patch: { id: 3, uniqueId: 'abc', name: '条目A' }
        })
      })
    ).toBe('资源X（条目A）')

    expect(
      caseTargetText({
        targetType: 'comment',
        targetId: 9,
        target: makeTarget({ targetType: 'comment', label: '评论摘要' })
      })
    ).toBe('评论摘要')

    expect(
      caseTargetText({
        targetType: 'user',
        targetId: 11,
        target: makeTarget({ targetType: 'user' })
      })
    ).toBe('用户 #11')
  })

  it('maps resolution labels and keeps null as null', () => {
    expect(caseResolutionLabel('moved')).toBe('已移动')
    expect(caseResolutionLabel(null)).toBeNull()
  })
})
