<template>
  <v-app>
    <router-view v-slot="{ Component, route }">
      <transition mode="out-in" name="md3">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>
    <global-message />
  </v-app>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'

// 深色主题只在 plugins/vuetify.js 里定（defaultTheme: 'dark'），这里不再重复强制

// 鼠标静止多久之后收掉悬停效果（一秒：展示时鼠标往往一动不动，待得久了卡片一直亮着）
const IDLE_HOVER_MS = 1000
// 收掉之后挂在这个类名上。真正的「退回非悬停」写在 styles/index.scss 里
// （见那段注释）：JS 这边只管加类、去类
const IDLE_CLASS = 'hw-hover-idle'

// 全站禁用右键菜单，只留文本编辑框那一处。
//
// 为什么：触屏上长按弹出来的那一套（复制／粘贴／添加到主屏幕）占半屏，
// 而且松手的时候很容易把长按的那个按钮顺手触发一下——用户想长按一个按钮，
// 结果先糊了半屏菜单，一通乱点之后东西已经改了。想用右键菜单的地方只有正文，
// 那里留着（复制粘贴还要用）。
//
// 用 capture 阶段挂在 document 上：浮层、按钮挡在前面也照样掐得住，
// 而且不用给每个组件各绑一遍
function onContextMenu(event) {
  const target = event.target
  // 输入框、以及 contenteditable 的区域（用户自己可能加）：留着
  if (target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
  event.preventDefault()
}

// 悬停只在该动鼠标的时候存在
//
// 为什么要有这条：鼠标架在卡片上不动的时候，:hover 一直挂着（抬升、阴影、
// 放大全在），拍出来的静止画面看着像"有人正指着它"，展示时不对。
// 而 :hover 是浏览器的伪类，JS 取消不了——试过盖一层透明的接收层把指针全接走，
// 没用：浏览器不重新做命中测试，:hover 照样挂着，还顺手挡了点击。
//
// 所以只能反过来：JS 只负责判断"鼠标是不是静止了"，静止就在 <html> 上挂一个类；
// 真正把样式收回去的写在 styles/index.scss 那段里（那边是逐条 hover 规则
// 配一份同值的非悬停覆盖）。鼠标一动就把类去掉，悬停当场回来。
//
// 两处特意不做：
//   按住不放的时候不开始计时——不然按着按钮不动一秒，按下的效果会被收掉
//   触屏不启用——那边本来没有 hover
let idleTimer = 0
let pointerDown = false

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

onMounted(() => {
  document.addEventListener('contextmenu', onContextMenu, true)
  if (!supportsHover()) return
  document.addEventListener('mousemove', onActivity, { capture: true, passive: true })
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onActivity, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerUp, true)
  document.addEventListener('mouseleave', onWindowLeave)
  armIdle()
})

onBeforeUnmount(() => {
  window.clearTimeout(idleTimer)
  document.documentElement.classList.remove(IDLE_CLASS)
  document.removeEventListener('contextmenu', onContextMenu, true)
  document.removeEventListener('mousemove', onActivity, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onActivity, true)
  window.removeEventListener('pointerup', onPointerUp, true)
  window.removeEventListener('pointercancel', onPointerUp, true)
  document.removeEventListener('mouseleave', onWindowLeave)
})
</script>
<style>
@import '@/styles/index.scss';
@import '@/styles/transitions.scss';
@import '@/styles/global.scss';

.md3-enter-active,
.md3-leave-active {
  transition:
    opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.md3-enter-from {
  opacity: 0;
  transform: translateX(0.5vw);
}

.md3-leave-to {
  opacity: 0;
  transform: translateX(-0.5vw);
}
</style>
