const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')

let unresolvedActivation = false
try {
  fs.lstatSync(path.join(__dirname, '.deploy', 'activation-journal.json'))
  unresolvedActivation = true
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (unresolvedActivation) {
  throw new Error(
    'Unresolved deployment activation; use pnpm deploy:rollback --list and pnpm deploy:rollback to choose and confirm a release. Verify database compatibility first.'
  )
}

const managedCurrentDir = path.join(__dirname, '.deploy', 'current')
const standaloneDir = fs.existsSync(managedCurrentDir)
  ? managedCurrentDir
  : path.join(__dirname, '.next', 'standalone')
// Prefer server.mjs if it exists (deployed environment), otherwise fallback to server.js (local environment)
const scriptPath = fs.existsSync(path.join(standaloneDir, 'server.mjs'))
  ? 'server.mjs'
  : 'server.js'

// Load .env file so PM2 processes get all environment variables
const envPath = path.join(__dirname, '.env')
const dotenvResult = fs.existsSync(envPath)
  ? dotenv.config({ path: envPath })
  : {}
const envFromFile = dotenvResult.parsed || {}

module.exports = {
  apps: [
    {
      name: 'kun-touchgal-next',
      port: 3000,
      cwd: standaloneDir,
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      script: scriptPath,
      // https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
      env: {
        ...envFromFile,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: 3000
      }
    }
  ]
}
