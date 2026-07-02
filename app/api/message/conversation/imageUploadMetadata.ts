import { createHash } from 'crypto'
import type { PrivateMessageImage } from '~/types/api/conversation'

const CONVERSATION_IMAGE_UPLOAD_TTL_SECONDS = 60 * 60
const CONVERSATION_IMAGE_UPLOAD_CONSUME_SCRIPT = `
  local function decode(value)
    local ok, parsed = pcall(cjson.decode, value)
    if not ok then
      return nil
    end
    return parsed
  end

  for i = 1, #KEYS do
    local storedValue = redis.call("GET", KEYS[i])
    if not storedValue then
      return cjson.encode({ ok = false, code = "missing", index = i })
    end

    local stored = decode(storedValue)
    local expected = decode(ARGV[i])
    if not stored or not expected then
      return cjson.encode({ ok = false, code = "mismatch", index = i })
    end

    if tostring(stored.url) ~= tostring(expected.url)
      or tonumber(stored.width) ~= tonumber(expected.width)
      or tonumber(stored.height) ~= tonumber(expected.height)
      or tonumber(stored.size) ~= tonumber(expected.size)
      or tostring(stored.mime) ~= tostring(expected.mime)
      or tostring(stored.name) ~= tostring(expected.name) then
      return cjson.encode({ ok = false, code = "mismatch", index = i })
    end
  end

  redis.call("DEL", unpack(KEYS))
  return cjson.encode({ ok = true })
`

type ConversationImageConsumeResult =
  | { ok: true }
  | { ok: false; code: 'missing' | 'mismatch'; index: number }

const getConversationImageUploadKey = (
  conversationId: number,
  uid: number,
  url: string
) => {
  const urlHash = createHash('sha256').update(url).digest('hex')
  return `conversation:image-upload:${conversationId}:${uid}:${urlHash}`
}

const parseConsumeResult = (value: unknown): ConversationImageConsumeResult => {
  if (typeof value !== 'string') {
    throw new Error('Invalid conversation image consume response')
  }

  const parsed = JSON.parse(value) as Partial<ConversationImageConsumeResult>
  if (parsed.ok === true) {
    return { ok: true }
  }

  if (
    parsed.ok === false &&
    (parsed.code === 'missing' || parsed.code === 'mismatch') &&
    typeof parsed.index === 'number'
  ) {
    return {
      ok: false,
      code: parsed.code,
      index: parsed.index
    }
  }

  throw new Error('Invalid conversation image consume payload')
}

export const registerConversationImageUpload = async (
  conversationId: number,
  uid: number,
  image: PrivateMessageImage
) => {
  const { setKv } = await import('~/lib/redis')

  await setKv(
    getConversationImageUploadKey(conversationId, uid, image.url),
    JSON.stringify(image),
    CONVERSATION_IMAGE_UPLOAD_TTL_SECONDS
  )
}

export const consumeConversationImageUploads = async (
  conversationId: number,
  uid: number,
  images: PrivateMessageImage[]
) => {
  if (images.length === 0) {
    return null
  }

  const { getPrefixedRedisKey, redis, runRedisCommand } = await import(
    '~/lib/redis'
  )
  const keys = images
    .map((image) => getConversationImageUploadKey(conversationId, uid, image.url))
    .map(getPrefixedRedisKey)
  const expectedImages = images.map((image) => JSON.stringify(image))

  try {
    const rawResult = await runRedisCommand(() =>
      redis.eval(
        CONVERSATION_IMAGE_UPLOAD_CONSUME_SCRIPT,
        keys.length,
        ...keys,
        ...expectedImages
      )
    )
    const result = parseConsumeResult(rawResult)

    if (result.ok) {
      return null
    }

    return result.code === 'missing'
      ? '图片已过期，请重新上传'
      : '图片信息校验失败，请重新上传'
  } catch (error) {
    console.error('Failed to consume conversation image upload metadata', {
      conversationId,
      uid,
      error
    })
    return '图片校验失败，请稍后重试'
  }
}

export const restoreConversationImageUploads = async (
  conversationId: number,
  uid: number,
  images: PrivateMessageImage[]
) => {
  if (images.length === 0) {
    return
  }

  await Promise.all(
    images.map((image) =>
      registerConversationImageUpload(conversationId, uid, image)
    )
  )
}
