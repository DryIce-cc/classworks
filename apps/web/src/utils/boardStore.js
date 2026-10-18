// 一天作业存档的形状处理：正文只认 content 这一套坐标。
// 「哪些科目要删、这天是不是整个删掉」的判断在这里；
// 异步写盘、pendingSaves / storedDates 这些并发编排留在组件里。

// 正文为空（含全空白）的科目名：这些条目存盘前要从这天删掉，不留空壳
export function emptySubjectNames(homework) {
  return Object.entries(homework || {})
    .filter(([, data]) => !data?.content?.trim())
    .map(([name]) => name)
}

// 清掉空条目之后这天还剩没剩作业。false 表示整条记录都不该留。
// 用键数而不是再扫一遍 content：调用方刚删过空条目，剩下的就是要存的
export function hasAnyHomework(homework) {
  return Object.keys(homework || {}).length > 0
}
