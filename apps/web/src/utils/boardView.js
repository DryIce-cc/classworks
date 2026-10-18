// 展示板的选择器：从「所看的这一天 + 后续日期 + 编辑中的预览」里挑出要显示什么。
// 全是纯函数，入参都是普通数据，不碰组件实例、不读写存档。

// 某一天某个科目的预览正文。没有这一天的预览就返回 null，调用方据此回落到存档。
// 用 in 而不是真值判断：正文被删空时预览值是空串，那也得算数——
// 不然就会回落到存档里那份旧内容，把刚删掉的又显示出来
export function previewContent(preview, dateString, subjectName) {
  const day = preview[dateString]
  if (!day || !(subjectName in day)) return null
  return day[subjectName]
}

// 存档里出现过、且确实有内容的科目（含后续日期）。
// 同一天同一科目以预览为准，不用存档那份：正在编辑时存档还是改之前的样子，
// 拿存档来判就等于看不见这次编辑。正文被删空时预览值是空串，
// 那也是「这天它没有内容了」——不给存档让位的话，底部「点击添加作业」
// 那张卡片要等到完成编辑、存档真被改掉才出现
export function storedSubjectNames({ homework, preview, dateString, laterDays }) {
  const names = new Set()
  const collect = (dayHomework, dayString) => {
    // 预览里的科目存档里可能还没有（那天整个记录都还没存过），
    // 只扫存档的键会漏掉刚敲的第一个字，卡片区就长不出来
    const keys = new Set([
      ...Object.keys(dayHomework || {}),
      ...Object.keys(preview[dayString] || {}),
    ])
    for (const key of keys) {
      const own = previewContent(preview, dayString, key)
      const content = own != null ? own : dayHomework?.[key]?.content
      if (content?.trim()) names.add(key)
    }
  }
  collect(homework, dateString)
  // laterDays 已经把预览里各天补成占位项了，跟着它走就都算到了
  for (const day of laterDays) collect(day.homework, day.dateString)
  return names
}

// 同一科目的作业分块：当日在前，后续日期按日期升序，分隔线由渲染层处理。
// 每块都带着 dateString，卡片区靠它分出「点哪块进哪一天」的可点范围。
// dayName 由调用方传入：纯函数里不自己取当前时间，测试/缓存口径才稳定
export function buildSegments({ subjectName, homework, preview, dateString, laterDays, dayName }) {
  const segments = []
  const own = previewContent(preview, dateString, subjectName)
  const currentContent = own != null ? own : homework[subjectName]?.content
  // 空白不算有作业：正文只剩空格和空行时展示板会出一张没有内容的空卡片。
  // 口径和 storedSubjectNames 一致（那边用的是 trim）
  if (currentContent?.trim()) {
    segments.push({
      dateString,
      label: null,
      content: currentContent,
    })
  }
  for (const day of laterDays) {
    const ownLater = previewContent(preview, day.dateString, subjectName)
    const content = ownLater != null ? ownLater : day.homework?.[subjectName]?.content
    if (content?.trim()) {
      segments.push({
        dateString: day.dateString,
        label: dayName(day.dateString),
        content,
      })
    }
  }
  return segments
}
