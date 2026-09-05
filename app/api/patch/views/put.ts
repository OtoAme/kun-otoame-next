import { prisma } from '~/prisma/index'
import { incrementPatchViewBuffer } from './buffer'

const logPatchViewError = (message: string, error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(message, error)
}

export const updatePatchViews = async (
  uniqueId: string,
  currentView?: number
) => {
  try {
    await incrementPatchViewBuffer(uniqueId, currentView)
    return
  } catch (error) {
    logPatchViewError('Failed to buffer patch view increment:', error)
  }

  try {
    // 与 flushPatchViewsTask 一致, 用原生 SQL 自增, 避免 @updatedAt 顶掉 updated
    await prisma.$executeRaw`
      UPDATE patch
      SET view = view + 1
      WHERE unique_id = ${uniqueId}
    `
  } catch (error) {
    logPatchViewError('Failed to update patch views in DB:', error)
  }
}
