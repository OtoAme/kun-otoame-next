import type { DropEvent } from 'react-dropzone'

export interface GalleryRemoteImportPayload {
  fileName: string
  contentType: string
  base64: string
}

type GalleryRemoteImporter = (
  url: string
) => Promise<GalleryRemoteImportPayload | string>

const imageExtensionPattern = /\.(avif|jpe?g|png|webp)(?:[?#].*)?$/i

const getDataTransferFiles = (event: DropEvent) => {
  if (Array.isArray(event)) {
    return []
  }

  const target = event.target as HTMLInputElement | null
  if (target?.files?.length) {
    return Array.from(target.files)
  }

  const dataTransfer = (event as DragEvent).dataTransfer
  if (dataTransfer?.files?.length) {
    return Array.from(dataTransfer.files)
  }

  return []
}

const normalizeRemoteUrl = (value: string) => {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

const getFirstUriListUrl = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))

const getImageSrcFromHtml = (value: string) => {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(value, 'text/html')
    return doc.querySelector('img')?.getAttribute('src') ?? null
  }

  return value.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null
}

const pushRemoteUrl = (urls: string[], value: string | null | undefined) => {
  if (!value) return

  const url = normalizeRemoteUrl(value)
  if (url && !urls.includes(url)) {
    urls.push(url)
  }
}

export const extractGalleryRemoteImageUrls = (dataTransfer: DataTransfer) => {
  const urls: string[] = []

  pushRemoteUrl(
    urls,
    getFirstUriListUrl(dataTransfer.getData('text/uri-list'))
  )
  pushRemoteUrl(urls, dataTransfer.getData('text/plain'))
  pushRemoteUrl(
    urls,
    getImageSrcFromHtml(dataTransfer.getData('text/html'))
  )

  return urls.filter((url) => {
    try {
      const parsed = new URL(url)
      return (
        imageExtensionPattern.test(parsed.pathname) ||
        parsed.pathname.includes('/cdn-cgi/image/')
      )
    } catch {
      return false
    }
  })
}

export const fileFromGalleryRemoteImport = ({
  fileName,
  contentType,
  base64
}: GalleryRemoteImportPayload) => {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new File([bytes], fileName, { type: contentType })
}

export const importRemoteGalleryImage = async (url: string) => {
  const response = await fetch('/api/edit/gallery/remote', {
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'kun-fetch'
    },
    body: JSON.stringify({ url })
  })

  if (!response.ok) {
    throw new Error('远程图片导入失败')
  }

  return response.json() as Promise<GalleryRemoteImportPayload | string>
}

export const getGalleryFilesFromEvent = async (
  event: DropEvent,
  importer: GalleryRemoteImporter = importRemoteGalleryImage
) => {
  const files = getDataTransferFiles(event)
  if (files.length > 0) {
    return files
  }

  if (Array.isArray(event)) {
    return []
  }

  const dataTransfer = (event as DragEvent).dataTransfer
  if (!dataTransfer) {
    return []
  }

  const urls = extractGalleryRemoteImageUrls(dataTransfer)
  const importedFiles: File[] = []
  let lastImportError: string | null = null
  for (const url of urls) {
    const result = await importer(url)
    if (typeof result !== 'string') {
      importedFiles.push(fileFromGalleryRemoteImport(result))
    } else {
      lastImportError = result
    }
  }

  if (urls.length > 0 && importedFiles.length === 0 && lastImportError) {
    throw new Error(lastImportError)
  }

  return importedFiles
}
