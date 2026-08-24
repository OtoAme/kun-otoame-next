export const MOEMOEPOINT_REASON = {
  accountCreated: {
    code: 'account.created',
    text: '账户创建初始余额'
  },
  migrationOpening: {
    code: 'system.migration_opening',
    text: '系统迁移初始余额'
  },
  checkIn: { code: 'check_in.reward', text: '每日签到奖励' },
  patchCreated: { code: 'patch.create_reward', text: '发布 OtomeGame 奖励' },
  resourceCreated: {
    code: 'resource.create_reward',
    text: '发布资源奖励'
  },
  resourceDeleted: {
    code: 'resource.delete_reversal',
    text: '资源删除，收回发布奖励'
  },
  commentLiked: {
    code: 'comment.like_received',
    text: '评论收到点赞'
  },
  commentUnliked: {
    code: 'comment.unlike_reversal',
    text: '评论点赞被取消'
  },
  ratingLiked: {
    code: 'rating.like_received',
    text: '评价收到点赞'
  },
  ratingUnliked: {
    code: 'rating.unlike_reversal',
    text: '评价点赞被取消'
  },
  resourceLiked: {
    code: 'resource.like_received',
    text: '资源收到点赞'
  },
  resourceUnliked: {
    code: 'resource.unlike_reversal',
    text: '资源点赞被取消'
  },
  usernameChanged: {
    code: 'account.username_change',
    text: '修改用户名'
  },
  conversationCreated: {
    code: 'message.conversation_create',
    text: '创建私聊会话'
  },
  conversationImage: {
    code: 'message.image_charge',
    text: '私聊图片超额上传'
  },
  conversationImageRefund: {
    code: 'message.image_refund',
    text: '私聊图片上传失败退款'
  },
  adminGrant: { code: 'admin.grant', text: '管理员发放' }
} as const

/**
 * 规则说明页的展示数据。金额是当前实现的实际值, 改动业务时必须同步这里,
 * 否则用户看到的规则会和真实扣费不一致。
 *
 * 对应实现位置:
 * - 签到: app/api/user/status/check-in/route.ts
 * - 发布游戏: app/api/edit/create.ts
 * - 发布/删除资源: app/api/patch/resource/{create,delete}.ts
 * - 点赞: app/api/patch/{comment,rating,resource}/like/service.ts
 * - 改名: app/api/user/setting/username/route.ts
 * - 私聊与图片: app/api/message/conversation/**
 * - 发资源与上传门槛: app/api/patch/resource/route.ts, app/api/upload/resource/route.ts
 * - 投稿押金与奖励: app/api/patch-submission/**, constants/patchSubmission.ts
 */
export const MOEMOEPOINT_EARN_RULES = [
  { label: '每日签到', amount: '+2 ~ +7', detail: '每天一次, 数值随机' },
  { label: '发布 OtomeGame', amount: '+3', detail: '每成功发布一个游戏条目' },
  {
    label: '投稿通过',
    amount: '+3',
    detail: '投稿通过审核后返还押金, 并额外奖励 3 点'
  },
  { label: '发布资源', amount: '+3', detail: '每成功发布一个资源' },
  {
    label: '内容被点赞',
    amount: '+1',
    detail: '评论、评价、资源被他人点赞, 对方取消点赞时收回'
  },
  { label: '管理员发放', amount: '+N', detail: '活动奖励或补偿' }
] as const

export const MOEMOEPOINT_SPEND_RULES = [
  { label: '修改用户名', amount: '-30', detail: '需要 30 可用萌萌点' },
  {
    label: '发起新私聊',
    amount: '-10',
    detail: '每个新会话扣 10 点, 但必须至少保留 20 点可用萌萌点才能发起'
  },
  {
    label: '私聊图片超额上传',
    amount: '-5',
    detail: '每人每小时前 5 张免费, 第 6 张起每张 5 点; 上传失败自动退款'
  },
  {
    label: '他人取消对你内容的点赞',
    amount: '-1',
    detail: '评论、评价或资源被取消点赞时, 对应的点赞奖励会收回'
  },
  {
    label: '删除资源（收回奖励）',
    amount: '-3',
    detail: '发布资源时获得的 3 点会被收回, 可能使总额变为负数'
  },
  {
    label: '新建投稿（押金暂扣）',
    amount: '-10',
    detail:
      '普通用户每条投稿暂扣 10 点, 创作者 1 点。暂扣期间不可用, 但仍计入总额'
  },
  {
    label: '投稿违规（押金扣除）',
    amount: '-10',
    detail:
      '仅在被判定违规时扣除。重复条目或不予收录会全额返还, 删除草稿也会返还'
  }
] as const

export const MOEMOEPOINT_THRESHOLD_RULES = [
  {
    label: '发布资源',
    detail: '普通用户可用萌萌点 ≥ 20; 创作者和管理员不受此门槛限制'
  },
  {
    label: '上传文件到对象存储',
    detail: '创作者可用萌萌点 ≥ 20; 管理员不受此余额门槛限制'
  },
  {
    label: '新建投稿',
    detail:
      '需要足够的可用萌萌点支付押金; 普通用户同时最多 5 条投稿, 创作者 10 条'
  }
] as const
