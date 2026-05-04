import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kunCaptchaVerifyTokenRegex } from '~/constants/captcha'

const redisMocks = vi.hoisted(() => ({
  getKv: vi.fn(),
  setKv: vi.fn(),
  delKv: vi.fn()
}))

vi.mock('~/lib/redis', () => redisMocks)

import { verifyCaptcha } from '~/app/api/auth/captcha/verify'

describe('verifyCaptcha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a token accepted by captchaVerifyTokenSchema', async () => {
    const sessionId = '3ddfe00a-44fe-4317-b36c-6c7d1ee687e5'
    const selectedIds = ['2a3b7d8f-c8a5-4e0b-a45d-413b86851007']

    redisMocks.getKv.mockResolvedValue(JSON.stringify(selectedIds))

    const result = await verifyCaptcha(sessionId, selectedIds)

    expect(result).toEqual({
      code: expect.stringMatching(kunCaptchaVerifyTokenRegex)
    })
    expect(redisMocks.setKv).toHaveBeenCalledWith(
      expect.stringMatching(/^captcha:verify:[a-f0-9]{32}$/),
      'captcha',
      60 * 60
    )
  })
})
