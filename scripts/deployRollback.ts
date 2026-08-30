import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { acquireDeployLock } from './deployLock'
import { recoverOrRollbackWithReadiness } from './deployActivation'
import {
  restartAndVerifyProduction,
  validateStandaloneRuntime
} from './deployPm2'
import { getDeploySlotPaths } from './deploySlots'

const projectRoot = resolve(import.meta.dirname, '..')
const envPath = resolve(projectRoot, '.env')

const main = async () => {
  if (!existsSync(envPath)) {
    throw new Error('.env file not found in project root.')
  }
  config({ path: envPath })

  const slots = getDeploySlotPaths(projectRoot)
  const releaseLock = acquireDeployLock(slots.deployRoot)
  try {
    const result = await recoverOrRollbackWithReadiness({
      paths: slots,
      preflightRelease: (releasePath) => {
        // restartAndVerifyProduction repeats this immediately before PM2 delete.
        // The early pass guarantees both directions are viable before switching.
        validateStandaloneRuntime(releasePath)
      },
      verifyReadiness: (releasePath) =>
        restartAndVerifyProduction({ standaloneDir: releasePath })
    })
    console.log(
      `${result === 'recovered-interrupted' ? 'Interrupted deployment recovery' : 'Offline deployment rollback'} completed and passed readiness; database was not modified.`
    )
  } finally {
    releaseLock()
  }
}

main().catch((error) => {
  console.error('Deployment rollback failed:', error)
  process.exitCode = 1
})
