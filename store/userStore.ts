import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useSettingStore } from './settingStore'
import { useMessageStore } from './messageStore'
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

export type SessionStatus =
  | 'checking'
  | 'authenticated'
  | 'guest'
  | 'unavailable'

const broadcastSessionChange = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      'kun-session-change',
      JSON.stringify({ at: Date.now(), nonce: Math.random() })
    )
  }
}

export interface UserStore {
  sessionStatus: SessionStatus
  sessionContext: string | null
  sessionGeneration: number
  setSessionStatus: (status: SessionStatus) => void
  acceptSession: (user: UserState, context: string) => void
  invalidateSession: () => void
  user: UserState
  setUser: (user: UserState) => void
  setLoginUser: (user: UserState) => void
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
    (set, get) => ({
      user: initialUserStore,
      sessionStatus: 'checking',
      sessionContext: null,
      sessionGeneration: 0,
      setSessionStatus: (sessionStatus) => set({ sessionStatus }),
      invalidateSession: () => {
        useSettingStore.getState().resetData()
        useMessageStore.getState().resetUnreadMessageStatus()
        set((state) => ({
          user: initialUserStore,
          sessionStatus: 'checking',
          sessionContext: null,
          sessionGeneration: state.sessionGeneration + 1
        }))
      },
      acceptSession: (user, context) => {
        const previous = get()
        const changed =
          previous.user.uid > 0 &&
          (previous.user.uid !== user.uid ||
            (previous.sessionContext !== null &&
              previous.sessionContext !== context))
        if (changed) {
          useSettingStore.getState().resetData()
          useMessageStore.getState().resetUnreadMessageStatus()
        }
        syncBlockedTagCache(user.blockedTagIds)
        set({
          user,
          sessionContext: context,
          sessionStatus: 'authenticated',
          sessionGeneration: previous.sessionGeneration + Number(changed)
        })
      },
      setLoginUser: (user) => {
        useSettingStore.getState().resetData()
        useMessageStore.getState().resetUnreadMessageStatus()
        set((state) => ({
          user,
          sessionContext: null,
          sessionStatus: 'checking',
          sessionGeneration: state.sessionGeneration + 1
        }))
        syncBlockedTagCache(user.blockedTagIds)
        broadcastSessionChange()
      },
      setUser: (user: UserState) => {
        const previous = get()
        const changed = previous.user.uid !== user.uid
        if (changed) {
          useSettingStore.getState().resetData()
          useMessageStore.getState().resetUnreadMessageStatus()
        }
        syncBlockedTagCache(user.blockedTagIds)
        set({
          user,
          ...(changed
            ? {
                sessionStatus: 'checking' as const,
                sessionContext: null,
                sessionGeneration: previous.sessionGeneration + 1
              }
            : {})
        })
        if (changed) broadcastSessionChange()
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
        const previous = get()
        useSettingStore.getState().resetData()
        useMessageStore.getState().resetUnreadMessageStatus()
        set({
          user: initialUserStore,
          sessionStatus: 'guest',
          sessionContext: null,
          sessionGeneration: previous.sessionGeneration + 1
        })
        if (previous.user.uid || previous.sessionContext)
          broadcastSessionChange()
      }
    }),
    {
      name: 'kun-patch-user-store',
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({ user: state.user }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<UserStore>
        return {
          ...currentState,
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
