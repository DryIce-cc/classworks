// 悬停只在鼠标动的时候存在：静止一秒就把 hover 效果收掉。
//
// 为什么：鼠标架在卡片上不动时 :hover 一直挂着（抬升、阴影、放大全在），
// 拍出来的静止画面看着像「有人正指着它」，展示时不对。而 :hover 是浏览器伪类，
// JS 取消不了，所以反过来——JS 只判断「鼠标是不是静止了」，静止就在 <html> 上
// 挂一个类；真正把样式收回去的写在 styles/index.scss（那边是逐条 hover 规则
// 配一份同值的非悬停覆盖）。鼠标一动就把类去掉，悬停当场回来。
//
// 抽成模块是为了让截图那边也能「立刻收掉悬停」：截图前强制进 idle，
// 免得把鼠标正指着的那张卡带进图里（见 forceHoverIdle）。
//
// 两处特意不做：
//   按住不放的时候不开始计时——不然按着按钮不动一秒，按下的效果会被收掉
//   触屏不启用——那边本来没有 hover

// 鼠标静止多久之后收掉悬停效果（一秒：展示时鼠标往往一动不动，待得久了卡片一直亮着）
const IDLE_HOVER_MS = 1000
// 收掉之后挂在这个类名上。真正的「退回非悬停」写在 styles/index.scss 里
const IDLE_CLASS = 'hw-hover-idle'

let idleTimer = 0
let pointerDown = false
let active = false

function armIdle() {
  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(onIdle, IDLE_HOVER_MS)
}

function onIdle() {
  // 按着的时候不算「静止」：那是用户捏着一个东西在等，不该把它松开
  if (pointerDown) {
    armIdle()
    return
  }
  document.documentElement.classList.add(IDLE_CLASS)
}

function onActivity() {
  if (document.documentElement.classList.contains(IDLE_CLASS)) {
    document.documentElement.classList.remove(IDLE_CLASS)
  }
  armIdle()
}

function onPointerDown() {
  pointerDown = true
  onActivity()
}

function onPointerUp() {
  pointerDown = false
  onActivity()
}

function onWindowLeave() {
  // 鼠标已经不在窗口里了，页面上本来就没有悬停，不用收
  pointerDown = false
  document.documentElement.classList.remove(IDLE_CLASS)
  window.clearTimeout(idleTimer)
}

// 只有真正有悬停的设备才启用
function supportsHover() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false
}

export function startHoverIdle() {
  if (!supportsHover()) return false
  active = true
  document.addEventListener('mousemove', onActivity, { capture: true, passive: true })
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onActivity, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerUp, true)
  document.addEventListener('mouseleave', onWindowLeave)
  armIdle()
  return true
}

export function stopHoverIdle() {
  active = false
  window.clearTimeout(idleTimer)
  document.documentElement.classList.remove(IDLE_CLASS)
  document.removeEventListener('mousemove', onActivity, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onActivity, true)
  window.removeEventListener('pointerup', onPointerUp, true)
  window.removeEventListener('pointercancel', onPointerUp, true)
  document.removeEventListener('mouseleave', onWindowLeave)
}

// 截图前强制收掉悬停：清掉待执行的计时器并挂上 idle 类，拍出来的一定不带 hover。
// 拍完调 resumeHoverIdle 恢复原样
export function forceHoverIdle() {
  if (!active) return
  window.clearTimeout(idleTimer)
  idleTimer = 0
  document.documentElement.classList.add(IDLE_CLASS)
}

export function resumeHoverIdle() {
  if (!active) return
  document.documentElement.classList.remove(IDLE_CLASS)
  armIdle()
}
