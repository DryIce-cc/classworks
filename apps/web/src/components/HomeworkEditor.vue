<template>
  <!-- 编辑器只是一个视图：真正的正文（存储文本）住在 CM 的 doc 里。
       行首的「1. 」编号和「#」都真实存在于 doc，只是用 Decoration 藏起来，
       界面上摆到左边的 gutter 上——没有第二套坐标系，也没有「行数组」正文 -->
  <div ref="host" class="hwe-root" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, keymap } from '@codemirror/view'
import { defaultKeymap, deleteCharBackward, history, historyKeymap } from '@codemirror/commands'
import { ghostNumber, joinContent, nextNumber, renumberAll, splitContent, stripBareNumbers } from '@/utils/homeworkList'
import { smartPaste } from '@/utils/homeworkPaste'
import { isBodyLine, isHeadingLine } from '@/utils/homeworkText'
import { HEADING_PREFIX, parseHeadingLine } from '@/utils/homeworkReserve'

const props = defineProps({
  // 存储文本。行首「N. 」编号、「#」小标题记号都在里面，怎么解析完全照
  // homeworkList / homeworkReserve 的既有口径，编辑框这边不另立一套
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'selection-change'])

// ===== 行列记号的口径 =====

// 存储口径的行首编号：数字 + 句点，点后面必须紧跟一个空格或者就是行尾
const STORED = /^(\d+)\.(?=[ 　]|$)/

// 「1. 」这一截占几个字（含紧跟的那一个空格，只认一个）。不是编号行返回 0
function numberLen(text) {
  const found = STORED.exec(text)
  if (!found) return 0
  return found[0].length + (/^[ 　]/.test(text.slice(found[0].length)) ? 1 : 0)
}

// 行首那个 # 记号占几个字。口径和 homeworkReserve 的 HEADING_PREFIX 一模一样，
// 两边各写一份早晚会切出两条不一样的线
function headingLen(text) {
  const found = HEADING_PREFIX.exec(text)
  return found ? found[0].length : 0
}

// 一行顶上的记号总共占几个字。编号和 # 不会同时出现，取大的那个就够
function markerLen(text) {
  return Math.max(numberLen(text), headingLen(text))
}

// 摘掉记号之后的那份正文。判断「这一行是不是空的」用它
function bodyOf(text) {
  return text.slice(markerLen(text))
}

// 用户敲出来的编号补成存储口径：「1.订正」→「1. 订正」。
// 点后面跟的是数字（「1.5」）按存储口径本来就不算编号，留给正文。
// 「1.」后面什么都没跟时也补一个空格——接着敲的「5米」才落在正文里，
// 不补的话「1.5米」会读成没有编号的一整行
function normalizeTyped(line) {
  const found = /^([ \t]*)(\d+)\./.exec(line)
  if (!found) return line
  const after = line.slice(found[0].length)
  if (after === '') return `${line} `
  if (/^[ 　\d]/.test(after)) return line
  return `${found[1]}${found[2]}. ${after}`
}

function normalizeTypedNumbers(text) {
  return text.split('\n').map(normalizeTyped).join('\n')
}

// ===== 收尾：整篇重排编号 =====

// 敲完一下之后的编号收尾。只做一件事：把整篇按「每一段从上到下连号」重排一遍。
// 排整篇而不是光标那一节：插一个空行把一段劈成两段时，下半截要从 1 重新数；
// 删一个空行把两段并成一段时，整段要接着上一段往下数。
// 这里不凭空新增编号（提交的号一律走 renumberAll，用户手写的号被归一化）。
// 唯一由代码补号的地方是 anchor：光标这一行刚由「空」变成「有字」，补一个号——
// 这正是「空行一敲字就默认给编号 / 回车续号」。wasBlank 是照着改动**之前**的
// 那一行算的，所以在一行中间回车劈出来的下半截不会被误判成新的一条
function settle(oldDoc, newDoc, anchor) {
  const map = splitContent(normalizeTypedNumbers(newDoc))
  const texts = map.texts.slice()
  const numbers = map.numbers.slice()
  // 这一轮由「手敲 N.」认出来的行。下面「正文被删空就摘号」那一条要绕开它们：
  // 那些行的正文是被认成编号后才空的，不是用户把正文删掉了（见下面）
  const typed = new Set()
  for (let i = 0; i < texts.length; i++) {
    const found = /^(\d+)\.(?!\d)/.exec(texts[i])
    if (!found) continue
    const n = Number(found[1])
    if (!n) continue
    const rest = texts[i].slice(found[0].length)
    texts[i] = /^[ 　]/.test(rest) ? rest.slice(1) : rest
    numbers[i] = n
    typed.add(i)
  }
  // 正文被删空的行，把号也一起摘掉——但这轮只是「手敲 N. 号还没写正文」的话要留着：
  // 判断看旧文中同一行：旧文里就有这个号、旧文有字，说明号是旧行员，这轮删空正文 → 摘号；
  // 旧文没号或旧文行就是空的，说明号是这轮敲进来的 → 留着等正文。
  // 这一轮刚认出来的手敲号（typed）也要留着：它是用户主动写下的第几号，
  // 正文空着正是「还没写」，不该被当成「删空了」
  const oldMap = splitContent(oldDoc)
  for (let i = 0; i < texts.length; i++) {
    if (typed.has(i)) continue
    if (numbers[i] > 0 && !texts[i].trim()) {
      const oldBody = i < oldMap.texts.length ? oldMap.texts[i] : ''
      if (oldMap.numbers[i] === numbers[i] && oldBody.trim() !== '') numbers[i] = 0
    }
  }
  const index = anchor.index
  if (
    index >= 0 &&
    index < texts.length &&
    anchor.wasBlank &&
    !anchor.refused &&
    isBodyLine(texts[index]) &&
    numbers[index] === 0
  ) {
    numbers[index] = nextNumber(texts, numbers, index)
  }
  // 手敲「N.」还没写正文的空行：把号对齐到这一行的顺序位置上。有正文的行
  // 归 renumberAll 收拾，它照规则跳过空行；空行挂着的号就一直停在用户敲的
  // 那个数上，编号栏上连虚拟序号也跟着错。行的顺序就是号，敲错了纠正过来
  for (let i = 0; i < texts.length; i++) {
    if (numbers[i] > 0 && !texts[i].trim()) {
      numbers[i] = nextNumber(texts, numbers, i)
    }
  }
  renumberAll(texts, numbers)
  const target = joinContent(texts, numbers)
  return target
}

// 两份正文逐行的最小差异。收尾只改行首那几个记号，行数不会变，所以逐行对得上。
// 返回 null 表示行数对不上（不该发生，调用方兜底整份替换）。
// 每行取「公共前缀 + 公共后缀」留中间那一段，改动才落在行首附近，
// 光标落在同一行后面那几个字上时才能被准确地带过去
function diffLines(oldText, newText) {
  const before = oldText.split('\n')
  const after = newText.split('\n')
  if (before.length !== after.length) return null
  const changes = []
  let at = 0
  for (let i = 0; i < before.length; i++) {
    const start = at
    at += before[i].length + 1
    if (before[i] === after[i]) continue
    const max = Math.min(before[i].length, after[i].length)
    let prefix = 0
    while (prefix < max && before[i][prefix] === after[i][prefix]) prefix++
    let suffix = 0
    while (
      suffix < max - prefix &&
      before[i][before[i].length - 1 - suffix] === after[i][after[i].length - 1 - suffix]
    ) {
      suffix++
    }
    changes.push({
      from: start + prefix,
      to: start + before[i].length - suffix,
      insert: after[i].slice(prefix, after[i].length - suffix),
    })
  }
  return changes
}

// 位置在我们自己重排出来的那几处改动之间挪一挪。
// 落在改动点「后面」的一律算它后面（assoc 就取这个方向）：补编号、补那个
// 空格之后光标才不会退到编号前面去。落进改动范围里的夹到改动起点
function mapCursor(pos, changes) {
  let shift = 0
  for (const change of changes) {
    const insert = change.insert ? change.insert.length : 0
    if (change.to <= pos) shift += insert - (change.to - change.from)
    else if (change.from < pos) return change.from + shift
  }
  return pos + shift
}

// ===== 「这一行不要编号」的记号 =====

// 空行默认是要编号的（写上字就补），用户点一下 / 按空格 / 按删除键就是明说
// 「这一行不要」。这份状态不进正文（空行本来没有正文可存），所以存在 state 里：
// 记的是行首那几个字符的位置，位置会随正文增删自己挪（mapPos），
// 不用再维护一份「第几行」的行号表——那份一增行减行就全错位了
const setRefuse = StateEffect.define()
const refusedField = StateField.define({
  create: () => new Set(),
  update(value, tr) {
    let next = value
    if (tr.docChanged) {
      next = new Set()
      for (const pos of value) next.add(tr.changes.mapPos(pos, -1))
    }
    for (const effect of tr.effects) {
      if (!effect.is(setRefuse)) continue
      if (next === value) next = new Set(value)
      if (effect.value.on) next.add(effect.value.pos)
      else next.delete(effect.value.pos)
    }
    return next
  },
})

function isRefused(state, pos) {
  return state.field(refusedField).has(pos)
}

function toggleRefuse(view, pos) {
  view.dispatch({ effects: setRefuse.of({ pos, on: !isRefused(view.state, pos) }) })
}

// ===== 藏起记号、给日子词和标题名上色 =====

class HideWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'hwe-hide'
    el.setAttribute('aria-hidden', 'true')
    el.contentEditable = 'false'
    return el
  }
  ignoreEvent() { return true }
}
const HIDE = Decoration.replace({ widget: new HideWidget() })
const DAY_MARK = Decoration.mark({ class: 'hwe-date' })
const HEAD_MARK = Decoration.mark({ class: 'hwe-head' })

// 一行一行地摆装饰：行首的编号 / # 用 replace 藏掉；日子词刷黄、标题名换它的颜色。
// 两处都只改颜色，不动字重字号（一动换行位置就跟正文对不上了）
function buildDecorations(state) {
  const hides = []
  const marks = []
  const doc = state.doc
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text
    const num = numberLen(text)
    const head = headingLen(text)
    if (num) hides.push(HIDE.range(line.from, line.from + num))
    if (head) hides.push(HIDE.range(line.from, line.from + head))
    const parsed = parseHeadingLine(text)
    if (parsed) {
      // 日子词和它后面那个「的」刷黄，剩下的标题名换色；几段拼起来正好是这一行
      const base = line.from + parsed.prefix.length
      if (parsed.day) marks.push(DAY_MARK.range(base, base + parsed.day.length))
      const restStart = base + parsed.day.length + parsed.gap.length
      if (restStart < line.to) marks.push(HEAD_MARK.range(restStart, line.to))
      continue
    }
    // 普通正文里的日子词不刷黄：黄色只标 # 行开头起功能作用的日子词
  }
  return { hides, decorations: Decoration.set([...hides, ...marks], true) }
}

// 藏起来那几截同时是「整块」的：光标挪动会跳过它们，不会停在编号中间
const decorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.sets = buildDecorations(view.state)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) this.sets = buildDecorations(update.state)
    }
  },
  {
    decorations: (value) => value.sets.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        const value = view.plugin(plugin)
        return value ? Decoration.set(value.sets.hides, true) : Decoration.none
      }),
  },
)

// ===== 左边的 gutter：每行一格 =====

// 一格里的内容就是编号 / 暗点 / # / 虚拟序号。CM 会按这一行的实际高度铺格子，
// 所以行折行时这一格跟着变高，编号挂在第一行上（top: 0）
class CellMarker extends GutterMarker {
  constructor(text, cls, title) {
    super()
    this.text = text
    this.cls = cls
    this.title = title
  }

  eq(other) {
    return other.text === this.text && other.cls === this.cls && other.title === this.title
  }

  toDOM() {
    const el = document.createElement('span')
    el.className = `hwe-mark ${this.cls}`
    el.textContent = this.text
    el.title = this.title
    return el
  }
}

// 拆行这件事一帧里可能被问好几次（每行都要），按 doc 缓存一份拆好的结果
let mappedDoc = null
let mapped = null
function docMap(state) {
  if (mappedDoc !== state.doc) {
    mappedDoc = state.doc
    mapped = splitContent(state.doc.toString())
  }
  return mapped
}

function cellFor(view, block) {
  const state = view.state
  const line = state.doc.lineAt(block.from)
  const index = line.number - 1
  const map = docMap(state)
  const text = map.texts[index] ?? line.text
  if (isHeadingLine(text)) return new CellMarker('#', 'hwe-mark-head', '点一下去掉这个 #')
  if (!text.trim()) {
    // 空行：光标停在这一行时摆一个虚拟序号（写上字就是第几号）。
    // 用户明说过不要编号的那一行不摆
    const sel = state.selection.main
    const onCursor = sel.empty && sel.head >= line.from && sel.head <= line.to
    if (onCursor && !isRefused(state, line.from)) {
      return new CellMarker(
        `${ghostNumber(map.texts, map.numbers, index)}.`,
        'hwe-ghost',
        '点一下这一行不要编号',
      )
    }
    return new CellMarker('·', 'hwe-dot', '点一下给这一行编号')
  }
  const number = map.numbers[index]
  if (number > 0) return new CellMarker(`${number}.`, 'hwe-on', '点一下去掉这个编号')
  return new CellMarker('·', 'hwe-dot', '点一下给这一行编号')
}

// ===== 一行的记号怎么切 =====

function dropHeadingAt(view, index) {
  const line = view.state.doc.line(index + 1)
  const len = markerLen(line.text)
  if (!len) return
  view.dispatch({ changes: { from: line.from, to: line.from + len } })
}

// 把这一行的 # 状态翻过来：是标题就去掉 #，不是就补一个 #（补之前先把编号摘掉，
// 小标题不是一条作业）。点左边那一格、行首按 # 都走这里
function toggleHeadingAt(view, index) {
  const line = view.state.doc.line(index + 1)
  const text = docMap(view.state).texts[index] ?? line.text
  if (isHeadingLine(text)) {
    dropHeadingAt(view, index)
    return
  }
  const num = numberLen(line.text)
  const from = line.from
  view.dispatch({
    changes: { from, to: from + num, insert: '#' },
    // 光标明确落到 # 后面。这一下不给选区的话，CM 会把原来那个光标按
    // 「贴着前一个字符」映射过去——光标就留在 # 前面了，接着打的字全插到
    // # 前面去：# 从此不再是行首记号，这一行也就不再是小标题（还会顺手
    // 被当成一条新作业补上编号）
    selection: EditorSelection.cursor(from + num + 1),
  })
}

// 切换这一行的编号，等价于点编号栏上那一格 / 行首按空格：
//   标题行   → 去掉 #
//   空行     → 光标这一行：收起虚拟序号（明说不要）；别的空行：把光标搬过去
//   有正文的行 → 加编号／去编号
function toggleLineAt(view, index) {
  const state = view.state
  const line = state.doc.line(index + 1)
  const map = docMap(state)
  const text = map.texts[index] ?? line.text
  if (isHeadingLine(text)) {
    dropHeadingAt(view, index)
    return
  }
  if (!text.trim()) {
    const sel = state.selection.main
    const onCursor = sel.empty && sel.head >= line.from && sel.head <= line.to
    if (onCursor) {
      toggleRefuse(view, line.from)
      return
    }
    // 光标搬过去（虚拟序号只画在光标那一行），顺手撤掉「不要编号」
    view.dispatch({
      selection: EditorSelection.cursor(line.from + markerLen(line.text)),
      effects: setRefuse.of({ pos: line.from, on: false }),
    })
    view.focus()
    return
  }
  const num = numberLen(line.text)
  if (num > 0) {
    view.dispatch({ changes: { from: line.from, to: line.from + num } })
    return
  }
  const add = `${nextNumber(map.texts, map.numbers, index)}. `
  // 光标正好压在行首（点的是左边那一格，人就在这一行）时，插进去的号会被光标挡住，
  // 得明确把它推到号后面；光标在正文中就别动，CM 自己映射得对
  const sel = state.selection.main
  const atHead = sel.empty && sel.head === line.from
  view.dispatch({
    changes: { from: line.from, insert: add },
    selection: atHead ? EditorSelection.cursor(line.from + add.length) : undefined,
  })
}

// ===== 键盘语义 =====

// 光标停在哪一行的「行首」上（后面没选着字）。不是行首就返回 -1。
// 「行首」既包括行的开头，也包括记号（编号 / #）后面那一位——光标挪动会跳过
// 记号，正常只会停在这两处
function lineHeadIndex(view) {
  const sel = view.state.selection.main
  if (!sel.empty) return -1
  const line = view.state.doc.lineAt(sel.head)
  const before = line.text.slice(0, sel.head - line.from)
  if (before === '') return line.number - 1
  if (/^([ \t]*\d+\.[ 　]?|[ \t]*#[ \t　]?)$/.test(before)) return line.number - 1
  return -1
}

// 回车。行首回车 = 在这一行上面插一个空行（这就是「分段」）；别处回车 = 把这一行
// 劈成两半。新行不挂号：空行不算一条作业，编号栏上摆的是「写上字就是第几号」的
// 虚拟序号，真敲上字才把上一行的号接上来。
// 劈出来的下半截不是新的一条，标成「不要编号」，敲上字也不补
function enterAt(view) {
  const sel = view.state.selection.main
  if (!sel.empty) {
    view.dispatch(view.state.replaceSelection('\n'))
    return true
  }
  const line = view.state.doc.lineAt(sel.head)
  const mlen = markerLen(line.text)
  if (sel.head <= line.from + mlen) {
    // 光标跟着原来这一行走，落到它挪下去之后的新行首（这一行一个字没动，
    // 记号照旧挡在前面，所以落点要加上记号那一截）。
    // 别落在插出来的空行上：空行正好占着这一格原来的位置，光标停在那儿
    // 看着就是「按了回车光标没动」，人还在这一行上、格子却掉到下面去了。
    // 「分段」本来就是「在上一行和这一行之间插一段空白」，这一行才是你正在写的
    view.dispatch({
      changes: { from: line.from, insert: '\n' },
      selection: EditorSelection.cursor(line.from + 1 + mlen),
    })
    return true
  }
  const tail = line.text.slice(sel.head - line.from)
  const map = docMap(view.state)
  const num = nextNumber(map.texts, map.numbers, line.number - 1)
  const prefix = `${num}. `
  view.dispatch({
    changes: { from: sel.head, insert: '\n' + prefix },
    selection: EditorSelection.cursor(sel.head + 1 + prefix.length),
  })
  return true
}

// 退格在行首。这把键只额外认一件事：摘掉小标题行首的 #。
// 它不摘编号——用户按退格是想删东西，不是想改这一行要不要编号，
// 想要没编号的正文去点左栏那一格、或按空格（见 toggleLineAt）。
// 别的地方不插手，交给原生
function deleteAt(view, forward) {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const line = view.state.doc.lineAt(sel.head)
  const text = docMap(view.state).texts[line.number - 1] ?? line.text
  // 标题行：只允许退格摘掉 #；删除键一律不摘 #
  if (isHeadingLine(text) && !forward && sel.head <= line.from + headingLen(line.text)) {
    dropHeadingAt(view, line.number - 1)
    return true
  }
  if (isHeadingLine(text) && forward && sel.head < line.from + headingLen(line.text)) {
    view.dispatch({ selection: EditorSelection.cursor(line.from + headingLen(line.text)) })
    return true
  }
  const mlen = markerLen(line.text)
  // 光标落在记号里面：挪到记号后面，绝不删记号本身
  if (sel.head < line.from + mlen) {
    view.dispatch({ selection: EditorSelection.cursor(line.from + mlen) })
    return true
  }
  // 首行行首按退格：吃掉这一下。
  // 那前面就是记号本身。记号是零宽的、又是一段原子区（见 EditorView.atomicRanges），
  // 交给原生的话它会一步跨过整块原子区，退格把「1. 」连号带空格整个删掉——
  // 行号就此消失，编号栏跟着掉成暗点。正文是空的才走「明说这一行不要编号」。
  // 用户真要这个行不要编号，去点左栏那一格
  if (!forward && line.number === 1 && sel.head === line.from + mlen) {
    if (!text.trim() && !isRefused(view.state, line.from)) {
      toggleRefuse(view, line.from)
    }
    return true
  }
  // 全文最开头：正文是空的，「这一行不要编号」用一次；其余没有可删的，原生自己会什么都不做
  if (sel.head === 0) {
    if (!text.trim() && !isRefused(view.state, line.from)) {
      toggleRefuse(view, line.from)
      return true
    }
    return false
  }
  // 退格在行首（非全文开头）：删掉前面的换行符和这一行的记号，把正文并到上一行后面
  if (!forward && sel.head === line.from + mlen && line.number > 1) {
    const marker = markerLen(line.text)
    view.dispatch({ changes: { from: line.from - 1, to: line.from + marker } })
    return true
  }
  // 行末按删除键：删掉换行符，把下一行并上来，但把下一行的编号/记号摘掉，只留正文
  if (forward && sel.head === line.to && line.number < view.state.doc.lines) {
    const nextLine = view.state.doc.line(line.number + 1)
    const nextMarker = markerLen(nextLine.text)
    view.dispatch({ changes: { from: sel.head, to: sel.head + 1 + nextMarker } })
    return true
  }
  return false
}

// ===== 复制 / 剪切 =====

// 复制/剪切出去的正文里，把「一整行只有一个光杆编号」的空行还原成空行。
// 界面上那种空行只显示编号栏上的虚拟序号，正文里其实没有号，粘出去却带着，
// 用户不会知道那是哪来的（见 stripBareNumbers）。
// 原生复制走的是 DOM 选区，隐藏记号本来就不在里面，可空行自己那个号是在里面的
function clipboardFromSelection(event, view, cutting) {
  const sel = view.state.selection.main
  const text = view.state.doc.sliceString(sel.from, sel.to)
  const fixed = stripBareNumbers(text)
  if (fixed === text) return false
  event.clipboardData?.setData('text/plain', fixed)
  event.preventDefault()
  // 剪切的第二半得自己补上。原生剪切的默认行为被上面掐掉了，不补的话
  // 选区还留在那儿，看着像只复制没剪切
  if (cutting && !sel.empty && !view.state.readOnly) {
    view.dispatch(view.state.replaceSelection(''))
  }
  return true
}

// ===== 光标、模型值的同步 =====

const host = ref(null)
let view = null
let lastEmitted = ''
const fromOutside = Annotation.define()

function selectionPayload() {
  if (!view) return { anchor: 0, head: 0, from: 0, to: 0, empty: true }
  const main = view.state.selection.main
  return { anchor: main.anchor, head: main.head, from: main.from, to: main.to, empty: main.empty }
}

// 收尾的后半段：按 oldDoc/newDoc 算出该收成什么样，不一样就派发回编辑器。
// anchor.index 和 refused 都拿 view.state 现算——组字那条路没有现成的 update 可用，
// 只有这两样在两路口径里含义一致
function applySettled(oldDoc, newDoc, wasBlank) {
  const selection = view.state.selection
  const sel = selection.main
  const line = view.state.doc.lineAt(sel.head)
  const anchor = {
    index: line.number - 1,
    wasBlank,
    refused: view.state.field(refusedField).has(line.from),
  }
  const target = settle(oldDoc, newDoc, anchor)
  // 用户手敲「N.」明摆着是要序号：这一行之前点过「不要编号」的话，把拒绝记号撤掉，
  // 编号栏才会跟着摆出真号。target===newDoc 时也可能需要撤（号本来就在，正文没变）
  const tmap = splitContent(target)
  const effect = anchor.refused && tmap.numbers[anchor.index] > 0
    ? setRefuse.of({ pos: line.from, on: false })
    : undefined
  if (target === newDoc) {
    if (effect) {
      view.dispatch({ effects: effect, annotations: fromOutside.of(true) })
    }
    return
  }
  const changes = diffLines(newDoc, target)
  if (!changes) {
    view.dispatch({ changes: { from: 0, to: newDoc.length, insert: target }, annotations: fromOutside.of(true), effects: effect })
    return
  }
  const ranges = selection.ranges.map((range) => {
    const shifted = mapCursor(range.anchor, changes)
    const head = mapCursor(range.head, changes)
    return EditorSelection.range(shifted, head)
  })
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, sel.mainIndex),
    annotations: fromOutside.of(true),
    effects: effect,
  })
}

function settleInView(update) {
  const oldDoc = update.startState.doc.toString()
  const newDoc = update.state.doc.toString()
  const back = update.changes.invert(update.startState.doc)
  const oldPos = back.mapPos(update.state.selection.main.head, -1)
  const oldLine = update.startState.doc.lineAt(oldPos)
  // wasBlank 问的是「改动之前那一行是空的」，而 anchor.index 问的是「改动之后光标
  // 所在的那一行」。敲一个字时这两行是同一行；一次贴进来好几行时不是——光标停在
  // 整段的最后一行，oldPos 却落在整段的起点（插入的内容整体映射回原处），拿起点那行
  // 的「空」去给终点那行补号，贴进来的最后一行就会莫名多出一个号，而原文里它本来没有
  // （多半是说明、备注，不是作业）。粘贴那一路自己声明不补号，见 pasteText
  const pasted = update.transactions.some((tr) => tr.annotation(pastedFromClipboard))
  applySettled(oldDoc, newDoc, !pasted && bodyOf(oldLine.text).trim() === '')
}

// 无论如何，不让光标/选区端点停在隐藏记号里：
// 空选区（单光标）被夹到正文起点；非空选区只把恰好落进记号内部的一端捋到边缘，
// 选区可以盖住记号（全选复制要带上 # / 序号），但不能「半截进记号」
const clampSelectionToBody = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr
  const selection = tr.selection
  const doc = tr.state.doc
  const clampBodyStart = (pos) => {
    const line = doc.lineAt(pos)
    // 空选区（单光标）一律夹到正文起点，也就是记号后面那一格。
    // 行首（记号之前）不给停：记号是零宽的，屏幕上看着就在那儿，可它其实占着
    // 真实的字符位置。光标停在那儿有两个后果——原生退格会把整块记号当一个
    // 原子区跨过去，连号带空格一起删掉；中文输入法起手那一拍多半把首字锚在
    // 这儿，收尾再把这段正文搬回记号后面就会和输入法的组字打架（首字重复）。
    // 这一行没有记号时正文起点就是行首，空行照样能停
    const start = line.from + markerLen(line.text)
    return pos < start ? start : pos
  }
  const clampInside = (pos) => {
    const line = doc.lineAt(pos)
    const from = line.from
    const to = line.from + markerLen(line.text)
    return pos > from && pos < to ? to : pos
  }
  const newRanges = selection.ranges.map((range) => {
    if (range.empty) {
      const pos = clampBodyStart(range.anchor)
      return pos !== range.anchor ? EditorSelection.cursor(pos) : range
    }
    const anchor = clampInside(range.anchor)
    const head = clampInside(range.head)
    return anchor !== range.anchor || head !== range.head
      ? EditorSelection.range(anchor, head)
      : range
  })
  return {
    changes: tr.changes,
    selection: EditorSelection.create(newRanges, selection.mainIndex),
    annotations: tr.annotations,
    effects: tr.effects,
  }
})

function handleUpdate(update) {
  // 每一笔改动都收尾。组字中的拼音也走这一条：输入法只是把一次输入拆成了
  // 好几笔事务，没有哪一笔特殊。以前这里为组字单开过旁路（组字期间不收尾、
  // 不搬字、虚拟序号另算一条），拼音期间光标因此会落到隐藏记号前面、序号会抖，
  // 一律撤掉——拼音和普通字走完全同一条路
  if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromOutside))) {
    settleInView(update)
  }
  const value = view.state.doc.toString()
  if (value !== lastEmitted) {
    lastEmitted = value
    emit('update:modelValue', value)
  }
  if (update.selectionSet) emit('selection-change', selectionPayload())
}

// 改「笔插在哪儿」的只留一条：光杆编号「1.」末尾补一个空格。
// 别的都不搬了——原先还把插在记号前面的字挪到记号后面，那条在 clampSelectionToBody
// 把光标夹到正文起点之后已经走不到，留着只会引诱下一个人再加回去
const remapBeforeMarker = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  if (tr.annotation(fromOutside)) return tr
  if (!tr.isUserEvent('input')) return tr
  let count = 0
  let fix = null
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    count++
    if (fix || fromA !== toA || !inserted.length) return
    const line = tr.startState.doc.lineAt(fromA)
    const text = inserted.toString()
    // 光标压在光杆编号「1.」的末尾（编号后面那个空格还没写上）：接着写的字
    // 前面补一个空格。存储口径要求编号后面必须有一个空格，不补的话「1.」后面
    // 敲的「2」会粘成「1.2」——整行不再被认成编号行，前面那个号就跑进正文里了
    if (fromA === line.to && /^[ \t]*\d+\.$/.test(line.text) && !/^[ 　]/.test(text)) {
      fix = { from: fromA, insert: ' ' + text }
    }
  })
  if (count !== 1 || !fix) return tr
  return {
    changes: fix,
    selection: EditorSelection.cursor(fix.from + fix.insert.length),
    annotations: tr.annotations,
    effects: tr.effects,
  }
})

// ===== 粘贴 =====

// 「这一笔是贴进来的，别当敲字补号」。收尾拿它当 wasBlank 的否决票（见 settleInView）。
// 只在一次贴进来好几行时才挂：整段的最后一行正停在光标上，不拦一下它会被当成
// 「空行刚变成有字」而多出一个号——原文里它本来就没号（多半是说明、不是作业）。
// 一次只贴一行的那句不挂：那就是手敲一个字的情形，界面上不该和敲出来的不一样
const pastedFromClipboard = Annotation.define()

// 剪贴板里那一段文字，先整理成正文该有的样子再进来：像标题的行补上 #，
// 一行里挤着的条目拆开，CRLF 和多余空格收拾掉（见 homeworkPaste）。
// 编号一概不补：原文没有号的行为什么是没有号的，那多半是说明、不是作业。
// 插进去之后照常收尾：补号、重排编号都由 handleUpdate 那一条走完，
// 和手敲进去的字走的是同一个口径
function pasteText(text) {
  if (!view || text == null || text === '') return false
  const next = smartPaste(text)
  view.dispatch({
    // replaceSelection 给的是一整份事务说明（changes + selection），得摊开铺进来。
    // 整个塞进 changes 里的话，那层对象没有 from/to/insert，CM 会当成空改动，
    // 粘贴看起来「没反应」，连报错都没有
    ...view.state.replaceSelection(next),
    annotations: next.includes('\n') ? pastedFromClipboard.of(true) : undefined,
  })
  return true
}

// 原生 Ctrl+V / 右键粘贴走这一条，和外面那个粘贴按钮调的是同一个 pasteText，
// 两条路不会切出两种结果。剪贴板里读不到纯文本（比如从图片上复制的）就交回原生
function pasteFromClipboardEvent(event) {
  const text = event.clipboardData?.getData('text/plain')
  return text ? pasteText(text) : false
}

// ===== 键盘拦截 =====

// 光标某一处几何。默认 assoc 量不出来的位置（记号正后方的 body 起点常常如此）
// 换成贴左/贴右的偏置再量；还量不出才认输
function coordAt(view, pos) {
  let rect = view.coordsAtPos(pos)
  if (!rect || rect.x == null) rect = view.coordsAtPos(pos, -1)
  if (!rect || rect.x == null) rect = view.coordsAtPos(pos, 1)
  return rect && rect.x != null ? rect : null
}

// 光标某一处的横坐标。记号右边那种位置 CM 有时量不出坐标（x 是 null），
// 就借旁边字的位置凑：右边的字量不出左缘、左边的字量不出右缘，都没有就放弃
function visualX(view, pos) {
  const rect = coordAt(view, pos)
  if (rect) return rect.x
  const state = view.state
  if (pos < state.doc.length) {
    const next = coordAt(view, pos + 1)
    if (next) return next.x
  }
  if (pos > 0) {
    const prev = coordAt(view, pos - 1)
    if (prev) return prev.x
  }
  return null
}

// 别把光标丢进四字节字（emoji）两个半截的中间。sliceString 才是字符串，
// doc.slice 返回的是 Text 对象
function midSurrogate(state, pos) {
  const code = state.doc.sliceString(pos - 1, pos).charCodeAt(0)
  return code >= 0xd800 && code < 0xdc00
}

// 上下键自己接管。原生 moveVertically 拿光标处的横坐标去目标行找最近落点，
// 记号右边那个位置量不出坐标（x 是 null）就一行都对不上，按一下等于白按。
// 这里按逻辑行走：落点在目标行的正文里逐位置量横坐标挑最近的。
// 量不出现在的横坐标就落正文开头，比没反应强
function moveVertically(view, down, extend) {
  const state = view.state
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  const targetNumber = line.number + (down ? 1 : -1)
  // 顶边/底边没有去处：吃掉按键别交给原生。原生在量不出几何的时候
  // 会自己乱跳（实测最后一行按 Down 会跳去行尾）
  if (targetNumber < 1 || targetNumber > state.doc.lines) return true
  const target = state.doc.line(targetNumber)
  // 候选从这一行的正文起点起：记号是零宽的，不把光标摆进记号里
  const start = target.from + markerLen(target.text)
  const x = visualX(view, sel.head)
  // 量不出现在的横坐标就落正文开头，比没反应强
  if (x == null) {
    view.dispatch({
      selection: extend ? EditorSelection.range(sel.anchor, start) : EditorSelection.cursor(start),
    })
    return true
  }
  // 目标行第一个能量出几何的位置当顶上那行的基准；折行第二行起不看——
  // 上下键的落点只该在目标行顶上那一行里挑
  let rowTop = null
  let rowLimit = Infinity
  let best = start
  let bestDist = Infinity
  for (let pos = start; pos <= target.to; pos++) {
    if (pos > start && midSurrogate(state, pos)) continue
    const rect = coordAt(view, pos)
    if (!rect) continue
    if (rowTop == null) {
      rowTop = rect.top
      rowLimit = rowTop + (rect.bottom - rect.top) * 0.5
    } else if (rect.top > rowLimit) {
      break
    }
    const dist = Math.abs(rect.x - x)
    if (dist < bestDist) {
      bestDist = dist
      best = pos
    }
  }
  view.dispatch({
    selection: extend ? EditorSelection.range(sel.anchor, best) : EditorSelection.cursor(best),
  })
  return true
}

// 中文输入法组字中（event.isComposing）不插手；其余键交给 CM6 原生
function handleKeydown(event, view) {
  // 输入法组字中不插手：拼音不按 keydown 走，这些自定义键一个都不该在组字时生效。
  // 组字本身当普通输入处理（见 handleUpdate），只有「按键→动作」这一层让开
  if (event.isComposing) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.key === 'Home' && !event.shiftKey) {
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    view.dispatch({ selection: EditorSelection.cursor(line.from + markerLen(line.text)) })
    return true
  }
  if (event.key === 'ArrowLeft') {
    const sel = view.state.selection.main
    const line = view.state.doc.lineAt(sel.head)
    // 光标压着行首记号（记号是零宽的，正文起点和行首看着是同一个点）：
    // 这一下就该一步退到上一行末尾。光标不会停在记号前面（见 clampSelectionToBody），
    // 所以走到这儿就说明正站在正文起点上
    const ml = markerLen(line.text)
    if (ml > 0 && sel.head <= line.from + ml) {
      if (line.number > 1) {
        const prev = view.state.doc.line(line.number - 1)
        view.dispatch({
          selection: event.shiftKey
            ? EditorSelection.range(sel.anchor, prev.to)
            : EditorSelection.cursor(prev.to),
        })
      }
      // 第一行的行首已经是全文开头，再往左没有地方，不动是正常的
      return true
    }
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    return moveVertically(view, event.key === 'ArrowDown', event.shiftKey)
  }
  if (event.key === 'Enter') return enterAt(view)
  if (event.key === ' ' || event.key === '#') {
    const index = lineHeadIndex(view)
    if (index < 0) return false
    if (event.key === ' ') toggleLineAt(view, index)
    else toggleHeadingAt(view, index)
    return true
  }
  if (event.key === 'Backspace') return deleteAt(view, false)
  if (event.key === 'Delete') return deleteAt(view, true)
  return false
}

// ===== CM 扩展 =====

// (extensions 由 onMounted 里直接内联)

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue ?? '',
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        Prec.high(EditorView.domEventHandlers({
          // 组字一律不管：拼音不插事件、不参与 keydown，笔笔都当普通输入收尾
          keydown: handleKeydown,
          paste: pasteFromClipboardEvent,
          copy: (event, view) => clipboardFromSelection(event, view, false),
          cut: (event, view) => clipboardFromSelection(event, view, true),
        })),
        EditorView.lineWrapping,
        decorationPlugin,
        gutter({
          class: 'hwe-gutter',
          lineMarker: (v, block) => cellFor(v, block),
          lineMarkerChange: (update) =>
            update.selectionSet ||
            update.startState.field(refusedField) !== update.state.field(refusedField),
          domEventHandlers: {
            mousedown: (v, block) => {
              const line = v.state.doc.lineAt(block.from)
              toggleLineAt(v, line.number - 1)
              return true
            },
          },
        }),
        refusedField,
        clampSelectionToBody,
        remapBeforeMarker,
        EditorView.updateListener.of(handleUpdate),
      ],
    }),
    parent: host.value,
  })
  lastEmitted = view.state.doc.toString()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// ===== 对外接口 =====

function focus() {
  view?.focus()
}

function getSelection() {
  return selectionPayload()
}

function setValue(text, range) {
  if (!view) return
  const next = text ?? ''
  const changes = { from: 0, to: view.state.doc.length, insert: next }
  let selection
  if (range && Number.isInteger(range.anchor)) {
    const head = Number.isInteger(range.head) ? range.head : range.anchor
    const end = next.length
    selection = EditorSelection.single(
      Math.max(0, Math.min(range.anchor, end)),
      Math.max(0, Math.min(head, end)),
    )
  }
  lastEmitted = next
  view.dispatch({
    changes,
    selection,
    annotations: fromOutside.of(true),
  })
  emit('update:modelValue', next)
}

// 只挪光标/选区，正文一个字都不动。setValue 那条路会把整份 doc 换一遍，
// 打开面板时正文本来就刚换过一遍，没必要再来一次——多一次全量替换既白费，
// 又会在撤销栈里多出一条没用的记录
function setCaret(at, to = at) {
  if (!view) return
  const end = view.state.doc.length
  view.dispatch({
    selection: EditorSelection.single(
      Math.max(0, Math.min(at, end)),
      Math.max(0, Math.min(to, end)),
    ),
  })
}

// 小键盘上的回车／退格键走的入口：和键盘按键完全同一个语义，
// 对话框那边不要再自己切一套字符串
function keyEnter() {
  if (view) enterAt(view)
}

function keyBackspace() {
  if (!view) return
  // deleteAt 不想插手时会返回 false。键盘按键那条路后面还跟着 CM 的
  // defaultKeymap，退格由它兜住；按钮这条路没有后手，false 就等于什么都不做
  // （实测小键盘删除键整格失灵）。所以这里自己把原生退格接上，
  // 两边才是同一个语义
  if (!deleteAt(view, false)) deleteCharBackward(view)
}

// 第 index 行是不是被用户明说过「不要编号」。这份状态只活在 refusedField 里
// （正文存不下它），对话框那边要补号就得来问一句——它自己那份行号表早就错位了
function isLineRefused(index) {
  if (!view) return false
  const line = view.state.doc.line(index + 1)
  return isRefused(view.state, line.from)
}

// 外面那个「粘贴」按钮走的入口，和原生 Ctrl+V 完全同一个动作
defineExpose({ focus, setValue, getSelection, setCaret, keyEnter, keyBackspace, isLineRefused, pasteText })

// ===== 模型值外部更新 =====

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const next = value ?? ''
    if (next === view.state.doc.toString()) return
    lastEmitted = next
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      annotations: fromOutside.of(true),
    })
  },
)
</script>

<style scoped>
.hwe-root {
  font-size: inherit;
  line-height: 1.5;
}

.hwe-root :deep(.cm-editor) {
  background: transparent;
  font-family: inherit;
}

.hwe-root :deep(.cm-editor.cm-focused) {
  outline: none;
}

.hwe-root :deep(.cm-scroller) {
  font-family: inherit;
  line-height: inherit;
  overflow: auto;
}

.hwe-root :deep(.cm-content) {
  padding: 0 4px;
  caret-color: rgb(var(--v-theme-on-surface));
  /* 编辑框兜底高度。挂在 .cm-content 上而不是根元素上：正文短的时候下面那段
     空白要是编辑框自己的（点它 = 点编辑框，光标落到文末），悬在根元素上就
     成了一块「面板里的空白」，点一下等于点了外面，面板会关掉。
     撑足高度顶住排版：短正文也占满这块，面板高度不跟着正文长短跳 */
  min-height: 8em;
}

.hwe-root :deep(.cm-line) {
  padding: 0;
}

.hwe-root :deep(.cm-cursor) {
  border-left-color: currentColor;
}

/* 行内着色：只改颜色，不动字重字号——一动换行位置就跟正文对不上了 */
.hwe-root :deep(.hwe-date) {
  color: #ffeb3b;
}

.hwe-root :deep(.hwe-head) {
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.v-theme--light .hwe-root :deep(.hwe-date) {
  color: #f9a825;
}

/* 编号栏 */
.hwe-root :deep(.cm-gutters) {
  background: transparent;
  border-right: none;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.hwe-root :deep(.hwe-gutter) {
  min-width: 2.2em;
}

.hwe-root :deep(.hwe-gutter .cm-gutterElement) {
  position: relative;
  padding: 0;
  cursor: pointer;
}

.hwe-root :deep(.hwe-hide) {
  display: inline-block;
  width: 0;
  user-select: none;
  pointer-events: none;
}

.hwe-root :deep(.hwe-mark) {
  position: absolute;
  top: 0.15em;
  right: 4px;
  font-size: 0.8em;
  white-space: nowrap;
  user-select: none;
}

.hwe-root :deep(.hwe-dot) {
  color: rgba(var(--v-theme-on-surface), 0.3);
}

.hwe-root :deep(.hwe-ghost) {
  color: rgba(var(--v-theme-on-surface), 0.25);
}

.hwe-root :deep(.hwe-mark-head) {
  font-weight: 700;
}
</style>
