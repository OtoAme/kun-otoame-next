import { getS3StorageKey } from './s3Key'

// Server routes and Node maintenance scripts only. Client components must use
// complete URLs returned by the server; the prefix is not a client env variable.
const resolvePublicBase = (root: string | undefined) => {
  const base = root?.trim().replace(/\/+$/, '')
  if (!base) return null

  const storageRoot = getS3StorageKey('')
  return storageRoot ? `${base}/${storageRoot.slice(0, -1)}` : base
}

export const getS3PublicBaseUrl = () =>
  resolvePublicBase(process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL)

export const getImageBedBaseUrl = () =>
  resolvePublicBase(process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL)

export const getS3PublicUrl = (key: string | null | undefined) => {
  if (!key) return null
  const base = getS3PublicBaseUrl()
  return base ? `${base}/${key}` : null
}

export const getImageBedUrl = (key: string) => {
  const base = getImageBedBaseUrl()
  if (!base) throw new Error('Missing KUN_VISUAL_NOVEL_IMAGE_BED_URL')
  return `${base}/${key}`
}

// A nested public root must be stripped before its broader parent root.
export const getS3PublicBases = () =>
  [
    ...new Set(
      [getImageBedBaseUrl(), getS3PublicBaseUrl()].filter(
        (base): base is string => Boolean(base)
      )
    )
  ].sort((left, right) => right.length - left.length)
