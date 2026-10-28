import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/**
 * 维护文档的机械检查：本地链接目标、独立占位、新增文档标题、新页面入口。
 * 只读取仓库文件与本地 git 元数据，不访问网络、数据库或应用服务。
 */

export const MAINTAINED_FILES = ['README.md', 'AGENTS.md']

export const MAINTAINED_DIRECTORIES = ['docs/', 'skills/', 'deployment/']

// 历史计划与设计稿只保存讨论背景，不按维护文档要求检查。
export const EXCLUDED_DIRECTORIES = ['docs/superpowers/']

export type MarkdownNode = {
  type: string
  value?: string
  url?: string
  identifier?: string
  depth?: number
  children?: MarkdownNode[]
  position?: { start?: { line?: number } }
}

export type MarkdownLink = {
  kind: 'link' | 'image' | 'definition'
  url: string
  line: number
}

export type ClassifiedLink =
  | { kind: 'remote' | 'fragment' | 'site-route'; url: string }
  | { kind: 'local'; url: string; target: string }
  | { kind: 'invalid'; url: string; reason: string }

export type DocIssue = {
  file: string
  line?: number
  message: string
}

export type CheckMode = 'working-tree' | 'base' | 'explicit'

export type CheckReport = {
  mode: CheckMode
  base?: string
  root: string
  documents: string[]
  changed: string[]
  added: string[]
  deleted: string[]
  linkCount: number
  localLinkCount: number
  issues: DocIssue[]
}

export type CheckOptions = {
  root: string
  base?: string
  files?: string[]
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])

const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const PLACEHOLDER = /^(?:TODO|TBD|FIXME|待补充|待填写|待完善)\s*[:：]?$/i

const toPosix = (value: string) => value.split(path.sep).join('/')

export const isMaintainedDoc = (relPath: string): boolean => {
  const rel = relPath.split('\\').join('/')
  if (!rel.endsWith('.md')) return false
  if (MAINTAINED_FILES.includes(rel)) return true
  if (EXCLUDED_DIRECTORIES.some((directory) => rel.startsWith(directory))) {
    return false
  }
  return MAINTAINED_DIRECTORIES.some(
    (directory) => rel.startsWith(directory) && rel.length > directory.length
  )
}

export const parseMarkdown = (content: string): MarkdownNode =>
  processor.parse(content) as unknown as MarkdownNode

const walk = (node: MarkdownNode, visit: (node: MarkdownNode) => void) => {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

const lineOf = (node: MarkdownNode) => node.position?.start?.line ?? 1

const REFERENCE_NODE_TYPES = new Set(['linkReference', 'imageReference'])

export const collectLinks = (tree: MarkdownNode): MarkdownLink[] => {
  const definitions = new Map<string, { url: string; line: number }>()
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier) {
      if (!definitions.has(node.identifier)) {
        definitions.set(node.identifier, {
          url: node.url ?? '',
          line: lineOf(node)
        })
      }
    }
  })

  const links: MarkdownLink[] = []
  walk(tree, (node) => {
    if (node.type === 'link' || node.type === 'image') {
      links.push({
        kind: node.type,
        url: node.url ?? '',
        line: lineOf(node)
      })
      return
    }
    if (!REFERENCE_NODE_TYPES.has(node.type) || !node.identifier) return
    const definition = definitions.get(node.identifier)
    if (!definition) return
    links.push({
      kind: node.type === 'imageReference' ? 'image' : 'link',
      url: definition.url,
      line: lineOf(node)
    })
  })
  return links
}

const PLACEHOLDER_BLOCKS = new Set(['paragraph', 'heading', 'tableCell'])
const PLACEHOLDER_FORMATTING = new Set(['text', 'strong', 'emphasis', 'delete'])

const containsInlineCode = (node: MarkdownNode): boolean => {
  if (node.type === 'inlineCode') return true
  return (node.children ?? []).some(containsInlineCode)
}

const onlyFormatting = (children: MarkdownNode[]): boolean =>
  children.every(
    (child) =>
      PLACEHOLDER_FORMATTING.has(child.type) &&
      !containsInlineCode(child) &&
      onlyFormatting(child.children ?? [])
  )

const isStandalonePlaceholderBlock = (node: MarkdownNode): string | null => {
  const children = node.children ?? []
  if (children.length === 0) return null
  if (!onlyFormatting(children)) return null
  const text = nodeText(node).trim()
  return PLACEHOLDER.test(text) ? text : null
}

export const collectPlaceholders = (
  tree: MarkdownNode
): { line: number; message: string }[] => {
  const issues: { line: number; message: string }[] = []
  walk(tree, (node) => {
    if (!PLACEHOLDER_BLOCKS.has(node.type)) return
    const value = isStandalonePlaceholderBlock(node)
    if (!value) return
    issues.push({
      line: lineOf(node),
      message: `存在未填写的占位: ${value}`
    })
  })
  return issues
}

const nodeText = (node: MarkdownNode): string => {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  return (node.children ?? []).map(nodeText).join('')
}

export const hasHeadingOne = (tree: MarkdownNode): boolean => {
  let found = false
  walk(tree, (node) => {
    if (found) return
    if (node.type === 'heading' && node.depth === 1) {
      found = nodeText(node).trim().length > 0
    }
  })
  return found
}

export const classifyLink = (url: string): ClassifiedLink => {
  const raw = url.trim()
  if (!raw) return { kind: 'invalid', url, reason: '链接目标为空' }
  if (URL_SCHEME.test(raw)) return { kind: 'remote', url: raw }
  if (raw.startsWith('//')) return { kind: 'remote', url: raw }
  if (raw.startsWith('#')) return { kind: 'fragment', url: raw }
  if (raw.startsWith('/')) return { kind: 'site-route', url: raw }

  const withoutFragment = raw.split('#', 1)[0]
  const rawPath = withoutFragment.split('?', 1)[0]
  if (!rawPath) return { kind: 'fragment', url: raw }

  let target: string
  try {
    target = decodeURIComponent(rawPath)
  } catch {
    return { kind: 'invalid', url: raw, reason: 'URL 编码无法解析' }
  }
  if (target.includes('\0')) {
    return { kind: 'invalid', url: raw, reason: '链接目标包含非法字符' }
  }
  return { kind: 'local', url: raw, target }
}

export const isInside = (root: string, target: string): boolean =>
  target === root || target.startsWith(root + path.sep)

const SENSITIVE_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.ssh',
  '.aws',
  '.gnupg'
])

const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'service-account.json'
])

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx'])

/** env、凭据配置与生成目录不作为可检查文档，即使被显式指定。 */
export const isSensitivePath = (relPath: string): boolean => {
  const segments = relPath.split('\\').join('/').split('/')
  return segments.some((segment) => {
    const name = segment.toLowerCase()
    if (SENSITIVE_DIRECTORIES.has(name)) return true
    if (name === '.env' || name.startsWith('.env.')) return true
    if (SENSITIVE_FILE_NAMES.has(name)) return true
    return SENSITIVE_EXTENSIONS.has(path.extname(name))
  })
}

type ChangeSet = {
  changed: string[]
  added: string[]
  deleted: string[]
}

const splitChanges = (raw: string): ChangeSet => {
  const tokens = raw.split('\0')
  const changed: string[] = []
  const added: string[] = []
  const deleted: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index]
    if (!entry) continue
    const status = entry.slice(0, 2)
    const current = entry.slice(3)
    if (!current) continue

    if (status.includes('R') || status.includes('C')) {
      const previous = tokens[index + 1] ?? ''
      index += 1
      changed.push(current)
      if (status.includes('R')) {
        added.push(current)
        if (previous) deleted.push(previous)
      }
      continue
    }

    if (status.includes('D')) {
      deleted.push(current)
      continue
    }

    changed.push(current)
    if (status.includes('A') || status === '??') added.push(current)
  }

  return {
    changed: unique(changed),
    added: unique(added),
    deleted: unique(deleted)
  }
}

const splitNameStatus = (raw: string): ChangeSet => {
  const tokens = raw.split('\0').filter((token) => token !== '')
  const changed: string[] = []
  const added: string[] = []
  const deleted: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index]
    if (status.startsWith('R') || status.startsWith('C')) {
      const previous = tokens[index + 1] ?? ''
      const current = tokens[index + 2] ?? ''
      index += 2
      if (current) changed.push(current)
      if (status.startsWith('R')) {
        if (current) added.push(current)
        if (previous) deleted.push(previous)
      }
      continue
    }

    const current = tokens[index + 1] ?? ''
    index += 1
    if (!current) continue
    if (status.startsWith('D')) {
      deleted.push(current)
    } else {
      changed.push(current)
      if (status.startsWith('A')) added.push(current)
    }
  }

  return {
    changed: unique(changed),
    added: unique(added),
    deleted: unique(deleted)
  }
}

const unique = <T>(values: T[]): T[] => Array.from(new Set(values))

const runGit = (root: string, args: string[]): string => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr
    const detail = stderr ? String(stderr).trim() : String(error)
    throw new Error(`git ${args.join(' ')} 失败: ${detail}`)
  }
}

const assertRepoRoot = (root: string) => {
  let topLevel: string
  try {
    topLevel = runGit(root, ['rev-parse', '--show-toplevel']).trim()
  } catch (error) {
    throw new Error(
      `必须在 git 仓库根目录运行 docs:check: ${(error as Error).message}`
    )
  }
  if (realpathSync(topLevel) !== root) {
    throw new Error(`必须在仓库根目录运行 docs:check（当前根目录 ${root}）`)
  }
}

export const listMaintainedDocs = (root: string): string[] => {
  const raw = runGit(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard'
  ])
  return unique(
    raw
      .split('\0')
      .filter((rel) => rel && isMaintainedDoc(rel))
      .filter((rel) => existsSync(path.join(root, rel)))
  ).sort()
}

const resolveBaseRef = (root: string, base: string): string => {
  if (base.startsWith('-')) {
    throw new UsageError(`--base 不接受以 - 开头的值: ${base}`)
  }
  const commit = runGit(root, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${base}^{commit}`
  ]).trim()
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new UsageError(`--base 无法解析为提交: ${base}`)
  }
  return commit
}

const resolveHeadCommit = (root: string): string =>
  runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).trim()

export const runDocsCheck = (options: CheckOptions): CheckReport => {
  const root = realpathSync(path.resolve(options.root))
  const explicitFiles = (options.files ?? []).map((file) => {
    const absolute = path.resolve(root, file)
    if (!isInside(root, absolute)) {
      throw new Error(`指定文件超出仓库范围: ${file}`)
    }
    if (!absolute.endsWith('.md')) {
      throw new Error(`只能检查 Markdown 文件: ${file}`)
    }
    const rel = toPosix(path.relative(root, absolute))
    if (isSensitivePath(rel)) {
      throw new Error(`拒绝检查 env、凭据或生成目录中的文件: ${file}`)
    }
    if (!existsSync(absolute)) {
      throw new Error(`指定文件不存在: ${file}`)
    }
    return rel
  })

  let mode: CheckMode
  let changeSet: ChangeSet

  if (explicitFiles.length > 0) {
    assertRepoRoot(root)
    mode = 'explicit'
    const head = resolveHeadCommit(root)
    const trackedAtHead = new Set(
      runGit(root, ['ls-tree', '-r', '-z', '--name-only', head])
        .split('\0')
        .filter((rel) => rel !== '')
    )
    changeSet = {
      changed: explicitFiles,
      added: explicitFiles.filter((file) => !trackedAtHead.has(file)),
      deleted: []
    }
  } else if (options.base) {
    assertRepoRoot(root)
    mode = 'base'
    const baseCommit = resolveBaseRef(root, options.base)
    const headCommit = resolveHeadCommit(root)
    const raw = runGit(root, [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      baseCommit,
      headCommit
    ])
    changeSet = splitNameStatus(raw)
  } else {
    assertRepoRoot(root)
    mode = 'working-tree'
    const raw = runGit(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ])
    changeSet = splitChanges(raw)
  }

  const isExplicit = mode === 'explicit'
  const changed = isExplicit
    ? changeSet.changed
    : changeSet.changed.filter((rel) => isMaintainedDoc(rel))
  const added = isExplicit
    ? changeSet.added
    : changeSet.added.filter((rel) => isMaintainedDoc(rel))
  const deleted = unique(changeSet.deleted.map(toPosix))

  const documents = listMaintainedDocs(root)
  const scanned = unique([...documents, ...changed]).filter((rel) =>
    existsSync(path.join(root, rel))
  )
  const changedSet = new Set(changed)
  const addedSet = new Set(added)
  const deletedSet = new Set(deleted)

  const issues: DocIssue[] = []
  const inbound = new Map<string, { file: string; line: number }[]>()
  let linkCount = 0
  let localLinkCount = 0

  const report = (file: string, message: string, line?: number) => {
    issues.push(line === undefined ? { file, message } : { file, line, message })
  }

  for (const rel of scanned) {
    const absolute = path.join(root, rel)
    if (isSensitivePath(rel)) {
      if (changedSet.has(rel)) {
        report(rel, '拒绝读取 env、凭据或生成目录中的文档')
      }
      continue
    }
    let content: string
    try {
      const real = realpathSync(absolute)
      if (!isInside(root, real)) {
        report(rel, '文档经符号链接指向仓库外，已跳过读取')
        continue
      }
      const realRel = toPosix(path.relative(root, real))
      if (isSensitivePath(realRel)) {
        report(rel, `文档经符号链接指向受保护路径，已跳过读取: ${realRel}`)
        continue
      }
      if (!realRel.endsWith('.md')) {
        report(rel, `文档的真实目标不是 Markdown 文件，已跳过读取: ${realRel}`)
        continue
      }
      content = readFileSync(real, 'utf8')
    } catch {
      report(rel, '无法读取文档内容')
      continue
    }

    const tree = parseMarkdown(content)
    const isChanged = changedSet.has(rel)

    for (const link of collectLinks(tree)) {
      linkCount += 1
      const classified = classifyLink(link.url)
      if (classified.kind === 'invalid') {
        if (isChanged) report(rel, classified.reason, link.line)
        continue
      }
      if (classified.kind !== 'local') continue
      localLinkCount += 1

      const target = path.resolve(root, path.dirname(rel), classified.target)
      if (!isInside(root, target)) {
        if (isChanged) report(rel, `本地链接目标超出仓库范围: ${classified.url}`, link.line)
        continue
      }

      const referrers = inbound.get(target) ?? []
      referrers.push({ file: rel, line: link.line })
      inbound.set(target, referrers)

      if (existsSync(target)) {
        let real: string
        try {
          real = realpathSync(target)
        } catch {
          if (isChanged) {
            report(rel, `本地链接目标无法解析: ${classified.url}`, link.line)
          }
          continue
        }
        if (!isInside(root, real)) {
          if (isChanged) {
            report(rel, `本地链接目标经符号链接指向仓库外: ${classified.url}`, link.line)
          }
        }
        continue
      }

      if (isChanged) {
        report(rel, `本地链接目标不存在: ${classified.url}`, link.line)
        continue
      }

      const targetRel = toPosix(path.relative(root, target))
      if (deletedSet.has(targetRel)) {
        report(
          rel,
          `本地链接目标已删除或改名，仍被引用: ${classified.url}`,
          link.line
        )
      }
    }

    if (isChanged) {
      for (const issue of collectPlaceholders(tree)) {
        report(rel, issue.message, issue.line)
      }
      if (addedSet.has(rel) && !hasHeadingOne(tree)) {
        report(rel, '新增维护文档缺少一级标题（H1）')
      }
    }
  }

  for (const rel of addedSet) {
    if (!isMaintainedDoc(rel)) continue
    const needsEntry = rel.startsWith('docs/') && rel !== 'docs/README.md'
    if (!needsEntry) continue
    const target = path.join(root, rel)
    const referrers = (inbound.get(target) ?? []).filter(
      (referrer) =>
        referrer.file !== rel && isMaintainedDoc(referrer.file)
    )
    if (referrers.length === 0) {
      report(rel, '新增文档没有来自其他维护文档的入站链接')
    }
  }

  const deduped = new Map<string, DocIssue>()
  for (const issue of issues) {
    deduped.set(`${issue.file}:${issue.line ?? 0}:${issue.message}`, issue)
  }

  return {
    mode,
    base: options.base,
    root,
    documents,
    changed: unique(changed).sort(),
    added: unique(added).sort(),
    deleted,
    linkCount,
    localLinkCount,
    issues: Array.from(deduped.values()).sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        (left.line ?? 0) - (right.line ?? 0) ||
        left.message.localeCompare(right.message)
    )
  }
}

const MODE_LABELS: Record<CheckMode, string> = {
  'working-tree': '工作树相对 HEAD（staged + unstaged + untracked）',
  base: '已提交改动',
  explicit: '显式指定文件'
}

export const formatReport = (report: CheckReport): string => {
  const lines: string[] = []
  const modeLabel =
    report.mode === 'base' && report.base
      ? `${MODE_LABELS.base} ${report.base}..HEAD`
      : MODE_LABELS[report.mode]

  lines.push(`文档机械检查（${modeLabel}）`)
  lines.push(
    report.mode === 'explicit'
      ? `检查文件：${report.changed.join('、')}`
      : '检查范围：README.md、AGENTS.md、docs/**（不含 docs/superpowers/**）、skills/**/*.md、deployment/**/*.md'
  )

  if (report.deleted.length > 0) {
    lines.push(`本次删除或改名 ${report.deleted.length} 个路径。`)
  }
  if (report.changed.length === 0) {
    lines.push('没有需要检查的维护文档改动。')
    if (report.issues.length === 0) return lines.join('\n')
  } else {
    lines.push(
      `扫描维护文档 ${report.documents.length} 篇，本次改动 ${report.changed.length} 篇；Markdown 链接 ${report.linkCount} 个，其中本地目标 ${report.localLinkCount} 个。`
    )
    if (report.mode === 'base') {
      lines.push('按上述范围的改动文件定位；链接与占位按工作树当前内容检查。')
    }
    lines.push(
      '未校验：http(s)、mailto 等远程地址，以 / 开头的站点路由，纯片段锚点，以及 Markdown 之外的 HTML 链接。'
    )
  }

  if (report.issues.length === 0) {
    lines.push('')
    lines.push(
      '通过：未发现机械问题。该结果只代表机械检查通过，不代表内容质量已通过。'
    )
    return lines.join('\n')
  }

  lines.push('')
  for (const issue of report.issues) {
    const location =
      issue.line === undefined ? issue.file : `${issue.file}:${issue.line}`
    lines.push(`${location}: ${issue.message}`)
  }
  lines.push('')
  lines.push(
    `共 ${report.issues.length} 个问题。机械检查不验证远程页面、锚点、语义与内容质量。`
  )
  return lines.join('\n')
}

class UsageError extends Error {}

export type CliArguments = {
  base?: string
  files: string[]
  help: boolean
}

export const parseArguments = (argv: string[]): CliArguments => {
  const files: string[] = []
  let base: string | undefined
  let help = false
  let flagsEnded = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (flagsEnded) {
      files.push(argument)
      continue
    }
    if (argument === '--') {
      flagsEnded = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--base') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) {
        throw new UsageError('--base 需要一个 git ref')
      }
      base = value
      index += 1
      continue
    }
    if (argument.startsWith('--base=')) {
      const value = argument.slice('--base='.length)
      if (!value) throw new UsageError('--base 需要一个 git ref')
      base = value
      continue
    }
    if (argument.startsWith('-')) {
      throw new UsageError(`未知参数: ${argument}`)
    }
    files.push(argument)
  }

  if (base && files.length > 0) {
    throw new UsageError('--base 与显式文件参数不能同时使用')
  }

  return { base, files, help }
}

const USAGE = `用法: pnpm docs:check [选项] [文件...]

默认检查相对 HEAD 新增、修改或删除的维护文档：
  README.md、AGENTS.md、docs/**（不含 docs/superpowers/**）、
  skills/**/*.md、deployment/**/*.md

选项:
  --base <git-ref>  用 <git-ref>..HEAD 的改动定位要检查的文档；
                    链接与占位按工作树当前内容检查
  文件...           只检查指定文件（相对仓库根目录）
  -h, --help        显示本说明

退出码: 0 通过，1 发现问题，2 参数或仓库错误。`

export const main = (
  argv: string[],
  options: { root: string; stdout: (text: string) => void; stderr: (text: string) => void }
): number => {
  let parsed: CliArguments
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    options.stderr(`${(error as Error).message}\n\n${USAGE}`)
    return 2
  }

  if (parsed.help) {
    options.stdout(USAGE)
    return 0
  }

  let report: CheckReport
  try {
    report = runDocsCheck({
      root: options.root,
      base: parsed.base,
      files: parsed.files
    })
  } catch (error) {
    options.stderr(`${(error as Error).message}`)
    return 2
  }

  options.stdout(formatReport(report))
  return report.issues.length === 0 ? 0 : 1
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return (
      realpathSync(path.resolve(entry)) ===
      realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2), {
    root: process.cwd(),
    stdout: (text) => console.log(text),
    stderr: (text) => console.error(text)
  })
}
