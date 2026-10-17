import { LINK_CHECK_PROVIDER_LABELS } from '~/constants/linkHealth'
import type {
  LinkCheckReason,
  LinkCheckResponse,
  LinkHealthMutationResponse
} from '~/types/api/linkHealth'

export interface LinkCheckFeedback {
  type: 'success' | 'error' | 'info'
  message: string
}

export const INVALID_LINK_CHECK_FEEDBACK: LinkCheckFeedback = {
  type: 'error',
  message: '未取得有效检测结果，请刷新后重试'
}

const UNKNOWN_FEEDBACK: Record<
  Exclude<LinkCheckReason, `share_${string}` | 'unsupported'>,
  LinkCheckFeedback
> = {
  access_unverified: {
    type: 'info',
    message: '分享受限或需要访问验证，暂时无法判断链接状态'
  },
  rate_limited: {
    type: 'error',
    message: '检测服务请求过于频繁，请稍后重试'
  },
  timeout: {
    type: 'error',
    message: '检测超时，暂时无法判断链接状态，请稍后重试'
  },
  unavailable: {
    type: 'error',
    message: '检测服务暂时不可用，无法判断链接状态，请稍后重试'
  },
  invalid_response: {
    type: 'error',
    message: '检测服务响应异常，无法判断链接状态，请稍后重试'
  },
  untrusted_result: {
    type: 'error',
    message: '检测结果未通过校验，无法判断链接状态，请稍后重试'
  }
}

/** Classify this attempt, never transport success or a previous observation. */
export const linkCheckFeedback = (
  response: LinkHealthMutationResponse & Partial<LinkCheckResponse>
): LinkCheckFeedback => {
  const result = response.result
  if (
    !result ||
    !['observed', 'failed'].includes(response.check ?? '') ||
    typeof result.failed !== 'boolean' ||
    (response.check === 'failed') !== result.failed ||
    typeof result.stale !== 'boolean' ||
    !Number.isFinite(Date.parse(result.attemptedAt)) ||
    (result.failed
      ? result.verdict !== 'unknown' || result.checkedAt !== null
      : !result.checkedAt || !Number.isFinite(Date.parse(result.checkedAt)))
  ) {
    return INVALID_LINK_CHECK_FEEDBACK
  }
  if (result.stale) {
    return { type: 'info', message: '检测结果已过期，请重新检测' }
  }
  const latest = response.link.latestCheck
  if (
    !result.failed &&
    latest &&
    (latest.attemptedAt !== result.attemptedAt ||
      latest.checkedAt !== result.checkedAt ||
      latest.verdict !== result.verdict ||
      latest.reason !== result.reason)
  ) {
    return {
      type: 'info',
      message: '本次检测结果已被更新，请查看最新检测信息'
    }
  }
  if (result.verdict === 'unknown') {
    if (result.reason === 'unsupported') {
      const label =
        result.provider &&
        Object.hasOwn(LINK_CHECK_PROVIDER_LABELS, result.provider)
          ? `${LINK_CHECK_PROVIDER_LABELS[result.provider]}链接`
          : '此类链接'
      return {
        type: 'info',
        message: `本站暂未支持${label}检测，无法判断链接状态`
      }
    }
    return Object.hasOwn(UNKNOWN_FEEDBACK, result.reason)
      ? UNKNOWN_FEEDBACK[result.reason]
      : INVALID_LINK_CHECK_FEEDBACK
  }
  if (result.verdict === 'broken') {
    const reason = {
      share_deleted: '分享已删除',
      share_cancelled: '分享已取消',
      share_expired: '分享已过期',
      share_blocked: '分享已屏蔽'
    }[result.reason]
    return reason
      ? { type: 'error', message: `检测确认失效：${reason}` }
      : INVALID_LINK_CHECK_FEEDBACK
  }
  if (result.verdict !== 'available' || result.reason !== 'share_available') {
    return INVALID_LINK_CHECK_FEEDBACK
  }
  if (response.link.health === 'disputed') {
    return {
      type: 'info',
      message: '检测端可访问，但链接仍有争议，需要继续复核'
    }
  }
  if (response.link.health === 'broken') {
    return {
      type: 'info',
      message: '检测端可访问，但链接仍标记为已失效，请核实后处理'
    }
  }
  if (response.link.health === 'suspect') {
    return { type: 'info', message: '检测端可访问，但链接仍待核实' }
  }
  return { type: 'success', message: '检测端可访问' }
}
