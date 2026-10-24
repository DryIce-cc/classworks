// 作业区截图：把 DOM 原样交给浏览器再排一次版，拍成 PNG。
//
// 原理（modern-screenshot）：克隆目标节点 → 把每层元素算好的样式写成内联样式 →
// 连同样式塞进一个 <svg><foreignObject> → 浏览器把这段渲染成图片 → 画进 canvas。
// 排版还是浏览器自己算的，所以和屏幕上看到的是同一套结果。可能对不上的只有
// 克隆时拿不到的东西：外部字体/图片（本页没有）、伪元素（库会单独补一份）、
// 视口单位（只出现在工具栏，不在截图范围内），以及 :hover / 过渡这类瞬时状态
// （克隆里没有悬停，正好不会把鼠标正指着的那张卡带进图里）。
//
// 选它而不是 html-to-image 的原因：后者克隆样式时会把字号减 0.1px，行高跟着变，
// 卡片高度和每一行的位置会漂一两像素；实测这套 DOM 用它能做到逐像素一致，
// 代价是懒加载的那块脚本大约 10KB（gzip），只在第一次截图时下载。
//
// 写剪贴板必须赶在用户手势的有效期内完成，所以渲染这条路要尽量短：
// 不嵌入字体（本页没有网络字体），也不抓外部资源。

// 页面底色：卡片本身不画底色，截图得自己铺一层，不然 PNG 是透明的
const FALLBACK_BACKGROUND = '#121212'

function pageBackground() {
  const app = document.querySelector('.v-application')
  const color = app ? getComputedStyle(app).backgroundColor : ''
  // 拿不到或者拿到透明色时用兜底色（主题换过也不至于给一张透明底图）
  if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
    return FALLBACK_BACKGROUND
  }
  return color
}

// 把元素渲染成 PNG blob。
// 元素自己的外边距也在屏幕上占着版面（卡片区四周的留白），但它在盒子之外、
// 截图库不会带上；这里按实际外边距补一圈页面底色，看着才和页面上一样。
export async function captureElement(element) {
  if (!element) throw new Error('没有找到要截图的内容')

  // 字体没加载完就拍，换行可能和屏幕上不一样
  if (document.fonts?.ready) await document.fonts.ready

  const { domToCanvas } = await import('modern-screenshot')
  const style = getComputedStyle(element)
  const margin = {
    top: parseFloat(style.marginTop) || 0,
    right: parseFloat(style.marginRight) || 0,
    bottom: parseFloat(style.marginBottom) || 0,
    left: parseFloat(style.marginLeft) || 0,
  }
  const backgroundColor = pageBackground()
  // 按屏幕像素密度出图，贴到聊天软件里不糊；2 倍封顶，免得整页长图大到 canvas 存不下
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

  const rendered = await domToCanvas(element, {
    backgroundColor,
    // 本页没有网络字体：跳过字体嵌入，省掉一轮样式表抓取
    font: false,
    scale: pixelRatio,
    // 长图兜底：超过这个边长就整体缩小。不设的话 canvas 建不出来，
    // 会得到一张空白图（2 倍图下 8000 CSS px 高以内都还是原尺寸）
    maximumCanvasSize: 16000,
  })

  // 出图倍率按实际像素算（长图超过 canvas 上限时库会自动缩小）
  const cssWidth = element.getBoundingClientRect().width || element.clientWidth
  const scale = cssWidth ? rendered.width / cssWidth : pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = rendered.width + Math.round((margin.left + margin.right) * scale)
  canvas.height = rendered.height + Math.round((margin.top + margin.bottom) * scale)

  const context = canvas.getContext('2d')
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(rendered, Math.round(margin.left * scale), Math.round(margin.top * scale))

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('生成图片失败'))),
      'image/png',
    )
  })
}

// 给「日期 + 科目 + 作业全文」算一个稳定的哈希，供「已截图」标记判等。
// 用 FNV-1a（64 位 BigInt）：同步、不需要 Secure Context，碰撞概率对判断
// “内容是否变过”足够低。返回 16 位十六进制字符串
function fnv1a64(str) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

// 展示板当前可见内容的规范串再哈希。items 是 sortedItems（与截图取景一致）
export function hashBoard(items, dateString) {
  const parts = [dateString]
  for (const item of items) {
    parts.push(item.key, (item.segments || []).map((s) => s.content).join('\n'))
  }
  return fnv1a64(parts.join('\u0000'))
}

// 把图片写进剪贴板。浏览器不支持或被权限拒绝时抛错，由调用方提示用户
export async function copyImageToClipboard(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持图片剪贴板，请使用新版 Chrome / Edge')
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
  } catch (error) {
    // 权限被拒、非安全上下文（http）这两类给用户一句能看懂的话；其余原样抛
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      throw new Error('浏览器不允许写入剪贴板，请检查权限后重试')
    }
    throw error
  }
}
