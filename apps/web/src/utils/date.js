// 日期一律用 YYYYMMDD 字符串表示：可直接比较大小、按序排列、拼成存储 key

export function toDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function parseDateString(dateString) {
  return new Date(
    Number(dateString.slice(0, 4)),
    Number(dateString.slice(4, 6)) - 1,
    Number(dateString.slice(6, 8)),
  )
}

export function shiftDateString(dateString, offset) {
  const date = parseDateString(dateString)
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

// 周几的单字，下标就是 Date#getDay() 的返回值（0 = 周日）。
// 解析日子词（homeworkReserve）和显示日期名都从这里取，别处不再各写一份
export const WEEKDAY_CHARS = ['日', '一', '二', '三', '四', '五', '六']

// 相对日期名（周以周一为首）：
//   今天
//   昨天 / 明天
//   上周三 / 本周五 / 下周三
//   9月10日（星期四）
export function formatDayName(dateString) {
  const target = parseDateString(dateString)
  if (isNaN(target.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayMs = 86400000
  const diff = Math.round((target - today) / dayMs)

  // 按周一为周首计算所在周偏移
  const mondayStart = (dt) => {
    const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
    return t
  }
  const weekOffset = Math.round((mondayStart(target) - mondayStart(today)) / (7 * dayMs))

  const short = WEEKDAY_CHARS[target.getDay()]
  const md = `${target.getMonth() + 1}月${target.getDate()}日`

  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  if (weekOffset === -1) return `上周${short}`
  if (weekOffset === 1) return `下周${short}`
  if (weekOffset === 0) return `周${short}`
  return `${md}`
}
