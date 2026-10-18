// 改日期操作：单行摘出、多选改日期、并入已有小节。
// 都是正文变换（进正文、出新正文），不碰面板和存盘
// （原 homeworkPhrases.js 拆分出来，函数体原样搬运）

import {
  headingAbove,
  headingAboveStart,
  isBodyLine,
  isHeadingLine,
  lineIndexAt,
  lineStarts,
  ownerAt,
  sectionEnd,
  splitLines,
  tidyBlankLines,
} from './homeworkText'
import {
  parseReserveLine,
  resolveReserveDay,
  retargetDayHeading,
  scopeTitle,
} from './homeworkReserve'

// 落在 [start, end) 这个范围里的那些 # 行，起始位置各是多少。
// 只认整行都在范围里的 # 行——正文行不管，它自己不变，
// 它上面那个标题哪怕不在选区里也不动（用户只选了正文，就别去改标题）
export function selectionHeadings(content, start, end) {
  const { lines, starts } = splitLines(content)
  const found = []
  for (let index = 0; index < lines.length; index++) {
    if (isHeadingLine(lines[index]) && starts[index] >= start && starts[index] + lines[index].length <= end) {
      found.push(starts[index])
    }
  }
  return found
}

// 选区里每一行实际归哪天（去重）：有日期按日期，没日期的就是正在编辑的那天；
// 空行跳过不算。返回日期数组，顺序按正文先后
export function selectionDays(content, start, end, today, currentDate) {
  const { lines, starts } = splitLines(content)
  const days = []
  const add = (date) => {
    if (date && !days.includes(date)) days.push(date)
  }
  const dayOf = (from) => {
    const nl = content.indexOf('\n', from)
    const parsed = parseReserveLine(content.slice(from, nl < 0 ? content.length : nl))
    add(resolveReserveDay(parsed?.word, today) || currentDate)
  }

  for (const at of selectionHeadings(content, start, end)) dayOf(at)
  // 正文行各自归着哪个标题，从选区第一行往上问一次就够，然后在选区里顺着往下带，
  // 不用每行都回头重找一遍
  const first = lineIndexAt(starts, start)
  const last = lineIndexAt(starts, end - 1)
  let owner = headingAboveStart(content, starts[first])
  for (let index = first; index <= last; index++) {
    // 标题行自己不当正文算，它只成为下面那些行的归属
    if (isHeadingLine(lines[index])) {
      owner = starts[index]
      continue
    }
    // 空行跳过不算，只断开它下面那些行的归属
    if (lines[index].trim() === '') {
      owner = -1
      continue
    }
    // 光秃秃的正文（上面没有小标题管着）就是正在编辑那天的内容，
    // 管着它的标题没日期也一样，都算正在编辑的那天，不是「没有日期」
    if (owner < 0) {
      add(currentDate)
      continue
    }
    const nl = content.indexOf('\n', owner)
    const parsed = parseReserveLine(content.slice(owner, nl < 0 ? content.length : nl))
    add(resolveReserveDay(parsed?.word, today) || currentDate)
  }
  return days
}

// 选区那些行归的是不是同一天，是同一天就返回那天，不是就返回空串。
// 「选中 #明天的作业 下面的 e、r」虽然一个 # 行都没选中，该亮的仍是明天；
// 「1/#明天/2」这种全选混着没日期的行和明天，算两天，返回空串（上层一个都不点亮）
export function commonDayInSelection(content, start, end, today, currentDate) {
  const days = selectionDays(content, start, end, today, currentDate)
  return days.length === 1 ? days[0] : ''
}

// 选区里是不是混着多天。是就一个日期按钮都不点亮
export function hasMixedDaysInSelection(content, start, end, today, currentDate) {
  return selectionDays(content, start, end, today, currentDate).length > 1
}

// 单行操作 # 行之后：下一行是文末或 # 行，就在它下面空出一行；
// 下面是正文或已经空着就不动。
// content 是还没换的那份，lineStart 是那一行的行首，next 是换上去的新标题行。
// 返回新正文（光标调用方自己放，不在这里定）
export function blankAfterHeading(content, lineStart, next) {
  const { lines, starts } = splitLines(content)
  const index = lineIndexAt(starts, lineStart)
  const start = starts[index]
  const before = content.slice(0, start)
  const after = content.slice(start + lines[index].length)
  if (after === '') return before + next + '\n'
  const firstBelow = after.slice(1).split('\n', 1)[0]
  if (isHeadingLine(firstBelow)) return before + next + '\n' + after
  return before + next + after
}

// 单行点「正在编辑的那天」、但那天没有可并的现成小节时的兜底。
// 和 insertReservation（点别的日子）同一套动作：摘出这一行，c、d 上移补位，
// 尾巴保持原来的归属；区别只在新标题不挂日期——有名字配去日期的同名标题
// （#明天的通知 → #通知），没名字（#明天的作业这类）就光秃秃留一行，
// 当天的内容本来就不需要标题。
// detach 那种「只在上下补空行」的做法在这里不能用：它把尾巴也一起隔断归属，
// c、d 明明是明天的，点完就成今天的了。
// 返回新正文和摘走那一行的新位置（放光标用）；光标在标题行上、
// 或者上面没有小标题时返回 null，调用方按原样不动
export function stripLineToEnd(content, lineStart) {
  const { lines, starts } = splitLines(content)
  const index = lineIndexAt(starts, lineStart)
  if (!isBodyLine(lines[index])) return null
  const ownerStart = headingAboveStart(content, starts[index])
  if (ownerStart < 0) return null
  const owner = lines[lineIndexAt(starts, ownerStart)]
  const parsed = parseReserveLine(owner)
  if (!parsed) return null
  // 摘掉这一行，连带一个换行（insertReservation 同款切法，不然原地留空行）
  const cutStart = starts[index]
  const cutEnd = cutStart + lines[index].length
  const line = lines[index]
  let end = cutEnd
  let start = cutStart
  if (content[end] === '\n') end += 1
  else if (start > 0 && content[start - 1] === '\n') start -= 1
  let rest = pruneDayHeading(content.slice(0, start) + content.slice(end), start)
  rest = tidyBlankLines(rest)
  // 新标题：有名字去日期，没名字不要标题
  const heading = parsed.heading ? `#${parsed.heading}` : ''
  const body = rest.replace(/\n+$/, '')
  const head = body.trim() ? body + '\n\n' : ''
  // tidy 到这里只是在末尾补一个换行（前面已经没有连续空行也没有开头空行），
  // 摘走那一行的行首按拼好的位置算就行。不能拿 text.length 当光标——
  // 那是末尾空行的位置，会掉到搬走那一行的下面去
  const pre = heading ? head + heading + '\n' + line : head + line
  return { text: tidyBlankLines(pre), blockStart: head.length + (heading ? heading.length + 1 : 0) }
}

// 选区跨的那几行，按空行和 # 行切成若干段。段与段之间的空行不算进任何一段
function splitIntoBlocks(lines, first, last) {
  const blocks = []
  for (let index = first; index <= last; ) {
    // 段落之间的空行不属于任何一段，跳过（不跳的话 index 不前进，死循环）
    if (lines[index].trim() === '') {
      index++
      continue
    }
    const begin = index
    const headed = isHeadingLine(lines[index])
    if (headed) index++
    while (index <= last && isBodyLine(lines[index])) index++
    blocks.push({ begin, end: index - 1, headed })
  }
  return blocks
}

// 把 [start, end) 按空行和 # 行切成若干段，逐段改。跨空行选中的时候一段
// 一段来：一段以 # 行开头就改那个标题，一段是光秃秃的正文就给它新起一节。
//   点编辑日 + 标题是「的作业」这种没名字的 → 标题是废话，删掉，正文留下
//   点编辑日 + 光秃秃的正文 → 原样留着，这几行本来就是这天的作业
//   点别的天 → 标题换日期，正文前面插一行 #<那天>的作业
// 返回新正文和「这次动过的范围」在哪儿（给调用方重新框选区），没改动返回 null
export function applyDayToSelection(content, start, end, word, strip) {
  const { lines, starts } = splitLines(content)
  const first = lineIndexAt(starts, start)
  const last = lineIndexAt(starts, end - 1)

  const out = []
  // 一个片段是「若干行 + 要不要重新框进选区」。标记是必需的：没改动的块也得框进去，
  // 不然选区会缩到只剩真正动过的那几块，用户明明选了一整片
  const marked = (chunkLines, inSelection) => ({ lines: chunkLines, inSelection })
  let selFrom = -1
  let selTo = -1
  let touched = false
  // 到目前为止输出过非空行没有。选区正好在文首时尾部提不上来，只能留在原地
  let hasContentBefore = false
  let cursor = 0

  const emit = (chunk) => {
    if (chunk.inSelection) {
      if (selFrom < 0) selFrom = out.length
      selTo = out.length + chunk.lines.length
    }
    if (!hasContentBefore) hasContentBefore = chunk.lines.some((line) => line.trim() !== '')
    out.push(...chunk.lines)
  }

  // 这一段改成什么样：按输出顺序给出若干片段。六种情形，取决于段本身有没有标题、
  // 点的是不是正在编辑的那天、以及段前是不是紧贴着一个小标题
  const rewrite = (block) => {
    const tailEnd = sectionEnd(lines, block.end + 1)
    const tail = lines.slice(block.end + 1, tailEnd)
    const body = lines.slice(block.begin, block.end + 1)
    const scopeAbove = headingAbove(content, starts[block.begin])
    // 作用域名：有标题的段用它自己那个标题（headingAbove 只会严格往上找，
    // 段自己的标题得单独取），光秃秃的段才去问上面那一节叫什么
    const title = block.headed ? scopeTitle(body[0]) : scopeTitle(scopeAbove || '')
    // 尾部（同一段里选中之后剩下的那几行）没被选中，不该跟着这一段改。
    // 要给它自己一节的话，标题就用作用域名，不带日期——跟原来那节一个层级
    const ownHead = title ? `#${title}` : ''
    // 段前就是一个小标题（段前不是标题行，或者压根没有段前）
    const skipHead = !block.headed && block.begin > 0 && isHeadingLine(lines[block.begin - 1])
    // 新起一节用的标题。光秃秃的段要点别的天就新起，标题也用作用域名，
    // 别一律叫「作业」
    const sectionHead = ['', `#${word}的${title || '作业'}`]
    const prevHead = skipHead ? lines[block.begin - 1] : ''

    if (block.headed) {
      const head = body[0]
      const parsed = parseReserveLine(head)
      // 点编辑日 + 「的作业」这种没名字的 → 标题成了废话，删掉，正文留下
      const drop = !!(strip && parsed && !parsed.heading)
      const next = drop ? head : retargetDayHeading(head, word, strip)
      // 拆出去的标题不能跟改完那个标题重名，重了等于没拆
      const keepTail = !!tail.length && !!ownHead && ownHead !== next.trim()
      const chunks = [
        marked(drop ? body.slice(1) : next === head ? body : [next, ...body.slice(1)], true),
      ]
      if (tail.length) chunks.push(marked(keepTail ? ['', ownHead, ...tail] : tail, false))
      return { chunks, touched: drop || next !== head }
    }

    // 点编辑日：这几行本来就是这天的正文，不用挂标记。上面没有小标题管着
    // 就什么都不用做；有小标题管着才要动，怎么动看那是个什么标题：
    //   有名字的跨天小节（#明天的通知）→ 选中的几行摘出来，挂到去日期的同名标题下，
    //     剩下的尾巴还归原来的标题管；全选中时尾巴为空，原标题自然消失，等于直接改标题
    //   没名字的（#明天的作业这类）→ 沿旧路脱成光秃秃的正文
    //   本来就没日期的（已经是今天的内容）→ 什么都不做
    if (strip) {
      if (!scopeAbove) return { chunks: [marked([...body, ...tail], true)], touched: false }
      const scopeParsed = parseReserveLine(scopeAbove)
      if (scopeParsed && scopeParsed.heading) {
        // 新标题是配出来的，用户选的只是正文那几行：选区保持，不扩到标题上
        return {
          chunks: [
            marked(['', ownHead], false),
            marked(body, true),
            ...(tail.length ? [marked(['', scopeAbove, ...tail], false)] : []),
          ],
          touched: true,
        }
      }
      if (!scopeParsed) return { chunks: [marked([...body, ...tail], true)], touched: false }
      // 后面那几行还归原来那节管，提到前面去；脱出来的就是光秃秃的正文
      return { chunks: [marked(tail, false), marked(['', ...body], true)], touched: true }
    }

    // 光秃秃的段正好是紧贴在上面那个标题底下的（段前就是那个标题），后面又没有
    // 别的行了 → 整节一起搬走，直接改那个标题就行，不必新起一节。
    // 标题是改出来的，用户选的只是正文那几行：选区保持，不扩到标题上
    if (!tail.length && skipHead && scopeAbove) {
      const next = retargetDayHeading(prevHead, word, false)
      return {
        chunks:
          next === prevHead
            ? [marked(body, false)]
            : [marked([next], false), marked(body, true)],
        touched: next !== prevHead,
      }
    }

    // 原来那个标题留着——它还管着后面那几行，用户没选它就不动它。
    // 新起的这一节插在它前面，尾部那几行跟着原标题走
    if (skipHead) {
      return {
        chunks: [
          marked(sectionHead, false),
          marked(body, true),
          ...(tail.length ? [marked(['', prevHead, ...tail], false)] : []),
        ],
        touched: true,
      }
    }

    // 段前面还有别的内容：尾部提上来，它归原来那节管，新标题落在尾部后面
    if (hasContentBefore) {
      return {
        chunks: [marked(tail, false), marked(sectionHead, false), marked(body, true)],
        touched: true,
      }
    }

    // 提不动（选区就在文首），留在原处、用空行隔开，
    // 不然新标题插在中间会把尾部一起收进来
    return {
      chunks: [
        marked(sectionHead, false),
        marked(body, true),
        ...(tail.length ? [marked(['', ...tail], false)] : []),
      ],
      touched: true,
    }
  }

  for (const block of splitIntoBlocks(lines, first, last)) {
    // 这个段没吃掉的行原样输出。段前那个小标题不输出：整节一起搬走的时候上面
    // 会重新输出一个改过日期的，搬走完没人管了的那几种就干脆删掉，
    // 别在展示板上留一个没有内容的小标题
    const gapEnd = block.begin - (!block.headed && block.begin > 0 && isHeadingLine(lines[block.begin - 1]) ? 1 : 0)
    for (let k = cursor; k < gapEnd; k++) emit(marked([lines[k]], false))
    const result = rewrite(block)
    for (const chunk of result.chunks) emit(chunk)
    touched = touched || result.touched
    cursor = sectionEnd(lines, block.end + 1)
  }
  for (let k = cursor; k < lines.length; k++) emit(marked([lines[k]], false))

  if (!touched) return null
  const text = tidyBlankLines(out.join('\n'))
  // tidy 只动空行，用「第几个非空行」把下标映射回整理后的正文。
  // 末尾是开区间，所以最后一行非空行的名次要减一
  const rank = (index) => out.slice(0, index).filter((line) => line.trim() !== '').length
  const wanted = [rank(selFrom), rank(selTo) - 1]
  const tidied = text.split('\n')
  const at = [-1, -1]
  let seen = 0
  for (let i = 0; i < tidied.length; i++) {
    if (tidied[i].trim() === '') continue
    for (let slot = 0; slot < 2; slot++) {
      if (at[slot] < 0 && wanted[slot] === seen) at[slot] = i
    }
    seen++
  }
  // 名次找不到就框全文。会有这种情形：某段一行正文都没输出（选中的正好是一个
  // 只由标记行构成的标题），标记的那次 emit 一个字都没加，selTo 停在 0
  if (at[0] < 0) at[0] = 0
  if (at[1] < 0) at[1] = tidied.length - 1
  return { text, blockStart: lineStarts(tidied)[at[0]], blockLines: at[1] - at[0] + 1 }
}

// 把 [start, end) 这几行并进 content 里已有的某一节，而不是新起一节。
// 只用来处理「选区正好落在某一节里」的场合；跨段落的选择走 applyDayToSelection。
// 摘掉这几行以后，原来那个小标题要是被摘空了（「的作业」标记，没名字的），
// 顺手删掉，不留一个没有内容的小标题。
// 返回新正文和「挪过去的那几行」在哪儿——调用方拿它把光标放回原处；
// 全都没有可并的地方就返回 null，调用方新起一节
export function mergeLinesInto(content, start, end, today, target, allowPlain) {
  const { lines, starts } = splitLines(content)
  const first = lineIndexAt(starts, start)
  const last = lineIndexAt(starts, end - 1)

  // 这一行本来就归那一天了，没什么可并的。不先挡一下的话，它会被并进
  // 自己所在的那一节——位置上就是跟隔壁的行换了个位置，看着像什么都没发生
  const owner = ownerAt(content, start)
  if (owner && resolveReserveDay(parseReserveLine(owner)?.word, today) === target) return null

  // 选区第一行自己就是小标题的话，这一整节都是要挪走的，标题不带过去——
  // 目标就是同名的那一节，再留一个标题就变成两份一样的了
  let picked = lines.slice(first, last + 1)
  if (isHeadingLine(picked[0])) picked = picked.slice(1)
  // 光剩一个标题：没什么可搬的，交给调用方去改那个标题
  if (!picked.length) return null
  let rest = [...lines.slice(0, first), ...lines.slice(last + 1)]
  // 切口位置（rest 坐标）：上面被摘空的标题删掉时会前移一行，
  // 找「上一个」正文块按它算
  let cutAt = first

  // 原来那节被摘空了？空标题删掉。留着它展示板上就是一个没有内容的小标题。
  // 选区本来就从标题起头的（整节搬走）不算这一种——它上面那一行是别人家的正文
  if (!isHeadingLine(lines[first])) {
    const above = first > 0 ? rest[first - 1] : ''
    const below = rest[first] ?? ''
    const emptied = isHeadingLine(above) && !isBodyLine(below)
    if (emptied) {
      rest = [...rest.slice(0, first - 1), ...rest.slice(first)]
      cutAt = first - 1
    }
  }

  // 原来那节的名字。光秃秃的正文没有名字，落到某一天时归那天的「的作业」管，
  // 所以这里给个「作业」，别因为没有名字就谁也匹配不上
  const from = owner ? scopeTitle(owner) : '作业'
  // 有名字的节（#明天的通知）不往光秃秃的正文里并——名字会丢，节也没了；
  // 只并进那天已有的同名节，并不上就交给调用方（改标题/配去日期标题）。
  // 没名字的（#明天的作业这类）才往现成正文里并
  const at = findMergePoint(rest, today, target, allowPlain && from === '作业', from, cutAt)
  if (at < 0) return null
  const out = [...rest.slice(0, at), ...picked, ...rest.slice(at)]
  return {
    text: tidyBlankLines(out.join('\n')),
    blockStart: lineStarts(out)[at],
    blockLines: picked.length,
  }
}

// 返回该插到哪一行之前；-1 表示没找到可并的地方。找法按优先级：
//   1. 向上，最后一个「日期正好是那天」的同名节
//   2. allowPlain 时，优先切口之上的最后一个没有小标题的正文块；
//      上面没有才沿用老兜底（全文最后一个，实在没有就向下找同名节）
//   3. 向下，第一个「日期正好是那天」的同名节
// allowPlain 是「点的是正在编辑的那天」那一种：这一行本来就是这天的正文，
// 不用挂标记，并进离它最近的上面那一节就是了。点别的日子时不找这种
// 地方——那天还没有对应的一节，说明该复制标题另起一节，不能把这一行塞进
// 旁边不相干的正文块里
// from 是原来那一节的节名：只并进同名的那一节。#后天的通告跟#明天的2 不是一码事，
// 塞进去等于把这几行挂错了标题，宁可新起一节
// cutAt 是摘出位置在 lines 里的下标（-1 表示不传，老行为）：只看整段
// 落在它之上的正文块，看不见切口下面的
function findMergePoint(lines, today, target, allowPlain, from, cutAt = -1) {
  const isTargetDay = (line) => {
    if (!isHeadingLine(line)) return false
    const parsed = parseReserveLine(line)
    if (!parsed || resolveReserveDay(parsed.word, today) !== target) return false
    return scopeTitle(line) === from
  }
  for (let index = lines.length - 1; index >= 0; index--) {
    if (isTargetDay(lines[index])) return sectionEnd(lines, index + 1)
  }
  // 3 要让着 2，只在没有 2 可找的时候才用
  let downward = -1
  for (let index = 0; index < lines.length; index++) {
    if (isTargetDay(lines[index])) {
      downward = sectionEnd(lines, index + 1)
      break
    }
  }
  if (!allowPlain) return downward
  // 紧跟在标题行后面那一段算标题的，不算——
  // 不然同一节里第二行点「今天」会并回自己头上，看着像什么都没发生
  let plain = -1
  let lastPlain = -1
  let index = 0
  while (index < lines.length) {
    if (!isBodyLine(lines[index])) {
      index++
      continue
    }
    const next = sectionEnd(lines, index)
    if (!isHeadingLine(lines[index - 1])) {
      lastPlain = next
      if (cutAt < 0 || next <= cutAt) plain = next
    }
    index = next
  }
  if (plain >= 0) return plain
  return lastPlain >= 0 ? lastPlain : downward
}

// 摘掉一行以后，如果它原来那一节被摘空了，把那个标题行也删掉——
// 不然展示板上会留一个没有内容的小标题。任何小标题都算，不只是「的作业」那种
export function pruneDayHeading(content, cutAt) {
  const next = content.slice(cutAt).split('\n')[0]
  if (isBodyLine(next)) return content
  const head = content.slice(0, cutAt)
  const prevEnd = head.endsWith('\n') ? head.length - 1 : head.length
  const prevStart = head.lastIndexOf('\n', prevEnd - 1) + 1
  if (!isHeadingLine(content.slice(prevStart, prevEnd))) return content
  return content.slice(0, prevStart) + content.slice(prevEnd + 1)
}
