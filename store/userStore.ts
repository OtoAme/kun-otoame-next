import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useSettingStore } from './settingStore'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'

export interface UserState {
  uid: number
  name: string
  avatar: string
  bio: string
  moemoepoint: number
  moemoepointReserved: number
  moemoepointAvailable: number
  role: number
  dailyCheckIn: number
  dailyImageLimit: number
  dailyUploadLimit: number
  enableEmailNotice: boolean
  allowPrivateMessage: boolean
  blockedTagIds: number[]

  enableRedirect: boolean
  excludedDomains: string[]
  delaySeconds: number
}

export interface UserStore {
  user: UserState
  setUser: (user: UserState) => void
  setMoemoepointBalance: (balance: MoemoepointBalance) => void
  logout: () => void
}

const initialUserStore: UserState = {
  uid: 0,
  name: '',
  avatar: '',
  bio: '',
  moemoepoint: 0,
  moemoepointReserved: 0,
  moemoepointAvailable: 0,
  role: 1,
  dailyCheckIn: 1,
  dailyImageLimit: 0,
  dailyUploadLimit: 0,
  enableEmailNotice: false,
  allowPrivateMessage: true,
  blockedTagIds: [],

  enableRedirect: true,
  excludedDomains: [],
  delaySeconds: 5
}

const syncBlockedTagCache = (blockedTagIds: number[]) => {
  const { data, setData } = useSettingStore.getState()
  setData({ ...data, kunBlockedTagIds: blockedTagIds })
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: initialUserStore,
      setUser: (user: UserState) => {
        syncBlockedTagCache(user.blockedTagIds)
        set({ user })
      },
      setMoemoepointBalance: (balance: MoemoepointBalance) => {
        set((state) => ({
          user: {
            ...state.user,
            moemoepoint: balance.total,
            moemoepointReserved: balance.reserved,
            moemoepointAvailable: balance.available
          }
        }))
      },
      logout: () => {
        syncBlockedTagCache([])
        set({ user: initialUserStore })
      }
    }),
    {
      name: 'kun-patch-user-store',
      storage: createJSONStorage(() => window.localStorage),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<UserStore>
        return {
          ...currentState,
          ...persisted,
          user: {
            ...initialUserStore,
            ...persisted.user,
            moemoepointReserved: persisted.user?.moemoepointReserved ?? 0,
            moemoepointAvailable:
              persisted.user?.moemoepointAvailable ??
              persisted.user?.moemoepoint ??
              0
          }
        }
      }
    }
  )
)
