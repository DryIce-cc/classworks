// 统一列宽 + 跨列卡片的分列求解器。
//
// 模型：
//   - 列数只按内容宽度分档（见 COLUMN_BREAKPOINTS），同一档内每列等宽；
//   - 卡片可以跨 1..C 列，跨 s 列时的高度直接从测量表 heights[i][s] 查；
//   - 跨列卡放在被覆盖列当前最高点 y=max(h[k])，比 y 矮的列上方留洞，
//     洞按面积计入 waste（保守模型：这些洞之后不再复用）。
//
// 搜索：卡片按科目顺序逐张放，beam 搜每张卡放进哪一列、跨几列。
// 不搜索的话，一路往当前最矮的列垒，长卡很容易被挤到最后一列顶成一根柱子。
// 目标是「最高的那一列尽量矮」；跨列省下的高度再按系数抵扣（长文本跨列好读）。
// 分数相同时更靠左、更少留洞的排法胜出，也就自然贴近科目顺序。

export const COLUMN_GAP = 10
export const ROW_GAP = 11

// 列数分档：宽度达到 minWidth 就用对应的列数，都不满足就是单列
export const COLUMN_BREAKPOINTS = [
  { minWidth: 1440, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 600, columns: 2 },
]
// 跨列上限：一张卡最多跨 2 列，所以只需量 1 列和 2 列宽度下的高度
export const MAX_SPAN = 2
// 跨列门槛：自然宽要达到目标跨列总宽的 80% 才允许跨。
// 太窄的卡硬跨会变成一条宽扁横条，右侧一片空白，还容易在邻列上方留洞
export const SPAN_WIDTH_FILL = 0.8
// 跨列至少要省下这么多高度才值得（占单列高度的比例）：只少折一行也跨，
// 会多占一列宽度却看不出紧凑，反而浪费横向空间
const SPAN_MIN_SAVE = 0.06
const EPS = 1e-9
const WASTE_WEIGHT = 0.5
// 跨列卡最多允许桥接多深的高度差；再深就会在矮列上方留下明显空洞
const MAX_SPAN_HOLE = 72
// 跨列卡上方的洞平均摊给该列底部最多这几张卡，避免单张卡被拉得太长
const MAX_STRETCH_CARDS = 4
// 每层保留的候选状态数。分支只有「列 × 跨列数」这点，卡数一般不到 10
const BEAM_WIDTH = 300
// 跨列资格分（spanGain）的权重：资格分 = 省下的高度 × 自然宽/跨列宽（封顶 2）。
// 省下的高度是绝对值，自然宽比跨列宽越大说明两列下仍在折行、内容更像长文本，
// 两者相乘正好把「英语这种又长又窄的卡」和「语文这种刚好填满两列的卡」拉开。
// 0.5 表示愿意为一张高资格分的卡多付半张卡的高度（3 列下英语跨列只多 33px）。
const SPAN_GAIN_WEIGHT = 0.5

export function columnsForWidth(W) {
  for (const bp of COLUMN_BREAKPOINTS) {
    if (W >= bp.minWidth) return bp.columns
  }
  return 1
}

export function columnWidth(W, C, gap = COLUMN_GAP) {
  if (C <= 1) return W
  return (W - (C - 1) * gap) / C
}

export function spanWidth(span, W, C, gap = COLUMN_GAP) {
  return span * columnWidth(W, C, gap) + (span - 1) * gap
}

// 让出一轮事件循环即可：用 setTimeout(0) 而不是 requestIdleCallback，
// 后者在输入繁忙时可能被拖到 timeout，反而让实时预览迟迟不更新。
function yieldToIdle() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
}

// 把第 i 张卡放进某个（列、跨列数）的候选。父状态用链表串起来，
// 每一步都复制一遍落位数组太浪费
function expandState(state, i, ctx, out) {
  const { C, heights, naturalWidths, spanWidths, colW, rowGap } = ctx

  for (let c = 0; c < C; c++) {
    // 列只从左往右开：左边还有空列时不在更右的列落卡，
    // 否则后放的卡会出现在先放的卡上方，读起来就乱序了
    let closed = false
    for (let k = 0; k < c; k++) {
      if (state.heights[k] <= 0) {
        closed = true
        break
      }
    }
    if (closed) continue

    for (let s = 1; s <= MAX_SPAN && c + s <= C; s++) {
      // 单列下不折行的短卡不跨：会变成一条宽扁横条，既浪费横向空间，
      // 又容易在邻列上方留洞；跨了也几乎不省高度，没有意义
      if (s > 1) {
        if (naturalWidths[i] < spanWidths[s] * SPAN_WIDTH_FILL) continue
        if (heights[i][s] > heights[i][1] * (1 - SPAN_MIN_SAVE)) continue
      }

      let y = 0
      let minCovered = Infinity
      for (let k = c; k < c + s; k++) {
        if (state.heights[k] > y) y = state.heights[k]
        if (state.heights[k] < minCovered) minCovered = state.heights[k]
      }
      // 跨列只在被覆盖列高度接近时才有意义，否则矮列上方的洞会非常刺眼
      if (s > 1 && y - minCovered > MAX_SPAN_HOLE) continue

      let addedWaste = 0
      for (let k = c; k < c + s; k++) addedWaste += (y - state.heights[k]) * colW

      const next = new Float64Array(C)
      let max = 0
      for (let k = 0; k < C; k++) {
        const v = k >= c && k < c + s ? y + heights[i][s] + rowGap : state.heights[k]
        next[k] = v
        if (v > max) max = v
      }

      const waste = state.waste + addedWaste
      // 跨列奖励只取「最高资格分那一张」，不是累加：累加会为了刷奖励
      // 把多张卡都排成横条，反而更难排紧
      const gain = s > 1 ? ctx.spanGains[i] : 0
      out.push({
        heights: next,
        waste: waste,
        max: max,
        gain: Math.max(state.gain, gain),
        score:
          max +
          (WASTE_WEIGHT * waste) / Math.max(1, ctx.W) -
          SPAN_GAIN_WEIGHT * Math.max(state.gain, gain),
        prev: state,
        card: i,
        col: c,
        span: s,
        y: y,
      })
    }
  }
}

function cmpState(a, b) {
  if (Math.abs(a.score - b.score) > EPS) return a.score - b.score
  if (Math.abs(a.max - b.max) > EPS) return a.max - b.max
  return a.waste - b.waste
}

function dedupeAndSort(states) {
  // 列高相同就只留分最低的那个。列高按整数取整当键：
  // 差不到 1px 的状态合并，结果不会有可见差别
  const map = new Map()
  for (const st of states) {
    let key = 'k'
    for (let k = 0; k < st.heights.length; k++) key += '|' + Math.round(st.heights[k])
    const prev = map.get(key)
    if (!prev || st.score < prev.score - EPS) map.set(key, st)
  }
  const arr = Array.from(map.values())
  arr.sort(cmpState)
  return arr.slice(0, BEAM_WIDTH)
}

// 跨列卡落在 y=max(列高)，比 y 矮的列上方会留一条洞。把洞平均摊到该列
// 底部最多 MAX_STRETCH_CARDS 张单列卡上：卡片变高、下面的卡跟着下移，洞就被吃掉。
// 如果列底本身是跨列卡，只有它覆盖的每一列里下一张卡都从同一个 y 开始，
// 才把整张卡加高，让底边整体下移；否则加高会顶到别的列的卡，或只能填一半，宁可不填。
// height 是当前显示高度，naturalHeight 是内容本身的实测高度；实时预览重排时
// 用 naturalHeight 重算，不会把上一轮拉伸出来的高度当成内容高度重复叠加。
export function fillSpanHoles(placements, columnCount, rowGap = ROW_GAP) {
  const out = placements.map(function (p) {
    return { ...p, naturalHeight: p.naturalHeight != null ? p.naturalHeight : p.height }
  })
  const byColumn = Array.from({ length: columnCount }, function () { return [] })
  const colBottom = new Float64Array(columnCount)
  function stretchTail(cards, gap, y) {
    const run = []
    for (let i = cards.length - 1; i >= 0 && run.length < MAX_STRETCH_CARDS; i--) {
      // 单列卡可以逐张分摊；碰到跨列卡就由上面的分支处理（或放弃）
      if (cards[i].span !== 1) break
      run.unshift(cards[i])
    }
    if (!run.length) return
    // 按整像素均分，保证卡片外框、行号、11px 间距都不带小数，
    // 否则 grid-row 取整后会在某些卡下面多出不到 1px 的缝
    const base = Math.floor(gap / run.length)
    let extra = Math.round(gap - base * run.length)
    for (const card of run) {
      card.height += base
      if (extra > 0) {
        card.height += 1
        extra -= 1
      }
    }
    // 这一串卡原本一路排到列底，现在整体变高、最上面一张不动，下面依次下移，
    // 列底正好顶到跨列卡的上沿
    let cursor = run[0].y
    for (const card of run) {
      card.y = cursor
      card.bottom = card.y + card.height
      cursor = card.bottom + rowGap
    }
  }

  for (const p of out) {
    let y = colBottom[p.col]
    for (let k = p.col + 1; k < p.col + p.span; k++) {
      if (colBottom[k] > y) y = colBottom[k]
    }
    p.y = y
    p.bottom = y + p.height
    if (p.span > 1) {
      for (let k = p.col; k < p.col + p.span; k++) {
        const gap = y - colBottom[k]
        if (gap > 0.5) {
          stretchTail(byColumn[k], gap, y)
          colBottom[k] = y
        }
      }
    }
    for (let k = p.col; k < p.col + p.span; k++) {
      colBottom[k] = p.bottom + rowGap
      byColumn[k].push(p)
    }
  }
  // 单列卡分摊完以后，y 已经定稿。再处理列底本身是跨列卡的情况：
  // 只有在它覆盖的每一列里，下一张卡都从同一个 y 开始，整张加高才能让
  // 底边一起下移、每条缝都正好留成 rowGap；只要有一列下一张卡更高/更低，
  // 加高就会在那一列顶到卡，或者只填掉一半、留下更不齐的缝，此时留空。
  // 这一步只改高度、不改任何 y，所以放在最后做，不会影响已经排好的位置。
  const nextYByColumn = new Array(columnCount).fill(Infinity)
  const nextUniform = new Map()
  for (let i = out.length - 1; i >= 0; i--) {
    const p = out[i]
    let nextY = Infinity
    let uniform = true
    for (let c = p.col; c < p.col + p.span; c++) {
      const ny = nextYByColumn[c]
      if (nextY === Infinity) nextY = ny
      else if (Math.abs(ny - nextY) > 0.5) uniform = false
    }
    if (p.span > 1 && uniform && nextY !== Infinity) nextUniform.set(p, nextY)
    for (let c = p.col; c < p.col + p.span; c++) nextYByColumn[c] = p.y
  }
  for (const [p, nextY] of nextUniform) {
    const add = Math.floor(nextY - rowGap - p.bottom)
    if (add > 0) {
      p.height += add
      p.bottom += add
    }
  }

  // 多出来的高度不落在卡片之间，而是变成卡片自己的底部内边距：
  // 外框仍然顶到 grid 行末，下一张卡与它之间始终是 rowGap
  return out.map(function (p) {
    return { ...p, stretch: Math.max(0, p.height - p.naturalHeight) }
  })
}

function finalize(state, ctx) {
  const { C, colW, gap, rowGap, W } = ctx
  const columns = []
  let x = 0
  for (let k = 0; k < C; k++) {
    columns.push({ width: colW, x: x })
    x += colW + gap
  }

  // 搜索状态用链表记录落位顺序，这里倒出来
  const seq = []
  for (let node = state; node && node.card != null; node = node.prev) {
    seq.push({ index: node.card, col: node.col, span: node.span, y: node.y })
  }
  seq.reverse()

  const placements = seq.map(function (p) {
    const height = ctx.heights[p.index][p.span]
    return {
      index: p.index,
      col: p.col,
      span: p.span,
      y: p.y,
      height: height,
      naturalHeight: height,
      bottom: p.y + height,
    }
  })

  const filled = fillSpanHoles(placements, C, rowGap)
  const colHeights = new Float64Array(C)
  for (const p of filled) {
    for (let k = p.col; k < p.col + p.span; k++) {
      if (p.bottom > colHeights[k]) colHeights[k] = p.bottom
    }
  }
  for (let k = 0; k < C; k++) columns[k].height = colHeights[k]

  const max = Math.max.apply(null, Array.from(colHeights))
  const min = Math.min.apply(null, Array.from(colHeights))
  let gain = 0
  for (const p of placements) {
    if (p.span > 1) gain = Math.max(gain, ctx.spanGains ? ctx.spanGains[p.index] || 0 : 0)
  }
  return {
    columnCount: C,
    columns: columns,
    placements: filled,
    gap: gap,
    W: W,
    max: max,
    min: min,
    range: max - min,
    waste: state.waste,
    gain: gain,
    spanCount: placements.reduce(function (n, p) { return n + (p.span > 1 ? 1 : 0) }, 0),
  }
}

// 同样总高时优先科目顺序：
//   1. 相邻科目尽量留在同一列（相邻两科上下排，而不是散到各列）；
//   2. 再按“从上到下、从左往右”的阅读顺序，逆序对越少越好。
// 跨列卡只按起始列算，它本来就会盖住下一列
function orderRank(layout) {
  const n = layout.placements.length
  const colOf = new Array(n)
  for (const p of layout.placements) colOf[p.index] = p.col
  let sameColumn = 0
  for (let i = 0; i + 1 < n; i++) {
    if (colOf[i] === colOf[i + 1]) sameColumn++
  }
  const sorted = layout.placements.slice().sort(function (a, b) {
    return a.y - b.y || a.col - b.col
  })
  let inversions = 0
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].index > sorted[j].index) inversions++
    }
  }
  return [-sameColumn, inversions]
}

// 兜底候选：LPT 贪心——高的卡先放，每次都塞进当前最矮的列。
// 不跨列时分列就是装箱问题，LPT 往往已经是最优或只差一点；beam 只看眼前
// 最高列，偶尔会漏掉这种「中途先吃点亏、后面更平」的排法，拿它兜底最省事。
// 允许跨列的卡再额外试一个「跨在当前最低两列顶上」的变体，取更矮的：
// 跨列卡后面不会再被别的卡挤上去，决策越晚越省纵向空间，矮卡才能补进洞里。
function greedyChain(ctx, allowSpan) {
  const { C, heights, rowGap } = ctx
  const n = heights.length
  const order = []
  for (let i = 0; i < n; i++) order.push(i)
  order.sort(function (a, b) { return heights[b][1] - heights[a][1] || a - b })

  const colHeights = new Float64Array(C)
  let prev = null
  for (const i of order) {
    let c = 0
    for (let k = 1; k < C; k++) if (colHeights[k] < colHeights[c]) c = k
    let span = 1
    let y = colHeights[c]
    let bottom = y + heights[i][1] + rowGap
    if (allowSpan && allowSpan[i] && C >= 2) {
      // 只在相邻两列的中间点试：c 是最矮列，覆盖 c 和 c-1 / c+1
      for (const c0 of [Math.max(0, c - 1), Math.min(C - 2, c)]) {
        const y2 = Math.max(colHeights[c0], colHeights[c0 + 1])
        const bottom2 = y2 + heights[i][2] + rowGap
        if (bottom2 < bottom - EPS) {
          span = 2
          y = y2
          bottom = bottom2
          c = c0
        }
      }
    }
    for (let k = c; k < c + span; k++) colHeights[k] = bottom
    prev = { prev: prev, card: i, col: c, span: span, y: y }
  }
  return prev
}


// heights: [{ heights: Float64Array(C+1), naturalWidth: number }]，与卡片顺序一致；
// naturalWidths: 每张卡的自然宽（用于判断能不能跨列）。
export function buildMasonryLayout(options) {
  const {
    heights,
    naturalWidths,
    W,
    columns,
    gap = COLUMN_GAP,
    rowGap = ROW_GAP,
  } = options

  if (!W || !heights.length) return null

  const C = Math.max(1, Math.min(columns || columnsForWidth(W), heights.length))
  const colW = columnWidth(W, C, gap)
  const spanWidths = new Float64Array(C + 1)
  for (let s = 1; s <= C; s++) spanWidths[s] = spanWidth(s, W, C, gap)

  const ctx = {
    heights: heights,
    naturalWidths: naturalWidths || heights.map(function () { return W }),
    C: C,
    W: W,
    gap: gap,
    rowGap: rowGap,
    colW: colW,
    spanWidths: spanWidths,
  }

  const n = heights.length
  // 跨列资格分：省下的高度 × 自然宽/两列宽（封顶 2）。
  // 英语这种自然宽远超两列宽的卡，单列下折行最多、省得也最多，分数最高；
  // 语文这种自然宽刚好等于两列宽的卡系数只有 1，分数明显低一档
  const spanGains = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (heights[i][2] >= heights[i][1]) continue
    const overflow = Math.min(2, Math.max(1, naturalWidths[i] / spanWidths[2]))
    spanGains[i] = (heights[i][1] - heights[i][2]) * overflow
  }
  ctx.spanGains = spanGains
  const allowSpan = new Array(n)
  for (let i = 0; i < n; i++) {
    allowSpan[i] =
      spanGains[i] > 0 &&
      heights[i][2] <= heights[i][1] * (1 - SPAN_MIN_SAVE) &&
      naturalWidths[i] >= spanWidths[2] * SPAN_WIDTH_FILL
  }
  let states = [{
    heights: new Float64Array(C),
    waste: 0,
    max: 0,
    gain: 0,
    score: 0,
    prev: null,
    card: null,
    col: 0,
    span: 1,
    y: 0,
  }]

  for (let i = 0; i < n; i++) {
    const next = []
    for (const state of states) expandState(state, i, ctx, next)
    if (!next.length) return null
    states = dedupeAndSort(next)
  }

  // 验收：先看「总高 - 跨列资格分 × 权重」，同分再比列高差。
  // 资格分高的卡（英语）值得为它多付半张卡的高度，刚好填满两列的卡（语文）不值
  function rank(layout) {
    const [sameColumn, inversions] = orderRank(layout)
    return [
      Math.round(layout.max - SPAN_GAIN_WEIGHT * layout.gain),
      sameColumn,
      inversions,
      layout.range > MAX_SPAN_HOLE ? 1 : 0,
      layout.range,
    ]
  }
  function better(x, y) {
    const a = rank(x)
    const b = rank(y)
    for (let j = 0; j < a.length; j++) {
      if (Math.abs(a[j] - b[j]) > EPS) return a[j] < b[j]
    }
    return false
  }
  let best = null
  for (const st of states) {
    const lay = finalize(st, ctx)
    if (!best || better(lay, best)) best = lay
  }
  const greedy = finalize(greedyChain(ctx, allowSpan), ctx)
  if (better(greedy, best)) best = greedy
  for (let k = 0; k < n; k++) {
    if (!allowSpan[k]) continue
    const lay = finalize(spanLateChain(ctx, k), ctx)
    if (better(lay, best)) best = lay
  }
  return best
}

// 卡片比视口列数少时改用这一版：每张卡宽 = max(自然宽, 视口列宽)，
// 一行左对齐，不再把卡片拉宽去撑满整行。
// widths 是每张卡的目标宽度，heights 是各自在该宽度下量到的高度。
export function buildRowLayout(options) {
  const { widths, heights, W, gap = COLUMN_GAP } = options
  const n = widths.length
  if (!n) return null
  let x = 0
  const columns = []
  const placements = []
  let max = 0
  for (let i = 0; i < n; i++) {
    const height = heights[i]
    columns.push({ width: widths[i], x: x, height: height })
    placements.push({
      index: i,
      col: i,
      span: 1,
      y: 0,
      height: height,
      naturalHeight: height,
      bottom: height,
    })
    if (height > max) max = height
    x += widths[i] + gap
  }
  return {
    columnCount: n,
    columns: columns,
    placements: placements,
    gap: gap,
    W: W,
    max: max,
    min: max,
    range: 0,
    waste: 0,
    gain: 0,
    spanCount: 0,
  }
}

// allowSpan[k] 为真时就排在最后（越晚跨，越不容易在矮列上方留洞）
function spanLateChain(ctx, k) {
  const { C, heights, rowGap } = ctx
  const n = heights.length
  const order = []
  for (let i = 0; i < n; i++) if (i !== k) order.push(i)
  order.sort(function (a, b) { return heights[b][1] - heights[a][1] || a - b })
  order.push(k)

  const colHeights = new Float64Array(C)
  let prev = null
  for (const i of order) {
    const span = i === k ? Math.min(MAX_SPAN, C) : 1
    let c = 0
    for (let j = 1; j + span <= C; j++) {
      if (Math.max(colHeights[j], colHeights[j + span - 1]) < Math.max(colHeights[c], colHeights[c + span - 1])) c = j
    }
    let y = 0
    for (let j = c; j < c + span; j++) if (colHeights[j] > y) y = colHeights[j]
    const bottom = y + heights[i][span] + rowGap
    for (let j = c; j < c + span; j++) colHeights[j] = bottom
    prev = { prev: prev, card: i, col: c, span: span, y: y }
  }
  return prev
}

// 在隐藏容器里量每张卡：自然行宽（不折行需要多宽）+ 每个跨列数下的高度。
// cardElements 必须与 heights 的顺序一致。
export function measureCards(cardElements, W, options = {}) {
  const C = options.columns || columnsForWidth(W)
  const maxSpan = Math.min(C, MAX_SPAN)
  const gap = options.gap ?? COLUMN_GAP
  const parent = options.parent || document.body
  if (!parent) return null

  const holder = document.createElement('div')
  holder.style.cssText =
    'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;'
  parent.appendChild(holder)

  const entries = []
  try {
    // 先把所有克隆都挂上、统一设成 max-content，再一次性读自然宽。
    for (const card of cardElements) {
      if (!card) {
        entries.push(null)
        continue
      }
      const clone = card.cloneNode(true)
      clone.style.height = 'auto'
      clone.style.width = 'max-content'
      clone.style.maxWidth = 'none'
      clone.style.boxSizing = 'border-box'
      const nowrapNodes = []
      clone.querySelectorAll('.hw-line, .hw-card-title, .segment-label, .label-name').forEach(function (node) {
        nowrapNodes.push([node, node.style.whiteSpace])
        node.style.whiteSpace = 'pre'
      })
      holder.appendChild(clone)
      entries.push({ clone: clone, nowrapNodes: nowrapNodes, heights: new Float64Array(maxSpan + 1) })
    }

    // 同一帧里所有 clone 都是 max-content：一次布局就能量完全部自然宽
    for (const entry of entries) {
      if (!entry) continue
      // 向上取整：offsetWidth 是取整值，差半像素就会把最后一个字挤到下一行
      let naturalWidth = Math.min(W, Math.ceil(entry.clone.getBoundingClientRect().width))
      if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) naturalWidth = W
      entry.naturalWidth = Math.max(120, naturalWidth)
      for (const [node, original] of entry.nowrapNodes) node.style.whiteSpace = original
    }

    // 各卡宽度不同时（少卡一行）按各自宽度量高
    const widths = options.widths
    if (widths) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry) entry.clone.style.width = widths[i] + 'px'
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry) entry.heights[1] = entry.clone.offsetHeight
      }
    } else {
      for (let s = 1; s <= maxSpan; s++) {
        const width = spanWidth(s, W, C, gap) + 'px'
        for (const entry of entries) {
          if (entry) entry.clone.style.width = width
        }
        // 第一次 offsetHeight 触发一次布局，同一 s 下其余读数不再触发布局
        for (const entry of entries) {
          if (entry) entry.heights[s] = entry.clone.offsetHeight
        }
      }
    }

    return entries.map(function (entry) {
      if (!entry) return null
      return { heights: entry.heights, naturalWidth: entry.naturalWidth }
    })
  } finally {
    holder.remove()
  }
}

// measureCards 的异步版：每量一个跨列宽度就让出一次主线程。
// 编辑时它会慢一点，但不会占着输入/预览的主线程；调用方用 shouldCancel 丢弃过期结果。
export async function measureCardsAsync(cardElements, W, options = {}, hooks = {}) {
  const C = options.columns || columnsForWidth(W)
  const maxSpan = Math.min(C, MAX_SPAN)
  const gap = options.gap ?? COLUMN_GAP
  const parent = options.parent || document.body
  if (!parent) return null

  const holder = document.createElement('div')
  holder.style.cssText =
    'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;'
  parent.appendChild(holder)

  const entries = []
  try {
    if (hooks.shouldCancel && hooks.shouldCancel()) return null

    for (const card of cardElements) {
      if (!card) {
        entries.push(null)
        continue
      }
      const clone = card.cloneNode(true)
      clone.style.height = 'auto'
      clone.style.width = 'max-content'
      clone.style.maxWidth = 'none'
      clone.style.boxSizing = 'border-box'
      const nowrapNodes = []
      clone.querySelectorAll('.hw-line, .hw-card-title, .segment-label, .label-name').forEach(function (node) {
        nowrapNodes.push([node, node.style.whiteSpace])
        node.style.whiteSpace = 'pre'
      })
      holder.appendChild(clone)
      entries.push({ clone: clone, nowrapNodes: nowrapNodes, heights: new Float64Array(maxSpan + 1) })
    }

    for (const entry of entries) {
      if (!entry) continue
      // 向上取整：offsetWidth 是取整值，差半像素就会把最后一个字挤到下一行
      let naturalWidth = Math.min(W, Math.ceil(entry.clone.getBoundingClientRect().width))
      if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) naturalWidth = W
      entry.naturalWidth = Math.max(120, naturalWidth)
      for (const [node, original] of entry.nowrapNodes) node.style.whiteSpace = original
    }

    await yieldToIdle()
    if (hooks.shouldCancel && hooks.shouldCancel()) return null

    // 每张卡宽度不同时（居中一行），各自按自己的宽度量高
    const widths = options.widths
    if (widths) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry) entry.clone.style.width = widths[i] + 'px'
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry) entry.heights[1] = entry.clone.offsetHeight
      }
    } else {
      for (let s = 1; s <= maxSpan; s++) {
        const width = spanWidth(s, W, C, gap) + 'px'
        for (const entry of entries) {
          if (entry) entry.clone.style.width = width
        }
        for (const entry of entries) {
          if (entry) entry.heights[s] = entry.clone.offsetHeight
        }
        if (s < maxSpan) {
          await yieldToIdle()
          if (hooks.shouldCancel && hooks.shouldCancel()) return null
        }
      }
    }

    return entries.map(function (entry) {
      if (!entry) return null
      return { heights: entry.heights, naturalWidth: entry.naturalWidth }
    })
  } finally {
    holder.remove()
  }
}
