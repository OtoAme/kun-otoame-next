const path = require('path')
const fs = require('fs')

const standaloneDir = path.join(__dirname, '.next', 'standalone')
// Prefer server.mjs if it exists (deployed environment), otherwise fallback to server.js (local environment)
const scriptPath = fs.existsSync(path.join(standaloneDir, 'server.mjs')) ? 'server.mjs' : 'server.js'

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
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: 3000
      }
    }
  ]
}
