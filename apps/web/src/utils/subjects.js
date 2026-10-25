// 科目清单的默认取值与规整。
// 默认清单原先在 pages/index.vue 与 SubjectManagementCard.vue 各抄了一份，
// 科目带上附加属性后两份很容易走偏，统一放这里。

// 附加属性：
// - extraSubjects：附加科目名称。可以把作业记到本卡片下的附加科目里，
//   写法就是正文里的一行「# 附加科目名的作业」。
export const DEFAULT_SUBJECTS = [
  { name: '语文', order: 0 },
  { name: '数学', order: 1 },
  { name: '英语', order: 2 },
  { name: '物理', order: 3 },
  { name: '化学', order: 4 },
  { name: '生物', order: 5 },
  { name: '政治', order: 6, extraSubjects: ['历史合格作业'] },
  { name: '历史', order: 7, extraSubjects: ['政治合格作业'] },
  { name: '地理', order: 8 },
  { name: '其他', order: 9, extraSubjects: ['通知'] },
]

// 规整单个科目：补齐附加属性，附加科目名去空白、去空串、去重。
// 存档里的科目可能来自旧版本配置，字段缺失一律按默认值补上
export function normalizeSubject(subject, index = 0) {
  const extra = Array.isArray(subject?.extraSubjects) ? subject.extraSubjects : []
  return {
    name: subject?.name ?? '',
    order: subject?.order ?? index,
    extraSubjects: [...new Set(extra.map((n) => String(n).trim()).filter(Boolean))],
  }
}

// 规整整份科目配置并按 order 排序。返回全新对象，调用方改哪都不会污染这份默认值
export function normalizeSubjects(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((subject, index) => normalizeSubject(subject, index))
    .sort((a, b) => a.order - b.order)
}

// 一份互不影响的默认科目清单
export function cloneDefaultSubjects() {
  return normalizeSubjects(DEFAULT_SUBJECTS)
}

// 会话内递增的 uid：给视图模型当身份标识用。
// 它只在这次会话里有效，不落盘，刷新页面重新编号
let uidSeq = 0
export const nextSubjectUid = () => `subject-${++uidSeq}`

// 存档形状 → 视图模型：补默认字段、补 uid。
// uid 只在本次会话内用于拖拽身份（v-for 的 key、卡片上的 data-uid），不进存档；
// 名字在这里去空白并补占位名，免得一份空科目名存档以后每次存都写空
export function toViewSubjects(list) {
  return list.map((subject) => ({
    name: String(subject?.name ?? '').trim() || '未命名',
    extraSubjects: [...(subject?.extraSubjects || [])],
    uid: nextSubjectUid(),
  }))
}

// 视图模型 → 存档形状：顺序就是数组下标，存盘时按位置重算 order，
// 少一个会和人手改的 order 打架的字段；uid 是内存里的东西，不能进存档
export function toStoredSubjects(list) {
  return list.map((subject, index) => ({
    name: subject.name,
    order: index,
    extraSubjects: [...(subject?.extraSubjects || [])],
  }))
}
