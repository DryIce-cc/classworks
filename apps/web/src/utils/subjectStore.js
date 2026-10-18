// 科目配置的读写：存档键、规整、默认清单的兜底都集中在这里，
// 首页和设置页不必各自再拼一遍「读 → 判失败 → 用默认」。
import dataProvider from './dataProvider.js'
import { SUBJECT_CONFIG_KEY } from './storageKeys.js'
import { cloneDefaultSubjects, normalizeSubjects, toStoredSubjects } from './subjects.js'

// 读配置，并附带一个状态，让设置页能给出和以前一样的提示：
//   ok       存档就是一份清单
//   missing  还没存过（首次进入）
//   invalid  存了，但不是清单（写坏了或旧版本残留）
//   error    读失败
// 任何读不到的情况都回默认清单，不抛错
export async function readSubjects() {
  const response = await dataProvider.loadData(SUBJECT_CONFIG_KEY)
  if (!response.ok) {
    return {
      subjects: cloneDefaultSubjects(),
      status: response.error?.code === 'NOT_FOUND' ? 'missing' : 'error',
    }
  }
  if (!Array.isArray(response.data)) {
    return { subjects: cloneDefaultSubjects(), status: 'invalid', raw: response.data }
  }
  // 规整顺带补齐附加属性，旧存档里的科目也能用上多份作业和附加科目
  return { subjects: normalizeSubjects(response.data), status: 'ok' }
}

// 只要清单本身：没存过、读失败都回默认清单（首页首次启动走这条）。
// 传了 fallback 就改回 fallback——首页翻日期会反复调用，读失败不该把已经读到的
// 配置重置成默认清单（和原先「读失败就不赋值」的行为一致）
export async function loadSubjects(fallback) {
  const { subjects, status } = await readSubjects()
  if (status === 'ok') return subjects
  return fallback ?? subjects
}

// 规整后落盘，返回 dataProvider 的信封
export async function saveSubjects(subjects) {
  return dataProvider.saveData(SUBJECT_CONFIG_KEY, toStoredSubjects(normalizeSubjects(subjects)))
}
