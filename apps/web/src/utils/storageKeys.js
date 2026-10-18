// 本地存档键集中在这里：键名是持久化约定，散落在各组件里改一处漏一处。
// 两层门面：拼键（dayDataKey）和从键名认回日期（dayFromKey）必须成对使用。

export const SUBJECT_CONFIG_KEY = 'classworks-config-subject'

const DAY_DATA_PREFIX = 'classworks-data-'

export const dayDataKey = (dateString) => `${DAY_DATA_PREFIX}${dateString}`

// 从存档键里取出日期；不是某天的作业存档就返回 null。
// 只认八位日期，别的前缀残留（旧版本写坏的数据）一律当不认识
export function dayFromKey(key) {
  if (typeof key !== 'string' || !key.startsWith(DAY_DATA_PREFIX)) return null
  const dateString = key.slice(DAY_DATA_PREFIX.length)
  return /^\d{8}$/.test(dateString) ? dateString : null
}
