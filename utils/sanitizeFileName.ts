export const sanitizeFileName = (fileName: string) => {
  const basename = fileName.split(/[\\/]/).pop()?.trim() ?? ''
  const match = basename.match(/^(.*?)(\.[^.]+)$/)
  if (!match) {
    return ''
  }

  const baseName = match[1]
  const extension = match[2].replace(/[^\p{L}\p{N}.]/gu, '').toLowerCase()
  const sanitizedBaseName = baseName.replace(/[^\p{L}\p{N}_-]/gu, '')

  if (
    !sanitizedBaseName ||
    !extension ||
    sanitizedBaseName === '.' ||
    sanitizedBaseName === '..'
  ) {
    return ''
  }

  return `${sanitizedBaseName.slice(0, 100)}${extension}`.slice(0, 200)
}
