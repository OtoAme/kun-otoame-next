import { canAccessAdmin } from './user'

export interface KunNavItem {
  name: string
  href: string
}

export const kunNavItem: KunNavItem[] = [
  {
    name: '游戏下载',
    href: '/otomegame'
  },
  {
    name: '游戏标签',
    href: '/tag'
  },
  {
    name: '游戏会社',
    href: '/company'
  },
  {
    name: '帮助文档',
    href: '/doc'
  }
]

const kunAdminNavItem: KunNavItem = {
  name: '管理后台',
  href: '/admin'
}

const kunMobileOnlyNavItem: KunNavItem[] = [
  {
    name: '评论列表',
    href: '/comment'
  },
  {
    name: '下载资源列表',
    href: '/resource'
  },
  {
    name: '联系我们',
    href: 'mailto:contact@otoame.com'
  }
]

export const getKunNavItems = (role: number): KunNavItem[] => [
  ...kunNavItem,
  ...(canAccessAdmin(role) ? [kunAdminNavItem] : [])
]

export const getKunMobileNavItems = (role: number): KunNavItem[] => [
  ...getKunNavItems(role),
  ...kunMobileOnlyNavItem
]
