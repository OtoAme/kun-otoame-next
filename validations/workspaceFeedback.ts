import type { z } from 'zod'

export type WorkspaceValidationFeedback = {
  message: string
  fields: Array<{ path: string; message: string }>
}

const labels: Record<string, string> = {
  name: '资源名称',
  section: '资源分区',
  note: '说明',
  type: '资源类型',
  language: '资源语言',
  platform: '资源平台',
  links: '资源链接',
  baseLinks: '原链接及版本',
  page: '页码',
  limit: '每页数量',
  query: '搜索内容',
  view: '列表视图',
  status: '状态筛选',
  patchId: '游戏编号',
  resourceId: '资源编号',
  linkId: '链接编号',
  linkVersion: '链接版本',
  maintenanceRevision: '维护版本',
  action: '维护操作',
  days: '暂缓天数',
  basis: '链接状态',
  evidenceRound: '健康轮次',
  health: '健康状态',
  healthChangedAt: '状态更新时间'
}
const linkLabels: Record<string, string> = {
  id: '编号',
  version: '版本',
  storage: '存储类型',
  content: '地址',
  size: '大小',
  code: '提取码',
  password: '解压码',
  hash: '校验值',
  uploadId: '上传登记'
}
const editableKeys = new Set([
  'storage',
  'content',
  'size',
  'code',
  'password',
  'hash',
  'uploadId'
])
const approvedReasons = new Set([
  '不能包含空字符，请删除后重试',
  'OtomeGame 资源中包含不允许的资源类型',
  'OtomeGame 补丁中包含不允许的资源类型',
  '当前资源类型下包含不允许的平台',
  '资料集或工具不允许选择中文支持类型',
  '请选择中文支持情况：官中、民汉、机翻、生肉',
  '已发布条目不支持投稿状态筛选',
  '链接编辑基点不完整或存在重复 ID',
  '请保留链接编号及版本，或填写完整可编辑链接信息',
  '请输入资源链接',
  '请先上传资源文件'
])

const fieldFor = (path: z.ZodIssue['path']) => {
  const root = path[0]
  if (typeof root !== 'string' || !Object.hasOwn(labels, root))
    return { path: '', label: '提交内容', key: '' }
  if (root === 'links' || root === 'baseLinks') {
    const index = path[1]
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 9
    )
      return { path: root, label: labels[root], key: root }
    const prefix = `${root}.${index}`
    const title = `${root === 'baseLinks' ? '原链接' : '链接'} #${index + 1}`
    const key = path[2]
    if (
      typeof key === 'string' &&
      Object.hasOwn(linkLabels, key) &&
      (root === 'links' || key === 'id' || key === 'version')
    )
      return {
        path: `${prefix}.${key}`,
        label: `${title} · ${linkLabels[key]}`,
        key
      }
    return { path: prefix, label: title, key: root }
  }
  if (
    root === 'basis' &&
    typeof path[1] === 'string' &&
    Object.hasOwn(labels, path[1])
  )
    return {
      path: `basis.${path[1]}`,
      label: `链接状态 · ${labels[path[1]]}`,
      key: path[1]
    }
  return { path: root, label: labels[root], key: root }
}

/** A failed editable link must not be described as a missing protected version. */
const unionIssues = (issue: z.ZodInvalidUnionIssue): z.ZodIssue[] => {
  const branches = issue.unionErrors.slice(0, 4).map((error) => error.issues)
  if (issue.path[0] !== 'links') return branches[0] ?? []
  // A supplied retention version makes a mixed shape ambiguous. Explain its
  // reference/shape errors instead of inventing missing editable fields.
  if (
    branches
      .at(-1)
      ?.some(
        (item) =>
          item.code === 'unrecognized_keys' && item.keys.includes('version')
      )
  )
    return branches[0] ?? []
  const suppliedEditableIssue = branches.find((branch) =>
    branch.some(
      (item) =>
        editableKeys.has(String(item.path.at(-1))) &&
        !(item.code === 'invalid_type' && item.received === 'undefined')
    )
  )
  if (suppliedEditableIssue) return suppliedEditableIssue
  const editable = branches.at(-1) ?? []
  const missing = editable.filter(
    (item) =>
      item.code === 'invalid_type' &&
      item.received === 'undefined' &&
      editableKeys.has(String(item.path.at(-1)))
  )
  if (
    missing.length === 1 &&
    editable.every(
      (item) => item === missing[0] || item.code === 'unrecognized_keys'
    )
  )
    return editable
  if (
    branches
      .at(-1)
      ?.some(
        (item) =>
          item.code === 'invalid_type' &&
          item.received === 'undefined' &&
          editableKeys.has(String(item.path.at(-1)))
      )
  )
    return [
      {
        code: 'custom',
        path: issue.path,
        message: '请保留链接编号及版本，或填写完整可编辑链接信息'
      }
    ]
  if (
    branches[0]?.some(
      (item) =>
        item.code === 'unrecognized_keys' &&
        item.keys.some((key) => editableKeys.has(key))
    )
  )
    return branches.at(-1) ?? []
  return branches[0] ?? []
}

const flatten = (issues: z.ZodIssue[], depth = 0): z.ZodIssue[] =>
  issues
    .slice(0, 32)
    .flatMap((issue) =>
      issue.code === 'invalid_union' && depth < 4
        ? flatten(unionIssues(issue), depth + 1)
        : [issue]
    )

const reasonFor = (issue: z.ZodIssue, key: string) => {
  if (issue.code === 'unrecognized_keys')
    return '包含不支持的字段，请检查提交内容'
  if (key === 'days') return '请选择 1 天或 3 天'
  if (issue.code === 'custom' && approvedReasons.has(issue.message))
    return issue.message
  if (issue.code === 'invalid_type') {
    if (issue.received === 'undefined') return '请填写此项'
    if (issue.expected === 'string') return '请填写文本'
    if (issue.expected === 'array') return '请选择有效的选项列表'
    if (issue.expected === 'number') return '请填写有效的数字'
    return '格式不正确，请检查此项'
  }
  if (issue.code === 'too_big' || issue.code === 'too_small') {
    const bound = issue.code === 'too_big' ? issue.maximum : issue.minimum
    if (
      typeof bound === 'number' &&
      Number.isSafeInteger(bound) &&
      bound >= 0 &&
      bound <= 2147483647
    ) {
      if (issue.type === 'string')
        return issue.code === 'too_big'
          ? `最多 ${bound} 个字符`
          : `至少填写 ${bound} 个字符`
      if (issue.type === 'array')
        return issue.code === 'too_big'
          ? `最多 ${bound} 项`
          : `至少选择 ${bound} 项`
    }
    return '超出允许范围，请检查此项'
  }
  if (key === 'size') return '请填写 MB 或 GB 格式的资源大小（如 1MB、1GB）'
  if (key === 'uploadId') return '上传登记无效，请重新上传文件'
  if (key === 'storage') return '请选择有效的存储类型'
  if (key === 'type') return '请选择当前分区允许的资源类型及中文支持情况'
  if (key === 'language') return '请选择有效的资源语言'
  if (key === 'platform') return '请选择当前资源类型允许的平台'
  if (key === 'section') return '请选择游戏资源或工具补丁分区'
  if (key === 'baseLinks' || key === 'basis')
    return '状态信息不完整，请确认最新版本后重试'
  return '格式不正确，请检查此项'
}

/** Only trusted labels/reasons and bounded known paths may cross the wire. */
export const workspaceValidationFeedback = (
  error: z.ZodError
): WorkspaceValidationFeedback => {
  const fields: WorkspaceValidationFeedback['fields'] = []
  const seen = new Set<string>()
  for (const issue of flatten(error.issues)) {
    const field = fieldFor(issue.path)
    if (seen.has(field.path)) continue
    seen.add(field.path)
    fields.push({
      path: field.path,
      message: `${field.label}：${reasonFor(issue, field.key)}`
    })
    if (fields.length === 8) break
  }
  if (!fields.length)
    fields.push({ path: '', message: '提交内容：请检查格式后重试' })
  return { message: fields.map((field) => field.message).join('；'), fields }
}
