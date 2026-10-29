/**
 * Help board (module 07) vocabulary and limits. Category codes are persisted
 * in `help_post.category`; keep them stable.
 */
export const HELP_CATEGORIES = [
  'request',
  'runtime',
  'download',
  'account',
  'recommend',
  'other'
] as const
export type HelpCategory = (typeof HELP_CATEGORIES)[number]

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  request: '求游戏或资源',
  runtime: '运行问题',
  download: '下载与解压',
  account: '账号与站务',
  recommend: '求推荐',
  other: '其他'
}

/** Shown under the category picker so posters choose the right place. */
export const HELP_CATEGORY_HINTS: Record<HelpCategory, string> = {
  request: '求站内还没有的游戏、补丁、资料集，或站外的工具、字体等',
  runtime: '区域语言、运行库、兼容性、显示字体、启动失败、乱码、存档',
  download:
    '网盘客户端、网络、分卷、校验、解压软件与密码格式；某条链接失效请用链接旁的「报告失效」',
  account:
    '登录、验证、萌萌点规则、投稿流程等疑问；需要网站管理员改数据请用工作台「问题处理」里的站务反馈',
  recommend:
    '求推荐游戏、找忘了名字的游戏；已知道是哪部游戏、想要下载或补丁的，发到「求游戏或资源」',
  other: '上述都不适用的社区问题'
}

export const HELP_STATUSES = ['open', 'solved'] as const
export type HelpStatus = (typeof HELP_STATUSES)[number]

export const HELP_STATUS_LABELS: Record<HelpStatus, string> = {
  open: '未解决',
  solved: '已解决'
}

export const HELP_SORTS = ['latest', 'unanswered'] as const

/** Whose posts the list shows; mine and followed need a signed-in reader. */
export const HELP_SCOPES = ['all', 'mine', 'followed'] as const
export type HelpScope = (typeof HELP_SCOPES)[number]
export const HELP_SCOPE_LABELS: Record<HelpScope, string> = {
  all: '全部',
  mine: '我发布的',
  followed: '我关注的'
}
/** Items per own list in the sidebar; the rest is one click away. */
export const HELP_SIDEBAR_ITEM_LIMIT = 3
export type HelpSort = (typeof HELP_SORTS)[number]

export const HELP_POST_FEE = 5
export const HELP_ANSWER_REWARD = 3
export const HELP_DAILY_POST_LIMIT = 3
export const HELP_DAILY_REWARD_LIMIT = 3
/** Both asker and answerer must be registered this long to move points. */
export const HELP_POINT_ELIGIBLE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
/** Report auto-hide counts reporters registered at least this long. */
export const HELP_REPORTER_ELIGIBLE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
export const HELP_AUTO_HIDE_REPORTER_THRESHOLD = 3
/** Home aggregation only shows authors registered at least this long. */
export const HELP_HOME_AUTHOR_AFTER_MS = 3 * 24 * 60 * 60 * 1000

export const HELP_TITLE_MIN_LENGTH = 4
export const HELP_TITLE_MAX_LENGTH = 100
export const HELP_CONTENT_MIN_LENGTH = 10
export const HELP_CONTENT_MAX_LENGTH = 10007
export const HELP_ANSWER_MAX_LENGTH = 10007
export const HELP_REPLY_MAX_LENGTH = 1000
/** Uploaded images per post or answer body. */
export const HELP_IMAGE_MAX_PER_BODY = 6
export const HELP_IMAGE_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
] as const
export const HELP_GAME_NAME_MAX_LENGTH = 200
export const HELP_PAGE_SIZE = 20
export const HELP_SIMILAR_LIMIT = 5

export const HELP_RESOURCE_SHARE_HINT =
  '分享游戏或补丁资源，建议先在条目资源区「添加资源」（普通用户需至少 20 可用萌萌点，可能需要审核），通过后把资源卡片的分享链接贴到这里。'
export const HELP_NO_RESPONSE_DUTY =
  '由社区自愿回答，不保证回应，也不构成对网站管理员或任何发布者的回应义务。'
export const HELP_LOW_BALANCE_HINT = '余额不足，可先每日签到获得萌萌点'
