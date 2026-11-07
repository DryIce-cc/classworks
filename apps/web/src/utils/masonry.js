// 变宽列 + 跨列卡片的分列求解器。
//
// 模型：
//   - 视口内容宽度 W 均分成 T 个轨道，列 = 连续的若干轨道，列宽由轨道数决定；
//   - 卡片可以跨 1..C 列，跨 t 个轨道时的高度直接从测量表 H[i][t] 查；
//   - 跨列卡放在被覆盖列当前最高点 y=max(h[k])，比 y 矮的列上方留洞，
//     洞按面积计入 waste（保守模型：这些洞之后不再复用）。
//
// 搜索：
//   - 枚举列数 C；
//   - 用「等高 / 一宽多窄 / 按内容量 / 随机」做种子，单轨道转移爬山；
//   - 每种列宽用 beam search 逐卡选择「放哪列、跨几列」。
//
// 两种模式：
//   - comfort：每张卡的落位宽度不得小于它的可读下限
//     （naturalWidth < 270 时取 naturalWidth，否则取 270）；
//   - compact：允许低于可读下限，但按短少的像素数计罚，优先压总高度。

export const TRACK_COUNT = 36
export const COLUMN_GAP = 10
export const ROW_GAP = 11
export const MIN_COL_WIDTH = 150
export const COMFORT_COL_WIDTH = 270

const EPS = 1e-9
const WASTE_WEIGHT = 0.5
const RANGE_WEIGHT = 0.04
// 跨列卡最多允许桥接多深的高度差；再深就会在矮列上方留下明显空洞
const MAX_SPAN_HOLE = 72
// 跨列卡上方的洞平均摊给该列底部最多这几张卡，避免单张卡被拉得太长
const MAX_STRETCH_CARDS = 4

export function trackUnit(W, gap = COLUMN_GAP, T = TRACK_COUNT) {
  return (W - (T - 1) * gap) / T
}

export function widthOfTracks(t, W, gap = COLUMN_GAP, T = TRACK_COUNT) {
  return t * trackUnit(W, gap, T) + (t - 1) * gap
}

function tracksForWidth(width, W, gap, T) {
  let lo = 1
  let hi = T
  const target = width - 0.5
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (widthOfTracks(mid, W, gap, T) >= target) hi = mid
    else lo = mid + 1
  }
  return lo
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 让出一轮事件循环即可：用 setTimeout(0) 而不是 requestIdleCallback，
// 后者在输入繁忙时可能被拖到 timeout，反而让实时预览迟迟不更新。
function yieldToIdle() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
}

function equalTracks(C, T) {
  const base = Math.floor(T / C)
  const rem = T % C
  const arr = new Array(C).fill(base)
  for (let i = 0; i < rem; i++) arr[i]++
  return arr
}

function randomComposition(C, T, minT, rng) {
  const tracks = new Array(C).fill(minT)
  let rem = T - C * minT
  while (rem > 0) {
    tracks[Math.floor(rng() * C)]++
    rem--
  }
  return tracks
}

// 按「每张卡最省面积的宽度」估算内容量，再按列轮转分桶。
function volumeComposition(C, ctx) {
  const { heights, T, minT, rowGap, W, gap } = ctx
  const volumes = heights.map(function (H) {
    let best = Infinity
    for (let t = minT; t <= T; t++) {
      const area = (H[t] + rowGap) * widthOfTracks(t, W, gap, T)
      if (area < best) best = area
    }
    return best
  })

  const buckets = new Array(C).fill(0)
  for (let i = 0; i < volumes.length; i++) buckets[i % C] += volumes[i]
  const sum = buckets.reduce(function (a, b) { return a + b }, 0) || 1
  const rem = T - C * minT
  const raw = buckets.map(function (v) { return (rem * v) / sum })
  const tracks = raw.map(function (v) { return minT + Math.floor(v) })
  let diff = T - tracks.reduce(function (a, b) { return a + b }, 0)
  const order = raw
    .map(function (v, k) { return { k: k, frac: v - Math.floor(v) } })
    .sort(function (a, b) { return b.frac - a.frac })
  for (let i = 0; i < diff; i++) tracks[order[i % order.length].k]++
  return tracks
}

function buildSeeds(C, ctx) {
  const { T, minT } = ctx
  const seeds = []
  const push = function (tracks) {
    const key = tracks.join(',')
    if (!seeds.some(function (s) { return s.join(',') === key })) seeds.push(tracks)
  }

  push(equalTracks(C, T))

  const wideFirst = new Array(C).fill(minT)
  wideFirst[0] = T - (C - 1) * minT
  push(wideFirst)

  const wideLast = new Array(C).fill(minT)
  wideLast[C - 1] = T - (C - 1) * minT
  push(wideLast)

  if (C >= 3) {
    const twoWide = new Array(C).fill(minT)
    const extra = T - C * minT
    const first = Math.round(extra * 0.65)
    twoWide[0] += first
    twoWide[1] += extra - first
    push(twoWide)
  }

  push(volumeComposition(C, ctx))

  const rng = mulberry32(9173 + C * 131)
  for (let r = 0; r < 2; r++) push(randomComposition(C, T, minT, rng))
  return seeds
}

function scoreOf(max, min, waste, W, readability) {
  return max + WASTE_WEIGHT * (waste / W) + RANGE_WEIGHT * (max - min) + readability
}

function addPlacement(state, i, ctx, tracks, colW, prefixTracks) {
  const C = tracks.length
  const heights = state.heights
  const out = []

  for (let c = 0; c < C; c++) {
    for (let s = 1; c + s <= C; s++) {
      const t = prefixTracks[c + s] - prefixTracks[c]
      // comfort 模式：落位宽度必须达到这张卡的可读下限
      if (ctx.comfortMode && t < ctx.requiredTracks[i]) continue
      // 自然宽还没到舒适宽的卡，内容本身撑不满一整列；跨列会变成一条宽扁横条，
      // 既浪费横向空间，又容易在邻列上方留洞，所以优先单列。
      if (s > 1 && ctx.naturalWidths[i] < COMFORT_COL_WIDTH) continue

      const width = ctx.widthByTracks[t]
      const readability = ctx.comfortMode
        ? 0
        : Math.max(0, ctx.targetWidths[i] - width) * ctx.readWeight

      const h = ctx.heights[i][t] + ctx.rowGap
      let y = 0
      let minCovered = Infinity
      for (let k = c; k < c + s; k++) {
        if (heights[k] > y) y = heights[k]
        if (heights[k] < minCovered) minCovered = heights[k]
      }
      // 跨列只在被覆盖列高度接近时才有意义，否则矮列上方的洞会非常刺眼
      if (s > 1 && y - minCovered > MAX_SPAN_HOLE) continue

      let addedWaste = 0
      for (let k = c; k < c + s; k++) addedWaste += (y - heights[k]) * colW[k]

      const next = new Float64Array(C)
      let max = 0
      let min = Infinity
      for (let k = 0; k < C; k++) {
        const v = k >= c && k < c + s ? Math.max(heights[k], y + h) : heights[k]
        next[k] = v
        if (v > max) max = v
        if (v < min) min = v
      }

      const waste = state.waste + addedWaste
      const readabilityTotal = state.readability + readability
      out.push({
        heights: next,
        waste: waste,
        readability: readabilityTotal,
        max: max,
        min: min,
        range: max - min,
        score: scoreOf(max, min, waste, ctx.W, readabilityTotal),
        placements: state.placements.concat([{ index: i, col: c, span: s, y: y, t: t }]),
      })
    }
  }
  return out
}

function cmpState(a, b) {
  if (Math.abs(a.score - b.score) > EPS) return a.score - b.score
  if (Math.abs(a.max - b.max) > EPS) return a.max - b.max
  if (Math.abs(a.range - b.range) > EPS) return a.range - b.range
  return a.waste - b.waste
}

function dedupeAndSort(states, beamWidth) {
  const map = new Map()
  for (const st of states) {
    const key = Array.from(st.heights).join('|')
    const prev = map.get(key)
    if (!prev || st.score < prev.score - EPS) map.set(key, st)
  }
  const arr = Array.from(map.values())
  arr.sort(cmpState)
  return arr.slice(0, beamWidth)
}

function evaluateGreedy(tracks, ctx) {
  const C = tracks.length
  const colW = tracks.map(function (t) { return ctx.widthByTracks[t] })
  const prefixTracks = new Array(C + 1).fill(0)
  for (let k = 0; k < C; k++) prefixTracks[k + 1] = prefixTracks[k] + tracks[k]

  let heights = new Float64Array(C)
  let waste = 0
  let readability = 0
  const placements = []

  for (let i = 0; i < ctx.heights.length; i++) {
    const state = { heights: heights, waste: waste, readability: readability, placements: [] }
    const candidates = addPlacement(state, i, ctx, tracks, colW, prefixTracks)
    if (!candidates.length) return null

    let best = null
    for (const cand of candidates) {
      if (
        !best ||
        cand.score < best.score - EPS ||
        (Math.abs(cand.score - best.score) < EPS &&
          cand.placements[0].span < best.placements[0].span)
      ) {
        best = cand
      }
    }
    heights = best.heights
    waste = best.waste
    readability = best.readability
    placements.push(best.placements[0])
  }

  const max = Math.max.apply(null, Array.from(heights))
  const min = Math.min.apply(null, Array.from(heights))
  return {
    tracks: tracks,
    placements: placements,
    heights: heights,
    waste: waste,
    readability: readability,
    max: max,
    min: min,
    range: max - min,
    score: scoreOf(max, min, waste, ctx.W, readability),
    spanCount: placements.reduce(function (n, p) { return n + (p.span > 1 ? 1 : 0) }, 0),
  }
}

function evaluateBeam(tracks, ctx, beamWidth) {
  const C = tracks.length
  const colW = tracks.map(function (t) { return ctx.widthByTracks[t] })
  const prefixTracks = new Array(C + 1).fill(0)
  for (let k = 0; k < C; k++) prefixTracks[k + 1] = prefixTracks[k] + tracks[k]

  let states = [{
    heights: new Float64Array(C),
    waste: 0,
    readability: 0,
    max: 0,
    min: 0,
    range: 0,
    score: 0,
    placements: [],
  }]

  for (let i = 0; i < ctx.heights.length; i++) {
    let next = []
    for (const state of states) {
      next = next.concat(addPlacement(state, i, ctx, tracks, colW, prefixTracks))
    }
    if (!next.length) return null
    states = dedupeAndSort(next, beamWidth)
  }

  return finalize(states[0], tracks, ctx)
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

// 列的左右顺序不影响任何排版指标：把整列（含列宽和列内卡片）一起挪动，
// 每张卡的宽度、高度、跨列卡覆盖的轨道数、空洞面积都不变。既然如此，
// 顺序就应当服务于阅读：按「这一列第一张卡的科目序号」从左到右排。
// 跨列卡把相邻几列绑成一个整体（挪动其中一列会让跨列卡覆盖到别的宽度），
// 整体内部保持原序，整体之间仍可自由排序。
function orderColumns(C, placements) {
  const first = new Array(C).fill(Infinity)
  const reach = new Int32Array(C)
  for (let k = 0; k < C; k++) reach[k] = k

  for (const p of placements) {
    const end = p.col + p.span - 1
    for (let k = p.col; k <= end; k++) {
      if (p.index < first[k]) first[k] = p.index
      if (end > reach[k]) reach[k] = end
    }
  }

  const blocks = []
  let k = 0
  while (k < C) {
    let end = reach[k]
    for (let j = k; j <= end; j++) if (reach[j] > end) end = reach[j]
    // 读者先看到的是这一块最左列的首卡；跨列卡把几列绑死时，
    // 块内无法再调，只按这个可见的首卡决定整块放哪。
    blocks.push({ start: k, end: end, head: first[k] })
    k = end + 1
  }
  blocks.sort(function (a, b) { return a.head - b.head || a.start - b.start })

  const order = []
  for (const block of blocks) {
    for (let j = block.start; j <= block.end; j++) order.push(j)
  }
  return { order: order, first: first }
}

// 顺序已经按块归位后，仍然可能因为跨列卡把先后两列绑在一起而留下少量倒置
// （例：块内左列首卡 5、右列首卡 0）。这个数只用于同分方案的次级比较。
function headInversions(first) {
  let n = 0
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) if (first[i] > first[j]) n++
  }
  return n
}

function finalize(state, tracks, ctx) {
  const C = tracks.length
  const ordered = orderColumns(C, state.placements)
  const displayOf = new Array(C)
  ordered.order.forEach(function (orig, display) { displayOf[orig] = display })

  const columns = []
  let x = 0
  for (let k = 0; k < C; k++) {
    const orig = ordered.order[k]
    const width = ctx.widthByTracks[tracks[orig]]
    // 跨列卡会同时抬高被覆盖的每一列，直接用搜索状态里的列高，
    // 不能只看卡落在的第一列，否则统计出来的 max/range 会偏小。
    columns.push({ tracks: tracks[orig], width: width, x: x, height: state.heights[orig] })
    x += width + ctx.gap
  }

  const placements = fillSpanHoles(
    state.placements.map(function (p) {
      const col = displayOf[p.col]
      const height = ctx.heights[p.index][p.t]
      const width = ctx.widthByTracks[p.t]
      return {
        index: p.index,
        col: col,
        span: p.span,
        x: columns[col].x,
        y: p.y,
        width: width,
        height: height,
        naturalHeight: height,
        t: p.t,
        bottom: p.y + height,
      }
    }),
    C,
    ctx.rowGap,
  )

  const max = Math.max.apply(null, Array.from(state.heights))
  const min = Math.min.apply(null, Array.from(state.heights))

  return {
    tracks: columns.map(function (col) { return col.tracks }),
    columnCount: C,
    columns: columns,
    placements: placements,
    waste: state.waste,
    readability: state.readability,
    max: max,
    min: min,
    range: max - min,
    score: scoreOf(max, min, state.waste, ctx.W, state.readability),
    headOrder: headInversions(columns.map(function (col, k) {
      return ordered.first[ordered.order[k]]
    })),
    spanCount: placements.reduce(function (n, p) { return n + (p.span > 1 ? 1 : 0) }, 0),
  }
}

function compositionCandidates(C, ctx) {
  const cache = new Map()
  const evalG = function (tracks) {
    const key = tracks.join(',')
    if (cache.has(key)) return cache.get(key)
    const result = evaluateGreedy(tracks, ctx)
    cache.set(key, result)
    return result
  }

  const found = new Map()
  for (const seed of buildSeeds(C, ctx)) {
    let current = seed.slice()
    let currentResult = evalG(current)
    if (!currentResult) continue

    for (let iter = 0; iter < 8; iter++) {
      let bestTracks = null
      let bestResult = currentResult

      for (let a = 0; a < C; a++) {
        if (current[a] <= ctx.minT) continue
        for (let b = 0; b < C; b++) {
          if (a === b) continue
          const neighbor = current.slice()
          neighbor[a]--
          neighbor[b]++
          const result = evalG(neighbor)
          if (result && result.score < bestResult.score - EPS) {
            bestResult = result
            bestTracks = neighbor
          }
        }
      }

      if (!bestTracks) break
      current = bestTracks
      currentResult = bestResult
    }

    found.set(current.join(','), { tracks: current, score: currentResult.score })
  }

  const result = Array.from(found.values())
    .sort(function (a, b) { return a.score - b.score })
    .slice(0, 3)
    .map(function (item) { return item.tracks })

  const equal = equalTracks(C, ctx.T)
  const equalKey = equal.join(',')
  if (!result.some(function (tracks) { return tracks.join(',') === equalKey })) {
    result.push(equal)
  }
  return result
}

function cmpResult(a, b) {
  if (Math.abs(a.score - b.score) > EPS) return a.score - b.score
  if (Math.abs(a.max - b.max) > EPS) return a.max - b.max
  if (Math.abs(a.range - b.range) > EPS) return a.range - b.range
  if (Math.abs(a.waste - b.waste) > EPS) return a.waste - b.waste
  if ((a.headOrder || 0) !== (b.headOrder || 0)) return (a.headOrder || 0) - (b.headOrder || 0)
  if ((a.spanCount || 0) !== (b.spanCount || 0)) return (a.spanCount || 0) - (b.spanCount || 0)
  return a.columnCount - b.columnCount
}

// 一个「多列」方案必须真的有卡片并排：合法布局里同一列的卡只会上下摞，
// 所以只要有两张卡的纵向区间重叠，它们就一定是并排的。一个都找不到，说明
// 整版只是单列竖排（典型：每张卡都跨满全部列）。这种方案要丢掉，否则它会
// 和真正的单列方案同高同分，再被「列数多」的排序规则挑中。
function hasSideBySide(placements) {
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]
      if (a.y < b.y + b.height && b.y < a.y + a.height) return true
    }
  }
  return false
}

function dropFakeColumns(layouts) {
  const real = layouts.filter(function (layout) {
    return layout.columnCount <= 1 || hasSideBySide(layout.placements)
  })
  return real.length ? real : layouts
}

function makeSolverContext(options) {
  const {
    heights,
    naturalWidths,
    W,
    T = TRACK_COUNT,
    gap = COLUMN_GAP,
    rowGap = ROW_GAP,
    maxColumns = 6,
    comfortMode = false,
    readWeight = 0.12,
    beamWidth = 28,
  } = options

  if (!W || !heights.length) return null

  const unit = trackUnit(W, gap, T)
  const minT = Math.max(2, Math.ceil((MIN_COL_WIDTH + gap) / (unit + gap)))
  const widthByTracks = new Float64Array(T + 1)
  for (let t = 1; t <= T; t++) widthByTracks[t] = widthOfTracks(t, W, gap, T)

  const targetWidths = naturalWidths.map(function (n) {
    return Math.max(MIN_COL_WIDTH, Math.min(COMFORT_COL_WIDTH, n, W))
  })
  const requiredTracks = targetWidths.map(function (w) {
    return tracksForWidth(w, W, gap, T)
  })

  const maxByWidth = Math.max(1, Math.floor((W + gap) / (MIN_COL_WIDTH + gap)))
  const columnLimit = Math.max(
    1,
    Math.min(maxColumns, Math.floor(T / minT), maxByWidth, heights.length),
  )

  return {
    ctx: {
      heights,
      W,
      T,
      gap,
      rowGap,
      unit,
      minT,
      widthByTracks,
      naturalWidths,
      targetWidths,
      requiredTracks,
      comfortMode,
      readWeight,
    },
    columnLimit,
    beamWidth,
  }
}

function bestForColumn(C, ctx, beamWidth) {
  const compositions = compositionCandidates(C, ctx)
  let bestC = null
  for (const tracks of compositions) {
    const result = evaluateBeam(tracks, ctx, beamWidth)
    if (result && (!bestC || cmpResult(result, bestC) < 0)) bestC = result
  }
  return bestC
}

export function buildMasonryLayouts(options) {
  const made = makeSolverContext(options)
  if (!made) return null
  const { ctx, columnLimit, beamWidth } = made

  const bestByColumnCount = []
  for (let C = 1; C <= columnLimit; C++) {
    const bestC = bestForColumn(C, ctx, beamWidth)
    if (bestC) bestByColumnCount.push(bestC)
  }

  // 列数从少到多：调用方在“高度充裕”时优先取列数少的方案。
  return dropFakeColumns(bestByColumnCount).sort(function (a, b) {
    return a.columnCount - b.columnCount
  })
}

// 每算完一个列数就让出主线程；调用方用 shouldCancel 丢弃已经过期的结果。
export async function buildMasonryLayoutsAsync(options, hooks = {}) {
  const made = makeSolverContext(options)
  if (!made) return null
  const { ctx, columnLimit, beamWidth } = made

  const bestByColumnCount = []
  for (let C = 1; C <= columnLimit; C++) {
    if (hooks.shouldCancel && hooks.shouldCancel()) return null
    const bestC = bestForColumn(C, ctx, beamWidth)
    if (bestC) bestByColumnCount.push(bestC)
    await yieldToIdle()
    if (hooks.shouldCancel && hooks.shouldCancel()) return null
  }

  return dropFakeColumns(bestByColumnCount).sort(function (a, b) {
    return a.columnCount - b.columnCount
  })
}

export function buildMasonryLayout(options) {
  const all = buildMasonryLayouts(options)
  if (!all || !all.length) return null
  return all.slice().sort(cmpResult)[0]
}

// 在隐藏容器里量每张卡：自然行宽（不折行需要多宽）+ 每个轨道宽度下的高度。
// cardElements 必须与 heights 的顺序一致。
export function measureCards(cardElements, W, options = {}) {
  const T = options.T || TRACK_COUNT
  const gap = options.gap ?? COLUMN_GAP
  const parent = options.parent || document.body
  if (!parent) return null

  const holder = document.createElement('div')
  holder.style.cssText =
    'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:visible;'
  parent.appendChild(holder)

  const entries = []
  try {
    // 先把所有克隆都挂上、统一设成 max-content，再一次性读自然宽。
    // 宽度-主序测量（先写所有卡、再读所有卡）把强制重排从 N×T 次压到 T 次。
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
      entries.push({ clone: clone, nowrapNodes: nowrapNodes, heights: new Float64Array(T + 1) })
    }

    // 同一帧里所有 clone 都是 max-content：一次布局就能量完全部自然宽
    for (const entry of entries) {
      if (!entry) continue
      let naturalWidth = Math.min(W, entry.clone.offsetWidth)
      if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) naturalWidth = W
      entry.naturalWidth = Math.max(120, naturalWidth)
      for (const [node, original] of entry.nowrapNodes) node.style.whiteSpace = original
    }

    for (let t = 1; t <= T; t++) {
      const width = widthOfTracks(t, W, gap, T) + 'px'
      for (const entry of entries) {
        if (entry) entry.clone.style.width = width
      }
      // 第一次 offsetHeight 触发一次布局，同一 t 下其余读数不再触发布局
      for (const entry of entries) {
        if (entry) entry.heights[t] = entry.clone.offsetHeight
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

// measureCards 的异步版：每量 batchSize 个轨道宽度就让出一次主线程。
// 编辑时它会慢一点，但不会占着输入/预览的主线程；调用方用 shouldCancel 丢弃过期结果。
export async function measureCardsAsync(cardElements, W, options = {}, hooks = {}) {
  const T = options.T || TRACK_COUNT
  const gap = options.gap ?? COLUMN_GAP
  const parent = options.parent || document.body
  const batchSize = options.batchSize || 6
  if (!parent) return null

  const holder = document.createElement('div')
  holder.style.cssText =
    'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:visible;'
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
      entries.push({ clone: clone, nowrapNodes: nowrapNodes, heights: new Float64Array(T + 1) })
    }

    for (const entry of entries) {
      if (!entry) continue
      let naturalWidth = Math.min(W, entry.clone.offsetWidth)
      if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) naturalWidth = W
      entry.naturalWidth = Math.max(120, naturalWidth)
      for (const [node, original] of entry.nowrapNodes) node.style.whiteSpace = original
    }

    await yieldToIdle()
    if (hooks.shouldCancel && hooks.shouldCancel()) return null

    for (let t = 1; t <= T; t++) {
      const width = widthOfTracks(t, W, gap, T) + 'px'
      for (const entry of entries) {
        if (entry) entry.clone.style.width = width
      }
      for (const entry of entries) {
        if (entry) entry.heights[t] = entry.clone.offsetHeight
      }
      if (t % batchSize === 0 && t < T) {
        await yieldToIdle()
        if (hooks.shouldCancel && hooks.shouldCancel()) return null
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
