// 编号行：编号怎么存在正文里、正文怎么拆成「编号」和「正文」两份。
//
// 存储口径：编号写在这一行最前面，形如「1. 订正」——数字、句点、一个空格。
// 那个空格是硬条件，省不得：省了之后「1.5米」这种开头的行就分不清是
// 编号行（编号 1、正文「5米」）还是一整行普通文字，两种存法解出来的东西不一样。
//
// 只有正文这一个坐标系：编辑器（CM）的 doc 就是正文，编号和 # 都真在 doc 里，
// 只是用 Decoration 藏起来、画到左边的编号栏上。所以这里拆出来的 bodies /
// bodyStarts 是「同一份正文的另一种切法」，供算行首前缀长度用（见 prefixAt），
// 不是另一套坐标：位置一律直接用正文里的偏移，不要再拿它和正文里的偏移互相换算。

import { isBodyLine, isHeadingLine, lineIndexAt } from './homeworkText'

// 存储口径的行首编号。只吃「数字 + 句点」这一截（空格用前瞻，不吃进来），
// 句点后面必须紧跟一个空格或者就是行尾，否则「1.5米」这种会被当成编号行。
// 编辑框（HomeworkEditor）判断行首编号也复用这一份，别在那边再写一遍
export const STORED_NUMBER = /^(\d+)\.(?=[ 　]|$)/

// 一行开头那个编号有多少个字符（含后面紧跟的那个空格），编号是几。
// 不是编号行返回 { number: 0, prefix: 0 }。正文以空格开头也得原样留着（只摘一个），
// 不然这一行就还原不回去了。展示板渲染悬挂对齐时也拿这个（编辑框那边编号
// 在左边的编号栏上，不走这儿）
export function storedNumber(line) {
  const found = STORED_NUMBER.exec(line)
  if (!found) return { number: 0, prefix: 0 }
  const space = /^[ 　]/.test(line.slice(found[0].length)) ? 1 : 0
  return { number: Number(found[1]), prefix: found[0].length + space }
}

// 标题行行首那截记号：# 加空白。它是「这一行是小标题」的标记，正文里带着它，
// 界面上用 Decoration 藏起来、只在那格的编号栏上摆一个 #（见 HomeworkEditor）。
// 存档里也带着它（判标题、归属、预定都靠它）。
// 这个正则从 homeworkReserve 借过来，两边各写一份早晚会切出两条不一样的线：
// 一边认为「#」后头跟着的是标题名、另一边认为是别的东西，归属和编号就错开了
import { HEADING_PREFIX } from './homeworkReserve'

// 摘掉行首那截记号，得到界面上看得见的那一行
function stripHeadingMark(text) {
  return text.replace(HEADING_PREFIX, '')
}

// 正文拆成每行的编号和每行的正文，外加两套行首偏移：
// starts 是正文里的行首（带 #、带编号），bodyStarts 是「摘掉 # 和编号」那份的行首，
// 两套差着前面那些记号的长度。
// texts 和 bodies 是同一份正文的两种写法：texts 带记号（存档、判标题、重拼都用它），
// bodies 是界面上看得见的那一行。两个坐标系是同一套坐标的两种切法，
// 一趟拆完，别处各拆一遍——同一个含义有了两套算法，改一处漏一处
export function splitContent(content) {
  const lines = String(content ?? '').split('\n')
  const numbers = []
  const texts = []
  const bodies = []
  const starts = []
  const bodyStarts = []
  let at = 0
  let bodyAt = 0
  for (const line of lines) {
    const { number, prefix } = storedNumber(line)
    const text = prefix ? line.slice(prefix) : line
    const body = stripHeadingMark(text)
    numbers.push(number)
    texts.push(text)
    bodies.push(body)
    starts.push(at)
    bodyStarts.push(bodyAt)
    at += line.length + 1
    bodyAt += body.length + 1
  }
  return { lines, numbers, texts, bodies, starts, bodyStarts }
}

// 正文拼回去：编号行拼成「N. 正文」，没编号的行原样。
// 正文为空也留一个「N.」（不补那个空格），不然读回来就不认得了。
export function joinContent(texts, numbers) {
  return texts
    .map((text, index) => {
      const n = numbers[index]
      if (!n) return text
      return text ? `${n}. ${text}` : `${n}.`
    })
    .join('\n')
}

// 一行开头的记号（编号 / #）有多长。正文那一行比摘掉记号那份长出来的就是它。
// 位置换算要把它让出来：光标停在正文第一个字上时，偏移里得算上它，否则会往右偏那么多格
function prefixAt(map, index) {
  return map.lines[index].length - map.bodies[index].length
}

// 第 index 行归在第几节：一串连续的正文行，空行和标题行都断节。
// 返回 [起, 止)，止是开区间
function sectionBounds(texts, index) {
  let begin = index
  while (begin > 0 && isBodyLine(texts[begin - 1])) begin--
  let end = index + 1
  while (end < texts.length && isBodyLine(texts[end])) end++
  return [begin, end]
}

// 那一节里 index 之前最后一个编号是多少，没有就是 0
function numberBefore(texts, numbers, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (!isBodyLine(texts[i])) return 0
    if (numbers[i] > 0) return numbers[i]
  }
  return 0
}

// 第 index 行按规则该编几号：同一节里前一个编号 + 1，它自己就是第一个就是 1
export function nextNumber(texts, numbers, index) {
  return numberBefore(texts, numbers, index) + 1
}

// 空行上的虚拟序号：这一行写上字的话会编几号。
// 这一行自己已经挂着号（刚敲完 `3.` 或刚回车出来）就用它自己的——
// 那是用户明说的「这条是第三条」，拿自动算出来的号盖掉他的就是不听他的。
// 没挂号才现算：同一节里上一个有编号的行 + 1
export function ghostNumber(texts, numbers, index) {
  if (numbers[index] > 0) return numbers[index]
  return nextNumber(texts, numbers, index)
}

// 空行刚敲上字时的补号：每一行都默认该有编号，敲上字就把它接上。
//   0   → 还没编号、等着补：补一个，接同一段里上一个有编号的行往下编
//   正数 → 已经有号了（敲的 `3.`，或者回车时挂上的），一个字不动
// 只认「刚变有字」这一下：已经有字的行被继续编辑，编号不因为「动了它」而变。
// 早先这里是每次输入都补，用户主动去掉的号一进去编辑又冒出来。
// 「这一行不要号」由编辑器的 refusedField 记着（那个状态不进正文），所以这里没有 -1 这一档
export function commitBlank(texts, numbers, index) {
  if (index < 0 || index >= texts.length) return
  if (!isBodyLine(texts[index]) || numbers[index] !== 0) return
  numbers[index] = nextNumber(texts, numbers, index)
}

// 按段落重排编号，就地改 numbers。规则只有一条：同一段里从上到下，
// 有编号的行依次编 1. 2. 3. …，中间没编号的行（说明文字、备注）不占号、
// 也不打断连号，空行和标题行断段。
//
// 空行不参与排号：它还没有成为一条作业。空行上那个「写上字就是第几号」
// 是编号栏上的虚拟提示（见 ghostNumber），不进正文
// 标题行的号清掉：小标题不是一条作业，挂着号既没意义又会在板上多出一行
//
// 用户手写的号一律归一化，不留跳号：敲 `3.` 排在 `2.` 后面就给他 3，
// 排在 `1.` 后面就给他 2。这不是不尊重用户——用户要的是「这一段从 1 开始
// 连续排下去」，手写的号只是他对顺序的猜测，猜错了就该被纠正
function renumberRange(texts, numbers, begin, end) {
  let prev = 0
  for (let i = begin; i < end; i++) {
    // 标题行不是一条作业：号清掉
    if (isHeadingLine(texts[i])) {
      numbers[i] = 0
      continue
    }
    // 空行还没成为一条作业，不参与排号
    if (!isBodyLine(texts[i])) continue
    // 这一行本来就没编号：不占号，也不打断连号（下一行照样接着往下数）
    if (numbers[i] <= 0) continue
    numbers[i] = prev + 1
    prev = numbers[i]
  }
}

// 敲完一下之后的编号收尾：整篇重排一遍，就地改 numbers（编号不进 texts，光标不用动）。
// 排的是整篇而不是光标那一节——插空行把一段劈成两段时，下一段也得从 1 重新数起；
// 删空行把两段并成一段时，整段接着往下数。只盯光标那一段，另一边的编号就永远停在旧值上。
//
// 这里不凭空新增编号：空行刚敲上字要补号归 commitBlank 管（它看的是「这一行刚才还是空的」）。
// 空行和标题行在这趟里原样跳过、不动它们的号：那上面可能挂着用户刚敲的号（见 renumberRange）。
// 要写盘、上板之前走 renumberContent，那儿会再清一遍
export function renumberAll(texts, numbers) {
  let index = 0
  while (index < texts.length) {
    if (!isBodyLine(texts[index])) {
      index++
      continue
    }
    const [begin, end] = sectionBounds(texts, index)
    renumberRange(texts, numbers, begin, end)
    index = end
  }
}

// 复制/剪切出去的正文里，一行只有一个光杆编号（「2.」／「2. 」）时把这一截去掉，只留空行。
//
// 为什么：这样的空行屏幕上什么都不显示，编号栏上摆的是「写上字就是第几号」的
// 虚拟序号（见 ghostNumber），它只活在界面上、并不在正文里。用户粘出去的东西
// 带着它，粘到记事本里就是一串莫名其妙的「2.」。正文一行（真有条作业）照旧带号。
export function stripBareNumbers(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => (/^[ \t]*\d+\.[ 　]?$/.test(line) ? '' : line))
    .join('\n')
}

// 位置和「第几行第几个字」之间来回换。
// 行搬动、重编号之后只有后者还准：绝对偏移会随着前面几行的编号变长变短整体漂移，
// 光标按偏移放回去就会落到别的字上
export function lineColumn(map, pos) {
  const index = lineIndexAt(map.starts, pos)
  return { line: index, column: pos - map.starts[index] - prefixAt(map, index) }
}

// 「第 index 行第 column 个字」在正文里的位置。行号越界就夹到最后一行的末尾
export function positionAt(map, index, column) {
  const at = Math.min(Math.max(index, 0), map.texts.length - 1)
  return map.starts[at] + prefixAt(map, at) + Math.min(column, map.bodies[at].length)
}

// 整篇重排编号，就地返回新正文。这是「写盘、上板之前」的那一道：
//   按节重排（每节从上到下连号）
//   空行、标题行挂着的号清掉——它们占着号却不是一条作业，
//   留着的话存档里会多出「3.」这种只有号没有字的行，卡片上也摆一条出来
// 行搬动之后（预定搬到另一天、并进小节、删掉一整节）节的范围变了，
// 搬进去的是别人的行，编号得跟着目的地那一节重排，不然目标日里会并着两个 1.
export function renumberContent(content) {
  const map = splitContent(content)
  renumberAll(map.texts, map.numbers)
  for (let i = 0; i < map.numbers.length; i++) {
    if (!isBodyLine(map.texts[i])) map.numbers[i] = 0
  }
  return joinContent(map.texts, map.numbers)
}