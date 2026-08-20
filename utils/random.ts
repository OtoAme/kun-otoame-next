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
