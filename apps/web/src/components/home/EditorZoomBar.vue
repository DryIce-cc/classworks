<template>
  <!-- 缩放条。整个面板缩着看（见父级的 dialogZoomStyle），所以条不放在卡片里：
       卡片小到一定程度，右下角已经被键位和推荐面板占满了。
       Teleport 到 body 是必须的——Vuetify 自己的浮层容器上带 transform，
       position: fixed 在那样的祖先里会退化成 absolute，跟着卡片一起缩。
       数值记在应用设置里（editor.zoom），下回打开还是这个大小 -->
  <Teleport to="body">
    <Transition name="fade">
      <!-- 焦点一律不许落进来：调缩放不该把光标从正文带走。
           滑块本来是可聚焦的（role="slider"），这里从根上把它踢出 tab 序，
           指针按下去浏览器也就挪不走焦点了（父级那条 keepFocusDuringZoom 兜底） -->
      <div
        v-if="visible"
        class="editor-zoom"
        @mousedown.prevent
        @touchstart.prevent
        @contextmenu.prevent
      >
        <span class="editor-zoom-value">编辑框缩放 {{ value }}%</span>
        <v-slider
          v-model="sliderValue"
          :min="50"
          :max="100"
          :step="10"
          density="compact"
          hide-details
          tabindex="-1"
          hide-spin-buttons
          class="editor-zoom-slider"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script>
// 缩放条只是 editorZoom 的一个遥控器：值由父级持有（应用设置里那份），
// 拖动时把新值报回去，夹范围和写设置都在父级，这里不记任何状态
export default {
  name: 'EditorZoomBar',
  props: {
    // 面板开着才摆出来
    visible: {
      type: Boolean,
      default: false,
    },
    // 当前缩放百分比
    value: {
      type: Number,
      default: 100,
    },
  },
  emits: ['update:value'],
  computed: {
    sliderValue: {
      get() {
        return this.value
      },
      set(next) {
        this.$emit('update:value', next)
      },
    },
  },
}
</script>

<style scoped>
/* 缩放条。整块钉在视口右下角，teleport 到 body（见模板里那段注释）——
   它管的是视口，不是卡片，卡片缩了它不能跟着缩。
   z-index 压在对话框浮层之上：对话框打开时它得能看见、能拖。
   不加底色，一条细滑块贴着右下角就够了。
   淡入淡出走通用那套 .fade-*（见 transitions.scss） */
.editor-zoom {
  position: fixed;
  /* 右边距连滚动条那条槽一起让开：html 上 scrollbar-gutter: stable 给滚动条
     常驻预留了一条槽（见 styles/global.scss），fixed 的包含块是视口减掉这条槽，
     而 100vw 含槽，两者之差正好是槽宽。没滚动条时差为 0，位置照旧 */
  right: calc(16px + (100vw - 100%));
  bottom: 16px;
  z-index: 2600;
  display: flex;
  align-items: center;
  gap: 14px;
  /* 定宽：百分比位数变化时滑轨不跟着伸缩 */
  width: 180px;
  box-sizing: border-box;
}

/* 定宽 + 等宽数字，70% 和 100% 切换时右侧滑轨纹丝不动 */
.editor-zoom-value {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  white-space: nowrap;
}

/* 露头时机和过渡长度都跟「点击任意位置完成编辑」那句用同一组变量：
   一起等面板停稳，再一起慢慢淡进来；关的时候也一起淡出去 */
.editor-zoom.fade-enter-active {
  transition: opacity var(--motion-slogan-in) var(--ease-standard) var(--motion-slogan-delay);
}

.editor-zoom.fade-leave-active {
  transition: opacity var(--motion-slogan-out) var(--ease-accelerate);
}

</style>
