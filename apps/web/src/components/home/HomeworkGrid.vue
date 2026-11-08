<template>
  <!-- 作业卡片区在上、底部那排「添加作业」在下。纵向 flex + 后者的 margin-top:auto，
       作业不满一屏时后者就贴在视口底边（见 styles/index.scss 的 .empty-subjects） -->
  <div
    class="grid-body"
    :class="{ 'grid-body-pending': bodyHidden, 'grid-resizing': resizing, 'grid-live': paused }"
  >
    <!-- 作业卡片：绝对定位，x/y/宽/高由求解器算好、直接写进 inline style。
       列数只按窗口宽度分档，不看设备类型。
       首屏还没量好之前整块藏着，免得先摆一版临时位置再瞬移 -->
    <div
      ref="gridContainer"
      class="grid-masonry"
      :class="{ 'grid-initial': !layoutReady }"
      :style="gridStyle"
    >
      <!-- 只留一个 TransitionGroup：换列时卡片 key 不从一组挪到另一组，
           换位就是同一批节点改位置，不会演成「离场 + 入场」的残影 -->
      <TransitionGroup name="grid" @before-leave="holdLeavingBox">
        <div
          v-for="item in sortedItems"
          :key="item.key"
          class="grid-item"
          :class="{ 'grid-item-unplaced': !isPlaced(item) }"
          :data-key="item.key"
          :style="itemStyle(item)"
        >
          <v-card
            border
            class="hw-card"
            height="100%"
            rounded="md"
            @click="openCard(item, $event)"
          >
            <!-- 科目名独占一行，小标题按段落正常单独显示。
                 这一行没有自己的点击处理，冒泡到卡片上：不带日期进编辑面板，
                 也就是跟着展示板正在看的那天（正常情况下就是今天） -->
            <v-card-title class="hw-card-title" :style="contentStyle">
              <span class="hw-card-subject">{{ item.name }}</span>
              <!-- 首行就是 # 行时并到科目名后面，不单独占一行；日期/标题名的颜色和字号
                   跟正文里的小标题完全一致 -->
              <span v-if="titleHeading(item)" class="segment-label hw-card-heading">
                <span class="label-name">
                  <span v-if="titleHeading(item).day" class="label-date">{{ titleHeading(item).day }}</span>{{ titleHeading(item).gap + titleHeading(item).title }}
                </span>
              </span>
            </v-card-title>
            <v-card-text :style="contentStyle" class="hw-card-text">
              <!-- 一天一区：同一天的那几段（正文按空行、小标题分的段）和它们之间的
                   分隔线都算在这一区里，点哪儿都进那一天。跨天的那条分隔线归新的一天，
                   不然点它会掉到卡片上、进今天。区外的卡片留白仍旧冒泡给卡片 -->
              <div
                v-for="(day, di) in buildDays(item)"
                :key="di"
                class="hw-day"
                @click.stop="openDay(item, day, $event)"
              >
                <template v-for="(block, bi) in day.blocks" :key="bi">
                  <v-divider v-if="di > 0 || bi > 0" class="hw-divider" />
                  <!-- 日期有、或者这段有自定义小标题，就出小标题：后面的日子光有正文也是要出
                       「明天的作业」的，别因为没有自定义小标题就把它吞了。
                       日期那几个字刷黄（编辑框里也是黄的，两边看齐），标题名跟正文一样颜色 -->
                  <div v-if="!block.inTitle && (day.date || block.custom)" class="segment-label">
                    <span class="label-date">{{ day.date }}</span>
                    <span class="label-de">{{ day.date ? '的' : '' }}</span>
                    <span class="label-name">
                      <span v-if="block.day" class="label-date">{{ block.day }}</span><span :class="{ 'label-date': !block.custom }">{{ block.title }}</span>
                    </span>
                  </div>
                  <div class="hw-paragraph">
                    <!-- 悬挂只给有序号的行：序号占一格、文本悬挂缩进，折行对齐到序号后面；
                         没序号的行走普通的、顶格，不占格 -->
                    <div
                      v-for="(line, ti) in block.lines"
                      :key="ti"
                      class="hw-line"
                      :class="{ 'hw-line-num': line.number && !block.hideNumber }"
                      :style="line.number && !block.hideNumber ? { '--hw-line-num-col': `${line.col}em` } : null"
                    ><span v-if="line.number && !block.hideNumber" class="hw-num">{{ line.number }}.</span>{{ line.text }}</div>
                  </div>
                </template>
              </div>
            </v-card-text>
          </v-card>
        </div>
      </TransitionGroup>
    </div>

    <!-- 可添加作业的科目：尚无内容的直接开始填。下边距留在上面那块（.grid-masonry），
         这边的上外边距空出来给 margin-top:auto，见 styles/index.scss -->
    <div ref="emptySubjects" class="empty-subjects">
      <div class="empty-subjects-grid">
        <!-- 这里不能加 tag：TransitionGroup 默认渲染成片段，卡片直接当 .empty-subjects-grid
             的子元素 participating 网格排布；套一层 div 就只剩一个子元素，会排成竖排 -->
        <TransitionGroup
          name="v-list"
          @before-leave="holdLeavingBox"
        >
          <v-card
            v-for="subject in addableSubjects"
            :key="subject.name"
            :data-key="subject.name"
            border
            rounded="md"
            class="empty-subject-card"
            @click="openAddDialog(subject, $event)"
          >
            <v-card-title class="text-subtitle-1">
              {{ subject.name }}
            </v-card-title>
            <v-card-text class="text-center">
              <v-icon color="grey" size="small"> mdi-plus </v-icon>
              <div class="text-caption text-grey">点击添加作业</div>
            </v-card-text>
          </v-card>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<script>
import { holdLeavingBox } from '@/utils/domHold'
import { splitContent } from '@/utils/homeworkList'
import { parseHeadingLine } from '@/utils/homeworkReserve'
import { isBodyLine, isHeadingLine } from '@/utils/homeworkText'
import { captureElement } from '@/utils/screenshot'
import {
  buildMasonryLayout,
  columnsForWidth,
  fillSpanHoles,
  measureCardsAsync,
  COLUMN_GAP,
  ROW_GAP,
} from '@/utils/masonry'

// 「点击添加作业」卡片露在视野里又没人理，3s 后就把它上滑出去
const IDLE_SCROLL_DELAY = 3000
// 标题行判定走文本层的 isHeadingLine，展示板这边不再另写一份正则

// 一个序号占多宽（单位 em）。数字按等宽数字估（0.62em），句点那一位加上（0.42em）。
// 这只是个估算，跟正文字体对不上是常态：宁可让框比字宽一点，
// 也不能让序号折行——序号一折，整行高度翻倍，看着就成了「序号和正文换了行」
function numColEm(number) {
  return String(number).length * 0.62 + 0.42
}

export default {
  name: 'HomeworkGrid',
  props: {
    sortedItems: { type: Array, required: true },
    // 尚无内容的科目
    addableSubjects: { type: Array, required: true },
    contentStyle: { type: Object, default: () => ({}) },
    // 作业编辑面板开着时页面不能动，自动上滑也一并停掉
    paused: { type: Boolean, default: false },
    // 当天作业和科目表都读完了才放行；此前整块卡片（含「添加作业」）不露面
    ready: { type: Boolean, default: true },
    // 当前展示的日期。按天缓存布局，切回看过的某天时先直接用缓存，
    // 再在后台重算校正（缓存只在内存里，不落盘）
    dayKey: { type: String, default: '' },
  },
  emits: ['open-dialog'],
  data() {
    return {
      // 布局版本号：卡片占的行数变化时才 +1，避免量高度触发无限重渲染
      layoutVersion: 0,
      // 窗口宽度（px）。只按宽度决定列数，窗口一变就重算
      layoutWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
      // 首屏是否已经分好列并量完高度。没量完之前 opacity 为 0，
      // 不能先露一版临时摆法再重排
      layoutReady: false,
      // 拖窗口/缩放期间为 true：几何全部直接到位，不追着窗口边缘慢慢爬；
      // 视口宽度变了的那版求解落地后自动恢复过渡
      resizing: false,
    }
  },
  created() {
    // 求解结果的列宽、每张卡的 grid 位置（非响应式，靠 layoutVersion 触发重算）
    this._layout = null
    this._layoutSignature = ''
    this._layoutTimer = 0
    // 每次真正开算时递增；卸载时也递增，用来丢弃未完成的结果
    this._layoutToken = 0
    // 每次内容变化递增；用来判断算完后是否还要补算
    this._layoutRequest = 0
    // 同一时间只允许一份测量/求解
    this._layoutRunning = false
    // 有内容变化但还没重算
    this._layoutDirty = false
    // 上一版布局对应的每张卡内容签名，编辑预览据此判断哪张卡变了。
    // 只拿来和本次内容比，不参与完整求解的签名。
    this._fastSignatures = new Map()
    // 按展示日期缓存布局：某天算过一次后，切回该天先复用，再后台校正。
    // 只活在当前页面实例里，刷新即清空
    this._layoutCache = new Map()
    this._layoutDayKey = null
    // 待执行的自动上滑的定时器
    this._scrollTimer = 0
    // 首屏等动画收尾的 rAF 句柄
    this._revealRaf = 0
    // 上一次渲染时已经落位的卡片 key：首次落位的那一帧不加过渡，
    // 免得新卡从左上角滑到自己的格子
    this._placedBefore = new Set()
    // 拖窗口时关过渡的收尾帧；视口求解落地后画完这一帧再恢复
    this._resizeRaf = 0
    // 上一次完整求解用的容器宽度。新结果宽度不同，说明是视口变化引起的
    this._solvedW = 0
    // 列结构动画的截止时间：这之前新的拖拽事件不要再关横向过渡
    this._structuralUntil = 0
  },
  computed: {
    // 列宽和每张卡的位置写进内联样式：卡片全部绝对定位，
    // 位置和尺寸都由布局给出，视口缩放时一起过渡
    gridStyle() {
      void this.layoutVersion
      const layout = this._layout
      // 卡片全部绝对定位，不参与文档流：高度由布局给出，空板时收成 0
      if (!layout || !layout.placements?.size || !this.sortedItems?.length) {
        return { height: '0px' }
      }
      return { height: `${Math.ceil(layout.max || 0)}px` }
    },
    // 整块只在首屏量好前隐形。换日期/增删卡不藏整块：
    // 旧卡留在原位，新数据到了逐张换位，避免整块淡出再淡入
    bodyHidden() {
      return !this.layoutReady
    },
    // 每张卡各段正文的解析结果（按段切开），buildDays 共用这一份。
    // buildDays 在模板里逐帧调用，各解析一遍等于每帧白算一次；
    // 这里用 computed 缓存：依赖 sortedItems（含各卡的 segments.content），
    // 正文一变自然失效重算，不会读到上一版内容。
    // key 用卡片对象本身而不是 item.key，同一科目出现两张卡时也不会互相串
    parsedCards() {
      const parsed = new Map()
      for (const item of this.sortedItems || []) {
        parsed.set(
          item,
          (item.segments || []).map((segment) => this.parseParagraphs(segment.content)),
        )
      }
      return parsed
    },
  },
  mounted() {
    // 首屏量一次（异步测量 + 求解，不阻塞首屏交互）
    this.scheduleLayout(0)
    // 字体后加载会改变卡片高度，加载完再平衡一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        this._layoutSignature = ''
        this.scheduleLayout(0)
      })
    }
    window.addEventListener('scroll', this.handleViewportChange, { passive: true })
    window.addEventListener('resize', this.handleWindowResize, { passive: true })
    // 捕获阶段，用户碰一下就撤销待执行的上滑
    document.addEventListener('pointerdown', this.cancelIdleScroll, true)
    this.armIdleScroll()
  },
  updated() {
    // 换天时先把这一天上次算好的布局取出来，卡片立刻有位可站；
    // 取不到才让下面的近似逻辑兜底（此时旧布局不属于新的一天，不能套用）
    this.restoreCachedLayout()
    if (this._layoutDayKey === this.dayKey && this._layout) {
      // 任何变化都分两步：先立刻上一版便宜的近似（宽度变了按比例缩列宽，
      // 正文变了按现有列位撑/收卡片），真正的测量求解随后在后台异步跑。
      // 编辑面板开着也照常算，输入不被阻塞，也不需要等到编辑结束。
      this.applyQuickResize()
      this.applyFastPreview()
      this.cacheCurrentLayout()
    }
    this.scheduleLayout(this.paused ? 0 : 140)
    // 卡片增减会改变视野里的那一段，重新判断要不要计时
    this.armIdleScroll()
    // 这一帧已经落位的卡片，下一次渲染时不再当作“首次落位”
    this.syncPlacedKeys()
  },
  beforeUnmount() {
    this.cancelIdleScroll()
    window.clearTimeout(this._layoutTimer)
    this._layoutToken++
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf)
    cancelAnimationFrame(this._revealRaf)
    window.removeEventListener('scroll', this.handleViewportChange)
    window.removeEventListener('resize', this.handleWindowResize)
    document.removeEventListener('pointerdown', this.cancelIdleScroll, true)
  },
  watch: {
    // 日期一变，在子组件重新渲染之前就把缓存布局换上，
    // 避免新一天的卡片先以「未定位」状态闪一帧
    dayKey() {
      this.restoreCachedLayout()
    },
    // 数据读完再量一遍，量稳了才放行首屏
    ready(value) {
      if (!value) {
        this.layoutReady = false
        return
      }
      this.scheduleLayout(0)
    },
    paused(value) {
      if (value) {
        this.cancelIdleScroll()
        return
      }
      // 面板关掉了：立即补算一次，再重新判断要不要计时
      this.scheduleLayout(0)
    },
  },
  methods: {
    // 页面滚了或窗口变了：先撤销待执行的上滑（人已经自己在动了），
    // 再按当前位置重新判断，所以计时总是从「最后一次动静」算起
    handleViewportChange() {
      this.cancelIdleScroll()
      this.armIdleScroll()
    },

    // 窗口宽度变化：按旧列数等比拉伸列宽、同步重摞卡片（实时预览），
    // 同时立刻排一次完整求解。预览当场直接到位；随后落地的那版求解
    // 如果也是宽度变化引起的，同样直接摆放，不补 280ms 动画。
    handleWindowResize() {
      if (window.innerWidth === this.layoutWidth) {
        this.handleViewportChange()
        return
      }
      // 上一次求解排的“恢复过渡”还没执行就先取消，免得拖到一半被它放开
      if (this._resizeRaf) {
        cancelAnimationFrame(this._resizeRaf)
        this._resizeRaf = 0
      }
      this.layoutWidth = window.innerWidth
      // 正在做列结构动画时不要重新关掉横向/宽度过渡，否则动画刚起步
      // 就被下一次预览取消，卡片会直接跳到目标列再动
      this.resizing = performance.now() >= this._structuralUntil
      this.applyQuickResize()
      this.applyFastPreview(true)
      this.scheduleLayout(0)
      this.handleViewportChange()
    },

    // 视口引起的这版布局已经摆好，画完这一帧再恢复过渡；
    // 连续拖窗口时下一帧就会被 handleWindowResize 重新关掉
    releaseResizing() {
      if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf)
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = requestAnimationFrame(() => {
          this._resizeRaf = 0
          this.resizing = false
        })
      })
    },

    // 异步排期：同一时间只跑一份计算，算完先应用这份（实时预览），
    // 如果算的过程中又来了输入，再立刻补算最新内容。旧结果不会堵住新结果。
    scheduleLayout(delay = 140) {
      this._layoutDirty = true
      this._layoutRequest++

      // 正在算：不打断，算完自动补算最新内容
      if (this._layoutRunning) return

      // 已有排期：不重置计时，保证连续输入时也能按节奏刷新
      if (delay > 0 && this._layoutTimer) return
      if (delay <= 0) {
        window.clearTimeout(this._layoutTimer)
        this._layoutTimer = 0
      }

      const run = () => {
        this._layoutTimer = 0
        if (this._layoutRunning) return
        const token = ++this._layoutToken
        const request = this._layoutRequest
        this._layoutRunning = true
        this.$nextTick(() => {
          this.updateLayout(token, request)
            .then((changed) => {
              this._layoutRunning = false
              if (token !== this._layoutToken) return
              if (changed) this.armIdleScroll()
              if (this.ready) this.revealWhenSettled()
              // 只有本轮计算期间又来了新请求才补算，避免空数据时 0ms 自循环
              if (this._layoutDirty && this._layoutRequest !== request) this.scheduleLayout(0)
            })
            .catch(() => {
              this._layoutRunning = false
            })
        })
      }

      this._layoutTimer = window.setTimeout(run, Math.max(0, delay))
    },

    // 已经在计时就别重置，否则每次重排都会把上滑往后顺延一次
    armIdleScroll() {
      if (this._scrollTimer || this.paused || !this.shouldHideEmptySubjects()) return
      this._scrollTimer = window.setTimeout(() => {
        this._scrollTimer = 0
        this.hideEmptySubjects()
      }, IDLE_SCROLL_DELAY)
    },

    cancelIdleScroll() {
      if (this._scrollTimer) window.clearTimeout(this._scrollTimer)
      this._scrollTimer = 0
    },

    // 底部这张卡片：还没有内容的科目从这儿进来
    openAddDialog(subject, event) {
      this.$emit('open-dialog', subject.name, { origin: this.cardRect(event) })
    },

    // 点展示卡片（标题区、留白）：不带日期，跟当前看的那天走
    openCard(item, event) {
      this.$emit('open-dialog', item.key, { origin: this.cardRect(event) })
    },

    // 交给编辑面板做「从这张卡片长出来」的起点。用普通对象，
    // 跨组件传的只是四个数，不用把 DOMRect 带过去
    cardRect(event) {
      const card = event?.currentTarget?.closest?.('.empty-subject-card, .grid-item')
      if (!card) return null
      const rect = card.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    },

    // 还没量到位置（刚加进来、还没落位）的卡片先隐形，等布局算好再露面
    isPlaced(item) {
      void this.layoutVersion
      return !!this._layout?.placements?.has(item.key)
    },

    // 布局里卡片的横向坐标只存 col/span，px 在渲染时按当前列宽换算：
    // 视口实时拉伸列宽、求解结果落地都不用改 placement，两边共用一套列坐标
    placementBox(layout, placement) {
      const columns = layout?.columns || []
      if (!columns.length) return { x: 0, width: 0 }
      const col = Math.max(0, Math.min(placement.col, columns.length - 1))
      const span = Math.max(1, Math.min(placement.span, columns.length - col))
      let width = columns[col].width
      for (let k = col + 1; k < col + span; k++) {
        width += (layout.gap || 0) + columns[k].width
      }
      return { x: columns[col].x, width }
    },

    // 卡片在网格里的显式位置：列、跨几列、从第几行开始、跨几行。
    // 行高 1px、row-gap 0，所以行号就是像素；卡片之间的 11px 由求解器的 y 留出。
    // 起止都往上取整，保证前一张的底不会压到后一张的头。
    itemStyle(item) {
      void this.layoutVersion
      const layout = this._layout
      const placement = layout?.placements?.get(item.key)
      if (!placement) return {}
      const box = this.placementBox(layout, placement)
      const start = Math.ceil(placement.y)
      const end = Math.max(start + 1, Math.ceil(placement.y + placement.height))
      // 为填平跨列卡上方的洞而多出来的高度，落到卡片底部内边距上；
      // 卡片外框仍然正好占满给它的高度，卡与卡之间保持统一的 11px
      const stretch = Math.max(
        0,
        placement.height - (placement.naturalHeight != null ? placement.naturalHeight : placement.height),
      )
      const style = {
        left: `${box.x}px`,
        top: `${start}px`,
        width: `${box.width}px`,
        height: `${end - start}px`,
        '--hw-stretch': `${stretch}px`,
      }
      // 首次落位的这一帧直接落在最终位置，不要从左上角滑过来；
      // 下一帧起恢复正常过渡
      if (!this._placedBefore.has(item.key)) style.transition = 'none'
      return style
    },

    // 记下这一帧已经落位的卡片，供下一次渲染判断哪些是首次落位。
    // 从 DOM 读而不是从 _layout 读：updated 里可能已经算好新布局但还没渲染
    syncPlacedKeys() {
      const container = this.$refs.gridContainer
      const keys = new Set()
      if (container) {
        container.querySelectorAll('.grid-item[data-key]').forEach((el) => {
          if (!el.classList.contains('grid-item-unplaced')) keys.add(el.dataset.key)
        })
      }
      this._placedBefore = keys
    },

    // 离场卡片钉在原位（实现见 utils/domHold，与设置页共用同一份）
    holdLeavingBox,

    // 点卡片上某一天的那一块：直接进那一天，不用先进今天再自己往前翻。
    // 卡片冒泡上来的那次点击（标题区、卡片留白）不带日期，走的是另一条路
    openDay(item, day, event) {
      if (!day?.dateString) return
      this.$emit('open-dialog', item.key, { date: day.dateString, origin: this.cardRect(event) })
    },

    // 截图取景范围只到卡片区：不含底部那排「添加作业」，也不含顶部工具栏。
    // 截图方法由页面去调，这里只把 DOM 节点交出去
    captureCards() {
      return captureElement(this.$refs.gridContainer)
    },

    // 「点击添加作业」卡片还露在视野里、且页面没滑到顶，就该把它上滑出去
    shouldHideEmptySubjects() {
      const el = this.$refs.emptySubjects
      if (!el || !this.addableSubjects?.length) return false
      if (window.scrollY <= 0) return false
      const rect = el.getBoundingClientRect()
      // 上下都出了视野都不算「显示在可视区域」
      return rect.bottom > 0 && rect.top < window.innerHeight
    },


    // 往页首方向滚时，内容整体是往下移的，所以是把整块卡片区推出视口下沿。
    // 要滚的距离超过剩下的高度，就只能到页首为止。
    hideEmptySubjects() {
      const el = this.$refs.emptySubjects
      // 这 3s 里情况可能已经变了（卡片被填掉、页面被滚回顶），到点再确认一次
      if (!el || !this.shouldHideEmptySubjects()) return
      const distance = Math.min(window.scrollY, window.innerHeight - el.getBoundingClientRect().top)
      if (distance <= 0) return
      // 交给原生的平滑滚动：时长和曲线由浏览器定，但各环境表现一致，
      // 自己用 rAF 一步步挪反而容易碰上 behavior: 'instant' 不被支持而整段失效
      window.scrollTo({ top: window.scrollY - distance, behavior: 'smooth' })
    },

    // 首屏放行：分列稳定还不够，入场/退场/换位动画也得收尾，
    // 否则整块刚淡入时旧节点还在，露出来就是「闪一下再少几张」
    revealWhenSettled() {
      if (!this.ready || this.layoutReady) return
      const container = this.$refs.gridContainer
      if (!container) return
      const busy = container.querySelector('.grid-enter-active, .grid-leave-active, .grid-move')
      if (busy) {
        cancelAnimationFrame(this._revealRaf)
        this._revealRaf = requestAnimationFrame(() => this.revealWhenSettled())
        return
      }
      this.layoutReady = true
    },

    // 内容/宽度没变就不重算。签名只看会影响高度的输入，
    // 避免 layoutVersion++ 引起的 updated 再算一遍，形成死循环。
    layoutSignature(W) {
      const items = this.sortedItems || []
      const content = items
        .map((item) => {
          const segments = item.segments || []
          return (
            item.key +
            ':' +
            (item.name || '') +
            ':' +
            segments.map((segment) => segment.content || '').join('\u0001')
          )
        })
        .join('\u0002')
      const style = this.contentStyle ? JSON.stringify(this.contentStyle) : ''
      return `${W}|${style}|${content}`
    },

    // 这次求解有没有改动列结构：列数变了，或某张卡换了列、跨列数变了。
    // 只变 y/高度不算——那种情况横向没动，纵向过渡是正常的重排。
    layoutStructureChanged(placements, columns) {
      const layout = this._layout
      if (!layout || !layout.columns || !placements) return false
      if (!columns || columns.length !== layout.columns.length) return true
      for (const [key, next] of placements) {
        const prev = layout.placements.get(key)
        if (!prev || prev.col !== next.col || prev.span !== next.span) return true
      }
      return false
    },

    // 宽度变了先做便宜的实时预览：列数不动，列宽按旧宽度占比等比拉伸。
    // 卡片横向位置由 col/span 在渲染时按当前列宽换算，这里只改列宽，
    // 所以下一帧宽度、高度、top 就能一起到位；列数/跨列的调整交给
    // 后台实时求解，算成一份就立刻换上。
    applyQuickResize() {
      const layout = this._layout
      const container = this.$refs.gridContainer
      if (!layout || !container || !layout.columns || !layout.columns.length) return false
      const W = Math.round(container.clientWidth)
      if (!W || W === layout.W) return false
      const gap = layout.gap
      const totalOld = layout.columns.reduce((sum, col) => sum + col.width, 0)
      const totalNew = W - gap * (layout.columns.length - 1)
      if (totalOld <= 0 || totalNew <= 0) return false

      let x = 0
      const columns = layout.columns.map((col) => {
        const width = (col.width / totalOld) * totalNew
        const next = { ...col, x, width }
        x += width + gap
        return next
      })

      this._layout = { ...layout, W, columns }
      this.layoutVersion++
      return true
    },

    // 单张卡的内容签名。只看会影响高度的字段，坐标/样式变化不算。
    itemSignature(item) {
      const segments = item.segments || []
      return (
        item.key +
        ':' +
        (item.name || '') +
        ':' +
        segments.map((segment) => segment.content || '').join('\u0001')
      )
    },

    snapshotFastSignatures() {
      const next = new Map()
      for (const item of this.sortedItems || []) {
        next.set(item.key, this.itemSignature(item))
      }
      this._fastSignatures = next
    },

    // 把当前这版布局记到所属日期下。布局对象每次都是整体替换，
    // 缓存里存的引用不会被后续的快速推演改脏
    cacheCurrentLayout() {
      if (!this._layout || this._layoutDayKey !== this.dayKey) return
      const key = this.dayKey || ''
      this._layoutCache.delete(key)
      this._layoutCache.set(key, {
        layout: this._layout,
        signatures: new Map(this._fastSignatures),
      })
      // 只是切换日期的即时预览，没必要无限囤；超过 24 天丢掉最久没用的
      while (this._layoutCache.size > 24) {
        this._layoutCache.delete(this._layoutCache.keys().next().value)
      }
    },

    // 切到某天时先恢复该天的缓存布局。返回 true 表示这次确实换了布局，
    // 后续的快速推演可以基于它继续改高度。缓存里的宽度是上次那天的宽度，
    // 若当前容器宽度不同，紧接着的 applyQuickResize 会按列宽比例缩放。
    restoreCachedLayout() {
      if (this.dayKey === this._layoutDayKey) return false
      const entry = this._layoutCache.get(this.dayKey)
      if (!entry) {
        // 没缓存：旧布局不属于这一天，别拿它套新日期的卡片
        this._layoutDayKey = null
        return false
      }
      this._layout = entry.layout
      this._fastSignatures = new Map(entry.signatures)
      // 清空签名，强制后台再完整算一次，校正期间可能发生的正文/字体变化
      this._layoutSignature = ''
      this._layoutDayKey = this.dayKey
      this.layoutVersion++
      return true
    },

    // 编辑预览的本地重排：不重新求解列数/列位，只按现有 col/span 从上往下
    // 重新摞一遍。改过的卡按自己的列宽重新量内容高度，后面的卡自然被推下去
    // 或拉上来。force=true 用于拖窗口：不管签名，所有卡按当前列宽重新量高。
    // 返回 false 表示这次变化本地兜不住，交给 scheduleLayout。
    applyFastPreview(force = false) {
      const layout = this._layout
      const container = this.$refs.gridContainer
      if (!layout || !container || !layout.placements) return false
      const W = Math.round(container.clientWidth)
      if (!W || W !== layout.W) return false

      const items = this.sortedItems || []
      if (!items.length) return false
      const signatures = new Map()
      const changed = []
      for (const item of items) {
        if (!layout.placements.has(item.key)) return false
        const signature = this.itemSignature(item)
        signatures.set(item.key, signature)
        if (force || this._fastSignatures.get(item.key) !== signature) changed.push(item)
      }
      // 卡的数量变了（多一张/少一张）同样交给完整求解
      if (signatures.size !== layout.placements.size) return false
      if (!changed.length) {
        this._fastSignatures = signatures
        return true
      }

      const heights = this.measurePreviewHeights(changed, layout, container)
      if (!heights) return false

      const columnCount = layout.columns.length
      const colBottom = new Float64Array(columnCount)
      const list = []
      // 按求解时的落位顺序重摞，而不是按科目顺序：顺序变了列位就跟着错
      const itemIndex = new Map(items.map((item, index) => [item.key, index]))
      const byKey = new Map(items.map((item) => [item.key, item]))
      const order = Array.isArray(layout.order) && layout.order.length === items.length
        ? layout.order
        : items.map((item) => item.key)
      order.forEach((key) => {
        const item = byKey.get(key)
        const old = layout.placements.get(key)
        if (!item || !old) return
        const naturalHeight = heights.has(item.key)
          ? heights.get(item.key)
          : old.naturalHeight != null
            ? old.naturalHeight
            : old.height
        let y = colBottom[old.col]
        for (let k = old.col + 1; k < old.col + old.span; k++) {
          if (colBottom[k] > y) y = colBottom[k]
        }
        list.push({
          ...old,
          index: itemIndex.get(key),
          y,
          height: naturalHeight,
          naturalHeight,
          bottom: y + naturalHeight,
        })
        for (let k = old.col; k < old.col + old.span; k++) {
          colBottom[k] = y + naturalHeight + ROW_GAP
        }
      })

      // 跨列卡上方的洞按同一套规则重新分摊，避免改一张卡后洞被拉长
      const filled = fillSpanHoles(list, columnCount, ROW_GAP)
      const placements = new Map()
      const colHeights = new Float64Array(columnCount)
      for (const placement of filled) {
        const item = items[placement.index]
        if (!item) return false
        placements.set(item.key, placement)
        for (let k = placement.col; k < placement.col + placement.span; k++) {
          if (placement.bottom > colHeights[k]) colHeights[k] = placement.bottom
        }
      }

      const columns = layout.columns.map((col, index) => ({
        ...col,
        height: colHeights[index],
      }))
      this._layout = {
        ...layout,
        columns,
        placements,
        max: Math.max(0, ...colHeights),
      }
      this._fastSignatures = signatures
      this.layoutVersion++
      return true
    },

    // 只量改动过的卡片：克隆到隐藏容器里，按它现在占的列宽取自然高度。
    // 先全部挂上再统一读数，一次布局就能量完。
    measurePreviewHeights(changed, layout, container) {
      const cards = new Map()
      container.querySelectorAll('.grid-item[data-key]').forEach((el) => {
        const card = el.querySelector('.hw-card')
        if (card) cards.set(el.dataset.key, card)
      })
      const holder = document.createElement('div')
      holder.style.cssText =
        'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;'
      ;(container.parentElement || container).appendChild(holder)
      const entries = []
      try {
        for (const item of changed) {
          const card = cards.get(item.key)
          const placement = layout.placements.get(item.key)
          if (!card || !placement) return null
          const clone = card.cloneNode(true)
          clone.style.height = 'auto'
          clone.style.width = this.placementBox(layout, placement).width + 'px'
          clone.style.maxWidth = 'none'
          clone.style.boxSizing = 'border-box'
          holder.appendChild(clone)
          entries.push([item.key, clone])
        }
        const result = new Map()
        for (const [key, clone] of entries) result.set(key, clone.offsetHeight)
        return result
      } finally {
        holder.remove()
      }
    },

    // 量卡片 → 求分列方案：列数只按内容宽度分档，同档内每列等宽，
    // 跨列卡按空洞最小、总高度最低落位；不看视口高度。
    async updateLayout(token, request = this._layoutRequest) {
      const container = this.$refs.gridContainer
      if (!container) return false
      const W = Math.round(container.clientWidth)
      if (!W) return false

      const signature = this.layoutSignature(W)
      if (signature === this._layoutSignature) {
        if (request === this._layoutRequest) this._layoutDirty = false
        return false
      }

      const itemNodes = new Map()
      container.querySelectorAll('.grid-item[data-key]').forEach((el) => {
        const key = el.dataset.key
        const card = el.querySelector('.hw-card')
        if (key && card) itemNodes.set(key, card)
      })

      const items = this.sortedItems || []
      const cardElements = items.map((item) => itemNodes.get(item.key))
      if (!items.length || cardElements.some((el) => !el)) return false

      // 列数按视口宽度分档，列宽按容器实际可用宽度均分；
      // 卡片比列数还少时按卡片数收窄，免得量了用不上的宽度
      const columns = Math.max(1, Math.min(columnsForWidth(window.innerWidth), items.length))
      const gap = COLUMN_GAP

      const measurements = await measureCardsAsync(
        cardElements,
        W,
        {
          columns,
          gap,
          parent: container.parentElement || container,
        },
        {
          // 宽度在量高期间又变了：立刻放弃，别拿旧宽度量完再丢
          shouldCancel: () =>
            (token != null && token !== this._layoutToken) ||
            W !== Math.round(container.clientWidth),
        },
      )
      if (!measurements || measurements.some((m) => !m)) return false
      // 测量期间又来了新输入/新尺寸：这份结果已经过期，直接丢掉
      if (token != null && token !== this._layoutToken) return false

      const chosen = buildMasonryLayout({
        heights: measurements.map((m) => m.heights),
        naturalWidths: measurements.map((m) => m.naturalWidth),
        W,
        columns,
        gap,
        rowGap: ROW_GAP,
      })
      if (!chosen) return false
      // 测量/求解这段时间内容又变了：这份结果已经过期，别盖掉本地预览，
      // 交给 updated 里排的那次补算。
      if (signature !== this.layoutSignature(W)) return false
      // 测量期间窗口宽度又变了：这份结果按旧宽度算的，不能用。
      // 标记补算，交给 .then 立刻按最新宽度重新排一次
      if (W !== Math.round(container.clientWidth)) {
        this._layoutDirty = true
        this._layoutRequest++
        return false
      }

      const placements = new Map()
      // 求解器主要按科目顺序落位，但兜底的 LPT 候选是按卡高排序的，顺序可能变：
      // 编辑预览的本地重排必须按这个顺序往下摞，按科目顺序摞会把位置打乱
      const order = []
      chosen.placements.forEach((placement) => {
        const item = items[placement.index]
        if (!item) return
        placements.set(item.key, placement)
        order.push(item.key)
      })

      // 视口宽度变了才落到这儿。若这版结果没动列结构（列数、每张卡的列和
      // 跨列数都没变），宽度已经在实时预览里到位，继续直接摆放；
      // 若列结构变了，整块要重新落位：放开四属性过渡，否则卡片只横向瞬移、
      // 纵向单独滑，看起来就像“在列内无缘无故地上下动”。
      const viewportDriven = this._solvedW !== 0 && this._solvedW !== W
      const structureChanged = viewportDriven && this.layoutStructureChanged(placements, chosen.columns)
      if (viewportDriven) {
        // 结构动画的窗口期内，后续非结构求解也不恢复“拖拽态”，
        // 否则正在跑的宽度过渡会被取消、收尾时跳一下
        const animating = performance.now() < this._structuralUntil
        this.resizing = !structureChanged && !animating
        if (structureChanged) this._structuralUntil = performance.now() + 320
      }
      if (structureChanged) {
        // 先让「放开横向过渡」这一帧落地：等 Vue 把 class 渲染掉，再强制结算样式。
        // 否则浏览器会把「移除 grid-resizing」和「改 left」当成同一次样式变化，
        // left 从旧值直接跳过去，看着就像从目标列开始动
        await this.$nextTick()
        void container.offsetWidth
        // 等这一下的工夫窗口可能又变了，按旧宽度算的结果不能用了
        if (W !== Math.round(container.clientWidth)) {
          this._layoutDirty = true
          this._layoutRequest++
          return false
        }
      }

      // 这份结果就是按当前宽度算的
      this._layout = {
        columns: chosen.columns,
        placements,
        order,
        max: chosen.max,
        gap,
        W,
      }
      this._layoutSignature = signature
      this._layoutDayKey = this.dayKey
      this.snapshotFastSignatures()
      this.cacheCurrentLayout()
      if (request === this._layoutRequest) this._layoutDirty = false
      this.layoutVersion++
      this._solvedW = W
      // 结构变化时上面已经放开过渡；其余情况等这一帧画完再恢复。
      // 用 resizing 判断而不是 viewportDriven：首屏期间就拖窗口时
      // _solvedW 还是 0，但过渡同样必须恢复，不能一直卡在拖拽态
      if (this.resizing && !structureChanged) this.releaseResizing()
      return true
    },

    // 一张卡片按天分块：一天一块，块里是那天的正文按空行和标题行分的几段。
    // 每段有标题行就是「日期的 + 标题名」，没有就是「日期的作业」，
    // 当天又没有标题行时不出小标题，只留分割线。
    // 一天一块（不是一段一块）是渲染层划点击区的依据：同一天的几段，
    // 连同分隔它们的线，点哪儿都该进那一天
    buildDays(item) {
      const days = []
      const segments = item.segments || []
      // 与 segments 一一对应，解析结果只算一遍
      const parsed = this.parsedSegments(item)
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]
        const blocks = (parsed[index] || []).map((para, paraIndex) => {
          // 没小标题的那一段就叫「作业」，没有颜色、没有自己的日期
          const head = para.heading || { day: '', gap: '', title: '作业' }
          return {
            custom: para.heading !== null,
            day: head.day,
            title: head.gap + head.title,
            lines: para.lines,
            // 作业文本首行就是 # 行：这一块的标题已经并到科目名后面了，
            // 正文照常渲染，不再重复出小标题
            inTitle: index === 0 && paraIndex === 0 && para.heading !== null,
          }
        })
        // 空的段（比如正文只剩空行）不占一块；只有 # 行没有正文的段要留下，
        // 不然那一行小标题会被整段吞掉
        const visible = blocks.filter((block) => block.lines.length || block.custom)
        if (!visible.length) continue
        // 这一天只有一行、而且那一行有序号：把序号藏起来。
        // 一天一个数，不是整张卡一个数——卡片跨了几天，各天各算各的
        const allLines = visible.flatMap((block) => block.lines)
        const hideNumber = allLines.length === 1 && !!allLines[0].number
        for (const block of visible) block.hideNumber = hideNumber
        days.push({
          date: segment.label || '',
          dateString: segment.dateString,
          blocks: visible,
        })
      }
      return days
    },
    // 卡片首行的 # 小标题（没有就是 null）。展示时并到科目名后面，
    // 和 buildDays 里标 inTitle 的那一块共用同一份解析缓存
    titleHeading(item) {
      const parsed = this.parsedSegments(item)
      return parsed[0]?.[0]?.heading || null
    },
    // 一张卡各段正文的解析结果，按 segments 的顺序排。
    // 正常走 parsedCards 那份缓存；缓存里没有（理论上不会发生）就现解析一份兜底，
    // 保证渲染结果不受缓存命中与否影响
    parsedSegments(item) {
      const cached = this.parsedCards.get(item)
      if (cached) return cached
      return (item.segments || []).map((segment) => this.parseParagraphs(segment.content))
    },
    // 正文分段：空行断段，标题行永远另起一段（前面有没有空行都一样）。
    // 标题行剥掉行首缩进、# 和可选的颜色代码，剩下的按「日期几个字 / 标题名」切开——
    // 日期那块刷黄、标题名用那个颜色代码染（编辑框里的上色是同一份解析，见 parseHeadingLine）。
    // 它下面到空行或下一个标题行为止的正文都归它，没有正文也算一段，
    // 渲染成只有小标题的空段
    parseParagraphs(content) {
      if (content == null) return []
      // 行和行首编号都走文本层的 splitContent（里面是同一个 storedNumber），
      // 展示板不再自己拆一遍。先归一 CRLF：文本层只按 \n 切
      const map = splitContent(String(content).replace(/\r\n?/g, '\n'))
      const paras = []
      let current = null
      let seq = 0
      const push = () => {
        if (current && (current.heading !== null || current.lines.length)) {
          paras.push(current)
        }
        current = null
        seq = 0
      }
      for (let index = 0; index < map.lines.length; index++) {
        const raw = map.lines[index]
        // 空行和标题行都是段边界（文本层 isBodyLine 的口径），标题行还要另起一段
        if (!isBodyLine(raw)) {
          push()
          if (!isHeadingLine(raw)) continue
          const head = parseHeadingLine(raw)
          current = head
            ? { heading: head, lines: [] }
            // 不是标题行也要兜住（isHeadingLine 和它按同一口径判定，
            // 这里只是不把一条解析失败当成崩溃的理由）
            : { heading: { day: '', gap: '', title: raw.replace(/^[ \t]*#+/, '').trim() }, lines: [] }
          continue
        }
        if (!current) current = { heading: null, lines: [] }
        // 正文行带上编号（{ number, text }）：模板靠它做悬挂对齐。
        // 拆的规矩和存储那边是同一个函数，两边各认一遍早晚会切出两条不一样的线
        const number = map.numbers[index]
        const text = map.texts[index]
        // 光秃秃一个号的行（「3.」）：什么都不写就不该在板上摆一条出来。
        // 那是编辑时留着接着写的位置，不是已经有一条作业了
        if (!text.trim()) continue
        // 板上编号跟编辑时同一个口径：每段里从上到下连续。
        // 存档里可能留着旧乱号（中间的空行占着号），板上一抹就露 1. 3. 的断层，
        // 该按连续摆出来，别把断层摆给读者看。
        // 这里不能用文本层的 renumberAll 等价替换：它会把上面那种光杆编号行
        // 也算成一条作业、占掉一个号，而板上那行根本不显示，两边的号就对不上了
        // col 是该序号占一格需要的宽度（em），模板靠它给这一行挂悬挂缩进，
        // 在解析期就算好存进行对象里，模板不用再去调用纯函数
        const seqNumber = number ? ++seq : 0
        current.lines.push({ number: seqNumber, text, col: seqNumber ? numColEm(seqNumber) : 0 })
      }
      push()
      return paras
    },
  },
}
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

/* 上面的作业卡片按内容高，下面那排「添加作业」由 margin-top:auto
   顶到最下面（styles/index.scss 里 .empty-subjects 的那条）。
   不写 min-height:0：作业写满一屏时这一列要能被内容顶高，页面照常往下滚 */
.grid-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
}

/* 首屏没算好之前整块不露面：作业卡和添加卡必须同一帧出现，
   否则数据晚到一步，添加卡会被作业卡顶下去，看着就是闪一下再重排 */
.grid-body-pending {
  opacity: 0;
  pointer-events: none;
}

/* 首屏分列过程中不要放过渡：位置会连续校正，放动画反而留下半截位移 */
.grid-initial .grid-item {
  transition: none !important;
}

/* 首屏高度也一样：露出来时就是最终高度，下面的区块不会跟着长一截 */
.grid-initial {
  transition: none !important;
}

/* 拖窗口/缩放期间只砍宽度和横向位移：左边缘、宽度实时贴住新列宽，
   高度和纵向位移仍走 280ms 过渡，不整个关掉 */
.grid-resizing .grid-item {
  transition:
    top var(--motion-slow) var(--ease-standard),
    height var(--motion-slow) var(--ease-standard);
}

/* 科目名、小标题、正文三处之间的间距统一取这一个值 */
.hw-card {
  --hw-gap: 6px;
  /* 跨列卡上方的洞摊到的额外高度，全部落在卡片底部的内边距里，
     不塞进卡片之间的间距（间距固定 11px，见 masonry.js ROW_GAP） */
  padding-bottom: var(--hw-stretch, 0px);
  /* 自己给手型光标，不用 Vuetify 的 .cursor-pointer */
  cursor: pointer;
}

/* 标题字号由 contentStyle 绑定，与正文一致。
   科目名和首行小标题排在同一行，按普通行内文字自然换行、不省略。
   v-card-title 自带 nowrap + ellipsis，这里一并覆盖掉 */
.hw-card-title {
  padding: 8px 0 6px 12px;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}

.hw-card-subject {
  overflow-wrap: anywhere;
}

/* 上内边距即科目名到首个小标题（或正文）的间距 */
.hw-card-text {
  padding: var(--hw-gap) 12px 12px;
}

/* 小标题：日期 + 自定义小标题（或「的作业」），各处外观一致。
   默认灰走 --hw-label-gray 这个变量，不挂 opacity：这一格的颜色是用户在小标题
   里自己写的代码绑上来的，外层 opacity 会把那个颜色一起淡掉（连里面那几个黄字
   一起淡），用户挑的色就变了。压暗只落在「没写颜色代码时的默认灰」上 */
.segment-label {
  --hw-label-gray: #6b6b6b;
  display: flex;
  align-items: baseline;
  min-width: 0;
  font-size: 0.8em;
  line-height: 1.5;
  /* 小标题到正文的间距，与科目名到小标题一致 */
  margin-bottom: var(--hw-gap);
}

/* 日期和「的」不压缩。
   这一组连「的」一起刷黄——编辑框里 hl-date 盖的也是「明天的」这几个字，
   两边看齐。黄得和那边一样（那边是 #FFEB3B） */
.label-date,
.label-de {
  flex: 0 0 auto;
  white-space: nowrap;
  color: #ffeb3b;
}

/* 自定义小标题自动换行，不省略 */
.label-name {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--hw-label-gray);
  overflow-wrap: anywhere;
  /* pre-wrap 才能保住小标题里多写的空格，同时允许折行 */
  white-space: pre-wrap;
}

/* 标题行这里要压过 .segment-label 的 flex：改成行内排布，
   才能跟在科目名后面自然折行，而不是整体另起一行 */
.hw-card-title .hw-card-heading {
  display: inline;
  margin-left: 0.5em;
  margin-bottom: 0;
}

/* 深色主题下默认灰要跟着提亮，不然小标题名比正文还暗，读不出来。
   主题类挂在更外层，写法跟编辑框那边一致 */
.v-theme--dark .segment-label {
  --hw-label-gray: #bdbdbd;
}

/* 内容块之间的分割线：v-divider 靠 opacity: var(--v-border-opacity)（0.12）压暗，
   深色主题下这里调到 0.35，白色更醒目又不过分 */
.hw-divider {
  margin: var(--hw-gap) 0;
  opacity: 0.35;
}

.hw-paragraph {
  display: flex;
  flex-direction: column;
  gap: var(--hw-gap);
}

.hw-line {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  padding: 0;
  margin: 0;
}

/* 悬挂只给有序号的行：序号占一格、正文从这个格子后面开始，
   这一行的折行也对齐到序号后面。没序号的行不占格，普通顶格写 */
.hw-line-num {
  --hw-num-gap: 0.3em;
  padding-left: calc(var(--hw-line-num-col, 0) + var(--hw-num-gap));
  text-indent: calc(-1 * (var(--hw-line-num-col, 0) + var(--hw-num-gap)));
}

/* 编号占一格右对齐：贴着正文那一侧排。宽度由模板按这一行的号现算，
   与 --hw-line-num-col 严格相等，不然正文起始位置和折行位置就差一截
   压成灰的，不跟正文抢眼——它是标记，不是内容。用实色不用 opacity：
   外面要是有人挂透明度，这一格跟着一起淡就正好把编号藏没了 */
.hw-num {
  display: inline-block;
  width: var(--hw-line-num-col, 0);
  /* 右边那一个空格靠 margin-right 让出来，不能写进 padding：
     写进 padding 的话这一段宽度会被 padding-left 算两次，正文折行位置就错了 */
  margin-right: var(--hw-num-gap, 0);
  /* nowrap 是保命的：编号一旦窄到装不下，它会在自己的框里折成两行，
     整行高度跟着翻倍，看上去就成了「序号和正文换了行」。
     宁可让它顶出去一点，也不能让它折行 */
  white-space: nowrap;
  color: #808080;
  /* text-indent 会继承给行内元素，不压回去的话编号自己也会往左顶一格 */
  text-indent: 0;
  text-align: right;
}
</style>
