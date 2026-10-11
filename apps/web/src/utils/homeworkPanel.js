// 作业面板的词表，以及「这一行现在该给哪一层、该给哪几个键」。
//
// 面板分三层，一次只显示当前这一层，哪一层完全由光标所在这一行的内容推出来，
// 不另记状态——空行、只有标点的行就是起手层，所以光标落到空行上自动回到起点，
// 换行也不用手动重置，永远不会和正文对不上：
//
//   起手层  订正 / 卷（卷子、练习卷、周末卷）/ 本（小白、作业册、练习册、课本）
//   自动建议的最后一层  只要这一行有汉字或字母就来，且不区分是卷是本还是默写：
//           第一行正反面，第二行怎么收尾，第三行预定。固定四行，高度不变，
//           写字时编辑框不会被顶得上下跳。量词（题课章页张）不算汉字，
//           见 pageLetters：敲完「1题」就该回起手层了
//   小标题层  光标停在 # 开头那一行上，只有「作为…的作业」那一栏，
//           点一下改的是这个标题的目标日期
//
// 预定那一行点一下会写出一个标题行「#明天的作业」，它下面几行
// 在完成编辑或者翻日期的时候一起搬到那天去。
//
// 数字和量词介词不在面板上，放在小键盘底下。面板只往正文里加字：
// 不加空格，也不改字。要空格按小键盘的空格，点错了按小键盘的删除往回删。
// （原 homeworkPhrases.js 拆分出来，函数体原样搬运）

import { formatDayName, shiftDateString } from './date'
import { isHeadingLine } from './homeworkText'
import { parseReserveLine, resolveReserveDay, scopeTitle } from './homeworkReserve'

// 任务、载体、量词三组词表。任务单独一行是因为点完它还有的下一步；
// 「完成」不在这里：写完了这一条，面板自己认（见 onlyDone）
const TASKS = ['订正']

// 订正按下后、还没说是哪本之前，第一行换成这一堆
const RECITE = ['默写', '早读默写', '课前默写']

// 卷和本：卷补正反面，本补页码或范围。面板已经不再区分了，这两个数组
// 只在「订正刚落下、还没说是哪种」那一阵用来分辨，所以摆在一行
const PAPERS = ['卷子', '练习卷', '周末卷']
const BOOKS = ['小白', '作业册', '练习册', '课本']

// 小键盘底下那排量词（按使用频率排的）。刚敲完一个数字才需要它们，平时收起来（见 hints）
export const BOTTOM_KEYS = ['张', '页', '题', '课', '章']

// 决定「给哪一页建议」时，BOTTOM_KEYS 里那几个量词字不计入汉字（见 pageLetters）。
// 直接由词表生成，量词增删了这里跟着变
const MEASURE_CHARS = new RegExp(`[${BOTTOM_KEYS.join('')}]`, 'g')

// 自动建议最后一页的第一行
const CONTENT_ROW = ['正面', '反面']

// 收尾建议。词上不带逗号：逗号由这一行的 comma 标记来补（见 panelRows 与 insertWord）。
// 「做完」是个整句收尾，前面顶个逗号反而断气，所以它自己 comma: false 覆盖掉行级的
const SUGGEST_WORDS = [{ word: '做完', comma: false }, '明天上课对答案', '核对群里或板报的答案']

// 这一行剩下的中英文字：数字、标点、空格、前后缀全摘掉。
// 中文标点不算内容，「订正，默写」和「订正默写」要一样看待；
// 「1. 完成」摘完是「完成」，面板看来它和光打一个「完成」是同一件事；
// 「小蓝p30~35」摘完是「小蓝p」
function lettersOnly(line) {
  return line.replace(/[^\p{Script=Han}a-zA-Z]/gu, '')
}

// 判断该给哪一页建议时用的那一版：五个量词字（题课章页张）不算汉字。
// 量词是「这一条写完了」的收尾，不是内容——敲完「1题」这一行就算交代完了，
// 该回起手那一页接着写下一条；摘掉之后「1题」和光一个「1」是一回事，
// 不然写完一条还得再删掉量词，面板才肯翻页
function pageLetters(line) {
  return lettersOnly(line).replace(MEASURE_CHARS, '')
}

// 除了「完成」这两个字，这一行没有别的中英文字了。
// 这时面板回起手那一页：这一条齐了，接着写下一条（订正 / 卷 / 本）
// 比的是量词摘干净之后那一版，所以「完成3题」和只写「完成」同样算齐了
function onlyDone(letters) {
  return letters === '完成'
}

// 小键盘上那两个格子，按光标前面停在哪动态换内容。空串表示这一次不给东西，
// 那一个格子就空着（渲染层用 visibility 留着位置）：
//   小白               → P  第   该起头了，两个前缀都能用
//   p / 第 / 13~ / 13- → 空  空   前缀或者连接符刚敲出来，接下来该敲数字，别再催
//   29                 → ~  .    光秃秃一个数字，多半是接着补范围
//   p29                → ~  第   页码到头了，补范围或者改成第几题
//   p13 15 / p13 15 17 → ~  第   多页接着往下写，收尾或者改成第几题
//   第29               → ~  .    题号到头了，补范围或者改写成第几页
//   p13~15 / p13-15    → 空  第   区间写完了，该说它是第几题
// 末尾的空格先忽略掉，「p13-15 」和「p13-15」要给出同一组
export function contextKeys(before) {
  const text = before.replace(/[ 　]+$/, '')
  // 前缀或者区间的连接符刚敲出来，后面该敲数字：这两个格子让开
  if (/[第pP~-]$/.test(text)) return ['', '']
  const digits = /(\d+)$/.exec(text)
  if (!digits) return ['P', '第']
  const head = text.slice(0, text.length - digits[1].length)
  if (/第$/.test(head)) return ['~', '.']
  if (/[pP]$/.test(head)) return ['~', '第']
  // p13~15、p13-15：区间已经写完了
  if (/[~-]$/.test(head)) return ['', '第']
  // p13 15、p13 15 17：数字前面是空格、而空格前面也是数字，多页接着写
  if (/\d$/.test(head.replace(/[ 　]+$/, ''))) return ['~', '第']
  return ['~', '.']
}

// 小键盘底下那排量词该不该出现，只看紧挨着光标的那一个字：是个阿拉伯数字就该出现。
// 「13」「13~25」「第13」「p29」都算——页码后面也跟量词（页、题），
// 所以不再往前捋着排除 p/P。全角数字不算
export function hints(before) {
  return /\d$/.test(before)
}

const has = (line, words) => words.some((word) => line.includes(word))

// 词按「行末」认，不是按整行——前面已经打过序号、掺了别的字，都不该认不出来。
// 「订正」和「1. 订正」要一样。行末的空格不算词的一部分
const lineTail = (line) => line.replace(/[ 　]+$/, '')

// 这一行末尾是哪个任务词
function taskOf(line) {
  const text = lineTail(line)
  return TASKS.find((task) => text.endsWith(task)) || ''
}

// 「订正」和「默写」都在才算默写那一档。只有「默写」两个字可能只是
// 别的句子里的一个词，不该当成一条完整的作业
function isRecite(line) {
  return line.includes('订正') && line.includes('默写')
}

// 订正按下之后、还没说是默写还是哪本之前。这期间第一行摆默写那一堆
function recitePending(line) {
  if (taskOf(line) !== '订正') return false
  return !isRecite(line) && !has(line, [...PAPERS, ...BOOKS])
}

// 这一行有没有真内容：有汉字或者字母就算，标点、数字都不算。
// 「小蓝p30~35」「完成小蓝」「mq」都算——词库认不认得先不管，有内容就能给建议。
// 量词在这一层仍算内容（所以「1题」能把换行那个键点亮）；只有决定翻不翻页时
// 才把它们摘掉，见 pageLetters
export function hasContent(line) {
  return lettersOnly(line) !== ''
}

// 面板三层，认不出来的时候给回起手那一层：那时候摊一屏用不上的按钮只会干扰他。
//   'pick'    起手那一层（首页）：订正 / 卷 / 本
//   'autoLast' 自动建议的最后一层：正反面、怎么收尾、预定
//   'hash'    小标题那一层：光标停在 # 标题行上，只有日期那一栏
function phaseOf(line) {
  if (isHeadingLine(line)) return 'hash'
  // 摘掉数字、标点和量词之后剩下的中英文字：空行、只有标点、只有数字量词的行
  // 都是「这一条还没写内容」，没什么可建议的
  const letters = pageLetters(line)
  if (!letters) return 'pick'
  // 整行就写了「完成」：这一条齐了，回首页去接着写下一条。
  // 只写了完成、没写别的才这么办——「完成小白」「订正默写完成」都还在最后一页，
  // 那边的收尾建议和预定照旧给
  if (onlyDone(letters)) return 'pick'
  // 「订正」刚落下、还没说是默写还是哪本，得留在起手那一层，
  // 不然默写那几个按钮就没处摆了
  if (recitePending(line)) return 'pick'
  return 'autoLast'
}

// 「作为…的 xx」那一栏。两个页面共用这一个栏：按钮的意思都是「挪到哪天」，
// 所以按钮和样式完全一样；只有「的 xx」跟着光标所在的那一节走。
// lit 传了就用它（选区那一页自己算），没传就按这一节的目标日期算
function reserveRow(today, currentDate, scope, lit) {
  // 用户写的小标题末尾常带个冒号（「#政治合格作业：」）。那一行是
  // 「作为 明天的政治合格作业：」，尾巴上那个冒号在这行里只是个收尾的标点，
  // 去掉——正文里那行小标题一个字不动，冒号该在正文里留着
  const title = scope ? scopeTitle(scope).replace(/[：:]+$/, '') : ''
  const chips = headingDayEntries(today)
  // 点亮的是这一节的目标日期；这一节没写日期就点当前正在编辑的那天——
  // 正在编辑 10 月 10 号，就亮 10 月 10 号那个按钮，不是「今天」。
  // 按日期比不按字比：「#周三的通知」该亮的是写着「下周二」那个。
  // 那天不在这五个按钮里就一个都不亮
  const target = resolveReserveDay(scope ? parseReserveLine(scope)?.word : '', today) || currentDate
  return {
    prefix: '作为',
    groups: [chips],
    suffix: title ? `的${title}` : '的作业',
    reserve: true,
    lit: lit ?? (chips.some((chip) => chip.date === target) ? [target] : []),
  }
}

// 面板固定四行，哪一层都正好四行，空着的位置也留着，高度才不会变来变去。
// 起手层是 订正 / 卷 / 本 / 空；最后一层是 内容 / 收尾建议 / 预定 / 空；
// 小标题层和选区层都只有 预定 / 空（点下去的后果不一样，但控件是同一个）
export function panelRows(line, today, scope, currentDate, selection) {
  if (selection) {
    // 点亮选区里那些行实际归的那天；混着多天（比如 1/#明天/2 全选）就一个都不点，
    // 点哪个都像在暗示「整块都是那天的」。只有选区里一行有效内容都没有
    // （全是空行）才退回正在编辑的那天，跟小标题那一层同一条规则
    return [
      { groups: [] },
      { groups: [] },
      reserveRow(today, currentDate, '', selection.mixed ? [] : [selection.day || currentDate]),
      { groups: [] },
    ]
  }
  const phase = phaseOf(line)
  if (phase === 'hash') {
    return [
      { groups: [] },
      { groups: [] },
      reserveRow(today, currentDate, scope || line),
      { groups: [] },
    ]
  }
  if (phase !== 'autoLast') {
    return [
      { groups: [recitePending(line) ? RECITE : TASKS] },
      { groups: [PAPERS] },
      { groups: [BOOKS] },
      { groups: [] },
    ]
  }
  // 最后一页不再分书/卷/默写——认得出是哪种反而让同一件事在不同行上长得不一样，
  // 按之前还得先想一遍这是哪一类
  return [
    // 第一行永远是正反面：不管这一行是订正、默写还是写着「完成」，都还能接着补内容。
    // newline 叫渲染层在「正面/反面」后头补一个换行按钮：写完一条另起一行是这个
    // 面板上最常用的动作，摆在词条后头比只在小键盘里按那一下顺手
    { groups: [CONTENT_ROW], newline: true },
    // 收尾建议要接在已有内容后面，所以带 comma 标记：按下时先补一个逗号再写词。
    // 用户自己已经打了逗号、或者已经在接着写这个词，就只补剩下的（见 insertWord）
    hasContent(line) ? { groups: [SUGGEST_WORDS], comma: true } : { groups: [] },
    reserveRow(today, currentDate, scope),
    { groups: [] },
  ]
}

// 日期按钮：今天起往后五天，一共五个，连着各自代表的那天一起给。
// 点亮哪个按钮得按「解出来是哪天」来比，不是按按钮上的字——
// 用户写「周三」而按钮上写着「下周二」，也是同一天。
// 「今天」永远指真正的今天，不是正在编辑的那一天：这里收的参数就叫 today，
// 别把 currentDate 递进来
function headingDayEntries(today) {
  const entries = []
  for (let offset = 0; offset <= 4; offset++) {
    const date = shiftDateString(today, offset)
    // 第一格固定写「今天」，往后那几格用应用里现成的格式化日期
    // （明天 / 下周二 …），不另写一套——按钮上显示什么，
    // 写进标记里的就是同一个词，解析时自然解得回来
    entries.push({ word: offset === 0 ? '今天' : formatDayName(date), date })
  }
  return entries
}
