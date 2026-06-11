import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CREATE_PATCH_BANNER_KEY,
  CREATE_PATCH_ORIGINAL_BANNER_KEY,
  clearCreatePatchDraftFiles
} from '~/utils/createPatchDraft'
import {
  CREATE_GALLERY_DRAFT_KEY,
  CREATE_GALLERY_WATERMARK_KEY
} from '~/utils/createGalleryDraft'

const removeItemMock = vi.hoisted(() => vi.fn())

vi.mock('localforage', () => ({
  default: {
    removeItem: removeItemMock
  }
}))

describe('create patch draft helpers', () => {
  beforeEach(() => {
    removeItemMock.mockReset()
  })

  it('clears stored create-page files when resetting edit information', async () => {
    await clearCreatePatchDraftFiles()

    expect(removeItemMock).toHaveBeenCalledWith(CREATE_PATCH_BANNER_KEY)
    expect(removeItemMock).toHaveBeenCalledWith(
      CREATE_PATCH_ORIGINAL_BANNER_KEY
    )
    expect(removeItemMock).toHaveBeenCalledWith(CREATE_GALLERY_DRAFT_KEY)
    expect(removeItemMock).toHaveBeenCalledWith(CREATE_GALLERY_WATERMARK_KEY)
  })
})
