// 拖拽排序里的纯几何计算：只吃数值和矩形，不碰 DOM、不碰组件状态。
// 指针事件怎么起、怎么收、什么时候换位置，留在组件的编排里。

// 值到 [start, start + size) 这一段的距离，落在段内就是 0
export function bandDistance(value, start, size) {
  return value < start ? start - value : value > start + size ? value - (start + size) : 0
}

// 就近取一个分段，返回它的 start。指针落在两段之间的空隙里时也不会在两者间反复横跳
export function nearestBand(value, bands) {
  let best = bands[0].start
  let bestDistance = Infinity
  for (const band of bands) {
    const distance = bandDistance(value, band.start, band.size)
    if (distance > bestDistance) continue
    bestDistance = distance
    best = band.start
  }
  return best
}

// 命中测试：把指针落到网格的哪一格（第几行、第几列），这一格在数组里就是唯一的一个
// 下标，于是无论指针怎么在格子里抖，答案都只有一个，位置就不会来回跳。
// 早先的写法是「就近认一张卡片」，行与行之间的空隙里，上一张算出「插它后面」、
// 下一张算出「插它前面」，两个下标差着一整段，指针一晃位置就被来回甩。
//
// 入参：
//   x / y 指针坐标，相对网格左上角
//   cells [{ uid, left, top, width, height }]，量的是 offsetLeft/offsetTop 这些布局值，
//         不含 TransitionGroup 让位时挂的 transform——量矩形会量到动画中途的位置，插入位置跟着乱跳
//   uids  科目数组当前的 uid 顺序（用来把 uid 换回下标）
//   from  被拖那张在数组里的下标
// 返回插进「去掉被拖那张」的数组里的下标；算不出来返回 null
export function hitTest(x, y, cells, uids, from) {
  if (!cells.length) return null

  // 行按顶边归并，同一行取最高的当行高（有科目挂了附加科目名，卡片高度不一样）
  const rowTops = [...new Set(cells.map((c) => c.top))].sort((a, b) => a - b)
  const rowHeight = (top) =>
    Math.max(...cells.filter((c) => c.top === top).map((c) => c.height))
  // 列宽一律相等（grid 用的 minmax(210px, 1fr)），量第一张的宽度就够
  const colLefts = [...new Set(cells.map((c) => c.left))].sort((a, b) => a - b)
  const colWidth = cells.find((c) => c.left === colLefts[0]).width

  // 指针落在哪一行、哪一列。空隙里就近取一个，免得边界上来回跳
  const row = nearestBand(y, rowTops.map((top) => ({ start: top, size: rowHeight(top) })))
  const col = nearestBand(x, colLefts.map((left) => ({ start: left, size: colWidth })))

  const indexOf = (uid) => uids.indexOf(uid)
  const rowCells = cells.filter((c) => c.top === row).sort((a, b) => a.left - b.left)
  // 下一行头一张卡片的数组下标，也就是「这一行后面」这个位置；已经是最后一行就是数组末尾
  const nextRowIndex = () => {
    const next = cells.filter((c) => c.top > row).map((c) => indexOf(c.uid))
    return next.length ? Math.min(...next) : uids.length
  }
  // 「排在某张之后」的下标，就是它右边（下一行）那张卡片的数组下标
  const afterCell = (cell) => {
    const next = rowCells[rowCells.indexOf(cell) + 1]
    return next ? indexOf(next.uid) : nextRowIndex()
  }

  // 末行可能不满格，落在空着的那一列就插到行尾
  const cell = rowCells.find((c) => c.left === col)
  let at = nextRowIndex()
  if (cell) {
    at = x > cell.left + cell.width / 2 ? afterCell(cell) : indexOf(cell.uid)
  }
  if (at < 0) return null

  // at 是「含被拖那张」的下标，插进掉它的数组要减一格
  return at > from ? at - 1 : at
}
