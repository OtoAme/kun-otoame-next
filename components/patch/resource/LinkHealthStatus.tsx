import type { PatchResourceHealthLink } from '~/types/api/patch'
import {
  linkCheckSummaryText,
  linkProcessingStateText,
  linkReportCountText,
  maintenanceRestrictionText
} from './linkHealthDisplay'

interface Props {
  link: PatchResourceHealthLink
}

/**
 * Per-mirror dual facts (module 10): machine observation + time, recent user
 * feedback, and the site's processing state — three independent lines that
 * never overwrite each other.
 */
export const LinkHealthStatus = ({ link }: Props) => {
  const processing = linkProcessingStateText(link)
  const restrictionText = maintenanceRestrictionText(link.maintenance)
  const warn = link.health !== 'ok'
  // 已定规则的期限/去向提示：disputed 需要人工复核，不显示 7 天自动判坏
  const deadlineHint =
    link.health === 'suspect'
      ? '疑似失效满 7 天仍未核实或补链，将自动标记失效；回复不会延长期限。'
      : link.health === 'broken' && link.ownerType === 'staff'
        ? '资源盘失效链接留在站方待办，等待补链或移除。'
        : ''

  return (
    <div className="space-y-1 text-sm" aria-label="链接状态">
      <p className="text-default-500">
        {linkCheckSummaryText(link.latestCheck)}
      </p>
      <p className={warn ? 'text-warning-600' : 'text-default-500'}>
        {linkReportCountText(link.recentReportCount)}
      </p>
      {processing && (
        <p
          className={
            link.health === 'broken' ? 'text-danger' : 'text-warning-600'
          }
        >
          {processing}
        </p>
      )}
      {deadlineHint && <p className="text-default-500">{deadlineHint}</p>}
      {restrictionText && (
        <p className="break-all text-warning-600">{restrictionText}</p>
      )}
    </div>
  )
}
