<template>
  <div class="subject-settings">
    <div class="subject-settings-head">
      <v-icon class="mr-2" icon="mdi-book-multiple" />
      <span class="text-h6">科目</span>
      <v-spacer />
      <!-- 有没存过的改动。淡入淡出走通用那套（styles/transitions.scss 的 .fade-*） -->
      <Transition name="fade">
        <v-chip v-if="hasChanges" class="mr-2" color="warning" size="small" variant="elevated">
          有未保存的更改
        </v-chip>
      </Transition>
      <v-btn
        :loading="loading"
        color="success"
        prepend-icon="mdi-content-save"
        variant="flat"
        @click="saveConfig"
      >
        保存
      </v-btn>
    </div>

    <!-- 跟着指针走的那个小片。它不能是网格里的那张卡片：留在网格里的话，
         TransitionGroup 让位时会把它的 transform 抢过去改写，
         两边抢同一行样式，卡片就在指针底下乱跳 -->
    <div
      v-if="draggingUid"
      ref="ghost"
      class="subject-ghost"
      :style="{ width: `${ghostWidth}px`, height: `${ghostHeight}px` }"
    >
      <v-icon class="mr-1" color="grey" size="small">mdi-drag</v-icon>
      <span class="text-truncate">{{ draggingName }}</span>
    </div>

    <!-- 卡片观感照抄首页的「点击添加作业」卡片：同样 border + rounded md + 同样的留白，
         只是不带上浮那套（卡片挪来挪去的，上浮只会看着像没对齐）。
         容器要 position: relative，离场的卡片绝对定位后才不会飘到页面左上角 -->
    <TransitionGroup
      name="v-list"
      move-class="v-list-move"
      tag="div"
      class="subject-grid"
      @before-leave="holdLeavingBox"
    >
      <v-card
        v-for="subject in subjects"
        :key="subject.uid"
        :data-uid="subject.uid"
        border
        rounded="md"
        class="subject-card"
        :class="{ 'subject-card-hidden': subject.uid === draggingUid }"
        @pointerdown="startDrag($event, subject)"
      >
        <div class="subject-card-title">
          <v-icon class="drag-glyph" color="grey" size="small">mdi-drag</v-icon>

          <v-text-field
            v-model="subject.name"
            class="subject-name"
            density="compact"
            hide-details
            variant="plain"
            @blur="finishRename(subject)"
            @focus="beginRename(subject)"
          />

          <v-btn
            color="error"
            icon="mdi-delete"
            size="x-small"
            title="删除科目"
            variant="text"
            @click="deleteSubject(subject)"
          />
        </div>

        <div class="subject-card-body">
          <v-switch
            v-model="subject.multiHomework"
            color="primary"
            density="compact"
            hide-details
            label="启用“继续添加作业”"
          />

          <v-text-field
            v-model="extraDrafts[subject.uid]"
            append-inner-icon="mdi-plus"
            density="compact"
            hide-details
            placeholder="附加科目名称"
            variant="outlined"
            @click:append-inner="addExtraSubject(subject)"
            @keyup.enter="addExtraSubject(subject)"
          />

          <div v-if="subject.extraSubjects.length" class="d-flex flex-wrap ga-1 mt-2">
            <v-chip
              v-for="name in subject.extraSubjects"
              :key="name"
              closable
              size="x-small"
              @click:close="removeExtraSubject(subject, name)"
            >
              {{ name }}
            </v-chip>
          </div>
        </div>
      </v-card>
    </TransitionGroup>

    <div class="d-flex flex-wrap ga-2 mt-4">
      <v-btn prepend-icon="mdi-plus" variant="text" @click="openAddDialog">添加科目</v-btn>
      <v-btn prepend-icon="mdi-restore" variant="text" @click="resetDialog = true">重置为默认</v-btn>
    </div>

    <v-dialog v-model="addDialog" max-width="420">
      <v-card rounded="lg">
        <v-card-title class="text-subtitle-1">添加科目</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="newSubjectName"
            autofocus
            density="comfortable"
            hide-details
            label="科目名称"
            variant="outlined"
            @keyup.enter="addSubject"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="addDialog = false">取消</v-btn>
          <v-btn color="primary" variant="tonal" @click="addSubject">添加</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="resetDialog" max-width="420">
      <v-card rounded="lg">
        <v-card-title class="text-subtitle-1">重置为默认科目列表</v-card-title>
        <v-card-text>当前的科目、附加科目名和多份作业设置都会被默认清单覆盖。</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetDialog = false">取消</v-btn>
          <v-btn color="error" variant="tonal" @click="resetToDefault">重置</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import dataProvider from '@/utils/dataProvider.js'
import { cloneDefaultSubjects, normalizeSubjects } from '@/utils/subjects.js'

// 存档键：与首页读科目配置用的是同一个
const STORAGE_KEY = 'classworks-config-subject'
// 按下到挪动超过这个距离才算拖动，否则当作普通点击（手抖一下不该把卡片拖走）
const DRAG_THRESHOLD = 4
// 卡片上能点的地方不从这儿起拖，否则点一下就变成拖卡片，这些控件全点不动了
const INTERACTIVE = 'input, textarea, button, .v-btn, .v-switch, .v-chip, .v-overlay'

// 科目在组件内的身份标识。order 会随排序变，拿它当 key 的话卡片被就地复用，
// 输入框里的内容会跟着串位，所以另给一个会话内稳定的 uid；它不落盘
let uidSeq = 0
const nextUid = () => `subject-${++uidSeq}`

// 内存里的科目不带 order：顺序就是数组下标，存盘时按位置重算，
// 少一个会和人手改的 order 打架的字段
// 空名在这里就补上占位名：一份带着空科目名的存档，以后每次存都会把名字写空
const withUids = (list) =>
  list.map((subject) => ({
    name: String(subject?.name ?? '').trim() || '未命名',
    multiHomework: !!subject?.multiHomework,
    extraSubjects: [...(subject?.extraSubjects || [])],
    uid: nextUid(),
  }))

// 值到 [start, start + size) 这一段的距离，落在段内就是 0
function bandDistance(value, start, size) {
  return value < start ? start - value : value > start + size ? value - (start + size) : 0
}

// 就近取一个分段，返回它的 start。指针落在两段之间的空隙里时也不会在两者间反复横跳
function nearestBand(value, bands) {
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

export default {
  name: 'SubjectManagementCard',

  data() {
    return {
      subjects: [],
      // 正在给哪个科目录入附加科目名，键是 uid
      extraDrafts: {},
      // 改名开始前的原值：改到一半清空了又失焦，退回它，不落一个空科目名
      renameFrom: '',
      // 正在拖的科目 uid，以及跟着指针走的那个小片的尺寸（起拖时量一次）
      draggingUid: null,
      ghostWidth: 0,
      ghostHeight: 0,
      addDialog: false,
      newSubjectName: '',
      resetDialog: false,
      loading: false,
      // 读到配置之前不算改动
      loaded: false,
      // 上一次落盘（或刚读出来）的内容，序列化后比一下就知道有没有未保存的更改。
      // 必须放在 data 里：hasChanges 是 computed，放非响应式的地方存盘后没人叫它重算，
      // 「有未保存的更改」会一直挂着不消
      savedSnapshot: '',
    }
  },

  computed: {
    // 跟着指针走的小片上写什么
    draggingName() {
      return this.subjects.find((s) => s.uid === this.draggingUid)?.name || ''
    },
    hasChanges() {
      return this.loaded && this.serialize() !== this.savedSnapshot
    },
  },

  created() {
    // 拖拽过程的状态放非响应式里：pointermove 每帧都读要避开 Vue 的依赖收集开销，
    // 真正需要触发重渲染的只有 draggingUid 一个
    this._drag = null
    this.loadConfig()
  },

  beforeUnmount() {
    this.cancelDrag()
  },

  methods: {
    // ------------------------------------------------------------------ 读配置

    async loadConfig() {
      let list
      try {
        const response = await dataProvider.loadData(STORAGE_KEY)
        if (Array.isArray(response)) {
          // 规整顺带补齐附加属性：旧存档里没有的字段在这里长出来，不会被读丢
          list = normalizeSubjects(response)
        } else if (response?.success === false) {
          // 读不到 key 时 dataProvider 返回 { success: false }，
          // 必须判 success 而不是判真值
          list = cloneDefaultSubjects()
          this.$message.info('使用默认配置')
        } else {
          // 存档里存的不是清单，多半是写坏了或旧版本的残留，当没有存档处理
          console.warn('科目存档格式不对，改用默认配置:', response)
          list = cloneDefaultSubjects()
          this.$message.warning('科目存档格式不对', '已改用默认配置')
        }
      } catch (error) {
        console.error('读取科目配置失败:', error)
        list = cloneDefaultSubjects()
        this.$message.error('读取科目配置失败', '暂用默认配置显示')
      }
      this.subjects = withUids(list)
      this.extraDrafts = {}
      this.renameFrom = ''
      this.savedSnapshot = this.serialize()
      this.loaded = true
    },

    // ------------------------------------------------------------------ 保存

    // 落盘只认序列化后的字符串。uid 和 order 是内存里的东西，不能进存档
    serialize() {
      return JSON.stringify(
        this.subjects.map((subject, index) => ({
          name: subject.name,
          order: index,
          multiHomework: !!subject.multiHomework,
          extraSubjects: [...subject.extraSubjects],
        })),
      )
    },

    async saveConfig() {
      // 先把改到一半的名字收一收：空名一旦存进去，这份配置以后每次存都会写空
      for (const subject of this.subjects) this.finishRename(subject)
      const payload = this.serialize()
      if (payload === this.savedSnapshot) return
      this.loading = true
      try {
        const response = await dataProvider.saveData(STORAGE_KEY, JSON.parse(payload))
        if (response?.success === false) throw new Error(response.error?.message || '保存失败')
        this.savedSnapshot = payload
        this.$message.success('配置已保存')
      } catch (error) {
        console.error('保存科目配置失败:', error)
        this.$message.error('保存失败', error.message || '请稍后重试')
      } finally {
        this.loading = false
      }
    },

    // ------------------------------------------------------------------ 增删改

    openAddDialog() {
      this.newSubjectName = ''
      this.addDialog = true
    },

    addSubject() {
      const name = this.newSubjectName.trim()
      if (!name) return
      const subject = { name, multiHomework: false, extraSubjects: [], uid: nextUid() }
      this.subjects = [...this.subjects, subject]
      this.addDialog = false
      this.newSubjectName = ''
    },

    beginRename(subject) {
      this.renameFrom = subject.name
    },

    finishRename(subject) {
      const name = subject.name.trim()
      if (name) {
        subject.name = name
        return
      }
      subject.name = this.renameFrom
    },

    deleteSubject(subject) {
      this.subjects = this.subjects.filter((s) => s.uid !== subject.uid)
      delete this.extraDrafts[subject.uid]
    },

    resetToDefault() {
      this.resetDialog = false
      this.subjects = withUids(cloneDefaultSubjects())
      this.extraDrafts = {}
      this.renameFrom = ''
    },

    // 附加科目名去空白、挡重；空名和重复名直接忽略，不给提示吵人
    addExtraSubject(subject) {
      const name = (this.extraDrafts[subject.uid] || '').trim()
      if (!name || subject.extraSubjects.includes(name)) {
        this.extraDrafts[subject.uid] = ''
        return
      }
      subject.extraSubjects = [...subject.extraSubjects, name]
      this.extraDrafts[subject.uid] = ''
    },

    removeExtraSubject(subject, name) {
      subject.extraSubjects = subject.extraSubjects.filter((n) => n !== name)
    },

    // ------------------------------------------------------------------ 拖拽排序

    // 整张卡片都能起拖（卡片留白处更好按），只有能点的控件除外
    startDrag(event, subject) {
      // 只认主键/左键，其余交给浏览器（比如右键菜单）
      if (event.button !== 0) return
      if (event.target.closest?.(INTERACTIVE)) return
      const card = event.currentTarget
      this._drag = {
        uid: subject.uid,
        // 网格元素本身不会被换掉，起拖时存住，后面量位置一直用它
        grid: card.parentElement,
        card,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        // 按住的位置相对卡片左上角的偏移：小片跟着手指走，不是跳到手指底下
        grabX: 0,
        grabY: 0,
        moved: false,
      }
      // 监听一律挂 window，绝不用 setPointerCapture。
      // 一旦发生位置交换，TransitionGroup 会用 insertBefore 把这张卡片挪到新格子，
      // 对浏览器来说等于「移除后重新插入」，指针捕获当场释放——挂在卡片上的
      // pointermove/pointerup 就再也收不到了，拖到这一步必崩。挂 window 没这个问题
      window.addEventListener('pointermove', this.onDragMove)
      window.addEventListener('pointerup', this.onDragEnd)
      window.addEventListener('pointercancel', this.onDragCancel)
      // 兜底：窗口失焦（切到别的程序、点到 devtools）时指针事件收不到，
      // 没有这句就会留一张看不见的卡片和一块不动的碎片在页面上
      window.addEventListener('blur', this.onDragCancel)
      // 挡掉默认动作（选中文字、后续的鼠标事件），否则拖一路选一路
      event.preventDefault()
    },

    onDragMove(event) {
      const drag = this._drag
      if (!drag || event.pointerId !== drag.pointerId) return
      // 没过阈值就还只是按着，别急着把卡片抬起来
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
          return
        }
        const box = drag.card.getBoundingClientRect()
        drag.grabX = event.clientX - box.left
        drag.grabY = event.clientY - box.top
        drag.moved = true
        // 小片跟卡片一样大，摆出来才知道拖的是哪一张
        this.ghostWidth = box.width
        this.ghostHeight = box.height
        this.draggingUid = drag.uid
        // 小片要等 draggingUid 触发的那次渲染才挂上来
        this.$nextTick(() => this.placeGhost())
      }
      event.preventDefault()
      drag.pointerX = event.clientX
      drag.pointerY = event.clientY
      this.placeGhost()
      this.reorderByPointer(event.clientX, event.clientY)
    },

    // 小片贴着指针。直接改 style，不走响应式：一帧一次的重渲染不值当
    placeGhost() {
      const el = this.$refs.ghost
      const drag = this._drag
      if (!el || !drag?.moved) return
      const x = drag.pointerX - drag.grabX
      const y = drag.pointerY - drag.grabY
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    },

    onDragEnd(event) {
      if (!this._drag || event.pointerId !== this._drag.pointerId) return
      this.cancelDrag()
    },

    onDragCancel() {
      this.cancelDrag()
    },

    // 松手：撤掉高亮、把 window 上的监听摘掉
    cancelDrag() {
      const drag = this._drag
      this._drag = null
      this.draggingUid = null
      window.removeEventListener('pointermove', this.onDragMove)
      window.removeEventListener('pointerup', this.onDragEnd)
      window.removeEventListener('pointercancel', this.onDragCancel)
      window.removeEventListener('blur', this.onDragCancel)
    },

    // 指针落在哪张卡片上，就把被拖的插到它前面还是后面。返回有没有真的换位置
    reorderByPointer(x, y) {
      const drag = this._drag
      // 下标一律现算，不留副本。DOM 上的 data-index 要等渲染完才跟得上数组，
      // 一次拖拽里读到的就会是上一次的位置，越换越乱
      const from = this.subjects.findIndex((s) => s.uid === drag.uid)
      if (from < 0) return false
      const target = this.hitTest(x, y, drag, from)
      if (target == null || target === from) return false
      const moved = this.subjects.filter((subject) => subject.uid !== drag.uid)
      moved.splice(target, 0, this.subjects[from])
      this.subjects = moved
      return true
    },

    // 命中测试：把指针落到网格的哪一格（第几行、第几列），这一格在数组里就是唯一的一个
    // 下标，于是无论指针怎么在格子里抖，答案都只有一个，位置就不会来回跳。
    // 早先的写法是「就近认一张卡片」，行与行之间的空隙里，上一张算出「插它后面」、
    // 下一张算出「插它前面」，两个下标差着一整段，指针一晃位置就被来回甩。
    // 返回插进「去掉被拖那张」的数组里的下标。
    // 量的是 offsetLeft/offsetTop 这些布局值，不含 TransitionGroup 让位时挂的
    // transform——量矩形会量到动画中途的位置，插入位置跟着乱跳
    hitTest(x, y, drag, from) {
      const grid = drag.grid
      if (!grid) return null
      const origin = grid.getBoundingClientRect()
      // 网格内的坐标：offsetLeft/offsetTop 就是相对网格的，省得每张都跟视口换算
      const px = x - origin.left
      const py = y - origin.top

      // 被拖的那张也算进来：它是 visibility: hidden，格子还占着，几何上它是个真格子
      const cells = [...grid.querySelectorAll('.subject-card')].map((el) => ({
        uid: el.dataset.uid,
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }))
      if (!cells.length) return null

      // 行按顶边归并，同一行取最高的当行高（有科目挂了附加科目名，卡片高度不一样）
      const rowTops = [...new Set(cells.map((c) => c.top))].sort((a, b) => a - b)
      const rowHeight = (top) =>
        Math.max(...cells.filter((c) => c.top === top).map((c) => c.height))
      // 列宽一律相等（grid 用的 minmax(210px, 1fr)），量第一张的宽度就够
      const colLefts = [...new Set(cells.map((c) => c.left))].sort((a, b) => a - b)
      const colWidth = cells.find((c) => c.left === colLefts[0]).width

      // 指针落在哪一行、哪一列。空隙里就近取一个，免得边界上来回跳
      const row = nearestBand(py, rowTops.map((top) => ({ start: top, size: rowHeight(top) })))
      const col = nearestBand(px, colLefts.map((left) => ({ start: left, size: colWidth })))

      const rowCells = cells.filter((c) => c.top === row).sort((a, b) => a.left - b.left)
      const indexOf = (uid) => this.subjects.findIndex((s) => s.uid === uid)
      // 下一行头一张卡片的数组下标，也就是「这一行后面」这个位置；已经是最后一行就是数组末尾
      const nextRowIndex = () => {
        const next = cells.filter((c) => c.top > row).map((c) => indexOf(c.uid))
        return next.length ? Math.min(...next) : this.subjects.length
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
        at = px > cell.left + cell.width / 2 ? afterCell(cell) : indexOf(cell.uid)
      }
      if (at < 0) return null

      // at 是「含被拖那张」的下标，插进掉它的数组要减一格
      return at > from ? at - 1 : at
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
  },
}
</script>

<style scoped>
/* 照抄首页「点击添加作业」卡片（styles/index.scss 的 .empty-subject-card）：
   同样 border + rounded md、同样留白、同样平时压到 0.8 悬停回 1。
   不带它的 hover 上浮和阴影——卡片本来就是拿来挪来挪去的，一上浮看着像没对齐 */
.subject-card {
  opacity: 0.8;
  cursor: grab;
  /* 手指一动就被当成滚页面的话，pointermove 会断，触摸根本拖不起来 */
  touch-action: none;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
}

/* 鼠标静止之后收掉悬停：这条本来是这里的 .subject-card:hover，
   现在挪到 styles/index.scss 里，写成 html:not(.hw-hover-idle) .subject-card:hover。
   不能留在这儿——这是 scoped 样式，全局选择器里的 html 会被套上本组件的
   scope 属性，永远匹配不上 */

/* 拖起来的那张留在网格里占着坑（visibility 不占布局，位置不会塌），
   跟着指针走的是外面那个小片。这张就只等着被 TransitionGroup 挪到新格子 */
.subject-card-hidden {
  visibility: hidden;
}

/* 跟着指针走的小片。定位和尺寸在样式里定死，位置由 placeGhost 写 transform */
.subject-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: thin solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
  /* 必须没有过渡：有过渡小片会追着指针跑，甩出半个身位 */
  transition: none;
  will-change: transform;
  pointer-events: none;
}

/* 离场的卡片脱离文档流后得有个定位父级，不然会飘到页面左上角 */
.subject-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  /* 不设 align-items: start，用默认的 stretch：一行里的卡片一律拉到行高（行高取最高的那个），
     免得科目长短、附加科目多少不同时，一行卡片底边参差不齐 */
  gap: 9px 8px;
  margin-top: 12px;
  position: relative;
}

/* 标题行：拖动标记 + 科目名 + 删除。留白跟 v-card-title 一样 */
.subject-card-title {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 6px 0 16px;
}

/* 只是个提示，拖哪儿都行，所以不额外限制它的大小 */
.drag-glyph {
  flex: 0 0 auto;
}

.subject-name {
  min-width: 0;
  flex: 1 1 auto;
  margin-top: -6px;
}

/* 科目名跟参考卡片的标题同一档字号（text-subtitle-1） */
.subject-name :deep(.v-field__input) {
  font-size: 1rem;
}

/* 正文行：留白跟 v-card-text 一样。这几个控件自己定了字号，靠 :deep 压成小号 */
.subject-card-body {
  padding: 0 16px 16px;
}

.subject-card-body :deep(.v-field),
.subject-card-body :deep(.v-label),
.subject-card-body :deep(.v-chip) {
  font-size: 0.75rem;
}

.subject-settings-head {
  display: flex;
  align-items: center;
}
</style>
