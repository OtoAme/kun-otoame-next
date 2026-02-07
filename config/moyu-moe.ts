import { SUPPORTED_TYPE_MAP } from '~/constants/resource'
import type { KunSiteConfig } from './config'

const KUN_SITE_NAME = 'OtoAme'
const KUN_SITE_MENTION = '@otoame'
const KUN_SITE_TITLE = 'OtoAme - 一站式OtomeGame文化社区!'
const KUN_SITE_IMAGE =
  './public/images/otoame.jpg'
const KUN_SITE_DESCRIPTION =
  'OtoAme 是一个一站式 OtomeGame 文化社区， 提供 OtomeGame 下载等服务。承诺永久免费, 高质量。为 OtomeGame 爱好者提供一片净土！'
const KUN_SITE_URL = 'https://www.otoame.top'
const KUN_SITE_ARCHIVE = 'https://archive.otoame.top/'
const KUN_SITE_FORUM = 'https://www.otoame.top/'                // 待修改 - 论坛
const KUN_SITE_NAV = 'https://www.otoa.me'                   // 待修改 - 导航页
const KUN_SITE_TELEGRAM_GROUP = 'https://t.me/otoame'         // 待修改
const KUN_SITE_QQ_GROUP_IMG = 'https://img.otoame.top/posts/2026/02/0c07d61ad30863586921c33a6ac1f4cb.webp'
const KUN_SITE_DISCORD_GROUP = ''  // 待修改
const KUN_SITE_LIST = [
  { name: KUN_SITE_NAME, url: 'https://www.otoame.top' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.moe' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.one' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.com' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.org' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.me' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.co' },
  // { name: KUN_SITE_NAME, url: 'https://www.touchgal.io' }
]
const KUN_SITE_KEYWORDS = [
  'OtoAme',
  'otome',
  'OtomeGame',
  '乙女',
  '乙女游戏',
  '乙女ゲーム',
  '乙游',
  '日乙',
  '论坛',
  '网站',
  '乙女游戏 下载',
  '乙女游戏 资源',
  '乙女游戏 wiki',
  '乙女游戏 评测',
  '乙女游戏 数据分析',
  '乙女游戏 新作动态',
  '乙女游戏 汉化 / 国际化',
  '乙女游戏 讨论',
  'OtomeGame 下载',
  'OtomeGame 资源',
  'OtomeGame wiki',
  'OtomeGame 评测',
  'OtomeGame 数据分析',
  'OtomeGame 新作动态',
  'OtomeGame 汉化 / 国际化',
  'OtomeGame 讨论',
  // 'OtomeGame 制作',
  '游戏交流',
  '其他交流',
  ...Object.values(SUPPORTED_TYPE_MAP)
]

export const kunMoyuMoe: KunSiteConfig = {
  title: KUN_SITE_TITLE,
  titleShort: KUN_SITE_NAME,
  template: `%s - ${KUN_SITE_NAME}`,
  description: KUN_SITE_DESCRIPTION,
  keywords: KUN_SITE_KEYWORDS,
  canonical: KUN_SITE_URL,
  author: [
    { name: KUN_SITE_TITLE, url: KUN_SITE_URL },
    { name: KUN_SITE_NAME, url: KUN_SITE_NAV },
    ...KUN_SITE_LIST
  ],
  creator: {
    name: KUN_SITE_NAME,
    mention: KUN_SITE_MENTION,
    url: KUN_SITE_URL
  },
  publisher: {
    name: KUN_SITE_NAME,
    mention: KUN_SITE_MENTION,
    url: KUN_SITE_URL
  },
  domain: {
    main: KUN_SITE_URL,
    imageBed: 'https://img.otoame.top',
    storage: KUN_SITE_URL,
    kungal: KUN_SITE_URL,
    telegram_group: KUN_SITE_TELEGRAM_GROUP,
    qq_group: KUN_SITE_QQ_GROUP_IMG,
    discord_group: KUN_SITE_DISCORD_GROUP,
    archive: KUN_SITE_ARCHIVE,
    forum: KUN_SITE_FORUM,
    nav: KUN_SITE_NAV
  },
  og: {
    title: KUN_SITE_TITLE,
    description: KUN_SITE_DESCRIPTION,
    image: KUN_SITE_IMAGE,
    url: KUN_SITE_URL
  },
  images: [
    {
      url: KUN_SITE_IMAGE,
      width: 1000,
      height: 800,
      alt: KUN_SITE_TITLE
    }
  ]
}
