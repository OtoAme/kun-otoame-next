import { spawn } from 'node:child_process'
import { createDevLogFilter } from './devLogFilter.mjs'

const nextCommand = process.platform === 'win32' ? 'next.cmd' : 'next'
const child = spawn(nextCommand, ['dev', ...process.argv.slice(2)], {
  stdio: ['inherit', 'pipe', 'pipe']
})

const filter = createDevLogFilter((line) => process.stdout.write(line))
child.stdout.on('data', (chunk) => filter.push(chunk))
child.stdout.on('end', () => filter.flush())
child.stderr.pipe(process.stderr)

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal)
}
process.on('SIGINT', forwardSignal)
process.on('SIGTERM', forwardSignal)

child.on('error', (error) => {
  process.stderr.write(`[dev] Failed to start Next.js: ${String(error)}\n`)
  process.exitCode = 1
})

child.on('close', (code, signal) => {
  process.removeListener('SIGINT', forwardSignal)
  process.removeListener('SIGTERM', forwardSignal)
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
