import { revalidatePath } from 'next/cache'

type RevalidatePathType = 'layout' | 'page'

export const safeRevalidatePath = (
  originalPath: string,
  type?: RevalidatePathType
) => {
  try {
    revalidatePath(originalPath, type)
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[ISR] Skipped revalidatePath(${originalPath}):`,
        error instanceof Error ? error.message : error
      )
    }
  }
}
