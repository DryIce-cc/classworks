<template>
  <v-toolbar class="no-select" color="surface" elevation="4">
    <v-toolbar-title class="text-h6" :class="isToday ? '' : 'text-yellow'">
      {{ titleText }}的作业
    </v-toolbar-title>

    <v-spacer />

    <template #append>
      <!-- 只在离开今天时摆出来。淡入淡出走通用那套（styles/transitions.scss 的 .fade-*） -->
      <Transition name="fade">
        <v-btn
          v-if="!isToday"
          class="mr-2"
          prepend-icon="mdi-calendar-today"
          variant="tonal"
          @click="goToday"
        >
          回到今天
        </v-btn>
      </Transition>
      <span v-if="state.screenshotMatched" class="text-caption text-grey ml-1">已截图</span>
      <v-btn
        v-if="sortedItems.length"
        icon="mdi-camera-outline"
        variant="text"
        title="截图并复制（Ctrl+C）"
        :loading="state.capturing"
        @click="captureBoard"
      />
      <v-btn icon="mdi-chevron-left" variant="text" title="查看昨天" @click="navigateDay(-1)" />

      <v-btn
        icon="mdi-format-font-size-decrease"
        variant="text"
        title="缩小字体"
        @click="zoom('out')"
      />
      <v-btn
        icon="mdi-format-font-size-increase"
        variant="text"
        title="放大字体"
        @click="zoom('up')"
      />
      <v-menu :close-on-content-click="false" location="bottom">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-calendar" variant="text" title="选择日期" />
        </template>
        <v-card border>
          <v-date-picker
            :model-value="state.selectedDateObj"
            color="primary"
            @update:model-value="handleDateSelect"
          />
        </v-card>
      </v-menu>
      <v-btn icon="mdi-chevron-right" variant="text" title="查看明天" @click="navigateDay(1)" />
      <v-btn icon="mdi-cog" variant="text" @click="$router.push('/settings')" />
    </template>
  </v-toolbar>

  <!-- 这一段是纵向 flex（见 styles/index.scss 的 .board-body）：占满工具栏下面剩下的高度，
       好让里面底部那排「添加作业」卡片在作业不满一屏时贴到视口底边 -->
  <div class="d-flex board-body">
    <v-container class="main-window flex-grow-1 no-select bloom-container" fluid>
      <!-- 数据没读完不挂载：先挂一版空板再换数据，会留下旧的「添加作业」退场残影 -->
      <homework-grid
        v-if="state.dataReady"
        ref="homeworkGrid"
        :sorted-items="sortedItems"
        :addable-subjects="addableSubjects"
        :content-style="state.contentStyle"
        :paused="state.dialogVisible"
        :ready="state.dataReady"
        :instant="state.instantSwitch"
        @open-dialog="openDialog"
      />
    </v-container>
  </div>

  <homework-edit-dialog
    v-model="state.dialogVisible"
    :title="currentEditSubject"
    :initial-date="state.editDate"
    :extra-subjects="currentEditExtraSubjects"
    :origin="state.dialogOrigin"
    @save="handleHomeworkSave"
    @preview="handleHomeworkPreview"
  />
</template>

<script>
import { defineAsyncComponent } from 'vue'

// 首屏核心组件（同步加载）
import HomeworkGrid from '@/components/home/HomeworkGrid.vue'

const HomeworkEditDialog = defineAsyncComponent({
  loader: () => import('@/components/HomeworkEditDialog.vue'),
  delay: 0,
})
import dataProvider from '@/utils/dataProvider'
import {
  buildSegments as buildSubjectSegments,
  storedSubjectNames as collectStoredSubjectNames,
} from '@/utils/boardView'
import { emptySubjectNames, hasAnyHomework } from '@/utils/boardStore'
import { formatDayName, parseDateString, shiftDateString, toDateString } from '@/utils/date'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  getSetting,
  setSetting,
  watchSettings,
} from '@/utils/settings'
import { dayDataKey, dayFromKey } from '@/utils/storageKeys'
import { copyImageToClipboard, hashBoard } from '@/utils/screenshot'
import * as subjectStore from '@/utils/subjectStore'
import { cloneDefaultSubjects } from '@/utils/subjects'

// 不在科目列表里的科目统一排在这个位置，即所有列表科目之后
const LAST_ORDER = 9998

// 焦点在输入框或可编辑区域里：Ctrl+C 交给它们做复制
function isEditableTarget(target) {
  return !!target?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  )
}

export default {
  name: 'Classworks 作业板',
  components: {
    HomeworkEditDialog,
    HomeworkGrid,
  },
  data() {
    return {
      // 空字符串而非 null：对话框常驻挂载，title 是 required String，
      // 用 null 会在初次渲染时触发 Vue 的 prop 类型检查警告
      currentEditSubject: '',
      state: {
        boardData: { homework: {} },
        // 首屏数据（当天作业 + 科目表）读完之前，卡片一律不露面：
        // 先露一版空板、数据到了再重排，就是用户看到的那下闪
        dataReady: false,
        // 换天这一帧先关掉卡片过渡：旧板和新板必须同一帧换完，
        // 不能让离场卡、入场卡、添加卡各按各的时长错开
        instantSwitch: false,
        dialogVisible: false,
        // 点开面板的那张卡片在视口里的位置，面板从这儿长出来、也缩回这儿
        dialogOrigin: null,
        dateString: '',
        // 本次打开编辑面板停在哪一天。卡片上点的是哪一天就进哪一天，
        // 没给（点科目名那个标题区）就跟着展示板正在看的那天
        editDate: '',
        fontSize: getSetting('font.size'),
        contentStyle: { 'font-size': `${getSetting('font.size')}px` },
        selectedDateObj: new Date(),
        availableSubjects: cloneDefaultSubjects(),
        // 展示板所看的这一天以外的每一天（后续日期预加载 + 面板里翻到过去的日子），
        // 按日期升序
        otherDays: [],
        // 编辑面板开着时展示板看到的那份正文：日期 -> 科目 -> 正文。
        // 只读不写盘——它和 boardData / otherDays 是两回事，那两个对象正是
        // saveDayData 落盘的原样内容，预览混进去就跟着存下去了
        preview: {},
        // 正在截图：渲染 + 写剪贴板要一会儿，期间按钮转圈、连按不重入
        capturing: false,
        // 最近一次截图的哈希（持久化在设置里）。用于判定当前内容是否已截过图
        lastScreenshotHash: getSetting('screenshot.lastHash'),
        // 本次编辑面板会话里是否真实改过内容（打开面板不算）。用于拦掉
        // 「刚打开还没编辑」那几轮种子预览，别把「已截图」误清掉
        _editChanged: false,
        // 当前存档内容是否和上次截图一致。由事件驱动刷新：载入/翻日期时核对，
        // 真实编辑后清掉，截图成功后置回。只是「打开面板」不改它
        screenshotMatched: false,
      },
    }
  },

  created() {
    // 正在写盘的日期，避免同一天并发写
    this.pendingSaves = new Set()
    // 确认读到过存档的日期。删空记录前必须先在册——
    // 读失败时内存里的作业是空的，不确认就删会把没读出来的内容一起抹掉
    this.storedDates = new Set()
    // 所看的这一天必须在第一次渲染之前就定下来。放在 mounted 里的话首屏先按空日期
    // 渲染一遍（工具栏标题是空的，「回到今天」先摆出来再撤掉；URL 里带了日期的话
    // 还会先淡入一下），看着像在加载。日期解析是纯计算，挪到这里没有副作用
    this.resolveViewDate()
  },

  computed: {
    titleText() {
      return this.dayName(this.state.dateString)
    },
    sortedItems() {
      const items = []
      for (const subject of this.state.availableSubjects) {
        const segments = this.buildSegments(subject.name)
        if (segments.length) {
          items.push({
            key: subject.name,
            name: subject.name,
            order: subject.order,
            segments,
          })
        }
      }
      // 存档里有、科目列表里没有的科目也要显示，排在列表科目之后
      const known = new Set(this.state.availableSubjects.map((s) => s.name))
      for (const name of this.storedSubjectNames()) {
        if (known.has(name)) continue
        const segments = this.buildSegments(name)
        if (segments.length) {
          items.push({ key: name, name, order: LAST_ORDER, segments })
        }
      }
      items.sort((a, b) => a.order - b.order)
      return items
    },

    // 底部卡片：还没内容的科目
    addableSubjects() {
      const used = this.storedSubjectNames()
      return this.state.availableSubjects
        .filter((subject) => !used.has(subject.name))
        .sort((a, b) => a.order - b.order)
    },

    // 当前编辑科目的附加科目，交给编辑面板做一键插入按钮
    currentEditExtraSubjects() {
      const subject = this.state.availableSubjects.find((s) => s.name === this.currentEditSubject)
      return subject?.extraSubjects || []
    },
    todayString() {
      return this.formatDate(this.getToday())
    },
    isToday() {
      return this.state.dateString === this.todayString
    },
    // 缩小字体：没有作业卡片、或已经到最小，按钮就灰掉
    canZoomOut() {
      return !!this.sortedItems.length && this.state.fontSize > FONT_SIZE_MIN
    },
    // 放大字体：没有作业卡片、或已经到最大，按钮就灰掉
    canZoomIn() {
      return !!this.sortedItems.length && this.state.fontSize < FONT_SIZE_MAX
    },

    // 展示板要不要把「所看的这一天」之后的日子也摆上来。往后看（含今天）要，往回看不要：
    // 过去那块板只呈现那一天自己，后来的作业存了档也不该在那儿冒出来。
    // 拿今天当分界而不是拿所看的这一天，往后翻一天并不等于就能看到后一天的作业
    showsFutureDays() {
      return this.state.dateString >= this.todayString
    },
    // 展示板只呈现「所看的这一天 + 更晚的日子」。
    // 更早的日子只可能是编辑面板里翻回去改的：存了档，但不该在这块板上冒出来。
    // 看的是过去的日子时连更晚的一天都不摆：readOtherDays 压根没把那些天读进来，
    // 但面板里翻过去改的实时预览照样会递上来日期，不在这里挡住就会漏到板上
    laterDays() {
      if (!this.showsFutureDays) return []
      const days = this.state.otherDays.slice()
      // 预览刚到、那天还在读进 otherDays 的路上时，先自己补一条空的占住位置，
      // 免得这一小段时间里展示板上少一段。内容随后由 handleHomeworkPreview 补上
      for (const dateString of Object.keys(this.state.preview)) {
        if (days.some((day) => day.dateString === dateString)) continue
        days.push({ dateString, homework: {} })
      }
      return days
        .filter((day) => day.dateString > this.state.dateString)
        .sort((a, b) => a.dateString.localeCompare(b.dateString))
    },
  },

  watch: {
    // 面板一关，预览就没意义了：到这一步为止改动也已经写完盘了。
    // 挂在这里而不是等 save 事件，是因为面板所有的关闭方式都走同一条路，
    // 只有一个地方需要记得清场。重新打开时清掉「是否改过」标记
    'state.dialogVisible'(value) {
      if (!value) {
        this.state.preview = {}
      } else {
        this.state._editChanged = false
      }
    },
  },

  async mounted() {
    window.addEventListener('keydown', this.handleScreenshotShortcut)
    try {
      await this.initializeData()
      this.refreshScreenshotMatch()
      this.unwatchSettings = watchSettings(() => {
        this.state.fontSize = getSetting('font.size')
        this.state.contentStyle = { 'font-size': `${this.state.fontSize}px` }
      })
    } catch (err) {
      console.error('初始化失败:', err)
      this.showError('初始化失败，请刷新页面重试')
    } finally {
      // 失败也要放行：这时显示的是默认科目，至少还能点「添加作业」
      this.state.dataReady = true
    }
  },

  beforeUnmount() {
    window.removeEventListener('keydown', this.handleScreenshotShortcut)
    if (this.unwatchSettings) this.unwatchSettings()
  },

  methods: {
    // 按存档内容核对是否和上次截图一致。只在非编辑状态调用（此时 sortedItems
    // 反映存档，预览只在编辑中出现）——载入、翻日期后调一次
    refreshScreenshotMatch() {
      const hash = this.sortedItems.length
        ? hashBoard(this.sortedItems, this.state.dateString)
        : ''
      this.state.screenshotMatched = !!this.state.lastScreenshotHash && hash === this.state.lastScreenshotHash
    },

    ensureDate(dateInput) {
      if (dateInput instanceof Date) return dateInput
      if (typeof dateInput === 'string') {
        const date = new Date(dateInput)
        if (!isNaN(date.getTime())) return date
      }
      return new Date()
    },
    formatDate(dateInput) {
      return toDateString(this.ensureDate(dateInput))
    },
    getToday() {
      return new Date()
    },

    // 相对日期名
    dayName(dateString) {
      return formatDayName(dateString)
    },

    // 定下「所看的这一天」：URL 上带了 date 就用它，否则今天。纯计算，
    // created 里先跑一遍（首屏标题和「回到今天」都要它），initializeData 里再兜一次
    resolveViewDate() {
      const urlParams = new URLSearchParams(window.location.search)
      const dateFromUrl = urlParams.get('date')
      const today = this.getToday()
      let currentDate = today
      if (dateFromUrl) {
        if (/^\d{8}$/.test(dateFromUrl)) {
          const parsed = parseDateString(dateFromUrl)
          // 13 月、2 月 30 日这种不存在的日子 parseDateString 会顺手进位，
          // 原先按 Invalid Date 回落到今天；这里用月/日复核一遍，保持原来的兜底
          const month = Number(dateFromUrl.slice(4, 6))
          const day = Number(dateFromUrl.slice(6, 8))
          currentDate =
            parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : today
        } else {
          currentDate = new Date(dateFromUrl)
        }
        if (isNaN(currentDate.getTime())) currentDate = today
      }
      this.state.dateString = this.formatDate(currentDate)
      this.state.selectedDateObj = currentDate
    },

    async initializeData() {
      this.resolveViewDate()
      await this.commitSnapshot(this.state.dateString)
    },

    // 一次换天要改的东西（当天作业、后续日期、科目表）先全部读到局部变量，
    // 最后在同一个同步块里提交。分成几次赋值的话，展示卡和添加卡会落在
    // 不同帧里各更新各的，中间那版就是用户看到的错位和闪跳
    async commitSnapshot(dateString) {
      const snapshot = await this.readSnapshot(dateString)
      this.state.dateString = dateString
      this.state.boardData = snapshot.boardData
      this.state.otherDays = snapshot.otherDays
      this.state.availableSubjects = snapshot.subjects
    },

    async readSnapshot(dateString) {
      const response = await dataProvider.loadData(dayDataKey(dateString))
      let boardData = { homework: {} }
      if (!response.ok) {
        // NOT_FOUND 是压根没记录，读失败则是未知状态，两种都不记进 storedDates；
        // 在册的只在明确 NOT_FOUND 时才撤（比如记录已被删过）
        if (response.error?.code === 'NOT_FOUND') this.storedDates.delete(dateString)
      } else if (!Array.isArray(response.data)) {
        this.storedDates.add(dateString)
        boardData = { homework: response.data.homework || response.data || {} }
      }
      // 旧版数组格式：内容认不出来，别记在册——不然会被当成空记录删掉

      const [otherDays, subjects] = await Promise.all([
        this.readOtherDays(dateString),
        subjectStore.loadSubjects(this.state.availableSubjects),
      ])
      return { boardData, otherDays, subjects }
    },

    // 当天和未来视图把更后面的作业一并读出来；查看过去日期时不启用——
    // 那块板只呈现那一天自己，别把后来的作业混进去
    async readOtherDays(dateString) {
      if (dateString < this.todayString) return []
      try {
        const res = await dataProvider.loadKeys({ limit: 1000 })
        if (!res.ok || !Array.isArray(res.data)) return []
        const dates = res.data
          .map(dayFromKey)
          .filter((ds) => ds && ds > dateString)
          .sort()
        const days = []
        for (const ds of dates) {
          const data = await this.readStoredDay(ds)
          if (!data) continue
          this.storedDates.add(ds)
          days.push({ dateString: ds, homework: data.homework || {} })
        }
        return days
      } catch (error) {
        console.warn('加载后续日期作业失败:', error)
        return []
      }
    },

    // 取某一天的作业表；展示板没读进内存的那天（多半是过去的日子）先从存档读出来，
    // 直接往空对象上写会把那天其他科目的作业抹掉
    async ensureDayHomework(dateString) {
      if (!dateString) return null
      if (dateString === this.state.dateString) return this.state.boardData.homework
      let day = this.state.otherDays.find((d) => d.dateString === dateString)
      if (!day) {
        this.state.otherDays.push({ dateString, homework: {} })
        this.state.otherDays.sort((a, b) => a.dateString.localeCompare(b.dateString))
        // 从数组里重新取一次，拿的是响应式代理：直接往 push 进去的原始对象上写，
        // 展示板收不到通知，新加的这一天会等到下次刷新才冒出来
        day = this.state.otherDays.find((d) => d.dateString === dateString)
        await this.loadOtherDay(day)
      }
      return day.homework
    },

    // 把某一天的存档读进缓存；这天本来就没有作业就留空
    async loadOtherDay(day) {
      try {
        const data = await this.readStoredDay(day.dateString)
        if (!data) return
        const homework = data.homework || data
        if (homework && typeof homework === 'object') {
          day.homework = homework
          this.storedDates.add(day.dateString)
        }
      } catch (error) {
        console.warn('读取作业失败:', error)
      }
    },

    // 读一天的存档：读不到、读失败、旧版数组格式都算「没有可用记录」，返回 null。
    // 旧版数组格式的内容认不出来，调用方别把它记进 storedDates，
    // 不然会被当成空记录删掉（见 readSnapshot 里的说明）
    async readStoredDay(dateString) {
      const response = await dataProvider.loadData(dayDataKey(dateString))
      if (!response.ok || Array.isArray(response.data)) return null
      return response.data
    },

    // 存档里出现过、且确实有内容的科目（含后续日期）。
    // 选择逻辑见 utils/boardView.js
    storedSubjectNames() {
      return collectStoredSubjectNames({
        homework: this.state.boardData.homework,
        preview: this.state.preview,
        dateString: this.state.dateString,
        laterDays: this.laterDays,
      })
    },

    // 同一科目的作业分块：当日在前，后续日期按日期升序，分隔线由渲染层处理。
    // 每块都带着 dateString，卡片区靠它分出「点哪块进哪一天」的可点范围
    // 正文内部用空行分段、用「# 标题」分段，详见 HomeworkGrid 的解析
    buildSegments(subjectName) {
      return buildSubjectSegments({
        subjectName,
        homework: this.state.boardData.homework,
        preview: this.state.preview,
        dateString: this.state.dateString,
        laterDays: this.laterDays,
        dayName: this.dayName,
      })
    },

    // 落盘一天，顺手清掉空壳：content 为空的科目条目直接从这天删掉，
    // 一门都不剩就把整条记录删掉（只动这一次改到的那天，不全量扫历史）。
    // 删之前要 storedDates 确认过这天的存档真的读到过——
    // 读失败时 homework 是空的，照删会把没读出来的内容一起抹掉
    async saveDayData(dateString = this.state.dateString) {
      // 同一份数据不并发写，重复的保存直接跳过
      if (this.pendingSaves.has(dateString)) return
      let payload = null
      let day = null
      if (dateString === this.state.dateString) {
        payload = this.state.boardData
      } else {
        day = this.state.otherDays.find((d) => d.dateString === dateString)
        if (!day) return
        payload = { homework: day.homework }
      }
      // 清空的科目不留条目。直接在原对象上删，内存和落盘用的是同一份
      for (const name of emptySubjectNames(payload.homework)) {
        delete payload.homework[name]
      }
      this.pendingSaves.add(dateString)
      try {
        if (hasAnyHomework(payload.homework)) {
          const response = await dataProvider.saveData(dayDataKey(dateString), payload)
          if (!response.ok) throw new Error(response.error.message)
          this.storedDates.add(dateString)
        } else if (this.storedDates.has(dateString)) {
          // 这天一门作业都不剩：记录删掉，不留空壳
          const response = await dataProvider.deleteData(dayDataKey(dateString))
          if (!response.ok) throw new Error(response.error.message)
          this.storedDates.delete(dateString)
        }
        // 保存成功不提示，静默保存
      } catch (error) {
        this.$message.error('保存失败', error.message || '请重试')
      } finally {
        this.pendingSaves.delete(dateString)
      }
    },

    // 编辑入口，key 就是科目名；对话框初始停在哪一天由 options.date 给：
    // 卡片上点的是哪一天就进哪一天，没给就跟着展示板正在看的那天（点标题区走这条）
    openDialog(key, options = {}) {
      this.currentEditSubject = key
      this.state.editDate = options.date || this.state.dateString
      this.state.dialogOrigin = options.origin || null
      this.state.dialogVisible = true
    },

    // 编辑面板开着时的实时预览：日期 -> 正文，只往 state.preview 里放。
    // 绝不碰 boardData / otherDays，也绝不调 saveDayData——
    // 这两样是真正会落盘的东西，预览混进去就不再是「只是展示」了
    handleHomeworkPreview(entries, changed = false) {
      const key = this.currentEditSubject
      if (!key) return
      // 真实改动：认定没截图过，顺手清掉存的哈希，避免残留旧标记
      if (changed) {
        this.state._editChanged = true
        this.state.screenshotMatched = false
        if (this.state.lastScreenshotHash) {
          this.state.lastScreenshotHash = ''
          setSetting('screenshot.lastHash', '')
        }
      }
      const preview = {}
      for (const [dateString, content] of Object.entries(entries || {})) {
        preview[dateString] = { [key]: content }
      }
      this.state.preview = preview
      // 预定标记指向的那天常常在存档里还不存在，otherDays 里就没有它。
      // 先读进来：不然完成编辑时 handleHomeworkSave 要现读，读的那几毫秒里
      // 预览已经被清掉，展示板上这一段会闪一下才回来
      for (const dateString of Object.keys(preview)) {
        if (dateString === this.state.dateString) continue
        this.ensureDayHomework(dateString)
      }
    },

    // 一次编辑可能改到多天，按各自的日期写回各自的存档
    async handleHomeworkSave(entries) {
      const key = this.currentEditSubject
      if (!key || !Array.isArray(entries)) return
      const touched = []
      for (const { dateString, content } of entries) {
        const homework = await this.ensureDayHomework(dateString)
        if (!homework) continue
        homework[key] = { ...homework[key], content }
        touched.push(dateString)
      }
      for (const dateString of touched) {
        await this.saveDayData(dateString)
      }
    },

    showError(title, content = '') {
      this.$message.error(title, content)
    },

    // 截图快捷键：Ctrl/Alt+P 随时可用（这块板用不上浏览器打印）；
    // Ctrl/Alt+C 只在看板状态下接管——编辑面板开着时那是复制正文，不能抢。
    // Ctrl/Alt+Shift+… 这些组合键不拦，照旧交给浏览器
    handleScreenshotShortcut(event) {
      // Alt 也算这组快捷键（和 Ctrl/Cmd 等价）
      if (!(event.ctrlKey || event.metaKey || event.altKey)) return
      if (event.shiftKey) return
      const key = event.key?.toLowerCase()
      if (key === 'p') {
        event.preventDefault()
        this.captureBoard()
        return
      }
      if (key !== 'c' || this.state.dialogVisible) return
      // 焦点在输入框 / 可编辑区域里：Ctrl+C 还是留给复制
      if (isEditableTarget(event.target)) return
      // 真的选中了一段文字（以后开放选区的话）也别抢
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      event.preventDefault()
      this.captureBoard()
    },

    // 把卡片区截成图片放进剪贴板。截图范围只到卡片区，见 HomeworkGrid.captureCards
    async captureBoard() {
      if (this.state.capturing) return
      if (!this.sortedItems.length) return
      const grid = this.$refs.homeworkGrid
      if (!grid) return
      this.state.capturing = true
      try {
        const blob = await grid.captureCards()
        await copyImageToClipboard(blob)
        this.state.lastScreenshotHash = hashBoard(this.sortedItems, this.state.dateString)
        setSetting('screenshot.lastHash', this.state.lastScreenshotHash)
        this.state.screenshotMatched = true
      } catch (error) {
        console.error('截图失败:', error)
        this.$message.error('截图失败', error?.message || '请重试')
      } finally {
        this.state.capturing = false
      }
    },

    zoom(direction) {
      const step = 2
      if (direction === 'up' && this.state.fontSize < FONT_SIZE_MAX)
        this.state.fontSize += step
      else if (direction === 'out' && this.state.fontSize > FONT_SIZE_MIN)
        this.state.fontSize -= step
      this.state.contentStyle = { 'font-size': `${this.state.fontSize}px` }
      setSetting('font.size', this.state.fontSize)
    },

    async handleDateSelect(newDate) {
      if (!newDate) return
      const selectedDate = this.ensureDate(newDate)
      const dateStr = this.formatDate(selectedDate)
      if (dateStr === this.state.dateString) return
      this.state.instantSwitch = true
      try {
        // 数据读完之前板上仍是旧的一天；读完后在 commitSnapshot 里一次性换掉。
        // 不先切日期再等数据：那会让旧卡片配着新日期先渲染一版
        await this.commitSnapshot(dateStr)
        this.state.selectedDateObj = selectedDate
        this.refreshScreenshotMatch()
        await this.$nextTick()
      } catch (error) {
        console.error('日期处理错误:', error)
        this.$message.error('日期处理错误', '请重新选择日期')
      } finally {
        this.state.instantSwitch = false
      }
    },

    navigateDay(offset) {
      this.handleDateSelect(parseDateString(shiftDateString(this.state.dateString, offset)))
    },

    goToday() {
      this.handleDateSelect(this.getToday())
    },
  },
}
</script>

