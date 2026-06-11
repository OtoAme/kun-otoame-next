import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialCreatePatchData, useCreatePatchStore } from '~/store/editStore'

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

  it('resets create-page external data so another game can be fetched', () => {
    useCreatePatchStore.getState().setData({
      ...initialCreatePatchData,
      name: 'A 游戏',
      bangumiId: '172612',
      vndbId: 'v1',
      alias: ['旧别名'],
      tag: ['旧标签'],
      introduction: '旧简介'
    })

    useCreatePatchStore.getState().resetData()

    expect(useCreatePatchStore.getState().data).toEqual(initialCreatePatchData)
  })
})
