import { kunMoyuMoe } from '~/config/moyu-moe'

interface IndexNow {
  host: string
  key: string
  keyLocation: string
  urlList: string[]
}

const INDEX_NOW_TIMEOUT_MS = 3000

export const postToIndexNow = async (url: string) => {
  const requestData: IndexNow = {
    host: kunMoyuMoe.domain.main,
    key: process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY || '',
    keyLocation: `${kunMoyuMoe.domain.main}/${process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY}.txt`,
    urlList: [url]
  }

  try {
    const res = await fetch('https://www.bing.com/indexnow', {
      method: 'POST',
      headers: { 'User-Agent': kunMoyuMoe.titleShort },
      signal: AbortSignal.timeout(INDEX_NOW_TIMEOUT_MS),
      body: JSON.stringify(requestData)
    })

    if (!res.ok) {
      console.error('[IndexNow] Post failed:', res.status)
    }
  } catch (error) {
    console.error('[IndexNow] Post failed:', error)
  }
}
