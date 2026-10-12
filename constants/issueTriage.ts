import { CASE_GUIDE_LINKS } from '~/constants/case'
import type { CaseKind } from '~/constants/case'
import type { LinkReportReason } from '~/types/api/linkHealth'

/**
 * Phenomenon → destination table behind the resource card「遇到问题」entry.
 * Module 05 takes over module 03's single-step form: the dialog now picks the
 * target first (one of the card's links — including folded broken links — or
 * the whole resource), then the phenomenon; each row has exactly one
 * destination. Keep this file the single switch point; do not add a second
 * entry. Module 07/08 swap temporary destinations here only.
 *
 * - Link targets vote through module 04's failure report (`link_report`),
 *   the same submission the per-link「报告失效」quick entry writes; the
 *   interim `resource_link_failure` case kind is no longer created here.
 * -「发在了错误的条目下」(D34) and the D40 rows (runtime / request / other)
 *   stay submittable exactly as module 03 opened them.
 * -「疑似违规或有害内容」is enabled for resource targets with the
 *   `content_violation` case capability module 03 registered.
 */
export type IssueTriageTargetType = 'link' | 'resource'

export type IssueTriageDestination =
  | {
      type: 'link_report'
      reason: LinkReportReason
    }
  | {
      type: 'case'
      kind: CaseKind
      /** Shown above the handler hint and the input, alongside the form. */
      guide?: {
        note: string
        links: readonly { href: string; label: string }[]
      }
    }
  | {
      type: 'guide'
      links: readonly { href: string; label: string }[]
    }

export interface IssueTriagePhenomenon {
  key: string
  label: string
  /** What the user sees under the option: examples of this phenomenon. */
  examples: string
  /** Which step-1 targets this phenomenon applies to. */
  targets: readonly IssueTriageTargetType[]
  destination: IssueTriageDestination
  /** Placeholder guiding what to write, for case destinations only. */
  placeholder?: string
  /** Handler hint sentence shown with the submittable form. */
  handlerHint?: string
  /** Not offered in this batch; registered rows stay single-sourced here. */
  enabled: boolean
}

/**
 * 「求资源或催更」note and links shared by the resource card phenomenon and
 * the game feedback entry (D40): both submit a case and show these above the
 * input. Module 07 decides at launch whether these go to the help board;
 * both entries follow this constant.
 */
export const REQUEST_RESOURCE_GUIDE_NOTE =
  '提交前可以先看内容贡献指南，想自己补充资源也可以直接发布：'

export const REQUEST_RESOURCE_GUIDE_LINKS = [
  { href: CASE_GUIDE_LINKS.contribute, label: '内容贡献指南' }
] as const

const LINK_TARGET = ['link'] as const satisfies readonly IssueTriageTargetType[]
const RESOURCE_TARGET = [
  'resource'
] as const satisfies readonly IssueTriageTargetType[]
const BOTH_TARGETS = [
  'link',
  'resource'
] as const satisfies readonly IssueTriageTargetType[]

/** One scope line for link phenomena; the server returns the real owner. */
export const LINK_PHENOMENON_HANDLER_NOTE =
  '报告是一次投票：累计到阈值后由该链接的归属方（资源盘链接为站方）处理，未达阈值不会通知归属方。'

export const ISSUE_TRIAGE_PHENOMENA: readonly IssueTriagePhenomenon[] = [
  {
    key: 'link_deleted',
    label: '网盘显示已删除、已过期或违规',
    examples: '打开网盘页面看到文件不存在、分享已过期或内容违规',
    targets: LINK_TARGET,
    destination: { type: 'link_report', reason: 'deleted' },
    handlerHint: LINK_PHENOMENON_HANDLER_NOTE,
    enabled: true
  },
  {
    key: 'link_access_condition',
    label: '链接要求付费，或取得方式与发布说明不符',
    examples: '网盘本身正常的登录要求不算失效',
    targets: LINK_TARGET,
    destination: { type: 'link_report', reason: 'access_condition' },
    handlerHint: LINK_PHENOMENON_HANDLER_NOTE,
    enabled: true
  },
  {
    key: 'link_unreachable',
    label: '打不开、超时',
    examples: '页面一直转圈、提示网络错误',
    targets: LINK_TARGET,
    destination: { type: 'link_report', reason: 'unreachable' },
    handlerHint: LINK_PHENOMENON_HANDLER_NOTE,
    enabled: true
  },
  {
    key: 'download_slow',
    label: '下载慢',
    examples: '网盘限速、下载中断',
    targets: BOTH_TARGETS,
    destination: {
      type: 'guide',
      links: [{ href: CASE_GUIDE_LINKS.download, label: '下载相关问题解答' }]
    },
    enabled: true
  },
  {
    key: 'resource_mismatch',
    label: '资源与描述不符',
    examples: '版本和描述不一致、缺少描述里写的文件、内容和条目不符',
    targets: RESOURCE_TARGET,
    destination: { type: 'case', kind: 'resource_mismatch' },
    placeholder: '描述里写的是……，实际拿到的是……',
    enabled: true
  },
  {
    key: 'wrong_patch',
    label: '发在了错误的条目下',
    examples: '这条资源属于另一个游戏',
    targets: RESOURCE_TARGET,
    destination: { type: 'case', kind: 'resource_wrong_patch' },
    placeholder: '这条资源实际属于哪个游戏（游戏名或条目链接）……',
    enabled: true
  },
  {
    key: 'archive_or_runtime',
    label: '解压失败或游戏无法运行',
    examples: '压缩包损坏、解压报错、无法启动、乱码、存档问题',
    targets: RESOURCE_TARGET,
    destination: {
      type: 'case',
      kind: 'resource_runtime',
      guide: {
        note: '可以先按这些说明排查；提交时请写清报错内容和已经试过的方法：',
        links: [
          { href: CASE_GUIDE_LINKS.repairRar, label: '压缩包修复教程' },
          { href: '/doc/notice/start', label: '网站说明和常见问题' }
        ]
      }
    },
    placeholder: '报错信息是……，已经试过……',
    enabled: true
  },
  {
    key: 'request_resource',
    label: '求资源或催更',
    examples: '希望更新版本，或补充其他版本、语言、平台',
    targets: RESOURCE_TARGET,
    destination: {
      type: 'case',
      kind: 'resource_request',
      guide: {
        note: REQUEST_RESOURCE_GUIDE_NOTE,
        links: REQUEST_RESOURCE_GUIDE_LINKS
      }
    },
    placeholder: '希望更新到哪个版本，或想补充的版本、语言、平台是……',
    enabled: true
  },
  {
    key: 'resource_other',
    label: '其他',
    examples: '以上都不符合的资源问题',
    targets: RESOURCE_TARGET,
    destination: { type: 'case', kind: 'resource_other' },
    placeholder: '请描述遇到的问题',
    enabled: true
  },
  {
    key: 'violation',
    label: '疑似违规或有害内容',
    examples: '恶意文件、违法内容',
    targets: RESOURCE_TARGET,
    destination: { type: 'case', kind: 'content_violation' },
    placeholder: '请描述看到的违规或有害内容',
    enabled: true
  }
]

export const enabledIssueTriagePhenomena = (
  target?: IssueTriageTargetType
) =>
  ISSUE_TRIAGE_PHENOMENA.filter(
    (phenomenon) =>
      phenomenon.enabled &&
      (target === undefined || phenomenon.targets.includes(target))
  )

/** A link target always carries a concrete link belonging to the resource. */
export interface IssueTriageLinkTargetOption {
  linkId: number
  label: string
  broken: boolean
}
