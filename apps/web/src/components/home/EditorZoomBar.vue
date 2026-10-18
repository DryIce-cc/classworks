<template>
  <!-- 缩放条。整个面板缩着看（见父级的 dialogZoomStyle），所以条不放在卡片里：
       卡片小到一定程度，右下角已经被键位和推荐面板占满了。
       Teleport 到 body 是必须的——Vuetify 自己的浮层容器上带 transform，
       position: fixed 在那样的祖先里会退化成 absolute，跟着卡片一起缩。
       数值记在应用设置里（editor.zoom），下回打开还是这个大小 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="editor-zoom" title="编辑框缩放" @mousedown.prevent @contextmenu.prevent>
        <v-slider
          :model-value="value"
          :min="min"
          :max="max"
          :step="5"
          density="compact"
          hide-details
          class="editor-zoom-slider"
          aria-label="编辑框缩放"
          @update:model-value="$emit('update:value', $event)"
        >
          <template #label>
            <span class="editor-zoom-value">{{ value }}%</span>
          </template>
        </v-slider>
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
    min: {
      type: Number,
      default: 50,
    },
    max: {
      type: Number,
      default: 100,
    },
  },
  emits: ['update:value'],
}
</script>

<style scoped>
/* 缩放条。整块钉在视口右下角，teleport 到 body（见模板里那段注释）——
   它管的是视口，不是卡片，卡片缩了它不能跟着缩。
   z-index 压在对话框浮层之上：对话框打开时它得能看见、能拖。
   刻意不给底色：整页本来就暗，一条没有底的细滑块贴着右下角就够了，
   加个底反而像多出来一块东西。淡入淡出走通用那套 .fade-*（见 transitions.scss） */
.editor-zoom {
  position: fixed;
  /* 右边距连滚动条那条槽一起让开：html 上 scrollbar-gutter: stable 给滚动条
     常驻预留了一条槽（见 styles/global.scss），fixed 的包含块是视口减掉这条槽，
     而 100vw 含槽，两者之差正好是槽宽。没滚动条时差为 0，位置照旧 */
  right: calc(16px + (100vw - 100%));
  bottom: 16px;
  z-index: 2600;
  width: 132px;
  /* 左右各留出半个拇指的位置：Vuetify 把拇指中心压在轨道两端，拇指会往外探出
     半个（约 10px）。不留的话滑到 100% 时拇指尖探到条外，正好被右下角那条
     滚动条压住。宽度走 border-box，留白从内容里让，条本身还是 132 */
  padding-inline: 10px;
}

.editor-zoom-slider {
  width: 100%;
}

/* 去掉 Vuetify 横向 slider 自带的 margin-inline:8px：它会把滑轨往右顶出 8px，
   拇指跟着再往右探 8px，上面那圈留白就白留了。选择器带上 .v-slider 提一档权重，
   跟 Vuetify 组件样式谁先加载无关 */
.editor-zoom-slider.v-slider {
  margin-inline: 0;
}

/* 百分比摆在滑块上，不是旁边另写一行。
   摆旁边的话数字一变宽（60% → 100%）滑轨就被挤短一截，
   滑到头的时候拇指会跟着跳一下，所以宽度给它定死 */
.editor-zoom-value {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
</style>
