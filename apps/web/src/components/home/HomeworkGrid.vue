<template>
  <!-- 作业卡片区在上、底部那排「添加作业」在下。纵向 flex + 后者的 margin-top:auto，
       作业不满一屏时后者就贴在视口底边（见 styles/index.scss 的 .empty-subjects） -->
  <div class="grid-body">
    <!-- 作业卡片：按实测高度分列，三列各自独立纵向堆叠（无网格行、无行对齐）。
         首屏那版分列是按序号摆的（高度还没量到），所以先整块藏着，量完再淡入 -->
    <div ref="gridContainer" class="grid-masonry" :class="{ 'grid-pending': !measured }">
      <TransitionGroup
        v-for="(col, ci) in columnItems"
        :key="ci"
        name="grid"
        move-class="grid-move"
        tag="div"
        class="grid-column"
      >
        <div v-for="item in col" :key="item.key" class="grid-item" :data-key="item.key">
          <v-card
            border
            class="hw-card cursor-pointer"
            height="100%"
            rounded="xl"
            @click="$emit('open-dialog', item.key)"
          >
            <!-- 科目名独占一行，小标题按段落正常单独显示。
                 这一行没有自己的点击处理，冒泡到卡片上：不带日期进编辑面板，
                 也就是跟着展示板正在看的那天（正常情况下就是今天） -->
            <v-card-title class="hw-card-title" :style="contentStyle">
              {{ item.name }}
            </v-card-title>
            <v-card-text :style="contentStyle" class="hw-card-text">
              <!-- 一天一区：同一天的那几段（正文按空行、小标题分的段）和它们之间的
                   分隔线都算在这一区里，点哪儿都进那一天。跨天的那条分隔线归新的一天，
                   不然点它会掉到卡片上、进今天。区外的卡片留白仍旧冒泡给卡片 -->
              <div
                v-for="(day, di) in buildDays(item)"
                :key="di"
                class="hw-day"
                @click.stop="openDay(item, day)"
              >
                <template v-for="(block, bi) in day.blocks" :key="bi">
                  <v-divider v-if="di > 0 || bi > 0" class="hw-divider" />
                  <!-- 日期有、或者这段有自定义小标题，就出小标题：后面的日子光有正文也是要出
                       「明天的作业」的，别因为没有自定义小标题就把它吞了。
                       日期那几个字刷黄（编辑框里也是黄的，两边看齐），标题名用小标题
                       自带的颜色代码染 -->
                  <div v-if="day.date || block.custom" class="segment-label">
                    <span class="label-date">{{ day.date }}</span>
                    <span class="label-de">{{ day.date ? '的' : '' }}</span>
                    <span class="label-name" :style="block.colorStyle">
                      <span v-if="block.day" class="label-date">{{ block.day }}</span>{{ block.title }}
                    </span>
                  </div>
                  <div class="hw-paragraph">
                    <div v-for="(text, ti) in block.lines" :key="ti" class="hw-line">
                      {{ text }}
                    </div>
                  </div>
                </template>
              </div>
            </v-card-text>
          </v-card>
        </div>
      </TransitionGroup>
    </div>

    <!-- 可添加作业的科目：尚无内容的直接开始填；启用了多份作业的科目即使已有内容，
         也留一张「继续添加作业」卡片。下边距留在上面那块（.grid-masonry），
         这边的上外边距空出来给 margin-top:auto，见 styles/index.scss -->
    <div ref="emptySubjects" class="empty-subjects">
      <div class="empty-subjects-grid">
        <!-- 这里不能加 tag：TransitionGroup 默认渲染成片段，卡片直接当 .empty-subjects-grid
             的子元素 participating 网格排布；套一层 div 就只剩一个子元素，会排成竖排 -->
        <TransitionGroup
          name="v-list"
          move-class="v-list-move"
          @before-leave="holdLeavingBox"
        >
          <v-card
            v-for="subject in addableSubjects"
            :key="subject.name"
            border
            rounded="xl"
            class="empty-subject-card"
            @click="openAddDialog(subject)"
          >
            <v-card-title class="text-subtitle-1">
              {{ subject.name }}
            </v-card-title>
            <v-card-text class="text-center">
              <v-icon color="grey" size="small"> mdi-plus </v-icon>
              <div class="text-caption text-grey">
                {{ hasContent(subject.name) ? '继续添加作业' : '点击添加作业' }}
              </div>
            </v-card-text>
          </v-card>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<script>
import { parseHeadingLine } from '@/utils/homeworkReserve'

// 窗口常年最大化，列数固定，不再按宽度分档
const MAX_COLUMNS = 3
// 「点击添加作业」卡片露在视野里又没人理，3s 后就把它上滑出去
const IDLE_SCROLL_DELAY = 3000
// 标题行：与文本层（homeworkText.js 的 isHeadingLine）同口径，
// 行首允许空格/Tab 缩进，# 开头即标题，不再限空格个数、不限有无正文
const HEADING_LINE = /^[ \t]*[#]/

export default {
  name: 'HomeworkGrid',
  props: {
    sortedItems: { type: Array, required: true },
    // 尚无内容的科目，外加启用了多份作业的科目（带附加属性：multiHomework / extraSubjects）
    addableSubjects: { type: Array, required: true },
    contentStyle: { type: Object, default: () => ({}) },
    // 作业编辑面板开着时页面不能动，自动上滑也一并停掉
    paused: { type: Boolean, default: false },
  },
  emits: ['open-dialog'],
  data() {
    return {
      // 布局版本号：分列结果变化时才 +1，避免量高度触发无限重渲染
      layoutVersion: 0,
      // 卡片高度还没量全（首帧），分列是临时的，先别露出来
      measured: false,
    }
  },
  created() {
    // 实测的卡片高度（非响应式，靠 layoutVersion 触发重算），
    // 每张的高度里已经带上了它自己那一份卡片间距
    this._heights = {}
    this._signature = ''
    // 待执行的自动上滑的定时器
    this._scrollTimer = 0
  },
  computed: {
    // 卡片少时收缩列数，让卡片铺满可用宽度
    effectiveColumns() {
      const count = this.sortedItems ? this.sortedItems.length : 0
      if (count <= 0) return 1
      return Math.max(1, Math.min(count, MAX_COLUMNS))
    },
    // 渲染用的分列结果（透传方法，保证每次拿到的都是现算的）
    columnItems() {
      // 显式依赖版本号，有新测量结果时才重算
      void this.layoutVersion
      return this.assignColumns()
    },
  },
  mounted() {
    // 首屏同步量一次（此时 DOM 已就绪、通常还未绘制），避免先闪一下再重排
    this.updateLayout()
    // 字体后加载会改变卡片高度，加载完再平衡一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => this.updateLayout())
    }
    window.addEventListener('scroll', this.handleViewportChange, { passive: true })
    window.addEventListener('resize', this.handleViewportChange, { passive: true })
    // 捕获阶段，用户碰一下就撤销待执行的上滑
    document.addEventListener('pointerdown', this.cancelIdleScroll, true)
    this.armIdleScroll()
  },
  updated() {
    this.$nextTick(() => {
      this.updateLayout()
      // 卡片增减会改变视野里的那一段，重新判断要不要计时
      this.armIdleScroll()
    })
  },
  beforeUnmount() {
    this.cancelIdleScroll()
    window.removeEventListener('scroll', this.handleViewportChange)
    window.removeEventListener('resize', this.handleViewportChange)
    document.removeEventListener('pointerdown', this.cancelIdleScroll, true)
  },
  watch: {
    paused(value) {
      if (value) {
        this.cancelIdleScroll()
        return
      }
      // 面板关掉了，卡片区还露着就接着算
      this.$nextTick(() => this.armIdleScroll())
    },
  },
  methods: {
    // 页面滚了或窗口变了：先撤销待执行的上滑（人已经自己在动了），
    // 再按当前位置重新判断，所以计时总是从「最后一次动静」算起
    handleViewportChange() {
      this.cancelIdleScroll()
      this.armIdleScroll()
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

    // 底部这张卡片：启用了多份作业的科目从这儿进来，正文末尾多留一个空行，
    // 好在已有内容下面另起一份，而不是紧跟着最后一行写
    openAddDialog(subject) {
      this.$emit('open-dialog', subject.name, {
        appendBlankLines: subject.multiHomework ? 2 : 1,
      })
    },

    // 离场的卡片马上要脱离文档流（见 transitions.scss 的 .v-list-leave-active），
    // 脱离后网格不再给它宽度、静态位置也会重排到别的格子去，淡出那一瞬看着像
    // 「往下挪一截再消失」。这里把当前的位置和尺寸钉死，它就只在原地淡出
    holdLeavingBox(el) {
      const box = el.getBoundingClientRect()
      const host = el.offsetParent
      if (host) {
        const hostBox = host.getBoundingClientRect()
        el.style.left = `${box.left - hostBox.left + host.scrollLeft}px`
        el.style.top = `${box.top - hostBox.top + host.scrollTop}px`
      }
      el.style.width = `${box.width}px`
      el.style.height = `${box.height}px`
    },

    // 点卡片上某一天的那一块：直接进那一天，不用先进今天再自己往前翻。
    // 卡片冒泡上来的那次点击（标题区、卡片留白）不带日期，走的是另一条路
    openDay(item, day) {
      if (!day?.dateString) return
      this.$emit('open-dialog', item.key, { date: day.dateString })
    },

    // 该科目在展示板上已经有内容卡片了没有：用来区分「点击添加作业」和「继续添加作业」
    hasContent(name) {
      return this.sortedItems.some((item) => item.key === name)
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

    // 按实测高度把卡片分列。各列等宽，卡片高度与分列结果无关，
    // 所以量一次就能收敛，不会循环。
    // 还没量到高度时（首屏第一帧）按序号取余，保证每张都有位置、能被量到。
    // 注意：必须是普通方法（每次现算），不能是 computed——
    // 高度存在非响应式的 _heights 里，computed 缓存会让 updateLayout 永远读到旧分配
    assignColumns() {
      const cols = Array.from({ length: this.effectiveColumns }, () => [])
      if (!this.sortedItems || !this.sortedItems.length) return cols
      const heights = this.sortedItems.map((item) => this._heights?.[item.key])
      // 有卡片还没量到高度：先按序号取余分列，等量到了自然会重排
      if (heights.some((h) => h == null)) {
        this.sortedItems.forEach((item, idx) => cols[idx % cols.length].push(item))
        return cols
      }
      return this.solveColumns(heights).map((idxs) => idxs.map((i) => this.sortedItems[i]))
    },

    // 回溯求最优分列：先让最高的那一列尽量矮，再让各列挨得更齐。
    // 三级比较依次是「最高列高 → 列高极差 → 列高方差」，卡在第一级就不看后面两级，
    // 所以不会为了好看去牺牲整体高度
    solveColumns(heights) {
      const c = this.effectiveColumns
      const n = heights.length
      const avg = heights.reduce((sum, h) => sum + h, 0) / c
      // 高度是量出来的整数，这个容差只为躲开浮点累加的零头
      const EPS = 1e-6
      // 搜索规模（科目数 × 列数）不大，但最坏情况仍有可能翻车；
      // 给个节点上限，超了就取搜索途中最好的那个，绝不卡住界面
      const budget = 250000

      // 三级比较。方差除以列数是同一个常数，不影响比较，省掉
      const measure = (loads) => {
        let max = 0
        let min = Infinity
        let variance = 0
        for (const load of loads) {
          if (load > max) max = load
          if (load < min) min = load
          variance += (load - avg) ** 2
        }
        return [max, max - min, variance]
      }
      const better = (a, b) =>
        a[0] < b[0] - EPS || (a[0] < b[0] + EPS && a[1] < b[1] - EPS) ||
        (a[0] < b[0] + EPS && a[1] < b[1] + EPS && a[2] < b[2] - EPS)

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
      let bestLoads = better(measure(byHeight.loads), measure(inOrder.loads)) ? byHeight : inOrder
      let bestScore = measure(bestLoads.loads)
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
          const score = measure(loads)
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
    },

    // 实测每张卡片高度，按签名变化才触发重排，保证收敛不循环
    updateLayout() {
      const container = this.$refs.gridContainer
      if (!container) return
      const colEl = container.querySelector('.grid-column')
      const gap = colEl ? parseFloat(window.getComputedStyle(colEl).rowGap) || 0 : 0
      const heights = {}
      container.querySelectorAll('.grid-item').forEach((el) => {
        // 卡片间的留白算进卡片自己的高度，这样一列的高度就是纯求和，
        // 不用再管「这一列的第一张要不要算留白」这种分支
        if (el.dataset.key) heights[el.dataset.key] = el.offsetHeight + gap
      })
      this._heights = heights
      // 每张卡片都量到了，分列才算靠得住。量全之前一直挂着临时摆位，
      // 首屏就会先看见一个错的布局再跳成对的，不如等量全了再淡入
      if (!this.measured) {
        this.measured = this.sortedItems.every((item) => heights[item.key] != null)
      }
      const sig = this.assignColumns()
        .map((col) => col.map((i) => i.key).join(','))
        .join('|')
      if (sig !== this._signature) {
        this._signature = sig
        this.layoutVersion++
      }
    },
    // 一张卡片按天分块：一天一块，块里是那天的正文按空行和标题行分的几段。
    // 每段有标题行就是「日期的 + 标题名」，没有就是「日期的作业」，
    // 当天又没有标题行时不出小标题，只留分割线。
    // 一天一块（不是一段一块）是渲染层划点击区的依据：同一天的几段，
    // 连同分隔它们的线，点哪儿都该进那一天
    buildDays(item) {
      const days = []
      for (const segment of item.segments || []) {
        const blocks = this.parseParagraphs(segment.content).map((para) => {
          // 没小标题的那一段就叫「作业」，没有颜色、没有自己的日期
          const head = para.heading || { day: '', gap: '', title: '作业', color: '' }
          return {
            custom: para.heading !== null,
            day: head.day,
            title: head.gap + head.title,
            // 颜色代码直接用作者写的那一串（#3FCC00 里不带 #），
            // 没写就空着，模板那边不给 .label-name 绑颜色
            colorStyle: head.color ? { color: `#${head.color}` } : null,
            lines: para.lines,
          }
        })
        // 空的段（比如正文只剩空行）不占一块
        if (!blocks.length) continue
        days.push({
          date: segment.label || '',
          dateString: segment.dateString,
          blocks,
        })
      }
      return days
    },
// 正文分段：空行断段，标题行永远另起一段（前面有没有空行都一样）。
// 标题行剥掉行首缩进、# 和可选的颜色代码，剩下的按「日期几个字 / 标题名」切开——
// 日期那块刷黄、标题名用那个颜色代码染（编辑框里的上色是同一份解析，见 parseHeadingLine）。
// 它下面到空行或下一个标题行为止的正文都归它，没有正文也算一段，
// 渲染成只有小标题的空段
    parseParagraphs(content) {
      if (content == null) return []
      const paras = []
      let current = null
      const push = () => {
        if (current && (current.heading !== null || current.lines.length)) {
          paras.push(current)
        }
        current = null
      }
      for (const raw of String(content).replace(/\r\n?/g, '\n').split('\n')) {
        if (raw.trim() === '') {
          push()
          continue
        }
        if (HEADING_LINE.test(raw)) {
          push()
          const head = parseHeadingLine(raw)
          current = head
            ? { heading: head, lines: [] }
            // 不是标题行也要兜住（HEADING_LINE 和它按同一口径判定，
            // 这里只是不把一条解析失败当成崩溃的理由）
            : { heading: { day: '', gap: '', title: raw.replace(/^[ \t]*#+/, '').trim(), color: '' }, lines: [] }
          continue
        }
        if (!current) current = { heading: null, lines: [] }
        current.lines.push(raw)
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

/* 这一列纵向排：上面的作业卡片按内容高，下面那排「添加作业」由 margin-top:auto
   顶到最下面（styles/index.scss 里 .empty-subjects 的那条）。
   不写 min-height:0：作业写满一屏时这一列要能被内容顶高，页面照常往下滚 */
.grid-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
}

/* 科目名、小标题、正文三处之间的间距统一取这一个值 */
.hw-card {
  --hw-gap: 6px;
}

/* 标题字号由 contentStyle 绑定，与正文一致 */
.hw-card-title {
  padding: 12px 12px 0;
  line-height: 1.4;
}

/* 上内边距即科目名到首个小标题（或正文）的间距 */
.hw-card-text {
  padding: var(--hw-gap) 12px 12px;
}

/* 小标题：日期 + 自定义小标题（或「的作业」），各处外观一致。
   压暗的那 0.6 只留给标题名（见 .label-name），日期那几个字要亮着刷黄 */
.segment-label {
  display: flex;
  align-items: baseline;
  min-width: 0;
  font-size: 0.8em;
  line-height: 1.5;
  /* 小标题到正文的间距，与科目名到小标题一致 */
  margin-bottom: var(--hw-gap);
}

/* 日期和「的」不压缩，自定义小标题过长时单行省略。
   这一组连「的」一起刷黄——编辑框里 hl-date 盖的也是「明天的」这几个字，
   两边看齐。黄得和那边一样（那边是 #FFEB3B） */
.label-date,
.label-de {
  flex: 0 0 auto;
  white-space: nowrap;
  color: #ffeb3b;
}

/* 自定义小标题过长时单行省略。颜色由模板按小标题里写的颜色代码绑上来，
   没写就靠这里的压暗和别的灰字拉开 */
.label-name {
  flex: 0 1 auto;
  min-width: 0;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  /* pre 才能保住小标题里多写的空格，同时保持单行 */
  white-space: pre;
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
</style>
