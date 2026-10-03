import { CASE_GUIDE_LINKS } from '~/constants/case'
import type { CaseKind } from '~/constants/case'

/**
 * Phenomenon → destination table behind the resource card「报告问题」entry
 * (module 03 D17). Module 05 takes this file over: it adds the first step
 * (choosing a link or the whole resource), turns on the rows that are
 * registered but hidden here, and points「链接失效」at module 04's failure
 * report. Keep it the single switch point; do not add a second entry.
 */
export type IssueTriageDestination =
  | { type: 'case'; kind: CaseKind }
  | {
      type: 'guide'
      links: readonly { href: string; label: string }[]
      /** Sentence above the links; the entry falls back to a generic one. */
      note?: string
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
 * 「求资源或催更」answer shared with the game feedback entry. Module 07
 * points the note and the links at the help board once that board ships.
 */
export const REQUEST_RESOURCE_GUIDE_NOTE =
  '求资源、催更需要等待求助区建成，届时可以在求助区发布，现在不需要提交。想自己补充资源，可以先看这些说明：'

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
      type: 'guide',
      links: [
        { href: CASE_GUIDE_LINKS.repairRar, label: '压缩包修复教程' },
        { href: '/doc/notice/start', label: '网站说明和常见问题' }
      ]
    },
    enabled: true
  },
  {
    key: 'request_resource',
    label: '求资源或催更',
    examples: '想要的资源不在这里、希望更新版本',
    destination: {
      type: 'guide',
      links: REQUEST_RESOURCE_GUIDE_LINKS,
      note: REQUEST_RESOURCE_GUIDE_NOTE
    },
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
    key: 'violation',
    label: '疑似违规或有害内容',
    examples: '恶意文件、违法内容',
    destination: { type: 'case', kind: 'content_violation' },
    enabled: false
  }
]

export const enabledIssueTriagePhenomena = () =>
  ISSUE_TRIAGE_PHENOMENA.filter((phenomenon) => phenomenon.enabled)
