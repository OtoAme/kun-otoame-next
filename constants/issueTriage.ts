import { CASE_GUIDE_LINKS } from '~/constants/case'
import type { CaseKind } from '~/constants/case'

/**
 * Phenomenon → destination table behind the resource card「报告问题」entry
 * (module 03 D17). Module 05 takes this file over: it adds the first step
 * (choosing a link or the whole resource), turns on the rows that are
 * registered but hidden here, and points「链接失效」at module 04's failure
 * report. Keep it the single switch point; do not add a second entry.
 *
 * D40: a case destination may carry a `guide` — a guiding sentence plus
 * links rendered above the handler hint and the input.
 */
export type IssueTriageDestination =
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
  destination: IssueTriageDestination
  /** Placeholder guiding what to write, for case destinations only. */
  placeholder?: string
  /** Registered for module 05 but not shown in this batch. */
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

export const ISSUE_TRIAGE_PHENOMENA: readonly IssueTriagePhenomenon[] = [
  {
    key: 'resource_mismatch',
    label: '资源与描述不符',
    examples: '版本和描述不一致、缺少描述里写的文件、内容和条目不符',
    destination: { type: 'case', kind: 'resource_mismatch' },
    placeholder: '描述里写的是……，实际拿到的是……',
    enabled: true
  },
  {
    key: 'link_failure',
    label: '链接失效',
    examples: '链接打不开、网盘显示已删除或已过期、要求付费',
    destination: { type: 'case', kind: 'resource_link_failure' },
    placeholder: '哪一条链接（网盘名称或第几条），打开后看到的提示是……',
    enabled: true
  },
  {
    key: 'download_slow',
    label: '下载慢',
    examples: '网盘限速、下载中断',
    destination: {
      type: 'guide',
      links: [{ href: CASE_GUIDE_LINKS.download, label: '下载相关问题解答' }]
    },
    enabled: true
  },
  {
    key: 'archive_or_runtime',
    label: '解压失败或游戏无法运行',
    examples: '压缩包损坏、解压报错、无法启动、乱码、存档问题',
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
    key: 'wrong_patch',
    label: '发在了错误的条目下',
    examples: '这条资源属于另一个游戏',
    destination: { type: 'case', kind: 'resource_wrong_patch' },
    placeholder: '这条资源实际属于哪个游戏（游戏名或条目链接）……',
    enabled: true
  },
  {
    key: 'resource_other',
    label: '其他',
    examples: '以上都不符合的资源问题',
    destination: { type: 'case', kind: 'resource_other' },
    placeholder: '请描述遇到的问题',
    enabled: true
  },
  {
    key: 'violation',
    label: '疑似违规或有害内容',
    examples: '恶意文件、违法内容',
    destination: { type: 'case', kind: 'content_violation' },
    enabled: false
  }
]

export const enabledIssueTriagePhenomena = () =>
  ISSUE_TRIAGE_PHENOMENA.filter((phenomenon) => phenomenon.enabled)
