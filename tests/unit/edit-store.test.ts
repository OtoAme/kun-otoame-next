import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initialCreatePatchData,
  useCreatePatchStore
} from '~/store/editStore'

describe('create patch edit store', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useCreatePatchStore.setState({ data: initialCreatePatchData })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports updater functions so async external fetches preserve newer input', () => {
    const initialSnapshot = useCreatePatchStore.getState().data

    useCreatePatchStore.getState().setData({
      ...initialSnapshot,
      bangumiId: '172612'
    })

    useCreatePatchStore.getState().setData((current) => ({
      ...current,
      alias: ['VNDB Title'],
      vndbTags: ['VNDB Tag'],
      vndbDevelopers: ['VNDB Studio']
    }))

    expect(useCreatePatchStore.getState().data).toMatchObject({
      bangumiId: '172612',
      alias: ['VNDB Title'],
      vndbTags: ['VNDB Tag'],
      vndbDevelopers: ['VNDB Studio']
    })
  })
})
