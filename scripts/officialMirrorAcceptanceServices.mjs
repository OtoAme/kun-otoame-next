import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
const marker = process.env.KUN_ACCEPTANCE_MARKER
const file = process.env.KUN_ACCEPTANCE_SERVICE_LOG
if (!marker || !file) throw new Error('Explicit run identity required')
let failDeletes = false
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path === '/health') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ marker }))
    return
  }
  if (path === '/control/fail-deletes') {
    failDeletes = new URL(req.url, 'http://127.0.0.1').searchParams.get('enabled') === 'true'
    res.end('controlled')
    return
  }
  appendFileSync(file, JSON.stringify({ method: req.method, path, at: new Date().toISOString() }) + '\n')
  for await (const _chunk of req) { /* consume only synthetic request bodies */ }
  if (path === '/v1/check') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'unknown', reason: 'controlled_acceptance' }))
    return
  }
  if (req.method === 'DELETE' && failDeletes) {
    res.statusCode = 503
    res.end('controlled delete failure')
    return
  }
  if (req.method === 'DELETE' || req.method === 'PUT') {
    res.statusCode = req.method === 'DELETE' ? 204 : 200
    res.end()
    return
  }
  res.statusCode = 404
  res.end('synthetic object missing')
})
server.listen(36741, '127.0.0.1', () => console.log('Synthetic storage/checker ' + marker))
