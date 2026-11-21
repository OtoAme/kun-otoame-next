import { existsSync } from 'node:fs'
import { activateReleaseWithReadiness } from './deployActivation'
import { acquireDeployLock } from './deployLock'
import { restartAndVerifyProduction } from './deployPm2'
import {
  formatRecoveryIdentity,
  formatRecoveryNextSteps,
  formatRecoveryState,
  getRecoveryReleaseStatus,
  inspectRecoveryRelease,
  listRecoveryChoices,
  recoverySelectionSnapshot
} from './deployRecoveryInfo'
import {
  getCurrentDeployRelease,
  getDeploySlotPaths,
  getPreviousDeployRelease,
  readActivationJournal
} from './deploySlots'

export const parseRecoveryArguments = (args: string[]) => {
  if (args.length === 0) return { mode: 'interactive' as const }
  if (args.length === 1 && args[0] === '--list')
    return { mode: 'list' as const }
  if (args.length === 2 && args[0] === '--preview')
    return { mode: 'preview' as const, releaseId: args[1] }
  if (
    args.length === 4 &&
    args[0] === '--release' &&
    args[2] === '--confirm' &&
    args[1] === args[3]
  ) {
    return { mode: 'execute' as const, releaseId: args[1] }
  }
  throw new Error(
    'Use --list, --preview <release-id>, or --release <release-id> --confirm <same-release-id>. No default target or generic --yes is accepted.'
  )
}

const numberedChoice = (
  choices: ReturnType<typeof listRecoveryChoices>,
  input: string
) => {
  const number = Number(input)
  return /^[1-9]\d*$/.test(input) && Number.isSafeInteger(number)
    ? choices[number - 1]
    : undefined
}

export const runDeployRecovery = async ({
  projectRoot,
  args,
  isTTY,
  ask,
  log = console.log,
  prepare = () => undefined,
  activate = activateReleaseWithReadiness
}: {
  projectRoot: string
  args: string[]
  isTTY: boolean
  ask: (prompt: string) => Promise<string | null>
  log?: (message: string) => void
  prepare?: () => void
  activate?: typeof activateReleaseWithReadiness
}) => {
  const mode = parseRecoveryArguments(args)
  const paths = getDeploySlotPaths(projectRoot)
  if (!existsSync(paths.deployRoot))
    throw new Error(
      'No managed deployment exists; no recovery state was changed.'
    )
  const unlock = acquireDeployLock(paths.deployRoot)
  try {
    log(formatRecoveryState(paths, { includeCommands: false }))
    let choices: ReturnType<typeof listRecoveryChoices> = []
    if (mode.mode === 'list' || mode.mode === 'interactive') {
      choices = listRecoveryChoices(paths)
      log(
        [
          '\n可选版本（请明确选择，不会自动启动任何版本）：',
          ...choices.flatMap((release, index) => [
            '',
            `${index + 1}. ${release.status}`,
            `   ${formatRecoveryIdentity(release)}`,
            ...(release.error ? ['   校验未通过，请先预览详情'] : [])
          ]),
          '',
          '说明：通过校验的版本已核对运行资源与清单，数据库兼容性需人工确认。'
        ].join('\n')
      )
    }
    if (mode.mode === 'list') {
      log(`\n${formatRecoveryNextSteps()}`)
      return 'listed'
    }
    if (mode.mode === 'interactive' && !isTTY)
      throw new Error(
        'Interactive recovery requires a TTY. Use --list/--preview or explicitly bind --release and --confirm to the same release ID.'
      )
    let releaseId: string
    if (mode.mode === 'interactive') {
      const input = (await ask('请输入版本编号（回车取消）：'))?.trim()
      if (!input) return 'cancelled'
      const choice = numberedChoice(choices, input)
      if (!choice) {
        log('编号无效，已取消；没有启动任何版本。')
        return 'cancelled'
      }
      releaseId = choice.releaseId
    } else if (mode.mode === 'preview' && /^\d+$/.test(mode.releaseId)) {
      const choice = numberedChoice(listRecoveryChoices(paths), mode.releaseId)
      if (!choice) throw new Error('版本编号无效，没有启动任何版本。')
      releaseId = choice.releaseId
    } else {
      releaseId = mode.releaseId
    }
    const selected = recoverySelectionSnapshot(paths, releaseId)
    log(
      [
        '\n已选择版本：',
        `  ${formatRecoveryIdentity(selected.release)}`,
        `  状态：${getRecoveryReleaseStatus(paths, selected.release.releasePath)}`,
        `  发布 ID：${selected.release.releaseId}`,
        `  目录：${selected.release.releasePath}`
      ].join('\n')
    )
    log(
      '确认后只启动此版本；数据库不会恢复，请先核对兼容性。'
    )
    if (mode.mode === 'preview') {
      log(`\n${formatRecoveryNextSteps()}`)
      return 'previewed'
    }
    if (
      mode.mode === 'interactive' &&
      (await ask(
        '确认启动上述版本？输入 y 继续，回车取消：'
      ))?.trim().toLowerCase() !== 'y'
    )
      return 'cancelled'
    const rechecked = recoverySelectionSnapshot(paths, releaseId)
    if (selected.fingerprint !== rechecked.fingerprint)
      throw new Error(
        'Selected release or deployment state changed during confirmation; no release was started.'
      )
    const journal = readActivationJournal(paths)
    const allowedReleaseDirs = [
      getCurrentDeployRelease(paths),
      getPreviousDeployRelease(paths),
      selected.release.releasePath
    ]
    if (journal)
      allowedReleaseDirs.push(
        inspectRecoveryRelease(paths, journal.candidate.split('/').at(-1)!)
          .releasePath
      )
    prepare()
    await activate({
      paths,
      candidateRelease: selected.release.releasePath,
      explicitRecovery: true,
      verifyReadiness: (releasePath) =>
        restartAndVerifyProduction({
          standaloneDir: releasePath,
          allowedReleaseDirs
        })
    })
    log(
      '恢复成功：所选版本已通过三个实例与 HTTP 就绪检查；数据库未恢复。'
    )
    return 'recovered'
  } finally {
    unlock()
  }
}
