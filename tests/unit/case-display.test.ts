import { describe, expect, it } from 'vitest'

import {
  caseClosingNoteError,
  caseLatestProposal,
  caseMessageAuthorLabel,
  caseMessageSide,
  caseResolutionLabel,
  caseResourceStatusLabel,
  caseReviewRequested,
  caseStatusHint,
  caseSystemEventText,
  caseTargetHref,
  caseTargetText,
  caseTextSegments,
  caseViewerStatusText,
  formatCaseDuration,
  formatCaseRemaining
} from '~/components/case/caseDisplay'
import { CASE_GUIDE_LINKS } from '~/constants/case'
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
    // 但在有权识别报告者的视角里服务端不置空作者，null 只可能是账号已注销，
    // 这时叫「报告者」就把处理方说过的话记到了报告者名下
    expect(caseMessageAuthorLabel(makeMessage({ author: null }), true)).toBe(
      '已注销用户'
    )
    // 具名作者不受该参数影响
    expect(
      caseMessageAuthorLabel(
        makeMessage({ author: { id: 2, name: '发布者甲', avatar: '' } }),
        true
      )
    ).toBe('发布者甲')
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

  it('formats compact durations with a floor of one minute', () => {
    expect(formatCaseDuration(0)).toBe('不足 1 分钟')
    expect(formatCaseDuration(-5000)).toBe('不足 1 分钟')
    expect(formatCaseDuration(59_000)).toBe('不足 1 分钟')
    expect(formatCaseDuration(5 * 60_000)).toBe('5 分钟')
    expect(formatCaseDuration(3 * 3_600_000)).toBe('3 小时')
    expect(formatCaseDuration(2 * 86_400_000)).toBe('2 天')
  })

  it('rounds time left up so the countdown matches the 48-hour reminder', () => {
    const hour = 3_600_000
    // D-01: 1 day 23 hours left is the「还有 2 天」reminder window
    expect(formatCaseRemaining(47 * hour)).toBe('2 天')
    expect(formatCaseRemaining(48 * hour)).toBe('2 天')
    expect(formatCaseRemaining(23.5 * hour)).toBe('1 天')
    expect(formatCaseRemaining(59.5 * 60_000)).toBe('1 小时')
    expect(formatCaseRemaining(30 * 60_000)).toBe('30 分钟')
    expect(formatCaseRemaining(30_000)).toBe('不足 1 分钟')
    expect(formatCaseRemaining(-5000)).toBe('不足 1 分钟')
  })

  it('hints publisher escalation and reporter timeout only for timeout kinds', () => {
    const now = Date.parse('2026-09-13T12:00:00.000Z')
    const base = {
      kind: 'resource_mismatch',
      statusChangedAt: '2026-09-13T00:00:00.000Z'
    } as const

    // D22: user-facing wording names the site administrator, not 站方
    expect(
      caseStatusHint({ ...base, ownerType: 'publisher', status: 'open' }, now)
    ).toBe('发布者处理中，约 7 天后提交给网站管理员处理')
    expect(
      caseStatusHint(
        { ...base, ownerType: 'publisher', status: 'waiting_reporter' },
        now
      )
    ).toBe('等待报告者回应，约 14 天后自动结案')
    // 非超时登记类型（如违规举报）即使归属发布者也没有时限提示
    expect(
      caseStatusHint(
        {
          kind: 'content_violation',
          ownerType: 'publisher',
          status: 'open',
          statusChangedAt: base.statusChangedAt
        },
        now
      )
    ).toBeNull()
    // 超过时限后改为等待系统的提示
    expect(
      caseStatusHint(
        { ...base, ownerType: 'publisher', status: 'open' },
        now + 8 * 86_400_000
      )
    ).toBe('已到时限，即将提交给网站管理员处理')
  })

  it('hints staff queue waiting and stays silent for closed cases', () => {
    const now = Date.parse('2026-09-13T12:00:00.000Z')
    const base = {
      kind: 'other',
      statusChangedAt: '2026-09-11T00:00:00.000Z'
    } as const
    expect(
      caseStatusHint({ ...base, ownerType: 'staff', status: 'open' }, now)
    ).toBe('网站管理员处理中，已等待 2 天')
    expect(
      caseStatusHint(
        { ...base, ownerType: 'staff', status: 'waiting_reporter' },
        now
      )
    ).toBe('等待报告者补充，已等待 2 天')
    expect(
      caseStatusHint({ ...base, ownerType: 'staff', status: 'resolved' }, now)
    ).toBeNull()
    expect(
      caseStatusHint({ ...base, ownerType: 'staff', status: 'rejected' }, now)
    ).toBeNull()
  })
})

describe('case conversation and tab helpers', () => {
  it('sides messages without guessing publisher from staff', () => {
    // 系统事件优先于作者判定
    expect(
      caseMessageSide(makeMessage({ kind: 'system', event: 'resolved' }), 5)
    ).toBe('system')
    // 后端脱敏后的报告者只剩 author: null，仍然算报告者一侧
    expect(caseMessageSide(makeMessage({ author: null }), 5)).toBe('reporter')
    expect(
      caseMessageSide(
        makeMessage({ author: { id: 5, name: '报告人', avatar: '' } }),
        5
      )
    ).toBe('reporter')
    // 其他人只可能是处理方（接口不允许第四方回复）
    expect(
      caseMessageSide(
        makeMessage({ author: { id: 8, name: '发布者甲', avatar: '' } }),
        5
      )
    ).toBe('owner')
    // 看不到报告者身份时，具名作者一律按处理方呈现
    expect(
      caseMessageSide(
        makeMessage({ author: { id: 8, name: '发布者甲', avatar: '' } }),
        null
      )
    ).toBe('owner')
  })

  it('refuses to pick a side for a deleted account in an identifying view', () => {
    // author_id 与 reporter_id 都是 onDelete: SetNull，注销后报告者与处理方
    // 的消息长得一模一样，猜哪边都会把一方的话记到另一方名下
    expect(caseMessageSide(makeMessage({ author: null }), 5, true)).toBe(
      'unknown'
    )
    // 报告者本人也注销时 reporterId 同样为 null，依旧不猜
    expect(caseMessageSide(makeMessage({ author: null }), null, true)).toBe(
      'unknown'
    )
    // 匿名视角下 author 为 null 是服务端刻意脱敏，维持原判定
    expect(caseMessageSide(makeMessage({ author: null }), 5, false)).toBe(
      'reporter'
    )
    // 具名作者不受该参数影响，两侧判定照旧
    expect(
      caseMessageSide(
        makeMessage({ author: { id: 5, name: '报告人', avatar: '' } }),
        5,
        true
      )
    ).toBe('reporter')
    expect(
      caseMessageSide(
        makeMessage({ author: { id: 8, name: '发布者甲', avatar: '' } }),
        5,
        true
      )
    ).toBe('owner')
    // 系统事件优先级最高，不受影响
    expect(
      caseMessageSide(
        makeMessage({ kind: 'system', event: 'resolved', author: null }),
        5,
        true
      )
    ).toBe('system')
  })

  it('files a later reporter note under the other reporters (D15)', () => {
    expect(
      caseMessageSide(
        makeMessage({
          kind: 'report',
          author: { id: 9, name: '后来者', avatar: '' }
        }),
        5,
        true
      )
    ).toBe('other-reporter')
  })

  it('switches status wording to first person only in the matching tab', () => {
    expect(
      caseViewerStatusText({ status: 'waiting_reporter' }, 'reported')
    ).toBe('等待我补充')
    expect(caseViewerStatusText({ status: 'waiting_reporter' }, 'owned')).toBe(
      '等待报告者'
    )
    expect(caseViewerStatusText({ status: 'open' }, 'owned')).toBe('等待我处理')
    expect(caseViewerStatusText({ status: 'waiting_owner' }, 'owned')).toBe(
      '等待我处理'
    )
    // 关注的分页保持中立文案
    expect(caseViewerStatusText({ status: 'open' }, 'subscribed')).toBe(
      '等待处理方'
    )
    expect(caseViewerStatusText({ status: 'resolved' }, 'reported')).toBe(
      '已解决'
    )
  })
})

describe('case feedback helpers (D16, D20, D22)', () => {
  const patch = { id: 3, uniqueId: 'abcd1234', name: '条目A' }

  it('links targets to their site pages and gives site feedback none', () => {
    expect(
      caseTargetHref({
        targetType: 'resource',
        targetId: 7,
        target: makeTarget({
          resource: {
            id: 7,
            name: '资源X',
            section: 'galgame',
            patchId: 3,
            patch,
            status: 0
          }
        })
      })
    ).toBe('/abcd1234?tab=resources&resourceSection=galgame&resourceId=7')
    expect(
      caseTargetHref({
        targetType: 'comment',
        targetId: 11,
        target: makeTarget({ targetType: 'comment', patch })
      })
    ).toBe('/abcd1234')
    expect(
      caseTargetHref({
        targetType: 'user',
        targetId: 12,
        target: makeTarget({ targetType: 'user' })
      })
    ).toBe('/user/12')
    expect(
      caseTargetHref({
        targetType: 'site',
        targetId: 0,
        target: makeTarget({ targetType: 'site', label: '站务反馈' })
      })
    ).toBeNull()
    expect(
      caseTargetHref({
        targetType: 'patch',
        targetId: 3,
        target: makeTarget({ targetType: 'patch', patch, deleted: true })
      })
    ).toBeNull()
  })

  it('mirrors the server closing-note rule', () => {
    const resource = {
      kind: 'resource_mismatch',
      targetType: 'resource'
    } as const
    const site = { kind: 'other', targetType: 'site' } as const
    expect(caseClosingNoteError(resource, 'repaired', '')).toBeNull()
    expect(caseClosingNoteError(resource, 'unreproducible', ' ')).toBe(
      '以「无法复现」结案时请写明核对了什么'
    )
    expect(caseClosingNoteError(resource, 'out_of_scope', '不受理')).toBe(
      '以「不在受理范围」结案时请附上下载、压缩包或投稿指南中的一篇链接'
    )
    expect(
      caseClosingNoteError(
        resource,
        'out_of_scope',
        `请看 ${CASE_GUIDE_LINKS.download}`
      )
    ).toBeNull()
    // Site feedback has no guide to link, only a reason (D21).
    expect(caseClosingNoteError(site, 'out_of_scope', '')).toBe(
      '以「不在受理范围」结案时请写明理由'
    )
    expect(caseClosingNoteError(site, 'out_of_scope', '需自助修改')).toBeNull()
  })

  it('finds the proposal of the current round and the review handoff', () => {
    const proposed = [
      makeMessage({
        id: 1,
        kind: 'system',
        event: 'escalated',
        payload: { escalation_trigger: 'review_request' }
      }),
      // The service writes the note first, right before its event.
      makeMessage({
        id: 2,
        body: '已重新上传',
        author: { id: 2, name: '发布者甲', avatar: '' }
      }),
      makeMessage({
        id: 3,
        kind: 'system',
        event: 'close_proposed',
        payload: { resolution: 'repaired' },
        created: '2026-09-20T00:00:00.000Z'
      })
    ]
    expect(caseLatestProposal(proposed)).toEqual({
      resolution: 'repaired',
      note: '已重新上传',
      created: '2026-09-20T00:00:00.000Z'
    })
    expect(caseReviewRequested(proposed)).toBe(true)
    // A later round boundary makes the proposal stale.
    expect(
      caseLatestProposal([
        ...proposed,
        makeMessage({ id: 4, kind: 'system', event: 'resolved' })
      ])
    ).toBeNull()
    expect(
      caseReviewRequested([
        makeMessage({
          kind: 'system',
          event: 'escalated',
          payload: { escalation_trigger: 'timeout' }
        })
      ])
    ).toBe(false)
  })
})

describe('site administrator review helpers (M03-8)', () => {
  const patch = { id: 3, uniqueId: 'abcd1234', name: '条目A' }

  it('opens the reported entry itself from the dashboard (item 4)', () => {
    const comment = {
      targetType: 'comment',
      targetId: 11,
      target: makeTarget({ targetType: 'comment', patch })
    } as const
    const shoutbox = {
      targetType: 'shoutbox',
      targetId: 14,
      target: makeTarget({ targetType: 'shoutbox' })
    } as const

    expect(caseTargetHref(comment, { forAdmin: true })).toBe(
      '/abcd1234?tab=comments&commentId=11'
    )
    expect(caseTargetHref(comment)).toBe('/abcd1234')
    expect(
      caseTargetHref(
        {
          targetType: 'rating',
          targetId: 13,
          target: makeTarget({ targetType: 'rating', patch })
        },
        { forAdmin: true }
      )
    ).toBe('/abcd1234?tab=rating&ratingId=13')
    expect(caseTargetHref(shoutbox, { forAdmin: true })).toBe(
      '/dashboard/shoutbox?shoutbox=14'
    )
    expect(caseTargetHref(shoutbox)).toBeNull()
    expect(
      caseTargetHref(
        {
          ...comment,
          target: makeTarget({ targetType: 'comment', patch, deleted: true })
        },
        { forAdmin: true }
      )
    ).toBeNull()
  })

  it('names the resource state and falls back for an unknown one (item 8)', () => {
    expect(caseResourceStatusLabel(0)).toBe('公开')
    expect(caseResourceStatusLabel(1)).toBe('已隐藏')
    expect(caseResourceStatusLabel(2)).toBe('待审核')
    expect(caseResourceStatusLabel(9)).toBe('状态 9')
  })

  it('links only standalone guide paths in dialogue text (item 20)', () => {
    expect(
      caseTextSegments(
        `请先看 ${CASE_GUIDE_LINKS.download}。解压见（${CASE_GUIDE_LINKS.repairRar}）`
      )
    ).toEqual([
      { type: 'text', text: '请先看 ' },
      {
        type: 'guide',
        text: CASE_GUIDE_LINKS.download,
        href: CASE_GUIDE_LINKS.download
      },
      { type: 'text', text: '。解压见（' },
      {
        type: 'guide',
        text: CASE_GUIDE_LINKS.repairRar,
        href: CASE_GUIDE_LINKS.repairRar
      },
      { type: 'text', text: '）' }
    ])
    // Another site's URL or a longer path keeps the text as it is.
    for (const text of [
      `https://example.com${CASE_GUIDE_LINKS.download}`,
      `${CASE_GUIDE_LINKS.contribute}-old`,
      `/mirror${CASE_GUIDE_LINKS.contribute}`
    ]) {
      expect(caseTextSegments(text)).toEqual([{ type: 'text', text }])
    }
    expect(caseTextSegments('')).toEqual([])
  })

  it('asks for a reason when declining (D25)', () => {
    const suggestion = { kind: 'patch_info', targetType: 'patch' } as const
    expect(caseClosingNoteError(suggestion, 'declined', ' ')).toBe(
      '以「不采纳」结案时请写明理由'
    )
    expect(
      caseClosingNoteError(suggestion, 'declined', '发售日期以官网为准')
    ).toBeNull()
  })

  it('drops a proposal the site administrator already answered (item 15)', () => {
    const publisher = { id: 2, name: '发布者甲', avatar: '' }
    const proposed = [
      makeMessage({ id: 1, body: '已重新上传', author: publisher }),
      makeMessage({
        id: 2,
        kind: 'system',
        event: 'close_proposed',
        payload: { resolution: 'repaired' }
      })
    ]
    const replyBy = (id: number, author: CaseMessage['author']) =>
      makeMessage({ id, body: '回复', author })

    // The reporter or the proposer talking on leaves it open.
    expect(
      caseLatestProposal(
        [
          ...proposed,
          replyBy(3, { id: 5, name: '报告者', avatar: '' }),
          replyBy(4, publisher)
        ],
        5
      )
    ).toMatchObject({ resolution: 'repaired', note: '已重新上传' })
    expect(
      caseLatestProposal(
        [...proposed, replyBy(3, { id: 90, name: '网站管理员', avatar: '' })],
        5
      )
    ).toBeNull()
  })
})
