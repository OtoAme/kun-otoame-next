interface AlistLinkData {
  code: number
  data: {
    key: string
    locked: boolean
    is_dir: boolean
    create_date: Date
    downloads: number
    views: number
    expire: number
    preview: boolean
    creator: {
      key: string
      nick: string
      group_name: string
    }
    source: {
      name: string
      size: number
    }
  }
  msg: string
}

interface AlistObjects {
  id: string
  name: string
  path: string
  thumb: boolean
  size: number
  type: string
  date: string
  create_date: string
  key: string
  source_enabled: boolean
}

interface AlistListData {
  code: number
  data: {
    objects: AlistObjects[]
  }
  msg: string
}

export const CLOUDREVE_PAN_DOMAIN = 'pan.otoame.top'

export const extractCloudreveShareKey = (link: string) => {
  const trimmed = link.trim()
  if (!trimmed) {
    return ''
  }

  try {
    const url = new URL(trimmed)
    if (url.hostname !== CLOUDREVE_PAN_DOMAIN) {
      return ''
    }

    const paths = (url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname)
      .split('/')
      .filter(Boolean)
    return paths.at(-1) ?? ''
  } catch {
    return ''
  }
}

export const formatSize = (sizeInBytes: number): string => {
  if (sizeInBytes >= 1024 ** 3) {
    return `${Number((sizeInBytes / 1024 ** 3).toPrecision(4))} GB`
  }
  return `${(sizeInBytes / 1024 ** 2).toFixed(3)} MB`
}

export const fetchCloudreveShareSize = async (link: string) => {
  const key = extractCloudreveShareKey(link)
  if (!key) {
    return null
  }

  try {
    const response = await fetch(
      `/api/cloudreve/share-size?key=${encodeURIComponent(key)}`
    )
    if (!response.ok) {
      return null
    }

    const data: { size?: number } = await response.json()
    return typeof data.size === 'number' && data.size > 0 ? data.size : null
  } catch {
    return null
  }
}

export const fetchLinkData = async (link: string) => {
  const key = extractCloudreveShareKey(link)
  if (!key) {
    return null
  }
  const apiUrl = `https://${CLOUDREVE_PAN_DOMAIN}/api/v3/share/info/${key}`
  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`)
    }
    const data: AlistLinkData = await response.json()
    return data
  } catch (error) {
    return null
  }
}

export const fetchListData = async (link: string) => {
  const key = extractCloudreveShareKey(link) || link
  const apiUrl = `https://${CLOUDREVE_PAN_DOMAIN}/api/v3/share/list/${key}`
  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch list: ${response.statusText}`)
    }
    const data: AlistListData = await response.json()

    if (data.code === 0 && data.data.objects && data.data.objects.length > 0) {
      const totalSize = data.data.objects.reduce(
        (sum, obj) => sum + obj.size,
        0
      )
      return totalSize
    }

    return null
  } catch (error) {
    return null
  }
}
