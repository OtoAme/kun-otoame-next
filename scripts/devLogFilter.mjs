import { StringDecoder } from 'node:string_decoder'

const REQUEST_LINE = /^\s*([A-Z]+)\s+(\S+)\s+(\d{3})(?:\s|$)/
// ANSI escapes are intentionally matched so terminal color codes can be stripped.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]/g

const isShoutboxPath = (value) => {
  const pathname = value.split(/[?#]/, 1)[0]
  return /^\/api\/(?:admin\/)?shoutbox(?:\/|$)/.test(pathname)
}

export const shouldHideDevLogLine = (line) => {
  const match = line.replace(ANSI_ESCAPE, '').match(REQUEST_LINE)
  if (!match || match[1] !== 'GET' || match[3] !== '200') return false
  return isShoutboxPath(match[2])
}

export const createDevLogFilter = (write) => {
  const decoder = new StringDecoder('utf8')
  let pending = ''

  const emit = (line) => {
    if (!shouldHideDevLogLine(line)) write(line)
  }

  return {
    push(chunk) {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      let newlineIndex = pending.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex + 1)
        pending = pending.slice(newlineIndex + 1)
        emit(line)
        newlineIndex = pending.indexOf('\n')
      }
    },
    flush() {
      pending += decoder.end()
      if (pending) {
        emit(pending)
        pending = ''
      }
    }
  }
}
