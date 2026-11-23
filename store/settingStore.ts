import { create } from 'zustand'
import { cookieStorage } from './_cookie'

export interface KunSettingData {
  kunNsfwEnable: string
  kunBlockedTagIds: number[]
}

interface StoreState {
  data: KunSettingData
  getData: () => KunSettingData
  setData: (data: KunSettingData) => void
  resetData: (clearLegacy?: boolean) => void
}

const initialState: KunSettingData = {
  kunNsfwEnable: 'sfw',
  kunBlockedTagIds: []
}

export const useSettingStore = create<StoreState>()((set, get) => ({
  data: initialState,
  getData: () => get().data,
  setData: (data) => set({ data }),
  resetData: (clearLegacy = false) => {
    if (clearLegacy && typeof document !== 'undefined')
      cookieStorage.removeItem('kun-patch-setting-store')
    set({ data: initialState })
  }
}))
