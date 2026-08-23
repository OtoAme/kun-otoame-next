export const randomNum = (lowerValue: number, upperValue: number) => {
  return Math.floor(Math.random() * (upperValue - lowerValue + 1) + lowerValue)
}

export const randomNormalInt = (min: number, max: number) => {
  const mean = (min + max) / 2
  const stdDev = (max - min) / 6

  const weights = []
  for (let x = min; x <= max; x++) {
    const w = Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2))
    weights.push(w)
  }

  const sum = weights.reduce((a, b) => a + b, 0)
  const r = Math.random() * sum

  let accum = 0
  for (let i = 0; i < weights.length; i++) {
    accum += weights[i]
    if (r <= accum) return min + i
  }

  // 浮点累加误差可能让 accum 略小于 r, 此时落在最后一格。
  // 返回 max 而不是 undefined, 调用方才不需要自己兜底。
  return max
}

export const generateRandomString = (length: number) => {
  const charset = '023456789abcdefghjkmnopqrstuvwxyz'
  const array = new Uint8Array(length)
  globalThis.crypto.getRandomValues(array)
  let code = ''
  for (let i = 0; i < length; i++) {
    code += charset[array[i] % charset.length]
  }
  return code.toUpperCase()
}

// crypto.randomUUID() exists only in secure contexts, so a page served over
// plain HTTP on a LAN address would throw. getRandomValues carries no such
// restriction, so build the v4 UUID from it instead.
export const generateUUID = () => {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
