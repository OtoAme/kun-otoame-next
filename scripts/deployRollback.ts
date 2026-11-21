import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { runDeployRecovery } from './deployRecovery'
import { formatRecoveryState } from './deployRecoveryInfo'
import { getDeploySlotPaths } from './deploySlots'

const projectRoot = resolve(import.meta.dirname, '..')
const ask = (prompt: string) =>
  new Promise<string | null>((resolveAnswer) => {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })
    let answered = false
    const finish = (answer: string | null) => {
      if (answered) return
      answered = true
      terminal.close()
      resolveAnswer(answer)
    }
    terminal.once('close', () => finish(null))
    terminal.once('SIGINT', () => finish(null))
    terminal.question(prompt, (answer) => finish(answer))
  })

runDeployRecovery({
  projectRoot,
  args: process.argv.slice(2),
  isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
  ask,
  prepare: () => {
    const envPath = resolve(projectRoot, '.env')
    if (!existsSync(envPath))
      throw new Error('.env file not found in project root.')
    config({ path: envPath })
  }
})
  .then((result) => {
    if (result === 'cancelled')
      console.log(
        'Recovery cancelled; no deployment state or process was changed.'
      )
  })
  .catch((error) => {
    console.error('Deployment recovery failed:', error)
    console.error(formatRecoveryState(getDeploySlotPaths(projectRoot)))
    process.exitCode = 1
  })
