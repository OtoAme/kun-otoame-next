import { spawnSync, type SpawnSyncOptions } from 'node:child_process'

export const runDeployCommand = (
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${String(result.status)}`
    )
  }
}

export const readDeployCommand = (
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${String(result.status)}: ${String(result.stderr ?? '')}`
    )
  }
  return String(result.stdout ?? '').trim()
}

export const assertCleanDeployWorktree = (cwd: string) => {
  const status = readDeployCommand(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    { cwd }
  )
  if (status !== '') {
    throw new Error('Deployment requires a clean Git worktree.')
  }
}
