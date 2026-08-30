import { kunMoyuMoe } from '~/config/moyu-moe'

interface IndexNow {
  host: string
  key: string
  keyLocation: string
  urlList: string[]
}

export const postToIndexNow = async (url: string) => {
  const key = process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY
  // An empty value is the explicit disabled state used by isolated E2E. Do not
  // send a malformed request that still reaches the public IndexNow endpoint.
  if (!key) return

  const requestData: IndexNow = {
    host: kunMoyuMoe.domain.main,
    key,
    keyLocation: `${kunMoyuMoe.domain.main}/${key}.txt`,
    urlList: [url]
  }

  await fetch('https://www.bing.com/indexnow', {
    method: 'POST',
    headers: { 'User-Agent': kunMoyuMoe.titleShort },
    body: JSON.stringify(requestData)
  })
}
