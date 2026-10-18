// 编号行：编号怎么存在正文里、输入框里怎么拆、以及两个坐标系之间怎么换算。
//
// 存储口径：编号写在这一行最前面，形如「1. 订正」——数字、句点、一个空格。
// 那个空格是硬条件，省不得：省了之后「1.5米」这种开头的行就分不清是
// 编号行（编号 1、正文「5米」）还是一整行普通文字，两种存法解出来的东西不一样。
//
// 编辑框里正文不含编号：编号画在左边的编号栏上，悬挂对齐靠的就是它
// （见 HomeworkEditDialog 的编号栏）。所以输入框拿到的值是摘掉编号的那一份，
// 两者靠 splitContent 分开，光标位置靠 contentToBody / bodyToContent 来回换算。
// 这么分是因为输入框的值必须和用户看得见、点得着的内容一致，撤销栈、
// 选区、输入法全都指着那个 DOM 节点，编号一旦留在里面就对不上了。

import { isBodyLine, isHeadingLine, lineIndexAt } from './homeworkText'

// 存储口径的行首编号。只吃「数字 + 句点」这一截（空格用前瞻，不吃进来），
// 句点后面必须紧跟一个空格或者就是行尾，否则「1.5米」这种会被当成编号行
const STORED = /^(\d+)\.(?=[ 　]|$)/

// 输入感知的口径比存储宽：句点后面只要不是数字就算。
// 用户拿中文输入法敲完「1.」直接接着打字，中间不会有一个空格，
// 按存储口径卡在这里永远认不出来——面板、页码一类的正文里这种写法很多
const TYPED = /^(\d+)\.(?!\d)/

// 一行开头那个编号有多少个字符（含后面紧跟的那个空格），编号是几。
// 不是编号行返回 { number: 0, prefix: 0 }。正文以空格开头也得原样留着（只摘一个），
// 不然这一行就还原不回去了。展示板渲染悬挂对齐时也拿这个（编辑框那边编号
// 在左边的编号栏上，不走这儿）
export function storedNumber(line) {
  const found = STORED.exec(line)
  if (!found) return { number: 0, prefix: 0 }
  const space = /^[ 　]/.test(line.slice(found[0].length)) ? 1 : 0
  return { number: Number(found[1]), prefix: found[0].length + space }
}

// 这一行开头会被摘掉几个字：敲出来的那个编号（连带紧跟的同一个空格），
// 或者本来就有编号的行、用户又接着敲的那一个空格。
// mergeBody 和算光标落点的地方都走它，两边不会各算一套而对不上
export function stripLength(row, known) {
  const found = TYPED.exec(row)
  if (found) {
    const rest = row.slice(found[0].length)
    return found[0].length + (/^[ 　]/.test(rest) ? 1 : 0)
  }
  return known > 0 && /^[ 　]/.test(row) ? 1 : 0
}

// 摘掉行首敲出来的那个编号，连同紧跟的一个空格（只摘一个）。
// 给 mergeBody 用：用户敲的那一截还没进正文，得先把行还原成能拼回去的样子
export function stripTyped(line) {
  return line.slice(stripLength(line, 0))
}

// 输入框里敲出来的行首编号（`1. 订正` 返回 1，`1.5米` 返回 null——那个是正文）
export function typedNumber(line) {
  const found = TYPED.exec(line)
  return found ? Number(found[1]) : null
}

// 标题行行首那截记号：# 加颜色代码加空白。它是「这一行是小标题」的标记，
// 只活在左边编号栏那一格上，输入框里不摆——所以输入框那份正文要把它摘掉。
// 存档里仍然带着它（判标题、归属、预定都靠它）。
// 这个正则从 homeworkReserve 借过来，两边各写一份早晚会切出两条不一样的线：
// 一边认为「#」后头跟着的是标题名、另一边认为是颜色代码，编号和光标就错开了
import { HEADING_PREFIX } from './homeworkReserve'

// 摘掉行首那截记号，返回输入框该摆的那一份
function stripHeadingMark(text) {
  return text.replace(HEADING_PREFIX, '')
}

// 正文拆成每行的编号和每行的正文，外加两套行首偏移：
// starts 是正文里的行首（带 #、带编号），bodyStarts 是输入框那份的行首
// （# 和编号都摘了），两套差着前面那些记号的长度。
// texts 和 bodies 是同一份正文的两种写法：texts 给存档和判断用，bodies 给输入框用。
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
// numbers 里可能有 -1（这行被用户明说「不要号」，见 toggleLineNumber），
// 那也是没编号，别拼成「-1. 正文」
export function joinContent(texts, numbers) {
  return texts
    .map((text, index) => {
      const n = numbers[index]
      if (!n || n < 0) return text
      return text ? `${n}. ${text}` : `${n}.`
    })
    .join('\n')
}

// 输入框里的位置落在第几行。两个坐标系行数相等（编号不进正文），行号是共用的，
// 只有字符位置要换算
export function bodyLineIndex(map, pos) {
  return lineIndexAt(map.bodyStarts, pos)
}

// 一行开头的编号有多长。正文那一行比输入框那份（# 和编号都摘了）长出来的就是它。
// 记号那一截（编号、#）都算在里面——它们在输入框里都不占地方，
// 可位置换算必须把它们让出来，否则光标会往右偏那么多格
function prefixAt(map, index) {
  return map.lines[index].length - map.bodies[index].length
}

// 正文位置 → 输入框位置。落在编号那一截里的位置（正常不会落在那儿，保险起见）
// 一律夹回行首，别让光标落到编号中间去
export function contentToBody(map, pos) {
  const index = lineIndexAt(map.starts, pos)
  const prefix = prefixAt(map, index)
  const offset = Math.min(Math.max(pos - map.starts[index] - prefix, 0), map.bodies[index].length)
  return map.bodyStarts[index] + offset
}

// 输入框位置 → 正文位置。行尾之后是编号那一截，落进去就是错的，
// 所以越过了行末就夹在行末（行末在正文里紧挨着编号的后面）
export function bodyToContent(map, pos) {
  const index = lineIndexAt(map.bodyStarts, pos)
  return map.starts[index] + Math.min(pos - map.bodyStarts[index], map.bodies[index].length) + prefixAt(map, index)
}

// 改动之后输入框里的光标该在哪儿：光标前面那一行在光标前面变了几个字，就往左挪几个。
// cut 是 mergeBody 从这一行开头摘掉的那一截（敲出来的「1.」连同一个空格）。
// 那些字都排在光标前面，不跟着挪的话，光标会从编号后面滑到正文第一个字后面一格——
// 「在行首敲 1.」之后光标莫名往后跳一格就是这个
// 只看光标自己那一行：别的行变了（插进来一行、并掉一行）不影响这一行的落点
export function caretAfterChange(before, after, pos, cut = 0) {
  const line = lineIndexAt(before.bodyStarts, pos)
  const at = Math.min(Math.max(line, 0), after.texts.length - 1)
  const width = after.bodies[at].length
  const column = Math.min(Math.max(pos - before.bodyStarts[line] - cut, 0), width)
  return after.bodyStarts[at] + column
}

// 输入框里的改动并进正文：行首敲出来的编号收成编号，其余的行沿用原来那行的编号。
// 输入框里看不见编号，所以两边的行号是共用的。改动就发生在光标那一行：
//   它前面那些行一个字没动，按行号对得上
//   它后面那些行整体挪了「行数差」行，也按行号对得上
//   动的那几行（插进来的、或者被并走的）没有对应的老行，编号留空
// 直接按行号硬取会把后面几行的编号整体错开一行，所以这段要单独空出来。
// detect 为 false 时只对行，不认新敲出来的编号——中文输入法组字期间用这个，
// 那时候正文是输入法自己拼的半成品，动它会把组字打断
export function mergeBody(body, content, anchor, detect = true) {
  const map = splitContent(content)
  const rows = String(body ?? '').split('\n')
  const shift = rows.length - map.texts.length
  // 行数没变时前后一一对应，anchor 给不给都对；给不出就当动的是最后一行之后，
  // 也就是老老实实按行号取
  const at = Number.isInteger(anchor) ? Math.min(Math.max(anchor, 0), rows.length) : rows.length
  const texts = []
  const numbers = []
  for (let index = 0; index < rows.length; index++) {
    const typed = detect ? typedNumber(rows[index]) : null
    let from = index
    if (index >= at) {
      if (shift > 0 && index < at + shift) from = -1 // 这次插进来的行
      else if (shift < 0 && index === at) from = at // 被并成一行的那一行，沿用前头的编号
      else from = index - shift
    }
    const known = from >= 0 && from < map.numbers.length ? map.numbers[from] : 0
    // 敲出来的编号由 stripTyped 摘（连同一个空格）；本来就有编号的行，
    // 用户紧接着敲的那个空格同样摘掉——编号已经在左边占了一条栏，
    // 正文行首再空一格就是两格。两种都只摘一个，正文自己以空格开头也留得住
    let text
    if (typed !== null) text = stripTyped(rows[index])
    else if (known > 0) text = rows[index].replace(/^[ 　]/, '')
    else text = rows[index]
    // 输入框里没有 #，并回正文时按对应那一行原来的样子补上：
    // 它是「这一行是小标题」的标记，存档和归属判断全靠它，缺了就散架
    if (from >= 0 && from < map.texts.length) {
      const head = HEADING_PREFIX.exec(map.texts[from])
      if (head) text = head[0] + text
    }
    texts.push(text)
    // 用户敲出来的号优先于「沿用原来那行」——他明写了是第几条，就该听他的。
    // 之前是「有号就沿用」，把敲出来那个号吃掉了：于是敲完 1. 再敲「订正」，
    // 那一行显示成没有编号，号得再点一下才回来。这就是那个「点一下先变成正确的」
    numbers.push(typed !== null ? typed : known)
  }
  return joinContent(texts, numbers)
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
export function numberBefore(texts, numbers, index) {
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

// 敲完一下之后的编号收尾。只做一件事：把整篇按「每一段落从上到下连号」
// 重排一遍——用户改了一行（清空、改字、删行、插空行分段），编号就该跟着动。
//
// 排的是整篇而不是光标那一节：插一个空行把一段劈成两段时，光标在上一段，
// 但下一段也得从 1 重新数起；删个空行把两段并成一段时，整段接着往下数。
// 只盯着光标那一段，另一边的编号就永远停在旧值上。
//
// 这里不凭空新增编号。正文空着的行归 commitBlank 那一下管——它看的是
// 「这一行刚才还是空的」，有据可依；不是每敲一个字都去猜哪些行该有号
export function settleEdit(texts, numbers) {
  renumberAll(texts, numbers)
}

// 空行刚敲上字时的补号：每一行都默认该有编号，敲上字就把它接上。
//   0  → 还没编号、等着补：补一个，接同一段里上一个有编号的行往下编
//   -1 → 用户点过按钮 / 按过空格 / 按过删除键，明说了这一行不要号，不给
//   正数 → 已经有号了（敲的 `3.`，或者回车时挂上的），一个字不动
// 只认「刚变有字」这一下：已经有字的行被继续编辑，编号不因为「动了它」而变。
// 早先这里是每次输入都补，用户主动去掉的号一进去编辑又冒出来
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

// 只重排第 index 行所在的那一节
export function renumberSection(texts, numbers, index) {
  if (index < 0 || index >= texts.length) return
  const [begin, end] = sectionBounds(texts, index)
  renumberRange(texts, numbers, begin, end)
}

// 整篇重排编号，就地改 texts 之外的两个数组。
// 空行和标题行原样跳过、不动它们的号：那上面可能挂着用户刚敲的号（见 renumberRange）。
// 要写盘、上板之前，走 renumberContent，那儿会再清一遍
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