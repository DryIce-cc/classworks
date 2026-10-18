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
          prepend-icon="mdi-calendar-today"
          variant="tonal"
          @click="goToday"
        >
          回到今天
        </v-btn>
      </Transition>
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
        <v-card border rounded="md">
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
      <homework-grid
        :sorted-items="sortedItems"
        :addable-subjects="addableSubjects"
        :content-style="state.contentStyle"
        :paused="state.dialogVisible"
        @open-dialog="openDialog"
      />
    </v-container>
  </div>

  <homework-edit-dialog
    v-model="state.dialogVisible"
    :title="currentEditSubject"
    :initial-date="state.editDate"
    :append-blank-lines="state.editAppendBlankLines"
    :extra-subjects="currentEditExtraSubjects"
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
import * as subjectStore from '@/utils/subjectStore'
import { cloneDefaultSubjects } from '@/utils/subjects'

// 不在科目列表里的科目统一排在这个位置，即所有列表科目之后
const LAST_ORDER = 9998

export default {
  name: 'Classworks 作业板',
  components: {
    HomeworkEditDialog,
    HomeworkGrid,
  },
  data() {
    return {
      currentEditSubject: null,
      state: {
        boardData: { homework: {} },
        dialogVisible: false,
        dateString: '',
        // 本次打开编辑面板要在正文末尾留几个空行：普通入口 1，
        // 从「继续添加作业」卡片进来 2，好和已有内容隔开另起一份
        editAppendBlankLines: 1,
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

    // 底部卡片：还没内容的科目，外加启用了多份作业的科目（已有内容也常驻一张「继续添加作业」）
    addableSubjects() {
      const used = this.storedSubjectNames()
      return this.state.availableSubjects
        .filter((subject) => subject.multiHomework || !used.has(subject.name))
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
    // 展示板要不要把「所看的这一天」之后的日子也摆上来。往后看（含今天）要，往回看不要：
    // 过去那块板只呈现那一天自己，后来的作业存了档也不该在那儿冒出来。
    // 拿今天当分界而不是拿所看的这一天，往后翻一天并不等于就能看到后一天的作业
    showsFutureDays() {
      return this.state.dateString >= this.todayString
    },
    // 展示板只呈现「所看的这一天 + 更晚的日子」。
    // 更早的日子只可能是编辑面板里翻回去改的：存了档，但不该在这块板上冒出来。
    // 看的是过去的日子时连更晚的一天都不摆：loadOtherDays 压根没把那些天读进来，
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
    // 只有一个地方需要记得清场
    'state.dialogVisible'(value) {
      if (!value) this.state.preview = {}
    },
  },

  async mounted() {
    try {
      await this.initializeData()
      this.unwatchSettings = watchSettings(() => {
        this.state.fontSize = getSetting('font.size')
        this.state.contentStyle = { 'font-size': `${this.state.fontSize}px` }
      })
    } catch (err) {
      console.error('初始化失败:', err)
      this.showError('初始化失败，请刷新页面重试')
    }
  },

  beforeUnmount() {
    if (this.unwatchSettings) this.unwatchSettings()
  },

  methods: {
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
      await Promise.all([this.loadDayData(), this.loadSubjects()])
    },

    async loadDayData() {
      const response = await dataProvider.loadData(dayDataKey(this.state.dateString))
      if (!response.ok) {
        // NOT_FOUND 是压根没记录，读失败则是未知状态，两种都不记进 storedDates；
        // 在册的只在明确 NOT_FOUND 时才撤（比如记录已被删过）
        if (response.error?.code === 'NOT_FOUND') this.storedDates.delete(this.state.dateString)
        this.state.boardData = { homework: {} }
      } else if (Array.isArray(response.data)) {
        // 旧版数组格式：内容认不出来，别记在册——不然会被当成空记录删掉
        this.state.boardData = { homework: {} }
      } else {
        this.storedDates.add(this.state.dateString)
        this.state.boardData = {
          homework: response.data.homework || response.data || {},
        }
      }
      await this.loadOtherDays()
    },

    // 当天和未来视图把更后面的作业一并读出来；查看过去日期时不启用——
    // 那块板只呈现那一天自己，别把后来的作业混进去
    async loadOtherDays() {
      const todayStr = this.todayString
      if (this.state.dateString < todayStr) {
        this.state.otherDays = []
        return
      }
      try {
        const res = await dataProvider.loadKeys({ limit: 1000 })
        if (!res.ok || !Array.isArray(res.data)) {
          this.state.otherDays = []
          return
        }
        const dates = res.data
          .map(dayFromKey)
          .filter((ds) => ds && ds > this.state.dateString)
          .sort()
        const days = []
        for (const ds of dates) {
          const data = await this.readStoredDay(ds)
          if (!data) continue
          this.storedDates.add(ds)
          days.push({ dateString: ds, homework: data.homework || {} })
        }
        this.state.otherDays = days
      } catch (error) {
        console.warn('加载后续日期作业失败:', error)
        this.state.otherDays = []
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
    // 不然会被当成空记录删掉（见 loadDayData 里的说明）
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

    // 科目配置从共享存储读：读不到就保留现有清单
    // （首次启动时现有清单本来就是默认的；翻日期时不能把已经读到的配置重置掉）
    async loadSubjects() {
      this.state.availableSubjects = await subjectStore.loadSubjects(this.state.availableSubjects)
    },

    // 编辑入口，key 就是科目名；对话框初始停在哪一天由 options.date 给：
    // 卡片上点的是哪一天就进哪一天，没给就跟着展示板正在看的那天（点标题区走这条）。
    // appendBlankLines 由卡片决定：底部「继续添加作业」进来要 2 个空行，其余 1 个
    openDialog(key, options = {}) {
      this.currentEditSubject = key
      this.state.editAppendBlankLines = options.appendBlankLines || 1
      this.state.editDate = options.date || this.state.dateString
      this.state.dialogVisible = true
    },

    // 编辑面板开着时的实时预览：日期 -> 正文，只往 state.preview 里放。
    // 绝不碰 boardData / otherDays，也绝不调 saveDayData——
    // 这两样是真正会落盘的东西，预览混进去就不再是「只是展示」了
    handleHomeworkPreview(entries) {
      const key = this.currentEditSubject
      if (!key) return
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
      try {
        const selectedDate = this.ensureDate(newDate)
        const dateStr = this.formatDate(selectedDate)
        if (dateStr === this.state.dateString) return
        this.state.dateString = dateStr
        this.state.selectedDateObj = selectedDate
        await Promise.all([this.loadDayData(), this.loadSubjects()])
      } catch (error) {
        console.error('日期处理错误:', error)
        this.$message.error('日期处理错误', '请重新选择日期')
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
