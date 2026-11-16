// Environment reads in this module are for server routes and Node scripts.
export const normalizeS3StoragePrefix = (value: string | undefined) => {
  const raw = value?.trim() ?? ''
  if (!raw) return ''

  const prefix = raw.replace(/^\/+|\/+$/g, '')
  if (
    !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(prefix) ||
    prefix.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX')
  }
  return prefix
}

// Business keys remain relative to the environment's storage root, including
// keys persisted in upload records and cleanup jobs.
export const getS3StorageKey = (key: string) => {
  const prefix = normalizeS3StoragePrefix(
    process.env.KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX
  )
  return prefix ? `${prefix}/${key}` : key
}

export const getS3LogicalKey = (storageKey: string) => {
  const root = getS3StorageKey('')
  if (!storageKey.startsWith(root)) return null
  return storageKey.slice(root.length)
}
