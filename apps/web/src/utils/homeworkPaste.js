// 粘贴的预处理：剪贴板里那一段文字，先整理成正文该有的样子再进编辑器。
//
// 群里／文档里复制出来的作业多半不是一行一条。常见的三种样子：
//   周末作业：1.小蓝第40篇讲解听完；2.摘抄一面，随笔一篇；3.带上选择性必修上册的书
//   作业
//   1.月考试题考点总结；2.文言文小蓝40篇做完。
// 原样粘进来就是两大坨：标题和条目挤在同一行里，编辑器既认不出哪一行是标题
// （没有 #，就只是一行正文），也没法把挤在一起的条目分开。
//
// 这里只做三件事，每一件都以「用户在正文里本来会这么写」为准：
//   1. 像标题的行补上 #，冒号后面的内容另起一行
//   2. 一行里挤着的多个条目拆成一行一条
//   3. 收拾复制带出来的脏东西：CRLF、行首行尾的空格、编号后面的多余空格
//
// 编号一个都不补。原文没有号的行为什么是没有号的——排在作业后面的「要求：」
// 「①认真研读…」「颜色一：…」是说明、是备注，不是作业，补上号就成了第七条作业。
// 空行刚变成有字时编辑器自己补的那个号照旧（见 HomeworkEditor 的 anchor），
// 那是敲字时的全局规矩，粘贴不另立一套。

import { isHeadingLine } from './homeworkText'

// 标题词：冒号后面还接着内容时，短句里有它才算标题。
// 收得窄是有意的——「作业更新：1. 小白…」是标题，「要求：」「颜色一：」「附：」
// 「作业二：」只是正文里的一个引子。放开成「冒号前面够短就行」的话，它们全都会变成小标题
const TITLE_WORDS = /作业|注意|通知/

// 冒号前面那一截最多这么长。再长就是一整句话，不是标题。
// 中英文冒号都收（见 TITLE_HEAD）：复制出来的东西两种都有，
// 「10.15语文作业:」和「作业更新：」是同一个写法
const HEAD_LIMIT = 20

// 没有冒号的标题（`作业`、`国庆历史作业（合格）`）最多这么长。
// 定得比 HEAD_LIMIT 紧：没有冒号就没有断点，整行都得是标题才对，
// `完成《合格班作业3》（1张，共1页）。` 那一类也得挡得住
const BARE_TITLE = 12

// 两条之间的连接符：只连接两条东西、拆开就该丢掉的那些（空格、分号）。
// 括号、句末标点不在名单里——它们是上一条自己的收尾，
// 「2.古诗词练习卷完成。（课代表课间来办公室取）3.…」里的「）」得跟着第二条走
const TRAILING_SEPARATOR = /[\s；;]+$/

const isDigit = (ch) => ch >= '0' && ch <= '9'

// 「短句 + 冒号 + 剩下的正文」。上限写在正则里，所以正则得拼出来：
// 正则字面量不插值，{1,HEAD_LIMIT} 会被当成要照着比的字面那几个字，
// 这条正则从此一条都匹配不上——而外面看着一切正常，只是所有标题都没被认出来
const TITLE_HEAD = new RegExp(`^([^：:]{1,${HEAD_LIMIT}})([：:])([\\s\\S]*)$`)

// 从第 i 个字开始是不是一个序号（「1.」「12.」），是的话它占几个字，不是就 0。
// 点后面还是数字就不算——「1.5米」是一整行正文，前面那个号跑进正文里了。
// 口径和 homeworkList 的 STORED / TYPED 一样，别处认成序号这里也得认
function markerWidth(line, i) {
  if (!isDigit(line[i])) return 0
  const digits = isDigit(line[i + 1]) ? 2 : 1
  if (line[i + digits] !== '.') return 0
  if (isDigit(line[i + digits + 1])) return 0
  return digits + 1
}

// 一行里所有序号的起点。前面那个字是数字或者小数点就跳过：
// 「背诵：2026.10. 素养测评词组」里的 26. 和 10. 都不是条目起点
function markers(line) {
  const at = []
  for (let i = 0; i < line.length; i++) {
    if (i > 0 && /[\d.]/.test(line[i - 1])) continue
    if (markerWidth(line, i)) at.push(i)
  }
  return at
}

// 一行里的条目拆成一行一条。只有一个序号（或者压根没有）就原样返回：
// 那是「1. 就一条」，拆了也没有别的可拆
function splitItems(line) {
  const at = markers(line)
  if (at.length < 2) return [line.trim()]
  const rows = []
  let from = 0
  for (let i = 1; i < at.length; i++) {
    rows.push(line.slice(from, at[i]).replace(TRAILING_SEPARATOR, '').trim())
    from = at[i]
  }
  rows.push(line.slice(from).trim())
  return rows
}

// 这一行是不是标题。是的话返回 { title, rest }：title 是标题本身（含那个冒号），
// rest 是冒号后面那一串正文。已经有 # 的、行首就是序号的、或者压根不像标题的，
// 一律返回 null——那说明它是一行普通的正文
function splitTitle(line, prev) {
  if (isHeadingLine(line)) return null
  // 行首就是序号的行不会是标题。「10.15语文作业：」不算，它后面跟的是数字，
  // 那个 10. 压根不是序号（markerWidth 认得出这一条）
  if (markerWidth(line, 0)) return null
  // 标题自己得占一段：上面是空行、或者上面也是标题。少了这条，
  // 夹在条目中间的行也会被当成标题（「作业二：练习部分P54-55」就是这种）
  if (prev && !isHeadingLine(prev)) return null
  const colon = TITLE_HEAD.exec(line)
  if (colon) {
    // 冒号后面什么都没有，这一行整个就是标题（「文本文本文本文本文本：」
    // 「10月月考考试说明：」「作业:」，中英文冒号都算，见 TITLE_HEAD）。
    // 这时标题词认不认得它都在那儿摆着，一眼就是标题，不必再拿词表去猜。
    // 冒号后面还有内容就只是「一行的开头」了，得靠标题词认——
    // 不然正文里随口一句「翻译：明天那一本」也会被拽成小标题
    if (colon[3].trim() !== '' && !TITLE_WORDS.test(colon[1])) return null
    return { title: colon[1] + colon[2], rest: colon[3] }
  }
  // 没有冒号：整行都得短、带标题词，而且不像一整句话
  if (line.length > BARE_TITLE || !TITLE_WORDS.test(line)) return null
  if (/[。！？]$/.test(line)) return null
  return { title: line, rest: '' }
}

// 剪贴板里那一段文字 → 可以直接进正文的形态。空串原样返回（粘贴那边自己当没粘）
export function smartPaste(text) {
  const rows = String(text ?? '')
    // 复制出来的东西多半是 CRLF，粘进来会在正文里留下一串看不见的 \r
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // 两头的空格是复制时带出来的缩进。整行都是空格的话它就成了一行空行，
    // 而正文里的空行是「断节」的意思，不能白留着
    .map((row) => row.replace(/^[ \t　]+|[ \t　]+$/g, ''))
  // 首尾的空行不留：正文末尾本来就空着一行够接着写
  while (rows.length && !rows[0]) rows.shift()
  while (rows.length && !rows[rows.length - 1]) rows.pop()
  const out = []
  for (const row of rows) {
    if (!row) {
      out.push('')
      continue
    }
    // 拿已经摆出去的上一行判「上面是不是空的」，而不是原文的上一行：
    // 标题刚从一行里分出来的时候，下一行确实另起了一段
    const title = splitTitle(row, out[out.length - 1] || '')
    const parts = title ? ['#' + title.title, ...splitItems(title.rest)] : splitItems(row)
    for (const part of parts) if (part) out.push(part)
  }
  // 编号后面的空格统一成一个。复制来的「1.  小白」有两个空格，
  // 存储口径只摘掉一个（见 homeworkList.storedNumber），正文里就白白留了一格前导空格
  return out.map((row) => row.replace(/^(\d+\.)[ \t　]+/, '$1 ')).join('\n')
}
