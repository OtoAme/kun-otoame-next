import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyLink,
  formatReport,
  isMaintainedDoc,
  runDocsCheck
} from '~/scripts/checkDocs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const scriptPath = path.join(projectRoot, 'scripts/checkDocs.ts')
const esnoCli = path.join(projectRoot, 'node_modules/esno/esno.js')

const tempRoots: string[] = []

const createRepo = () => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'otoame-docs-'))
  tempRoots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'docs-check@example.test'], {
    cwd: root
  })
  execFileSync('git', ['config', 'user.name', 'docs-check'], { cwd: root })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root })
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root })
  write(root, 'README.md', '# Fixture\n')
  commit(root, 'initial')
  return root
}

const write = (root: string, relPath: string, content: string) => {
  const absolute = path.join(root, relPath)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

const commit = (root: string, message: string) => {
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root })
}

/** Writes a committed document so later edits count as changes, not new pages. */
const writeCommitted = (root: string, relPath: string, content: string) => {
  write(root, relPath, content)
  commit(root, `add ${relPath}`)
}

const runCli = (root: string, args: string[] = []) =>
  spawnSync(process.execPath, [esnoCli, scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8'
  })

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true })
  }
})

describe('docs:check default scope', () => {
  it('covers staged, unstaged and untracked maintenance documents', () => {
    const root = createRepo()

    writeCommitted(root, 'docs/project/staged.md', '# Staged\n')
    writeCommitted(root, 'docs/modules/edited.md', '# Edited\n')
    writeCommitted(root, 'skills/new-skill/SKILL.md', '# New Skill\n')
    write(root, 'decision-making/plan.md', '# Plan\n')
    write(root, 'src/nothing.ts', 'export {}\n')

    write(root, 'docs/project/staged.md', '# Staged\n\n[edited](../modules/edited.md)\n')
    execFileSync('git', ['add', 'docs/project/staged.md'], { cwd: root })
    write(root, 'docs/modules/edited.md', '# Edited\n\n[staged](../project/staged.md)\n')
    write(root, 'skills/new-skill/SKILL.md', '# New Skill\n\nUpdated.\n')

    const report = runDocsCheck({ root })

    expect(report.mode).toBe('working-tree')
    expect(report.changed).toEqual([
      'docs/modules/edited.md',
      'docs/project/staged.md',
      'skills/new-skill/SKILL.md'
    ])
    expect(report.issues).toEqual([])
  })

  it('recognizes the maintained document paths and skips historical plans', () => {
    expect(isMaintainedDoc('README.md')).toBe(true)
    expect(isMaintainedDoc('AGENTS.md')).toBe(true)
    expect(isMaintainedDoc('docs/README.md')).toBe(true)
    expect(isMaintainedDoc('docs/concepts/architecture.md')).toBe(true)
    expect(isMaintainedDoc('docs/reference/theme.md')).toBe(true)
    expect(isMaintainedDoc('docs/guides/operations.md')).toBe(true)
    expect(isMaintainedDoc('skills/otoame-api/SKILL.md')).toBe(true)
    expect(isMaintainedDoc('deployment/link-checker/README.md')).toBe(true)
    expect(isMaintainedDoc('decision-making/9.company-ingestion-track.md')).toBe(
      false
    )
    expect(isMaintainedDoc('docs/superpowers/plans/plan.md')).toBe(false)
    expect(isMaintainedDoc('docs/project/notes.txt')).toBe(false)
  })

  it('reports an empty scope clearly', () => {
    const root = createRepo()

    const report = runDocsCheck({ root })

    expect(report.changed).toEqual([])
    expect(report.issues).toEqual([])
    expect(formatReport(report)).toContain('没有需要检查的维护文档改动')

    const result = runCli(root)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('没有需要检查的维护文档改动')
  })
})

describe('docs:check local targets', () => {
  it('accepts Next route paths, encoded paths, reference links and code demos', () => {
    const root = createRepo()

    writeCommitted(root, 'docs/project/target.md', '# Target\n')
    writeCommitted(root, 'docs/project/space (1).md', '# Space\n')
    write(root, 'app/(site)/[id]/page.tsx', 'export {}\n')
    write(root, 'public/images/otoame.jpg', 'binary')
    write(
      root,
      'docs/project/valid.md',
      [
        '# Valid',
        '',
        '[user](/user/1?tab=resources)',
        '[anchor](#valid)',
        '[absolute](https://example.com/a?b=c#d)',
        '[mail](mailto:team@example.com)',
        '[encoded](./space%20%281%29.md)',
        '[reference][ref]',
        '![image](../../public/images/otoame.jpg)',
        '[page](<../../app/(site)/[id]/page.tsx>)',
        '',
        '[ref]: ./target.md "Target"',
        '',
        '```md',
        '[demo](./missing.md)',
        '```',
        '',
        'Inline demo `[inline](./missing.md)` is not a link.',
        ''
      ].join('\n')
    )
    commit(root, 'add valid page')

    write(
      root,
      'docs/project/valid.md',
      `${readFileSync(path.join(root, 'docs/project/valid.md'), 'utf8')}\nMore.\n`
    )

    const report = runDocsCheck({ root })

    expect(report.issues).toEqual([])
    expect(report.localLinkCount).toBe(4)
  })

  it('reports a missing local target with file and line', () => {
    const root = createRepo()
    writeCommitted(root, 'docs/project/broken.md', '# Broken\n')
    write(
      root,
      'docs/project/broken.md',
      ['# Broken', '', 'Intro.', '', '[missing](./absent.md)', ''].join('\n')
    )

    const report = runDocsCheck({ root, files: ['docs/project/broken.md'] })

    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({
      file: 'docs/project/broken.md',
      line: 5
    })

    const result = runCli(root, ['docs/project/broken.md'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('docs/project/broken.md:5')
  })

  it('reports broken links in untouched documents after a referenced source is deleted', () => {
    const root = createRepo()
    write(root, 'docs/project/hub.md', '# Hub\n\n[code](../../src/gone.ts)\n')
    write(root, 'src/gone.ts', 'export {}\n')
    commit(root, 'add hub')

    rmSync(path.join(root, 'src/gone.ts'))

    const report = runDocsCheck({ root })

    expect(report.changed).toEqual([])
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({
      file: 'docs/project/hub.md',
      line: 3
    })

    const formatted = formatReport(report)
    expect(formatted).toContain('docs/project/hub.md:3')
    expect(formatted).not.toMatch(/^通过：/m)
  })

  it('rejects local targets that escape the repository', () => {
    const root = createRepo()
    const outside = path.join(root, '..', 'outside-doc.md')

    writeCommitted(root, 'docs/project/escape.md', '# Escape\n')
    write(
      root,
      'docs/project/escape.md',
      '# Escape\n\n[outside](../../../outside-doc.md)\n'
    )

    expect(existsSync(outside)).toBe(false)
    const report = runDocsCheck({ root, files: ['docs/project/escape.md'] })

    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].message).toContain('超出仓库范围')
  })
})

describe('docs:check placeholders and headings', () => {
  it('flags standalone placeholders but not prose, inline code, fences or examples', () => {
    const root = createRepo()
    writeCommitted(root, 'docs/project/draft.md', '# Draft\n')

    write(
      root,
      'docs/project/draft.md',
      [
        '# Draft',
        '',
        'TODO',
        '',
        '**TBD**',
        '',
        '## 待补充',
        '',
        '**`TODO`**',
        '',
        '不要保留 **TODO** 这样的占位。',
        '',
        '[TODO](./example.md) 只是示例。',
        '',
        '行内 `TODO` 也不是占位。',
        '',
        '```md',
        'TBD',
        '```',
        ''
      ].join('\n')
    )

    const report = runDocsCheck({ root, files: ['docs/project/draft.md'] })

    expect(
      report.issues
        .filter((issue) => issue.message.includes('占位'))
        .map((issue) => issue.line)
    ).toEqual([3, 5, 7])
  })

  it('accepts a heading written only with inline code', () => {
    const root = createRepo()

    write(root, 'docs/project/code-title.md', '# `docs:check`\n\nBody.\n')

    const report = runDocsCheck({
      root,
      files: ['docs/project/code-title.md']
    })

    expect(report.issues.some((issue) => issue.message.includes('一级标题'))).toBe(
      false
    )
  })

  it('accepts an H1 that is not the first heading', () => {
    const root = createRepo()

    write(
      root,
      'docs/project/late-title.md',
      'Intro paragraph.\n\n## Section\n\n# Real Title\n\nBody.\n'
    )

    const report = runDocsCheck({
      root,
      files: ['docs/project/late-title.md']
    })

    expect(report.issues.some((issue) => issue.message.includes('一级标题'))).toBe(
      false
    )
  })

  it('requires a level-one heading for added documents', () => {
    const root = createRepo()

    write(root, 'docs/project/no-heading.md', '## Section\n\nText.\n')

    const report = runDocsCheck({ root, files: ['docs/project/no-heading.md'] })

    expect(report.issues.some((issue) => issue.message.includes('一级标题'))).toBe(
      true
    )
  })

  it('does not require a new heading for an edited committed document', () => {
    const root = createRepo()
    write(root, 'docs/project/existing.md', '# Existing\n')
    commit(root, 'add existing')
    write(root, 'docs/project/existing.md', '# Existing\n\nMore.\n')

    const report = runDocsCheck({ root })

    expect(report.added).toEqual([])
    expect(report.issues).toEqual([])
  })
})

describe('docs:check inbound links for new pages', () => {
  it('recognizes the documentation index as an entry to a new guide', () => {
    const root = createRepo()
    write(root, 'README.md', '# Project\n\n[Documentation](docs/README.md)\n')
    write(root, 'docs/README.md', '# Documentation\n\n[Guide](modules/guide.md)\n')
    write(root, 'docs/modules/guide.md', '# Guide\n')

    const report = runDocsCheck({ root })

    expect(report.issues).toEqual([])
    expect(report.changed).toContain('docs/README.md')
  })

  it('rejects a new docs page that has no inbound link', () => {
    const root = createRepo()

    write(root, 'docs/project/orphan.md', '# Orphan\n')

    const report = runDocsCheck({ root })

    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].file).toBe('docs/project/orphan.md')
    expect(report.issues[0].message).toContain('入站链接')
  })

  it('does not count a self link as its own entry', () => {
    const root = createRepo()

    write(root, 'docs/modules/self.md', '# Self\n\n[self](./self.md)\n')

    const report = runDocsCheck({ root })

    expect(report.issues.some((issue) => issue.message.includes('入站链接'))).toBe(
      true
    )
  })

  it('accepts a new page linked from another maintained document', () => {
    const root = createRepo()

    write(root, 'docs/project/index.md', '# Index\n\n[Guide](./guide.md)\n')
    commit(root, 'add index')
    write(root, 'docs/project/guide.md', '# Guide\n')

    const report = runDocsCheck({ root })

    expect(report.issues).toEqual([])
  })

  it('does not count an unused definition as an inbound link', () => {
    const root = createRepo()

    write(
      root,
      'docs/project/target.md',
      '# Target\n\n[target]: ../modules/entry.md\n'
    )
    write(root, 'docs/modules/entry.md', '# Entry\n\nNothing here.\n')

    const report = runDocsCheck({ root })

    expect(
      report.issues.filter((issue) => issue.file === 'docs/modules/entry.md')
    ).toHaveLength(1)
  })

  it('counts a reference-style link once its definition is used', () => {
    const root = createRepo()

    write(
      root,
      'docs/project/target.md',
      '# Target\n\n[entry][e]\n\n[e]: ../modules/entry.md\n'
    )
    write(root, 'docs/modules/entry.md', '# Entry\n\nNothing here.\n')

    const report = runDocsCheck({ root })

    expect(
      report.issues.filter((issue) => issue.file === 'docs/modules/entry.md')
    ).toHaveLength(0)
  })

  it('does not require the same entry rule for new skills', () => {
    const root = createRepo()

    write(root, 'skills/new-domain/SKILL.md', '# New Domain\n')

    const report = runDocsCheck({ root })

    expect(report.issues).toEqual([])
  })
})

describe('docs:check deleted targets', () => {
  it('reports unchanged documents that still reference a deleted target', () => {
    const root = createRepo()

    write(root, 'docs/project/old.md', '# Old\n')
    write(root, 'docs/project/hub.md', '# Hub\n\n[old](./old.md)\n')
    commit(root, 'add pages')

    rmSync(path.join(root, 'docs/project/old.md'))

    const report = runDocsCheck({ root })

    expect(report.deleted).toContain('docs/project/old.md')
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({
      file: 'docs/project/hub.md',
      line: 3
    })

    const result = runCli(root)
    expect(result.status).toBe(1)
  })

  it('ignores historical broken links in documents that were not touched', () => {
    const root = createRepo()

    write(
      root,
      'docs/project/history.md',
      '# History\n\n[gone](./never-existed.md)\n'
    )
    writeCommitted(root, 'docs/project/fresh.md', '# Fresh\n')

    write(root, 'docs/project/fresh.md', '# Fresh\n\nUpdated.\n')

    const report = runDocsCheck({ root })

    expect(report.changed).toEqual(['docs/project/fresh.md'])
    expect(report.issues).toEqual([])
  })
})

describe('docs:check committed range', () => {
  it('checks --base commits and ignores uncommitted work', () => {
    const root = createRepo()
    write(root, 'docs/project/base.md', '# Base\n')
    commit(root, 'add base doc')

    write(root, 'docs/project/base.md', '# Base\n\n[dangling](./dangling.md)\n')
    commit(root, 'break base doc')

    write(root, 'docs/project/uncommitted.md', '# Uncommitted\n')

    const report = runDocsCheck({ root, base: 'HEAD~1' })

    expect(report.mode).toBe('base')
    expect(report.changed).toEqual(['docs/project/base.md'])
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].line).toBe(3)

    const emptyRange = runDocsCheck({ root, base: 'HEAD' })
    expect(emptyRange.changed).toEqual([])
    expect(emptyRange.issues).toEqual([])
  })

  it('reads working tree content for files selected by --base', () => {
    const root = createRepo()
    write(root, 'docs/project/edited.md', '# Edited\n\n[ok](./other.md)\n')
    write(root, 'docs/project/other.md', '# Other\n')
    commit(root, 'add pages')
    write(root, 'docs/project/other.md', '# Other\n\nMore text.\n')
    commit(root, 'touch other')

    write(
      root,
      'docs/project/other.md',
      '# Other\n\nMore text.\n\n[broken](./new.md)\n'
    )

    const report = runDocsCheck({ root, base: 'HEAD~1' })

    expect(report.changed).toEqual(['docs/project/other.md'])
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].message).toContain('./new.md')
    expect(formatReport(report)).toContain('工作树当前内容')
  })

  it('rejects --base values that git could read as an option', () => {
    const root = createRepo()

    const result = runCli(root, ['--base=--output=/tmp/x'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('不接受以 - 开头')
  })

  it('treats a committed rename as a deletion of the old path', () => {
    const root = createRepo()
    write(root, 'docs/project/renamed.md', '# Renamed\n')
    write(root, 'docs/project/reader.md', '# Reader\n\n[page](./renamed.md)\n')
    write(root, 'docs/project/hub.md', '# Hub\n')
    commit(root, 'add pages')

    execFileSync(
      'git',
      ['mv', 'docs/project/renamed.md', 'docs/project/moved.md'],
      { cwd: root }
    )
    write(root, 'docs/project/hub.md', '# Hub\n\n[page](./moved.md)\n')
    commit(root, 'rename page')

    const report = runDocsCheck({ root, base: 'HEAD~1' })

    expect(report.deleted).toContain('docs/project/renamed.md')
    expect(report.added).toContain('docs/project/moved.md')
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].file).toBe('docs/project/reader.md')
    expect(report.issues[0].message).toContain('已删除或改名')
  })

  it('fails with a usage error for an unknown ref or conflicting arguments', () => {
    const root = createRepo()

    const unknownRef = runCli(root, ['--base', 'does-not-exist'])
    expect(unknownRef.status).toBe(2)

    const conflicting = runCli(root, ['--base', 'HEAD', 'README.md'])
    expect(conflicting.status).toBe(2)
  })

  it('reports usage help and rejects unknown flags', () => {
    const root = createRepo()

    const help = runCli(root, ['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--base')

    const unknownFlag = runCli(root, ['--touch'])
    expect(unknownFlag.status).toBe(2)
    expect(unknownFlag.stderr).toContain('未知参数')
  })
})

describe('docs:check explicit files', () => {
  it('does not read non-Markdown content through a Markdown symlink', () => {
    const root = createRepo()
    write(root, 'data.json', 'TODO\n')
    mkdirSync(path.join(root, 'skills/linked'), { recursive: true })
    symlinkSync('../../data.json', path.join(root, 'skills/linked/SKILL.md'))

    const report = runDocsCheck({
      root,
      files: ['skills/linked/SKILL.md']
    })

    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].message).toContain('真实目标不是 Markdown')
  })

  it('does not read documents that are symlinks pointing outside the repository', () => {
    const root = createRepo()
    const outsideDir = mkdtempSync(
      path.join(realpathSync(tmpdir()), 'otoame-docs-outside-')
    )
    tempRoots.push(outsideDir)
    const outsideFile = path.join(outsideDir, 'outside.md')
    writeFileSync(outsideFile, '# Outside\n\n[bad](./missing.md)\n')

    mkdirSync(path.join(root, 'skills/linked'), { recursive: true })
    symlinkSync(outsideFile, path.join(root, 'skills/linked/SKILL.md'))

    const report = runDocsCheck({ root })

    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({ file: 'skills/linked/SKILL.md' })
    expect(report.issues[0].message).toContain('符号链接')
  })

  it('treats a staged new file as new in both default and explicit modes', () => {
    const root = createRepo()

    write(root, 'docs/project/staged-new.md', '## Missing title\n')
    execFileSync('git', ['add', 'docs/project/staged-new.md'], { cwd: root })

    const report = runDocsCheck({ root })
    expect(report.added).toEqual(['docs/project/staged-new.md'])
    expect(
      report.issues.some((issue) => issue.message.includes('一级标题'))
    ).toBe(true)

    const explicit = runDocsCheck({
      root,
      files: ['docs/project/staged-new.md']
    })
    expect(explicit.mode).toBe('explicit')
    expect(explicit.added).toEqual(['docs/project/staged-new.md'])
    expect(
      explicit.issues.some((issue) => issue.message.includes('一级标题'))
    ).toBe(true)
  })

  it('rejects env, credential and non-Markdown explicit targets', () => {
    const root = createRepo()
    write(root, '.env.example', 'SECRET=1\n')
    write(root, 'keys/service.pem', 'secret\n')
    write(root, 'docs/project/notes.txt', 'not markdown\n')
    write(root, 'docs/project/ok.md', '# Ok\n')

    expect(() => runDocsCheck({ root, files: ['.env.example'] })).toThrow()
    expect(() => runDocsCheck({ root, files: ['keys/service.pem'] })).toThrow()
    expect(() => runDocsCheck({ root, files: ['docs/project/notes.txt'] })).toThrow()
    expect(() =>
      runDocsCheck({ root, files: ['docs/project/ok.md'] })
    ).not.toThrow()
  })

  it('still allows ordinary documentation about credentials', () => {
    const root = createRepo()

    write(
      root,
      'docs/project/index.md',
      '# Index\n\n[guide](./credentials-guide.md)\n[secrets](./secrets-management.md)\n'
    )
    commit(root, 'add index')

    write(
      root,
      'docs/project/credentials-guide.md',
      '# Credentials Guide\n\n[secret docs](./secrets-management.md)\n'
    )
    write(root, 'docs/project/secrets-management.md', '# Secrets\n')

    const report = runDocsCheck({ root })

    expect(report.issues).toEqual([])
  })

  it('does not read a document that links through to a protected path', () => {
    const root = createRepo()
    write(root, '.env', 'SECRET=1\n')
    write(root, 'docs/project/holder.md', '# Holder\n')
    commit(root, 'add holder')

    rmSync(path.join(root, 'docs/project/holder.md'))
    symlinkSync(
      path.join(root, '.env'),
      path.join(root, 'docs/project/holder.md')
    )

    const report = runDocsCheck({
      root,
      files: ['docs/project/holder.md']
    })

    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].file).toBe('docs/project/holder.md')
    expect(report.issues[0].message).toContain('受保护路径')
  })

  it('applies new-document rules to explicit files too', () => {
    const root = createRepo()

    write(root, 'docs/project/loose.md', '## No title\n')

    const report = runDocsCheck({ root, files: ['docs/project/loose.md'] })

    expect(report.added).toEqual(['docs/project/loose.md'])
    const messages = report.issues.map((issue) => issue.message)
    expect(messages.some((message) => message.includes('一级标题'))).toBe(true)
    expect(messages.some((message) => message.includes('入站链接'))).toBe(true)
  })

  it('checks only the listed file and rejects paths outside the repository', () => {
    const root = createRepo()
    write(root, 'decision-making/plan.md', '# Plan\n\n[bad](./missing.md)\n')

    const report = runDocsCheck({
      root,
      files: ['decision-making/plan.md']
    })

    expect(report.mode).toBe('explicit')
    expect(report.changed).toEqual(['decision-making/plan.md'])
    expect(report.issues).toHaveLength(1)

    expect(() => runDocsCheck({ root, files: ['../escape.md'] })).toThrow()
  })
})

describe('link classification', () => {
  it('separates local paths from remote, fragment and site-route targets', () => {
    expect(classifyLink('./a.md#b').kind).toBe('local')
    expect(classifyLink('./a%20b.md?x=1').kind).toBe('local')
    expect(classifyLink('/user/1').kind).toBe('site-route')
    expect(classifyLink('#heading').kind).toBe('fragment')
    expect(classifyLink('https://example.com/a.md').kind).toBe('remote')
    expect(classifyLink('//cdn.example.com/a.md').kind).toBe('remote')
    expect(classifyLink('mailto:a@example.com').kind).toBe('remote')
    expect(classifyLink('').kind).toBe('invalid')
    expect(classifyLink('./%E0%A4%A.md').kind).toBe('invalid')
  })
})
