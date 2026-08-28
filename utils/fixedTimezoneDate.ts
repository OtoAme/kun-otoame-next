// 固定 Asia/Shanghai 而不是环境时区: 同一个时间戳在服务端和浏览器会渲染成
// 两种文本, 触发 SSR/CSR 水合不一致。这里刻意不用 utils/time.ts 的 formatDate,
// 那个函数按环境时区格式化, 有同样的风险; 固定成 Asia/Shanghai 也和
// utils/moemoepointDateRange.ts 的自然日边界保持同一口径。
//
// formatter 提到模块级: Intl.DateTimeFormat 构造开销大, 而调用方多是一次渲染
// 几十行的列表。
const CHINA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/** 按 Asia/Shanghai 格式化到分钟, 形如 `2026/08/27 08:00`。 */
export const formatChinaDateTime = (value: string | number | Date) =>
  CHINA_DATE_TIME_FORMATTER.format(new Date(value))
