import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

type LockOwner = {
  version: 1
  pid: number
  startedAt: string
}

export const DEPLOY_LOCK_OWNER_PID_ENV = 'KUN_DEPLOY_LOCK_OWNER_PID'

const ownerPath = (lockPath: string) => join(lockPath, 'owner.json')

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const readOwner = (lockPath: string): LockOwner | null => {
  try {
    const stat = lstatSync(ownerPath(lockPath))
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    const value = JSON.parse(
      readFileSync(ownerPath(lockPath), 'utf8')
    ) as unknown
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as LockOwner).version === 1 &&
      Number.isSafeInteger((value as LockOwner).pid) &&
      (value as LockOwner).pid > 0 &&
      typeof (value as LockOwner).startedAt === 'string'
    ) {
      return value as LockOwner
    }
  } catch {
    // An incomplete owner file is treated as an unknown active lock.
  }
  return null
}

export const assertInheritedDeployLock = (
  deployRoot: string,
  ownerPidValue = process.env[DEPLOY_LOCK_OWNER_PID_ENV]
) => {
  const expectedPid = Number(ownerPidValue)
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new Error(
      'Inherited deployment lock owner PID is missing or invalid.'
    )
  }

  const lockPath = join(deployRoot, 'operation.lock')
  let lockStat: ReturnType<typeof lstatSync>
  try {
    lockStat = lstatSync(lockPath)
  } catch {
    throw new Error('Inherited deployment lock is missing or untrusted.')
  }
  if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) {
    throw new Error('Inherited deployment lock is missing or untrusted.')
  }
  const owner = readOwner(lockPath)
  if (!owner || owner.pid !== expectedPid || !isRunning(owner.pid)) {
    throw new Error('Inherited deployment lock owner does not match.')
  }
}

export const acquireDeployLock = (deployRoot: string) => {
  mkdirSync(deployRoot, { recursive: true })
  const lockPath = join(deployRoot, 'operation.lock')

  const create = () => {
    mkdirSync(lockPath, { mode: 0o700 })
    writeFileSync(
      ownerPath(lockPath),
      `${JSON.stringify({
        version: 1,
        pid: process.pid,
        startedAt: new Date().toISOString()
      } satisfies LockOwner)}\n`,
      { mode: 0o600 }
    )
  }

  try {
    create()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const stat = lstatSync(lockPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Deployment lock path is not a trusted directory.')
    }
    const owner = readOwner(lockPath)
    const invalidOwnerIsRecent = !owner && Date.now() - stat.mtimeMs < 300_000
    if (invalidOwnerIsRecent || (owner && isRunning(owner.pid))) {
      throw new Error(
        owner
          ? `Another deployment operation is active (pid ${owner.pid}).`
          : 'Deployment lock exists without a valid recent owner; retry after five minutes or inspect it manually.'
      )
    }
    rmSync(lockPath, { recursive: true })
    create()
  }

  let released = false
  return () => {
    if (released) return
    const owner = readOwner(lockPath)
    if (!owner || owner.pid !== process.pid) {
      throw new Error('Deployment lock ownership changed before release.')
    }
    rmSync(lockPath, { recursive: true })
    released = true
  }
}
