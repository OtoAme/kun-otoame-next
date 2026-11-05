// Local acceptance processes may use only loopback TCP or local IPC.
const net = require('node:net')
const original = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = args[0]
  const options = Array.isArray(first) ? first[0] : first
  const host = typeof options === 'object' && options !== null
    ? options.host || options.hostname
    : typeof args[1] === 'string' ? args[1] : undefined
  const pipe = typeof options === 'object' && options !== null && options.path
  if (!pipe && host && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Official mirror acceptance blocked non-loopback network access')
  }
  return original.apply(this, args)
}
