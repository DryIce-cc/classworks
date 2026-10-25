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
            class="hw-card"
            height="100%"
            rounded="md"
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
                       日期那几个字刷黄（编辑框里也是黄的，两边看齐），标题名跟正文一样颜色 -->
                  <div v-if="day.date || block.custom" class="segment-label">
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
          move-class="v-list-move"
          @before-leave="holdLeavingBox"
        >
          <v-card
            v-for="subject in addableSubjects"
            :key="subject.name"
            border
            rounded="md"
            class="empty-subject-card"
            @click="openAddDialog(subject)"
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
import { assignColumns as distributeColumns } from '@/utils/masonry'
import { captureElement } from '@/utils/screenshot'

// 窗口常年最大化，列数固定，不再按宽度分档
const MAX_COLUMNS = 3
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
      // 列分配依赖字号和布局，窗口一变就得重算
      void this.layoutVersion
      return this.assignColumns()
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

    // 底部这张卡片：还没有内容的科目从这儿进来
    openAddDialog(subject) {
      this.$emit('open-dialog', subject.name)
    },

    // 离场卡片钉在原位（实现见 utils/domHold，与设置页共用同一份）
    holdLeavingBox,

    // 点卡片上某一天的那一块：直接进那一天，不用先进今天再自己往前翻。
    // 卡片冒泡上来的那次点击（标题区、卡片留白）不带日期，走的是另一条路
    openDay(item, day) {
      if (!day?.dateString) return
      this.$emit('open-dialog', item.key, { date: day.dateString })
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

    // 按实测高度把卡片分列（算法在 utils/masonry，这里只管把「卡片对象 ↔ 下标」对上）。
    // 还没量到高度时（首屏第一帧）按序号取余，保证每张都有位置、能被量到。
    // 注意：必须是普通方法（每次现算），不能是 computed——
    // 高度存在非响应式的 _heights 里，computed 缓存会让 updateLayout 永远读到旧分配
    assignColumns() {
      const items = this.sortedItems || []
      const heights = items.map((item) => this._heights?.[item.key])
      return distributeColumns(heights, this.effectiveColumns).map((idxs) => idxs.map((i) => items[i]))
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
      const segments = item.segments || []
      // 与 segments 一一对应，解析结果只算一遍
      const parsed = this.parsedSegments(item)
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]
        const blocks = (parsed[index] || []).map((para) => {
          // 没小标题的那一段就叫「作业」，没有颜色、没有自己的日期
          const head = para.heading || { day: '', gap: '', title: '作业' }
          return {
            custom: para.heading !== null,
            day: head.day,
            title: head.gap + head.title,
            lines: para.lines,
          }
        })
        // 空的段（比如正文只剩空行）不占一块
        const visible = blocks.filter((block) => block.lines.length)
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
  /* 自己给手型光标，不用 Vuetify 的 .cursor-pointer：那个工具类带 !important，
     悬停收掉之后（styles/index.scss 的 idle 规则）压不下去 */
  cursor: pointer;
}

/* 标题字号由 contentStyle 绑定，与正文一致 */
.hw-card-title {
  padding: 8px 0 6px 12px;
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

/* 日期和「的」不压缩，自定义小标题过长时单行省略。
   这一组连「的」一起刷黄——编辑框里 hl-date 盖的也是「明天的」这几个字，
   两边看齐。黄得和那边一样（那边是 #FFEB3B） */
.label-date,
.label-de {
  flex: 0 0 auto;
  white-space: nowrap;
  color: #ffeb3b;
}

/* 自定义小标题过长时单行省略 */
.label-name {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--hw-label-gray);
  overflow: hidden;
  text-overflow: ellipsis;
  /* pre 才能保住小标题里多写的空格，同时保持单行 */
  white-space: pre;
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
