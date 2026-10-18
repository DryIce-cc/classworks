// 预定与日期：日子词的解析、预定标记的拼装落实、单个标题的改日期。
// 也管小标题行开头那一截（# 和它后面那个空格，见 parseHeadingLine）——
// 日期和标题名都从这里切出来，编辑框和展示板两边都拿它上色
// 只认「# 哪天」这一层，不碰选区和面板
// （原 homeworkPhrases.js 拆分出来，函数体原样搬运）

import { WEEKDAY_CHARS, parseDateString, shiftDateString } from './date'
import { isBodyLine, isHeadingLine, sectionEnd, splitLines } from './homeworkText'

// 日期字符串取周几
function weekdayOf(dateString) {
  const day = parseDateString(dateString)?.getDay()
  return Number.isInteger(day) ? WEEKDAY_CHARS[day] : ''
}

const DAY_PATTERN = '(今天|明天|后天|下?周[日一二三四五六])'

// 日子词后面可以跟的那一串，两个都可有可无，所以下面几种算同一天：
//   #明天  #明天的  #明天：  #明天的：  #明天的通知
// 解析标记和点编辑日去掉日期都用这一段。
// 「的」在这里是「这天的那份xx」的语气助词，摘的时候要跟着走
const DAY_TAIL = '[ 　]?的?[ 　]?[：:]?[ 　]?'

// 复制一个小标题时用的：只摘日子词和「：」，「的」留着——
// 「#明天的通知」复制出来是「#后天的通知」，把「的」也摘了就成了「#后天通知」
const DAY_ONLY = DAY_PATTERN + '[ 　]?[：:]?[ 　]?'

// 小标题行开头那一截：缩进 + # + 最多一个空格。
// 曾经这里还认一段六位十六进制的染色代码（#3FCC00 通知），那个功能已经去掉了，
// 现在 # 后面那几个字母就是标题名的一部分，不再当颜色
export const HEADING_PREFIX = /^[ \t]*#[ \t　]?/

// 这一行是不是「某一天」的小标题：# 开头，剥掉标记以后
// 后面紧跟着那个日子词。# 周四的作业、# 周四、# 下周四 都算
function isDayHeading(line, word) {
  const head = parseHeadingLine(line)
  return !!head && head.word === word
}

// 按钮只往「的作业」那一节的末尾追加。「# 明天的通知」是另一节，不碰——
// 那节要么留着，要么由用户另外写一行去
function isPlainDayHeading(line, word) {
  const parsed = parseReserveLine(line)
  return !!parsed && parsed.heading === '' && isDayHeading(line, word)
}

// 那天已有正文里，最后一个同名小标题那一节的末尾（行号）。
// 比的是节名而不是预定解析的结果：那边写「#通知」、这边搬过来的是
// 「#明天的通知」，节名都是「通知」，得接进同一节去。
// 没有同名的小标题返回 -1
function endOfNamedSection(day, heading) {
  for (let index = day.length - 1; index >= 0; index--) {
    if (!isHeadingLine(day[index]) || scopeTitle(day[index]) !== heading) continue
    return sectionEnd(day, index + 1)
  }
  return -1
}

// 那天已有正文里，最后一个「不受小标题管着」的段落末尾（行号）。
// 段落是一串连续的非空行；紧跟在标题行后面那一段算标题的，不算。
// 整篇都被小标题管着就返回 -1
function endOfFreeParagraph(day) {
  let end = -1
  let start = 0
  for (let index = 0; index <= day.length; index++) {
    const atEnd = index === day.length
    if (!atEnd && isBodyLine(day[index])) continue
    if (index > start && !isHeadingLine(day[start - 1])) end = index
    start = index + 1
  }
  return end
}

// 把一段正文插进那天已有的正文里，插在哪：
//   有小标题 → 接在最后一个同名小标题那一节的最后。同名的一个都没有才新起一节。
//   没小标题 → 接在最后一个不受小标题管着的段落最后。这种段落一个都没有才接全文最后。
// 空行统一交给 tidyBlankLines 理，这里只管插在哪。返回新数组，不改动接进去的那个。
function spliceIntoDay(day, heading, lines) {
  const at = heading ? endOfNamedSection(day, heading) : endOfFreeParagraph(day)
  if (at < 0) {
    const head = heading ? `#${heading}` : ''
    return [...day, '', ...(head ? [head] : []), ...lines]
  }
  return [...day.slice(0, at), ...lines, ...day.slice(at)]
}

// 把若干块预定内容接到那天已有正文后面，返回新正文。
// 落进草稿（settleReservations）和拼进预览（buildPreviewPayload）用的是同一个函数，
// 两边算出来的必须一致，否则展示板上看到的和最后存下来的不是一回事。
// spliceIntoDay 返回的是新数组（不改动它接进去的那个），所以这里必须接住返回值
export function assembleDayContent(existing, blocks) {
  let lines = existing.trim().split('\n')
  for (const block of blocks) lines = spliceIntoDay(lines, block.heading, block.lines)
  return lines.join('\n')
}

// 那一节的名字，也就是「作为…的 xx」里那个 xx：
//   # 明天的通知 → 通知     #明天的作业 → 作业     #通知 → 通知
// 挑不出名字就退回「作业」——「#明天的」这种只有日期没名字的，
// 「#明天的作业」解析出来 heading 是空的（它就是普通预定），
// 但当作用域看它就是「作业」这一节
export function scopeTitle(scope) {
  const parsed = parseReserveLine(scope)
  if (parsed) return parsed.heading || '作业'
  // 不是日期标题（#通知）：剥掉开头那一截就是节名
  const head = parseHeadingLine(scope)
  return head ? head.title : scope.replace(/^[ \t]*#[ \t]?/, '').trim()
}

// 预定标记行：#明天的作业。写法和小标题一样，所以标出来的那行在当天看着
// 就是个标题，直到完成编辑/翻日期那一刻才连着下面几行一起搬走。
// 自己插进去的一律不带空格——用户手敲的带空格照样认
export function reserveLine(day) {
  return `#${day}的作业`
}

// 标题名（「# 明天的通知」里的「通知」）从第几个字开始。
// 改完标题要把光标放回名字原来的相对位置，靠这个对齐——
// 用户在名字前面就还留在前面，接着写名字不用再手动挪回去
export function headingTitleStart(line) {
  const head = parseHeadingLine(line)
  return head ? head.titleStart : line.length
}

// 复制一个小标题并把日子换成目标那天（# 通知 → # 明天的通知）。
// 复制的是用户写的标题，他 # 后面留的那个空格原样带着走。
// 空标题（# 后面什么都没有）配默认名：不然只剩「#明天的」这种半截标记
export function retargetHeading(line, word) {
  const head = parseHeadingLine(line)
  if (!head) return ''
  const rest = line.slice(head.prefix.length)
  if (/^[ \t　]*$/.test(rest)) return head.prefix + word + '的作业'
  // 摘掉原来那个日子词（连带它后面的冒号、空格），换上新的那个。
  // 换上之后总要补一个「的」：用户写的是「通知」就成「明天的通知」；
  // 写的是「明天的通知」，摘完还剩「的通知」，那个已经有一个了，别补成两份。
  // 不补的话写出来是「明天通知」——预定解析照样认得，可读着不成话
  const title = rest.replace(new RegExp('^' + DAY_ONLY), '')
  const named = (title === rest ? rest : title.replace(/^的/, '')).replace(/^[ 　]/, '')
  return head.prefix + word + (named.startsWith('的') ? named : '的' + named)
}

// 改一个小标题自己的目标日期（光标就停在这个标题行上，或者它下面只有一行正文）。
// 「#明天」「#下周一：」这种没有标题的也得认，不然改完会变成「#后天的明天」。
// strip 为真——点的是正在编辑的那天——就把日期信息摘掉，不是来回切：
// 已经写着日期的摘掉，本来就没有的什么都不发生；否则加上/换成 word 那一天。
// 永远不补「：」——用户没写过的标点不替他加
export function retargetDayHeading(line, word, strip) {
  const head = parseHeadingLine(line)
  if (!head) return line
  if (!strip) return retargetHeading(line, word)
  const rest = line.slice(head.prefix.length)
  const title = rest.replace(new RegExp('^' + DAY_PATTERN + DAY_TAIL), '')
  return title === rest ? line : head.prefix + title
}

// 光标在「#今天的作业」这种行上、点了正在编辑的那天：这一节本来就不是真标题，
// 没有目标日期就该整行删掉，正文并到上面那一节。
// 只是没写名字的（#明天的、#今天的）不算——那只是把日期摘掉，
// # 得留着，不能连带标题一起没了
const PLAIN_RESERVE = new RegExp(
  HEADING_PREFIX.source +
    DAY_PATTERN +
    '[ 　]?的?[ 　]?[：:]?[ 　]*作业[：:]?[ \\t]*$',
)

// 是不是「某天的作业」及其变种写法（带：、带空格、有没有「的」都算）。
// 光标停在这种标题行上点正在编辑的那天时，去日期没有意义（剩个删不掉的 #作业），
// 直接换成当天日期：当天纯标记存盘时自动整行删掉
export function isPlainReserveHeading(line) {
  return PLAIN_RESERVE.test(line)
}

// 小标题下面只有一行正文时，选了日期不去新开一节，直接改这个标题。
// 返回空串表示这一行整个删掉
export function retargetScopeHeading(line, word, strip) {
  if (strip && PLAIN_RESERVE.test(line)) return ''
  return retargetDayHeading(line, word, strip)
}

// 小标题行拆成几段。不是标题行（不以 # 开头）返回 null：
//   prefix  开头那一截：缩进 + # + 空格，一个字都不多不少
//   word    日子词（明天 / 下周二 …），这一行没写日期就空串
//   day     该刷黄的那几个字：日子词加上紧跟的那个「的」
//   gap     日期词后面还没算进标题的零碎（「：」和空格），算 # 那段的一部分
//   title   剩下的标题名，两头去空格
//   titleStart 标题名从整行的第几个字开始（改完标题要把光标放回原来的相对位置）
// 日期和标题名两段的边界都在这里定死，编辑框的高亮层和展示板都按它切——
// 两边各切一遍的话，迟早会切出两条不一样的线来
export function parseHeadingLine(line) {
  const prefix = HEADING_PREFIX.exec(line)
  if (!prefix) return null
  const rest = line.slice(prefix[0].length)
  const word = new RegExp('^' + DAY_PATTERN).exec(rest)?.[1] || ''
  // 日子词后面那一小串整体都不算标题名（「明天的：」的「：」是收尾标点，
  // 不是标题的一部分）；其中刷黄的只有日子词和紧跟的那个「的」
  const tail = word ? new RegExp('^' + DAY_TAIL).exec(rest.slice(word.length))?.[0] || '' : ''
  const particle = (/^[ 　]?的/.exec(tail) || [])[0] || ''
  // 标题名从「# + 空格 + 日子词 + 零碎」之后开始
  const titleStart = prefix[0].length + word.length + tail.length
  return {
    prefix: prefix[0],
    word,
    day: word + particle,
    gap: tail.slice(particle.length),
    title: rest.slice(word.length + tail.length).replace(/[ \t　]+$/, ''),
    titleStart,
  }
}

// 这一行是预定标记就返回 { word, heading }，不是就返回 null。
// 标记行的格式：# 明天 的 作业
//   「的」后面是「作业」或「作业：」→ 普通预定，搬完把标记行删掉
//   「的」后面是别的（当作小标题）→ 搬过去后在那天写成「#标题」+ 内容
//   「的」和「：」后面什么都没有 → 也是预定，只是不给它起目标标题
// 带小标题的预定（# 明天的通知）照样是标记：# 后面那一截在
// 不然这一节的内容就不跟着搬，会留在原来那天
export function parseReserveLine(line) {
  const head = parseHeadingLine(line)
  if (!head || !head.word) return null
  return {
    word: head.word,
    heading: /^作业[：:]?$/.test(head.title.trim()) ? '' : head.title.trim(),
  }
}

// 「明天」「后天」「周X」「下周二」都换成 YYYYMMDD，一律相对「今天」解，
// 不是相对正在编辑的那一天——这样标记不管过多少天再看，都解回原来那天，
// 不会因为编辑的日期变了就搬错方向。UI 上和解析上「今天」都是同一个意思：真正的今天。
// 周X 取严格往后最近的那天：今天就是那个周几时落到下周，带不带「下」都一样。
// 解析不出来返回空串，这一行就当普通正文
export function resolveReserveDay(word, today) {
  if (!word) return ''
  if (word === '今天') return today
  if (word === '明天') return shiftDateString(today, 1)
  if (word === '后天') return shiftDateString(today, 2)
  const name = word.slice(-1)
  if (!WEEKDAY_CHARS.includes(name)) return ''
  for (let offset = 1; offset <= 7; offset++) {
    const dateString = shiftDateString(today, offset)
    if (weekdayOf(dateString) === name) return dateString
  }
  return ''
}

// 正文里那一天的小标题下面那一节，在哪儿结束（也就是它最后一行内容之后）。
// 新来的作业要接在已有内容的后面，所以找的是节的末尾，不是标题下面第一行
export function findDayBlockEnd(content, word) {
  const { lines, starts } = splitLines(content)
  const index = lines.findIndex((line) => isPlainDayHeading(line, word))
  if (index < 0) return -1
  const end = sectionEnd(lines, index + 1)
  // 节的末尾就是最后一行内容之后；它下面不再有内容时，那就是正文末尾
  return end < lines.length ? starts[end] : content.length
}

// 完成编辑、或者翻日期的时候扫一遍正文，把手工写的预定标记落实到具体日期上。
// 从上往下逐行读：碰到能解析的标记行，它下面的内容归它，一直到空行或者下一个
// 标题行为止。解析不出来的标题行不碰，当普通小标题。
// today 一律传「今天」，不是正在编辑的那天。
// ownDate 传这份正文本身是哪一天：标记指回自己那天时就地规范化（有名字的去日期、
// 纯日期/的作业整行去掉），不走搬到末尾那一套；不传则保持老行为，全部当跨天搬走。
// blocks 按正文里的先后返回，同一个日期出现多次时按顺序追加
export function parseReservations(content, today, ownDate = '') {
  const lines = content.split('\n')
  const blocks = []
  const rest = []
  let index = 0
  while (index < lines.length) {
    const markLine = lines[index]
    const parsed = parseReserveLine(markLine)
    const dateString = parsed ? resolveReserveDay(parsed.word, today) : ''
    if (!dateString) {
      rest.push(markLine)
      index++
      continue
    }
    // 标记指回自己这天：不搬走，就地把日期去掉。纯日期/的作业没名字，
    // 留个空标题没意义，整行去掉；有名字的保留顺序，只摘日期
    if (ownDate && dateString === ownDate) {
      if (parsed.heading) {
        // 开头那一截原样带着（# 和它后面那个空格都是这一节的样子，不该在这儿丢）
        rest.push((parseHeadingLine(markLine)?.prefix || '#') + parsed.heading)
      }
      index++
      continue
    }
    index++ // 跳过标记行本身，它不搬走
    const end = sectionEnd(lines, index)
    const moved = lines.slice(index, end)
    index = end
    // 搬走的那几行后面紧跟着的空行也吃掉。标记行和内容都没了，这个空行就是
    // 凭空多出来的一节空白——rest 是直接拿去当那天正文的（不再过一遍 tidy），
    // 前后都还有内容的时候尤其明显
    if (index < lines.length && lines[index].trim() === '') index++
    blocks.push({
      dateString,
      lines: moved,
      heading: parsed.heading,
    })
  }
  return { blocks, rest: rest.join('\n') }
}
