import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireDeployLock,
  assertInheritedDeployLock
} from '~/scripts/deployLock'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('deployment operation lock', () => {
  it('excludes concurrent pull or rollback operations and releases by owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-deploy-lock-'))
    roots.push(root)
    const release = acquireDeployLock(root)
    expect(() =>
      assertInheritedDeployLock(root, String(process.pid))
    ).not.toThrow()
    expect(() =>
      assertInheritedDeployLock(root, String(process.pid + 1))
    ).toThrow('does not match')
    expect(() => acquireDeployLock(root)).toThrow(
      'Another deployment operation is active'
    )
    release()

    const releaseAgain = acquireDeployLock(root)
    expect(() => releaseAgain()).not.toThrow()
  })

  it('rejects an inherited marker when no real lock exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-deploy-lock-'))
    roots.push(root)
    expect(() => assertInheritedDeployLock(root, String(process.pid))).toThrow(
      'missing or untrusted'
    )
  })
})
