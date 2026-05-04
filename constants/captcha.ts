export const KUN_CAPTCHA_VERIFY_TOKEN_BYTES = 16
export const KUN_CAPTCHA_VERIFY_TOKEN_TTL_SECONDS = 60 * 60
export const kunCaptchaVerifyTokenRegex = /^[a-f0-9]{32}$/

export const kunCaptchaErrorMessageMap: Record<number, string> = {
  1: '咦？连自家的 白毛推 都认不出来了吗？',
  2: '是不是挑花眼了？醒醒呀公主殿下！',
  3: '再选不对的话，男主们可是要闹别扭咯。',
  4: '是不是被帅气迷晕了眼？醒醒呀公主殿下！',
  5: '虽然都很帅，但还是要看清题目选白毛哦！',
  6: '我知道很难选，因为每一张都想点...但请克制！'
}
