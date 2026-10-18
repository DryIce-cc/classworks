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
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { ghostNumber, joinContent, nextNumber, renumberAll, splitContent } from '@/utils/homeworkList'
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
// 正文里能刷黄的日子词（和 homeworkReserve 的 DAY_PATTERN 同一份）
const DAY_WORD = /(今天|明天|后天|下?周[日一二三四五六])/g

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
  renumberAll(texts, numbers)
  return joinContent(texts, numbers)
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

const HIDE = Decoration.replace({})
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
    // 普通正文里的日子词也刷黄
    for (const found of text.matchAll(DAY_WORD)) {
      marks.push(DAY_MARK.range(line.from + found.index, line.from + found.index + found[0].length))
    }
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

function dropNumberAt(view, index) {
  const line = view.state.doc.line(index + 1)
  const len = numberLen(line.text)
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
  view.dispatch({ changes: { from: line.from, to: line.from + num, insert: '#' } })
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
  view.dispatch({
    changes: { from: line.from, insert: `${nextNumber(map.texts, map.numbers, index)}. ` },
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

// 回车。行首回车 = 在它上面插一个空行，这一行连记号原样留在下面（这就是「分段」）；
// 别处回车 = 把这一行劈成两半。新行不挂号：空行不算一条作业，编号栏上摆的是
// 「写上字就是第几号」的虚拟序号，真敲上字才把上一行的号接上来。
// 劈出来的下半截不是新的一条，标成「不要编号」，敲上字也不补
function enterAt(view) {
  const sel = view.state.selection.main
  if (!sel.empty) {
    view.dispatch(view.state.replaceSelection('\n'))
    return true
  }
  const line = view.state.doc.lineAt(sel.head)
  if (sel.head <= line.from + markerLen(line.text)) {
    view.dispatch({
      changes: { from: line.from, insert: '\n' },
      selection: EditorSelection.cursor(line.from + 1),
    })
    return true
  }
  const tail = line.text.slice(sel.head - line.from)
  view.dispatch({
    changes: { from: sel.head, insert: '\n' },
    selection: EditorSelection.cursor(sel.head + 1),
    effects: tail ? setRefuse.of({ pos: sel.head + 1, on: true }) : undefined,
  })
  return true
}

// 删除键 / 退格在行首。标题行去掉 #；全文最开头把这一行的记号摘掉。
// 别的地方不插手——用户在那儿是要删字、删换行符，交给原生
function deleteAt(view, forward) {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const line = view.state.doc.lineAt(sel.head)
  const text = docMap(view.state).texts[line.number - 1] ?? line.text
  // 标题行：行首删掉 #
  if (isHeadingLine(text) && sel.head <= line.from + headingLen(line.text)) {
    dropHeadingAt(view, line.number - 1)
    return true
  }
  const mlen = markerLen(line.text)
  // 光标落在记号前面：先挪到记号后面，避免原生把整块记号删掉
  if (sel.head < line.from + mlen) {
    view.dispatch({ selection: EditorSelection.cursor(line.from + mlen) })
    return false
  }
  // 全文最开头：删除键前面本来就没有字，正好拿它把这一行的记号摘掉
  if (sel.head === 0) {
    if (!text.trim()) {
      if (!isRefused(view.state, line.from)) toggleRefuse(view, line.from)
      return true
    }
    if (numberLen(line.text) > 0) {
      dropNumberAt(view, 0)
      return true
    }
    return false
  }
  // 退格在行首（非全文开头）：删掉前面的换行符，把这一行并到上一行后面
  if (!forward && sel.head === line.from + mlen && line.number > 1) {
    view.dispatch({ changes: { from: line.from - 1, to: line.from } })
    return true
  }
  return false
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

function settleInView(update) {
  const oldDoc = update.startState.doc.toString()
  const newDoc = update.state.doc.toString()
  const sel = update.state.selection.main
  const back = update.changes.invert(update.startState.doc)
  const oldPos = back.mapPos(sel.head, -1)
  const oldLine = update.startState.doc.lineAt(oldPos)
  const wasBlank = bodyOf(oldLine.text).trim() === ''
  const line = update.state.doc.lineAt(sel.head)
  const refused = update.state.field(refusedField).has(line.from)
  const target = settle(oldDoc, newDoc, { index: line.number - 1, wasBlank, refused })
  if (target === newDoc) return
  const changes = diffLines(newDoc, target)
  if (!changes) {
    view.dispatch({ changes: { from: 0, to: newDoc.length, insert: target } })
    return
  }
  const ranges = sel.ranges.map((range) => {
    const anchor = mapCursor(range.anchor, changes)
    const head = mapCursor(range.head, changes)
    return EditorSelection.range(anchor, head)
  })
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, sel.mainIndex),
  })
}

function handleUpdate(update) {
  // 中文输入法组字中不插手：CM 已经把组字期间的按键拦下来了，这里只防万一
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

// 把光标停在行首那个记号前头 / 里头敲的字挪到记号后面，正文才落在正文该在的地方
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
    const end = line.from + markerLen(line.text)
    if (end > fromA) fix = { from: end, insert: inserted.toString() }
  })
  if (count !== 1 || !fix) return tr
  return {
    changes: fix,
    selection: EditorSelection.cursor(fix.from + fix.insert.length),
    annotations: tr.annotations,
    effects: tr.effects,
  }
})

// ===== 键盘拦截 =====

// 中文输入法组字中（event.isComposing）不插手；其余键交给 CM6 原生
function handleKeydown(event, view) {
  if (event.isComposing) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
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
        Prec.high(EditorView.domEventHandlers({ keydown: handleKeydown })),
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

function getValue() {
  return view ? view.state.doc.toString() : ''
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

defineExpose({ focus, setValue, getValue, getSelection })

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
  min-height: 8em;
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

.hwe-root :deep(.hwe-mark) {
  position: absolute;
  top: 0;
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
