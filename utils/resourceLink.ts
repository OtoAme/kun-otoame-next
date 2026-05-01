const CODE_PATTERNS = [
  /提取码\s*[：:]\s*([a-zA-Z0-9]+)/,
  /访问码\s*[：:]\s*([a-zA-Z0-9]+)/,
  /密码\s*[：:]\s*([a-zA-Z0-9]+)/,
  /pwd\s*[：:=]\s*([a-zA-Z0-9]+)/i
]

const URL_REGEX = /https?:\/\/[^\s,，]+/
const TRAILING_PUNCTUATION_REGEX = /[,.!?，。！？、「」【】]+$/

export interface ParsedResourceLink {
  url: string
  code: string
}

const parseCodeFromSearchParams = (url: URL) => {
  return (
    url.searchParams.get('pwd') ||
    url.searchParams.get('password') ||
    url.searchParams.get('code') ||
    ''
  )
}

const parseCodeFromText = (input: string) => {
  for (const pattern of CODE_PATTERNS) {
    const match = input.match(pattern)
    if (match) {
      return match[1]
    }
  }
  return ''
}

export const parseResourceLink = (input: string): ParsedResourceLink => {
  const trimmedInput = input.trim()
  const urlMatch = trimmedInput.match(URL_REGEX)

  if (!urlMatch) {
    return { url: trimmedInput, code: '' }
  }

  const url = urlMatch[0].replace(TRAILING_PUNCTUATION_REGEX, '')
  let code = ''

  try {
    const urlObject = new URL(url)
    code = parseCodeFromSearchParams(urlObject)
  } catch {}

  if (!code) {
    code = parseCodeFromText(trimmedInput)
  }

  return { url, code }
}

export const splitResourceCodes = (code: string) => {
  return code
    .split(/[,，\n]/)
    .map((code) => code.trim())
    .filter(Boolean)
}

export const mergeResourceCodes = (...codes: string[]) => {
  return Array.from(new Set(codes.flatMap(splitResourceCodes))).join(', ')
}

export const normalizeResourceContent = (content: string) => {
  const parsedLinks = content
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseResourceLink)

  const codes = Array.from(
    new Set(parsedLinks.map((item) => item.code).filter(Boolean))
  )

  return {
    links: parsedLinks.map((item) => item.url).filter(Boolean),
    codes,
    code: mergeResourceCodes(...codes),
    content: parsedLinks
      .map((item) => item.url)
      .filter(Boolean)
      .join(',')
  }
}
