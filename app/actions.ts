'use server'

import { setKUNGalgameTask } from '~/server/cron'

setKUNGalgameTask()

import { getHomeData } from '~/app/api/home/service'

export const kunGetActions = async () => {
  const response = await getHomeData({ content_limit: 'sfw' })
  return response
}
