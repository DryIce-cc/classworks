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
import { startHoverIdle, stopHoverIdle } from '@/utils/hoverIdle'

// 深色主题只在 plugins/vuetify.js 里定（defaultTheme: 'dark'），这里不再重复强制

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

onMounted(() => {
  document.addEventListener('contextmenu', onContextMenu, true)
  startHoverIdle()
})

onBeforeUnmount(() => {
  stopHoverIdle()
  document.removeEventListener('contextmenu', onContextMenu, true)
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
