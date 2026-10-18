// 瀑布流分列算法：只吃「每张卡片实测高度 + 列数」，吐「第几列放第几张卡片」。
// 不碰 DOM、不碰 Vue——量高度、写回布局那一步留在组件里（见 HomeworkGrid 的 updateLayout）。
// 卡片高度已经含了各自的卡片间距，所以一列的高度就是列内高度直接求和。

// 把卡片分到各列，返回列数组，每列是卡片在入参里的下标数组。
// heights 里的 undefined/null 表示「还没量到高度」：此时先按原始顺序取余分列，
// 保证每张卡都有位置、能被量到；等量全了自然会用 solveColumns 重排。
export function assignColumns(heights, columns) {
  const cols = Array.from({ length: columns }, () => [])
  if (!heights.length) return cols
  // 有卡片还没量到高度：先按序号取余分列，等量到了自然会重排
  if (heights.some((h) => h == null)) {
    heights.forEach((_, idx) => cols[idx % cols.length].push(idx))
    return cols
  }
  return solveColumns(heights, columns)
}

// 回溯求最优分列：先让最高的那一列尽量矮，再让各列挨得更齐，
// 最后才在同样高的方案里挑「卡片按科目顺序往下接在同一列」的那种。
// 四级比较依次是「最高列高 → 列高极差 → 列高方差 → 科目顺序」，
// 卡在第一级就不看后面几级，所以不会为了顺序去牺牲整体高度。
//
// 入参：heights 每张卡片的实测高度（已含卡片间距），columns 列数
// 出参：列数组，每列是卡片下标的数组；列按各列第一张卡片的科目顺序从左到右排
export function solveColumns(heights, columns) {
  const c = columns
  const n = heights.length
  const avg = heights.reduce((sum, h) => sum + h, 0) / c
  // 高度是量出来的整数，这个容差只为躲开浮点累加的零头
  const EPS = 1e-6
  // 搜索规模（科目数 × 列数）不大，但最坏情况仍有可能翻车；
  // 给个节点上限，超了就取搜索途中最好的那个，绝不卡住界面
  const budget = 250000

  // 四级比较。方差除以列数是同一个常数，不影响比较，省掉
  // 第四级是「科目顺序」：同样的高度方案有好几种时，挑卡片按科目顺序
  // 往下接在同一列的那种（第一科在最左列、第二科接着它下面，而不是跳到右边）。
  // 越靠前的卡片权重越大，所以「能接就接」压过「反正都一样高，随便分」
  const measure = (loads, assign) => {
    let max = 0
    let min = Infinity
    let variance = 0
    for (const load of loads) {
      if (load > max) max = load
      if (load < min) min = load
      variance += (load - avg) ** 2
    }
    let order = 0
    for (let i = 0; i < assign.length; i++) order += assign[i] * (n - i)
    return [max, max - min, variance, order]
  }
  const better = (a, b) =>
    a[0] < b[0] - EPS || (a[0] < b[0] + EPS && a[1] < b[1] - EPS) ||
    (a[0] < b[0] + EPS && a[1] < b[1] + EPS && a[2] < b[2] - EPS) ||
    (a[0] < b[0] + EPS && a[1] < b[1] + EPS && a[2] < b[2] + EPS && a[3] < b[3] - EPS)

  // 贪心解当上界：一份按原始顺序放最矮列，一份按高度降序放最矮列（更接近最优）
  const greedy = (order) => {
    const loads = new Array(c).fill(0)
    const assign = new Array(n).fill(-1)
    for (const i of order) {
      let target = 0
      if (i > 0) {
        for (let j = 1; j < c; j++) if (loads[j] < loads[target]) target = j
      }
      loads[target] += heights[i]
      assign[i] = target
    }
    return { loads, assign }
  }

  // 展示板上的第一科（语文）永远是左上角那张，先把它放进最左列，剩下的卡片再搜。
  // 不能靠「第一个开出来的列就是最左列」顺带钉住它：那样最高的那张卡片会被
  // 强行塞进语文那一列，卡片只能往上压，长卡片反而露不出来
  const rest = heights
    .map((_, i) => i)
    .filter((i) => i > 0)
    // 一样高的卡片按科目原顺序处理，不按索引顺序乱来
    .sort((a, b) => heights[b] - heights[a] || a - b)
  const m = rest.length
  const seq = heights.map((_, i) => i)
  const byHeight = greedy([0, ...rest])
  const inOrder = greedy(seq)
  let bestLoads = better(measure(byHeight.loads, byHeight.assign), measure(inOrder.loads, inOrder.assign)) ? byHeight : inOrder
  let bestScore = measure(bestLoads.loads, bestLoads.assign)
  let bestAssign = bestLoads.assign

  // 剩余卡片高度总和，用来判断「剩下的卡片总容量装不装得下」
  const suffix = new Array(m + 1).fill(0)
  for (let k = m - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + heights[rest[k]]
  const minLoad = (used) => {
    let min = Infinity
    for (let j = 0; j < used; j++) if (loads[j] < min) min = loads[j]
    return min
  }

  const loads = new Array(c).fill(0)
  loads[0] = heights[0]
  const assign = new Array(n).fill(-1)
  assign[0] = 0
  let left = budget
  let sum = heights[0]

  const search = (k, used) => {
    if (left-- <= 0) return
    if (k === m) {
      const score = measure(loads, assign)
      if (better(score, bestScore)) {
        bestScore = score
        bestAssign = assign.slice()
      }
      return
    }
    // 已经有列高过当前最优的最高列：后面只会更高，直接剪
    for (let j = 0; j < used; j++) if (loads[j] > bestScore[0] + EPS) return
    // 剩下的卡片就算塞满 c 列的余量也超了：塞不下，剪
    if (sum + suffix[k] > c * (bestScore[0] + EPS)) return
    const i = rest[k]
    const h = heights[i]
    // 列都用满了的话，最大的这张得先放得下才有可能
    if (used >= c && h > bestScore[0] - minLoad(used) + EPS) return

    // 各列没有区别，当前高度相同的列只试一个，免得同一批分配被枚举好几遍。
    // 最左列不算在内：语文在那儿，它跟别的列换不了位置
    const tried = []
    for (let j = 0; j < used; j++) {
      if (j > 0) {
        if (tried.includes(loads[j])) continue
        tried.push(loads[j])
      }
      if (loads[j] + h > bestScore[0] + EPS) continue
      loads[j] += h
      sum += h
      assign[i] = j
      search(k + 1, used)
      loads[j] -= h
      sum -= h
      assign[i] = -1
      if (left <= 0) return
    }
    // 开新列：语文之外各列之间没有区别，只开第一个空列
    if (used < c) {
      loads[used] = h
      sum += h
      assign[i] = used
      search(k + 1, used + 1)
      loads[used] = 0
      sum -= h
      assign[i] = -1
    }
  }
  search(0, 1)

  // 搜索里列是按「先开出来」的顺序编号的，列与列之间本来就没有区别，
  // 所以左右顺序由各列第一张卡片的科目顺序定下来（语文那列自然还在最左边）。
  // 卡片入列时是按原序推进的，每列第一张就是视觉上的最上面那张
  const cols = Array.from({ length: c }, () => [])
  for (let i = 0; i < n; i++) cols[bestAssign[i]].push(i)
  cols.sort((a, b) => (a.length ? a[0] : Infinity) - (b.length ? b[0] : Infinity))
  return cols
}
