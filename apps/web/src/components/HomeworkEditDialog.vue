<template>
  <!-- scroll-strategy="none"：默认的 block 会把页面的滚动整个锁掉、滚动条跟着隐形——
       面板开着想滚背后展示板的时候根本滚不动。放开滚（配合 handlePressEnd 里
       「遮罩上拖过就不算点击」），面板关不关还归按下抬起那套手势管 -->
  <v-dialog
    v-model="dialogVisible"
    :fullscreen="false"
    :width="dialogBaseWidth"
    :max-width="dialogMaxWidth"
    content-class="homework-dialog-content"
    :content-props="{ style: dialogZoomStyle }"
    scroll-strategy="none"
    persistent
  >
    <v-card
      class="hw-card"
      :class="{ 'hw-card-closing': closeWarn }"
      border
      @mousedown="holdFocus"
      @contextmenu="blockMenu"
    >
      <v-card-title class="hw-title">
        {{ title }}
      </v-card-title>

      <!-- 内容区。标题栏自带 8px 下内边距，这里再补 8px，标题到内容正好 16px，
           和左边的 16px 对齐 -->
      <v-card-text class="hw-panel">
        <div ref="editorRow" class="d-flex">
          <div class="hw-editor-col flex-grow-1">
            <!-- 日期小标题 + 切换日期的按钮；没有下限，一直能往前翻，只在已经离开今天时给「回到今天」 -->
            <div class="date-caption">
              <!-- 平时就是原来那行灰字（Vuetify 的 text-medium-emphasis，和原来的
                   opacity:.6 是一个意思）。只要看的不是今天就染黄，位置、字号、行高一个字都没动。
                   条件和「回到今天」那个按钮同源，都看当前这一天是不是今天 -->
              <span class="day-label" :class="canGoToday ? 'text-yellow' : 'text-medium-emphasis'">{{ dayName }}的作业</span>
              <v-spacer />
              <!-- 只在已经离开今天时摆出来。淡入淡出走通用那套 -->
              <Transition name="fade">
                <v-btn
                  v-if="canGoToday"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-calendar-today"
                  @mousedown.prevent
                  @click="goToday"
                >
                  回到今天
                </v-btn>
              </Transition>
              <v-btn
                icon="mdi-chevron-left"
                size="small"
                variant="text"
                title="上一天"
                @mousedown.prevent
                @click="shiftDate(-1)"
              />
              <!-- close-on-content-click 必须为 false：默认 true 会在选择器里点任何地方都把它自己关掉 -->
              <v-menu v-model="pickerOpen" :close-on-content-click="false" location="bottom">
                <template #activator="{ props: activatorProps }">
                  <v-btn
                    v-bind="activatorProps"
                    icon="mdi-calendar"
                    size="small"
                    variant="text"
                    title="选择日期"
                  />
                </template>
                <v-card border>
                  <v-date-picker
                    :model-value="currentDateObj"
                    color="primary"
                    @update:model-value="selectDate"
                  />
                </v-card>
              </v-menu>
              <v-btn
                prepend-icon="mdi-chevron-right"
                rounded="pill"
                variant="text"
                size="small"
                @mousedown.prevent
                @click="shiftDate(1)"
              >
                {{ nextDayName }}
              </v-btn>
            </div>

            <!-- 编辑区：编辑器就是正文（content）的视图——正文里带着行首编号和 #，
                 它自己用 Decoration 藏起来、画到左边的 gutter 上，没有第二份正文。
                 外面改 content 就调它的 setValue，用户在里面打字就回写 content，
                 编号的收尾（认手敲的 N.、补号、重排）全在编辑器那边走完。
                 两边的位置是同一套（编辑器里就是 content 的偏移） -->
            <div class="hw-area">
              <homework-editor
                ref="editorRef"
                class="hw-field"
                :model-value="content"
                @update:model-value="onEditorUpdate"
                @selection-change="onEditorSelection"
              />
            </div>

            <!-- 附加科目：点一下插入「#科目名：」小节，光标落在小节里的新行。
                 只在光标停在这天的空行上时摆出来：那是「要另起一小节」的地方，
                 停在别的行上插进去只会插在半句话中间。
                 显隐用 visibility 切换（配 .vis-fade 一起淡），位置留着：
                 面板高度不能跟着跳 -->
            <div
              v-if="extraSubjects.length"
              class="extra-subjects vis-fade mt-4"
              :class="{ 'vis-fade-off': !showExtraSubjects }"
            >
              <div class="d-flex flex-wrap ga-2">
                <v-chip
                  v-for="name in extraSubjects"
                  :key="name"
                  size="small"
                  variant="outlined"
                  @mousedown.prevent
                  @click="insertExtraSubject(name)"
                >#{{ name }}：</v-chip>
              </div>
            </div>

            <!-- 推荐面板：就在左栏里、文本框正下方，和文本框同宽，不再横铺到右边键位下面。
                 固定高度（.phrase-panel 写死了），写字时编辑框不会上下跳 -->
            <homework-phrase-panel :rows="panel" @tap="tapChip" @next-line="startNextItem" />

          </div>

          <!-- 小键盘：横着还在编辑框右栏里，这一栏继续占位把宽度撑住（编辑框的宽度不能变）；
               竖直却不在这一栏内，它脱开文档流落到视口中线上，见 .numeric-keypad。
               横向不靠算坐标：fixed 不写 left 时落在自己的静态位置上，
               静态位置照这一栏的 flex 排版算，还是原来那个左边 -->
          <homework-keypad
            :bottom-keys="bottomKeys"
            :show-bottom-keys="showBottomKeys"
            :pad-keys="padKeys"
            :can-end-line="canEndLine"
            :at-section-start="atSectionStart"
            :caret-at-line-start="caretAtLineStart"
            @insert="insertAtCursor"
            @paste="pasteFromClipboard"
            @paste-and-complete="pasteAndComplete"
            @next-line="startNextItem"
            @toggle-heading="toggleHeading"
            @hold-start="startHoldRepeat"
            @hold-stop="stopHoldRepeat"
          />
        </div>
      </v-card-text>
    </v-card>

    <!-- 对话框外的一句提示：点哪儿都算完成编辑（点遮罩、点这句都一样）。
         压在对话框正下方、水平居中，只用排版和字色区分层级，不加底衬。
         绝对定位挂在对话框内容容器上（那个容器 position: absolute），
         top:100% 正好落在卡片下面；pointer-events:none 让它不挡点击 -->
    <div class="dialog-slogan">
      <span>点击空白处完成编辑</span>
      <span class="dialog-slogan-keys">Esc / Ctrl+S </span>
    </div>
  </v-dialog>

  <!-- 缩放条。整个面板缩着看（见 dialogZoomStyle），所以条不放在卡片里：
       卡片小到一定程度，右下角已经被键位和推荐面板占满了。
       Teleport 到 body 是必须的——Vuetify 自己的浮层容器上带 transform，
       position: fixed 在那样的祖先里会退化成 absolute，跟着卡片一起缩。
       数值记在应用设置里（editor.zoom），下回打开还是这个大小 -->
  <editor-zoom-bar
    :visible="dialogVisible"
    :value="editorZoom"
    :min="zoomMin"
    :max="zoomMax"
    @update:value="setEditorZoom"
  />
</template>

<script>
import HomeworkEditor from '@/components/HomeworkEditor.vue'
import HomeworkKeypad from '@/components/home/HomeworkKeypad.vue'
import HomeworkPhrasePanel from '@/components/home/HomeworkPhrasePanel.vue'
import EditorZoomBar from '@/components/home/EditorZoomBar.vue'
import dataProvider from '@/utils/dataProvider'
import { dayDataKey } from '@/utils/storageKeys'
import { getSetting, setSetting, watchSettings } from '@/utils/settings'
import { formatDayName, parseDateString, shiftDateString, toDateString } from '@/utils/date'
import { BOTTOM_KEYS, chipLabel, contextKeys, hasContent, hints, panelRows } from '@/utils/homeworkPanel'
import {
  assembleDayContent,
  findDayBlockEnd,
  headingTitleStart,
  isPlainReserveHeading,
  parseReservations,
  parseReserveLine,
  reserveLine,
  resolveReserveDay,
  retargetDayHeading,
  retargetHeading,
  retargetScopeHeading,
} from '@/utils/homeworkReserve'
import {
  applyDayToSelection,
  blankAfterHeading,
  commonDayInSelection,
  hasMixedDaysInSelection,
  mergeLinesInto,
  pruneDayHeading,
  selectionHeadings,
  stripLineToEnd,
} from '@/utils/homeworkDayOps'
import {
  commitBlank,
  joinContent,
  lineColumn,
  positionAt,
  renumberAll,
  renumberContent,
  splitContent,
} from '@/utils/homeworkList'
import {
  headingAbove,
  headingAboveStart,
  headingBlockSize,
  isHeadingLine,
  lineAt,
  ownerAt,
  tidyBlankLines,
} from '@/utils/homeworkText'

// 点在这些元素上（或紧贴着它们）都不算「点空白」，别关面板。
// 里面不能出现 .v-overlay__content：它是对话框自己的内容容器，整张卡片都在它里面。
const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], .v-btn, .v-chip, .v-field, .v-list-item, .cm-gutters, .hwe-mark, .cm-content, .cm-editor, .cm-line'
// 缩放条是面板自己的控件，但它 teleport 到 body 上（在对话框容器之外），
// 所以上面那份名单扫不到它，扫到了也不会关面板——见 nearInteractive 的注释。
// 它身上也没有 button / role=button，滑块拇指是 role=slider，照样落不到那份名单里
const ZOOM_BAR_SELECTOR = '.editor-zoom'
// 长按按钮弹出来的那套右键菜单，在触屏上是纯添乱：弹出来占半屏，
// 松手的时候还会顺手把按着的那个按钮触发一下。按钮上的右键菜单一律掐掉，
// 实现改在模板上：整块键位（.quick-tools）和缩放条各挂一个 @contextmenu.prevent，
// 不再全局监听——正文那一块不在里面，右键菜单（复制／粘贴）还照常用
// 按下到抬起的位移超过这个值就当作滚动，不关面板
const TAP_SLOP = 10
// 离控件这么近以内也算点到了它
const NEAR_PADDING = 15
// 打开后 10s 内一动不动就自动关掉，防的是误触打开
const IDLE_CLOSE_DELAY = 10000
// 动过一次之后的倒计时长：之后再无动作 20s 关闭，有动作就重置成这个值重新算
const IDLE_CLOSE_RESET_DELAY = 20000
// 自动关闭前的最后这么一段时间，整块面板淡下去：还剩 3s 才提醒，
// 早了会显得一直在闪，晚了来不及反应
const CLOSE_WARN_DELAY = 3000
// 倒计定时器醒来的间隔。够密，自动关闭的误差看不出来；够疏，白跑的轮询少
const COUNTDOWN_TICK = 200
// 正文末尾至少留几个空行，方便接着写下一条
const DEFAULT_BLANK_LINES = 1
// 删除键按住连删：延迟和重复速度都照 Windows 键盘的默认值
// （控制面板「键盘 → 速度」那一页：重复延迟 500ms、重复速率 31 字/秒，
//  换算成两次之间约 32ms）。
// 延迟比系统的 500ms 短一截：这是触摸屏上的一个按钮，不是实体键盘，
// 按下去到开始连删之间停半秒，手感上像是没按动
const HOLD_REPEAT_DELAY = 250
const HOLD_REPEAT_INTERVAL = 32
// 编辑框整体缩放的范围（百分比）。上限就 100：想放大正文去调字体设置，
// 那条是全局的，这一条只管这个面板
const ZOOM_MIN = 50
const ZOOM_MAX = 100
// 对话框 100% 时的宽度。缩放条不再改宽度，而是整体 zoom 缩（见 dialogZoomStyle）
const DIALOG_BASE_WIDTH = 700
// 卡片上按下去时，命中这些就不动焦点——它们各自有正经的焦点行为（编辑区要留着
// 选区，日期浮层要留着给键盘用）。落在这份名单以外的地方按下去只是「按了个空白」，
// 一律把默认行为掐掉：焦点就不离开编辑器，选区自然也不会丢。
// 有了这个，卡片上的 mousedown 处理就够了，不再需要全局监听 + 抬手抢焦点那一套
const FOCUS_KEEP_SELECTOR = '.cm-content, input, textarea, .v-btn, .v-chip, [role="button"]'

// 从 ownerStart 起删掉一整行。标题没了，它下面那段正文就露出来了——
// 上面要是还有个小标题，得空一行隔开，不然这段会被顺手收进那个标题里；
// 上面本来就是空的、或者本来就是正文，就不用隔（省一个没意义的空行）。
// 返回新正文，和并起来以后第一行的起始位置（放光标用）
function dropHeadingLine(content, ownerStart) {
  const ownerEnd = content.indexOf('\n', ownerStart)
  const end = ownerEnd < 0 ? content.length : ownerEnd
  const after = end < content.length ? end + 1 : content.length
  const head = content.slice(0, ownerStart).replace(/\n+$/, '')
  const rest = content.slice(after).replace(/^\n+/, '')
  // 标题删掉以后那段正文归谁管？要拿「删掉之后」的正文去问——在原文里问的话，
  // 问出来的正是那个正要删的标题自己，会误判成「归某个小标题管」
  const probe = head ? head + '\n' + rest : rest
  const governed = !!headingAbove(probe, head ? head.length + 1 : 0)
  const gap = !head ? '' : governed ? '\n\n' : '\n'
  return { text: tidyBlankLines(head + gap + rest), caretAt: (head + gap).length }
}

export default {
  name: 'HomeworkEditDialog',
  components: { HomeworkEditor, HomeworkKeypad, HomeworkPhrasePanel, EditorZoomBar },
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    // 既是卡片标题，也是存档里的 key
    title: {
      type: String,
      required: true,
    },
    // 打开时停在哪一天：外面展示板正在看的那天，这样点哪张卡就是改哪天的
    initialDate: {
      type: String,
      default: '',
    },
    // 本科目的附加科目名称，给成一键插入「# 名字的作业」小节用
    extraSubjects: {
      type: Array,
      default: () => [],
    },
    // 点开面板的那张卡片在视口里的位置 { x, y, width, height }。
    // 面板从这儿长出来、关的时候缩回这儿；没有（键盘开的）就走居中缩放
    origin: {
      type: Object,
      default: null,
    },
  },
  emits: ['update:modelValue', 'save', 'preview'],
  data() {
    return {
      // 关面板那一刻现量的卡片位置。卡片可能已经随瀑布流挪过位，
      // 比打开时记下的那份准
      closeFrom: null,
      // 日期 -> 正文。翻到别的日期再翻回来时，这一天的改动还在，
      // 关闭时一次性把所有改动过的日期写回去
      drafts: {},
      // 读进来时的样子，用来判断哪些天被改过
      initialDrafts: {},
      currentDate: '',
      // 光标所在那一行，带编号的那一份。面板看不到它，搬运行的时候用它
      currentLine: '',
      // 光标所在那一行是第几行正文。两个坐标系行数相等，行号是共用的
      currentLineIndex: 0,
      currentLineStart: 0,
      currentLineEnd: 0,
      // 光标在这一行里的第几个字
      caretInLine: 0,
      // 多选的整行范围（{ start, end }），只选一行时是 null。
      // 放在 data 里跟着 updateCurrentLine 一起更新——computed 里读
      // selectionStart 既不响应又可能炸，面板得靠它知道自己是不是在改整块
      selectedRange: null,
      // 光标前有没有选中字。selectedRange 只管跨行的整块，行内选一小段它也是
      // null，所以另外记一个「有没有选区」——小键盘感知里「单选」就是靠它
      hasSelection: false,
      pickerOpen: false,
      // 编辑框整体缩放（百分比）。从应用设置读进来的，下回打开还是这个大小；
      // 拖缩放条时写回设置
      editorZoom: getSetting('editor.zoom') || 100,
      // 模板要用缩放条的范围，得挂在实例上——Options API 的模板只看得到 data 里的
      zoomMin: ZOOM_MIN,
      zoomMax: ZOOM_MAX,
      // 倒计进入最后 3s：面板淡下去提醒。一有动作立刻回实
      closeWarn: false
    }
  },

  created() {
    // 按下位置，不进响应式：只是用来判断这一下算不算「点击空白」
    this._press = null
    this._programmatic = false
    this._closeTimer = 0
    // 定时器的单调时钟可能差几十毫秒，条走完和自动关闭就对不上了。
    // 非响应式：轮询自己算，不需要触发重渲染
    this._closeDeadline = 0
    // 目标日的存档正文，日期 -> Promise。预览每敲一个字都要用，不能每次都去等
    // IndexedDB，所以连 Promise 一起存着，并发调用自然共用同一次读取
    this._baseCache = {}
    // 预览的世代号：读存档是异步的，回来时正文可能又变了，过期的那份直接扔掉
    this._previewToken = 0
    // 删除键按住连删的两个定时器（见 startHoldRepeat）
    this._holdDelay = 0
    this._holdRepeat = 0
  },
  mounted() {
    // 用捕获阶段监听，按钮、浮层挡在前面也照样能收到
    document.addEventListener('pointerdown', this.handlePressStart, true)
    document.addEventListener('pointerup', this.handlePressEnd, true)
    document.addEventListener('pointercancel', this.cancelPress, true)
    // 任何一点动静都把倒计推倒重来：按下、按键、滚轮、挪鼠标统统算「有人在用面板」，
    // 重来以后一律按 IDLE_CLOSE_RESET_DELAY 走。同样走捕获阶段，焦点落到面板外也照样收得到。
    // 鼠标移动也在这份名单里：只是把光标挪到某个词上、还没按下去，人也还在用这个面板。
    // pointermove 一秒能来几十次，但动一动只是把截止时刻往后推一个数，很便宜
    document.addEventListener('pointerdown', this.resetCloseCountdown, true)
    document.addEventListener('keydown', this.resetCloseCountdown, true)
    document.addEventListener('wheel', this.resetCloseCountdown, { capture: true, passive: true })
    document.addEventListener('pointermove', this.resetCloseCountdown, { capture: true, passive: true })
    // 看不见这个页面（切了标签页、窗口被最小化或完全遮住）就停表，见 handleVisibilityChange
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    // Esc / Ctrl+S 挂 document 捕获阶段，不挂卡片：点了卡片里不可聚焦的地方
    // （正文、推荐面板的空白）焦点会掉回 body，这时卡片上的 @keydown 收不到按键
    document.addEventListener('keydown', this.handleKeydown, true)
    // 面板开着且有没存盘的改动时，关页面/刷新之前先拦一下
    window.addEventListener('beforeunload', this.handleBeforeUnload)
    // 设置在别的标签页/页面改了（storage 事件），这边跟着走
    this.unwatchSettings = watchSettings((settings, event) => {
      if (event && event.key !== 'editor.zoom') return
      this.editorZoom = getSetting('editor.zoom') || 100
    })
  },
  beforeUnmount() {
    this.stopHoldRepeat()
    document.removeEventListener('pointerdown', this.handlePressStart, true)
    document.removeEventListener('pointerup', this.handlePressEnd, true)
    document.removeEventListener('pointercancel', this.cancelPress, true)
    document.removeEventListener('pointerdown', this.resetCloseCountdown, true)
    document.removeEventListener('keydown', this.resetCloseCountdown, true)
    document.removeEventListener('wheel', this.resetCloseCountdown, true)
    document.removeEventListener('pointermove', this.resetCloseCountdown, true)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    document.removeEventListener('keydown', this.handleKeydown, true)
    window.removeEventListener('beforeunload', this.handleBeforeUnload)
    if (this.unwatchSettings) this.unwatchSettings()
    this.stopHoldRepeat()
  },
  computed: {
    // 面板该从哪儿长出来：关的时候现量的优先，其次是点开时记下的那张卡片。
    // 换算成 translate 与 scale 交给 transitions.scss 里的 dialog-transition 覆盖
    dialogFrom() {
      return this.closeFrom || this.computeFromRect(this.origin)
    },
    // 对话框的原始宽度。缩放不再改它——改宽度只是横向压扁：正文重新折行、
    // 卡片反而更高；右边那列键位是 fixed 的，不跟着缩，挤进窄卡片里就跟推荐面板叠上了。
    // 缩放现在交给下面那条 zoom 整体缩，这里只把基准宽度交给 v-dialog
    dialogBaseWidth() {
      return DIALOG_BASE_WIDTH
    },
    // 整体缩放对话框。zoom 是真缩排版尺寸——内容按 700 排完，整棵子树（字体、键位、
    // 间距）一起按比例缩，比例不变。挂 transform: scale() 那条路不能走：排版盒子
    // 一点没变，只是画小了，内容仍旧按原尺寸排版，缩出来的空白也还落在对话框盒子里。
    // 用 zoom 缩下去以后，围着内容的那圈空白是真的在对话框盒子外面，
    // 点它是一个正常的「点外面」，面板照常关掉（见 handlePressEnd）
    dialogZoomStyle() {
      const from = this.dialogFrom
      return {
        zoom: `${this.editorZoom}%`,
        '--dialog-from-x': `${from ? from.x : 0}px`,
        '--dialog-from-y': `${from ? from.y : 0}px`,
        '--dialog-from-scale': from ? from.scale : 0.9,
      }
    },
    // 对话框能占的最大宽度。要按实际缩放折算，不能直接写视口能让出的那份：
    // max-width 是在「排版尺寸」这一层卡的（内容永远按 700 排、之后才被 zoom 整体缩），
    // 所以窄屏时得先把视口能让出的宽度放大回 1/缩放：排版时按放大后的值卡住，
    // 缩完正好等于视口能让出的宽度。不折算的话，窄屏下会先按 100% 把内容压到屏幕宽、
    // 再整体缩一次——缩放设 50% 就白白缩掉一半地方，缩出来的对话框比该有的小一大截
    dialogMaxWidth() {
      const zoom = this.editorZoom / 100
      return `calc((100vw - 48px) / ${zoom})`
    },
    dialogVisible: {
      get() {
        return this.modelValue
      },
      set(value) {
        this.$emit('update:modelValue', value)
      },
    },
    // 正文始终指向当前这一天，模板、粘贴、快捷键盘都走它
    content: {
      get() {
        return this.drafts[this.currentDate] || ''
      },
      set(value) {
        this.drafts[this.currentDate] = value
      },
    },
    // 正文拆开的四份东西都在这儿：每行的编号、每行的正文、正文那份的行首偏移、
    // 摘掉编号那份的行首偏移。面板、日期标签、补号全都从这一份拿——
    // 同一个正文拆两遍，早晚会对不上
    listMap() {
      return splitContent(this.content)
    },
    // 光标所在那一行的正文（不带编号、不带 # 的那一份）。面板认的是用户看得见的字，
    // 拿带编号的那一行去认，「1.」和「#」都会被当成正文的一部分
    currentBodyLine() {
      return this.listMap.bodies[this.currentLineIndex] ?? ''
    },
    todayString() {
      return toDateString(new Date())
    },
    // 打开时停在哪一天。展示板给的是它正在看的那天，
    // 拿不到（还没初始化）或格式不对时就从今天开始
    startDate() {
      return /^\d{8}$/.test(this.initialDate) ? this.initialDate : this.todayString
    },
    currentDateObj() {
      return parseDateString(this.currentDate)
    },
    dayName() {
      return formatDayName(this.currentDate)
    },
    // 「下一天」按钮上的文字，直接告诉用户会跳到哪一天
    nextDayName() {
      return formatDayName(shiftDateString(this.currentDate, 1))
    },
    // 已经不在今天了才给「回到今天」。日期没有下限，「上一天」一直能翻，不用收起
    canGoToday() {
      return !!this.currentDate && this.currentDate !== this.todayString
    },
// 「的 xx」那个 xx 用光标所在那一节的小标题名。光标停在标题行上就用它自己，
    // 在正文里就是管着它的那一行标题；都没有就空着，面板退回「的作业」
    reserveScope() {
      if (isHeadingLine(this.currentLine)) return this.currentLine
      return headingAbove(this.content, this.currentLineStart)
    },
    // 面板的四行，哪一层都正好四行，高度才不变来变去。
    // 选中了多行就只给日期那一栏，点亮的是选区里那些行实际归的那天；
    // 混着多天就一个都不点
    panel() {
      const selection = this.selectedRange
        ? { day: this.selectionDay, mixed: this.selectionMixedDays }
        : null
      return panelRows(
        // 传带 # 的那一行（currentLine），不是输入框那份正文：
        // 面板第一件事就是判断光标在不在小标题行上，# 得在
        this.currentLine,
        this.todayString,
        this.reserveScope,
        this.currentDate,
        selection,
      )
    },
    // 选区里那些行实际归的是同一天就返回那天；混着多天、
    // 或者一行有效内容都没有，就返回空串
    selectionDay() {
      if (!this.selectedRange) return ''
      return commonDayInSelection(
        this.content,
        this.selectedRange.start,
        this.selectedRange.end,
        this.todayString,
        this.currentDate,
      )
    },
    // 选区里混着多天：日期按钮一个都不点亮
    selectionMixedDays() {
      if (!this.selectedRange) return false
      return hasMixedDaysInSelection(
        this.content,
        this.selectedRange.start,
        this.selectedRange.end,
        this.todayString,
        this.currentDate,
      )
    },
    bottomKeys() {
      return BOTTOM_KEYS
    },
    // 附加科目什么时候摆出来：只在光标停在这天的空行上、没有整块多选的时候。
    // 不摆的时候靠 visibility 藏（配模板里的 .vis-fade 一起淡），位置留着，面板高度不跟着变
    showExtraSubjects() {
      return !this.selectedRange && this.currentBodyLine.trim() === ''
    },
    // 「~」「.」那两个格子按光标前面停在哪换，规则见 contextKeys 的注释表
    padKeys() {
      return contextKeys(this.textBeforeCaret)
    },
    // 量词那一排（张 页 题 课 章）该不该出现：光标前面紧挨着一个阿拉伯数字就该出现。
    // 放 computed 不放 methods：模板里 v-if 写的是 showBottomKeys（不加括号），
    // 拿 methods 的话模板取到的是那个函数本身，永远为真，这一排就从来不隐藏
    showBottomKeys() {
      return hints(this.textBeforeCaret)
    },
    // 光标在这一行里的位置。放在 data 里跟着 updateCurrentLine 一起更新，
    // 不在 computed 里摸 DOM——渲染期读 selectionStart 既不响应，又可能炸掉整个面板。
    // 从正文那一行的开头数，也就是编号后面数：编号不在输入框里，
    // 从行首数的话每个位置都会平移一个编号的长度
    textBeforeCaret() {
      return this.currentBodyLine.slice(0, this.caretInLine)
    },
    // 光标单选（没选中字）而且停在这一行最开头。行首补空格只会留个前导空格，
    // 那一格改成写小标题的 #
    caretAtLineStart() {
      return !this.hasSelection && this.caretInLine === 0
    },
    // 光标上面那一行。正文最上面时是空串
    lineAbove() {
      if (this.currentLineStart <= 0) return ''
      const end = this.currentLineStart - 1
      return this.content.slice(this.content.lastIndexOf('\n', end - 1) + 1, end)
    },
    // 光标停在一个空行上，它不是文首、上面那行也不是空的：这一行是新起一段的
    // 开头，换行那个键改叫「分段」。做的事一样，只是名字说清这一步的用途
    atSectionStart() {
      if (this.hasSelection || this.currentBodyLine !== '') return false
      return this.currentLineStart > 0 && this.lineAbove.trim() !== ''
    },
    // 换行只在「这一行真有内容」的时候才亮：光秃秃一个数字、或者只有标点，
    // 现在换行只会把没写完的东西切两半
    canEndLine() {
      return hasContent(this.currentBodyLine)
    },
  },
  watch: {
    // 日期选择器收起来之后把焦点还给输入框。
    // 在选择器里点日期，焦点跟着进了那层浮层；选完它就消失，焦点掉回 body，
    // 接着打字一个字也进不来。点它的时候是特意不抢焦点的（见 holdFocus），
    // 所以还回来得挑这个时候——选完了，就该回到正文上继续写
    pickerOpen(open) {
      if (open || !this.dialogVisible) return
      this.$nextTick(() => {
        this.$refs.editorRef?.focus?.({ preventScroll: true })
      })
    },
    // 正文一动就把预览推给展示板。存盘不归这里管——预览只是给外面看，
    // 真正写盘只发生在 handleClose
    drafts: {
      deep: true,
      handler() {
        this.pushPreview()
      },
    },
    async modelValue(newValue) {
      if (newValue) {
        // 新开一次，上一回关面板时量的位置作废
        this.closeFrom = null
        this._closing = false
        this.drafts = {}
        this.initialDrafts = {}
        // 上一次编辑读过的存档作废：这段时间里存档可能已经被写过了
        this._baseCache = {}
        // 从面板出现那一刻开始算，读存档的耗时也算在这段倒计里
        this.startCloseCountdown()
        await this.loadContent(this.startDate)
        this.focusAndSync()
      } else {
        this.stopCloseCountdown()
      }
    },
  },
  methods: {
    // 卡片矩形 -> 过渡用的位移与缩放。位移按「卡片中心 - 视口中心」算：
    // 面板是 flex 居中的，中心就在视口中心，translate 过去正好落在卡片上。
    // 元素带 zoom，translate 会被 zoom 一起缩，所以要除回去
    computeFromRect(rect) {
      if (!rect) return null
      const zoom = this.editorZoom / 100
      const width = Math.min(DIALOG_BASE_WIDTH * zoom, window.innerWidth - 48)
      if (!width || !rect.width) return null
      return {
        x: (rect.x + rect.width / 2 - window.innerWidth / 2) / zoom,
        y: (rect.y + rect.height / 2 - window.innerHeight / 2) / zoom,
        // 起手是卡片那么大，长到面板大小；太小的卡片别缩成一个点。
        // 缩放只作用在面板底色上，里面的字另有节奏（见 transitions.scss）
        scale: Math.min(0.92, Math.max(0.2, rect.width / width)),
      }
    },
    // 关面板时卡片可能已经被瀑布流挪走、或者从「添加」卡变成了正式卡片，
    // 按 key 现找一次
    findCardRect(key) {
      if (!key) return null
      const cards = document.querySelectorAll('.grid-item[data-key], .empty-subject-card[data-key]')
      for (const card of cards) {
        if (card.dataset.key === key) return card.getBoundingClientRect()
      }
      return null
    },
    // 顶部倒计条：停手一会儿就自动关掉，防的是误触打开。
    // 打开那一刻起先按 IDLE_CLOSE_DELAY 算，读存档的耗时也算在这段里；
    // 动过一次之后改按 IDLE_CLOSE_RESET_DELAY 算，之后每动一次都重新起算——
    // 面板一直有人用就一直不关，停手 20s 才关。
    // 撤/重来的动作挂在 document 捕获阶段，所以按钮、浮层挡在前面也照样收得到。
    //
    // 只用一个轮询定时器，不给关闭单独挂 setTimeout：动一动就把截止时刻往后推，
    // 推的动作多到不值得为它反复开关一个定时器（pointermove 一秒能来几十次）。
    // 轮询醒来时自己算还剩多少，到点了关，剩下不到一段就把条挂出来。
    startCloseCountdown(delay = IDLE_CLOSE_DELAY) {
      this.stopCloseCountdown()
      // 新的一轮从实心开始，上一次残留的淡化不带过来
      this.closeWarn = false
      this._closeDeadline = performance.now() + delay
      this._closeTimer = window.setInterval(this.tickCloseCountdown, COUNTDOWN_TICK)
      this.tickCloseCountdown()
    },

    stopCloseCountdown() {
      if (this._closeTimer) window.clearInterval(this._closeTimer)
      this._closeTimer = 0
      this._closeDeadline = 0
      // closeWarn 不在这里清：关闭时面板正淡着走，清掉会先亮回来再缩
    },

    // 轮询醒来：到点了关面板；最后 3s 把面板淡下去提醒
    tickCloseCountdown() {
      if (!this._closeTimer) return
      const left = this._closeDeadline - performance.now()
      if (left <= 0) {
        this.stopCloseCountdown()
        this.handleClose()
        return
      }
      // 最后 3s 才淡下去，之前一直是实心的
      const warn = left <= CLOSE_WARN_DELAY
      if (warn !== this.closeWarn) this.closeWarn = warn
    },

    // 有人动了：截止时刻推到 IDLE_CLOSE_RESET_DELAY 之后。
    // 面板没开着（定时器早清了）就什么都不做，白名单外的按键（比如修饰键）也照样算数。
    // 值本来是 false 时这次赋值不会触发重渲染
    resetCloseCountdown() {
      if (!this._closeTimer) return
      this._closeDeadline = performance.now() + IDLE_CLOSE_RESET_DELAY
      this.closeWarn = false
    },

    // 页面看不见时（切了标签页、窗口最小化或被完全遮住）不计表：
    // 人在别处忙不算「一动不动」，回来反而该重罚，所以从头给一整段
    // IDLE_CLOSE_RESET_DELAY，不再按误触的 IDLE_CLOSE_DELAY 算。
    handleVisibilityChange() {
      if (document.hidden) {
        this.stopCloseCountdown()
        return
      }
      if (this.dialogVisible) this.startCloseCountdown(IDLE_CLOSE_RESET_DELAY)
    },

    // 切到某一天：没访问过就读存档存成草稿，访问过就直接用草稿
    async loadContent(dateString) {
      this.currentDate = dateString
      if (this.drafts[dateString] != null) return
      const trimmed = (await this.ensureBase(dateString)).trim()
      this.initialDrafts[dateString] = trimmed
      this.drafts[dateString] = this.padTrailingBlankLines(trimmed)
    },
    // 正文末尾补足空行，已经够了就只补差额。空正文不动（没什么可隔开的）。
    // 预定标记搬过去的目标日要另开一份，不该跟着入口走——传 DEFAULT_BLANK_LINES
    padTrailingBlankLines(content, want = DEFAULT_BLANK_LINES) {
      if (!content) return content
      const count = Math.max(0, want)
      const have = /(\n*)$/.exec(content)[1].length
      return have >= count ? content : content + '\n'.repeat(count - have)
    },

    // 追加一个附加科目小节：小标题独占一段，渲染层才认得出它是附加科目的作业。
    // 光标前已经有内容时先补一个空行当分隔，再另起一行写小标题，光标落在小标题下面那行。
    // # 后面不留空格：小标题本来就靠「# 开头」认，多写一个空格只是宽出来一格。
    // 末尾那个冒号照着正文里手写的样子来，「作为…的 xx」那一行会自己摘掉它
    insertExtraSubject(name) {
      const editor = this.getEditor()
      if (!editor || !name) return
      const sel = editor.getSelection()
      const start = Math.min(sel.anchor, sel.head)
      const end = Math.max(sel.anchor, sel.head)
      const before = this.content.slice(0, start)
      let prefix = ''
      if (before) {
        if (!before.endsWith('\n')) prefix = '\n\n'
        else if (!before.endsWith('\n\n')) prefix = '\n'
      } else if (this.content.startsWith('#')) {
        // 光标在正文最开头，没有 before 可判断；但整段若本来就是以附加科目小节开头，
        // 新插入的小节照样得和它隔开
        prefix = '\n\n'
      }
      const text = prefix + `#${name}：\n`
      this.content = this.content.slice(0, start) + text + this.content.slice(end)
      this.renumberNow({ from: start + text.length })
    },

    // 过去的日子也翻得动，所以两个方向都不设限
    shiftDate(offset) {
      this.switchDate(shiftDateString(this.currentDate, offset))
    },
    goToday() {
      this.switchDate(this.todayString)
    },
    selectDate(value) {
      const next = value instanceof Date ? toDateString(value) : value
      if (!/^\d{8}$/.test(next) || next === this.currentDate) return
      this.switchDate(next)
    },
    // 翻日期也是一种「离开」，先把正文里的预定标记落实掉，
    // 不然跨页之后那些标记还留着，回头就找不着它原来管的那几行了。
    // 落实完就 goto 过去——搬走的内容已经进了 drafts，完成编辑时 changedDrafts
    // 会把当天和所有目标日一起交回去写盘，这里不用另外 emit。
    async switchDate(dateString) {
      await this.settleReservations()
      await this.loadContent(dateString)
      this.focusAndSync()
    },
    // 输入框重新可用了才能定位光标，所以聚焦要等一拍。
    // 光标落在正文末尾：打开这个面板就是来接着写的，从头开始等于逼用户先按几十下
    // 方向键。末尾那一行是留出来接着写的空行，落点就是正文最后那个位置
    focusAndSync() {
      this.$nextTick(() => {
        this.focusInput()
        this.getEditor()?.setCaret?.(this.content.length)
        this.updateCurrentLine()
      })
    },
    focusInput() {
      this.$refs.editorRef?.focus?.()
    },
    // 关闭判定统一走「按下—抬起」这一段手势，自己掌控，不依赖 Vuetify 的 click:outside
    // （浮层叠起来时它的 closeConditional 会因为 localTop 为 false 而永不触发）。
    // 面板内：落在真正的空白处才关（贴着控件的误触不关，焦点还给输入框）；
    // 面板外（遮罩）：轻点就关
    handlePressStart(event) {
      if (!this.dialogVisible || event.button > 0) return
      // 多指触摸：只认第一根手指
      if (this._press && this._press.pointerId !== event.pointerId) return
      const content = this.dialogContent()
      this._press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        inside: !!content?.contains(event.target),
        pickerOpen: this.pickerOpen,
        // 按下时落在缩放条上就记一笔。拖滑块的过程中指针会离开那条元素
        // （拖到滑轨尽头、滑出条的范围），抬手时再照落点判就判成「点了外面」，
        // 面板当场关掉——拖个缩放把编辑框关了。所以这一下按起点算，不按落点算
        onZoomBar: !!event.target?.closest?.(ZOOM_BAR_SELECTOR),
      }
    },

    handlePressEnd(event) {
      const press = this._press
      this._press = null
      if (!this.dialogVisible || !press || press.pointerId !== event.pointerId) return
      // 拖缩放条拖出去的这一下，不算「点了外面」
      if (press.onZoomBar) return
      // 触屏滚动：按下到抬起之间移动过就不是「点击」。卡片里滑动是想滚动或
      // 滚掉输入框的焦点；遮罩上滑则多半是在滚背后展示板——对话框开着时页面
      // 一直在滚（scroll-strategy="none"），滚背后的板不该把面板关掉
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP) return
      // 这一下是专门用来收起日期选择器的（点在它外面），别顺带把面板也关了
      if (press.pickerOpen && !this.insideFloatingOverlay(event.clientX, event.clientY)) return
      // 落在控件上、或者贴着控件的那一下都算误触：面板留着，焦点还留在编辑框
      // （卡片上的 mousedown 已经 preventDefault 掉了那次抢焦点，见 holdFocus）。
      // NEAR_PADDING 那圈容错只给卡片里面（slack = press.inside），遮罩上不给，
      // 不然贴着卡片边点就关不掉。落到真正的空白上就关面板——卡片里、遮罩上都一样
      if (this.nearInteractive(event.clientX, event.clientY, press.inside)) return
      this.handleClose()
    },

    cancelPress() {
      this._press = null
    },

    // 对话框自己的内容容器：日期选择器虽然渲染在卡片内部，但属于另一个 .v-overlay__content。
    // v-dialog 的根是 Fragment，$el 拿不到元素，所以靠 content-class 定位。
    dialogContent() {
      return document.querySelector('.homework-dialog-content')
    },

    // 日期选择器虽然渲染在卡片内部，但属于另一个 .v-overlay__content。
    // 外面工具栏的选择器是另一个实例，各关各的
    insideFloatingOverlay(x, y) {
      const ownContent = this.dialogContent()
      for (const el of document.elementsFromPoint(x, y) || []) {
        const overlay = el.closest?.('.v-overlay__content')
        if (overlay && overlay !== ownContent) return true
      }
      return false
    },

    // 这一下像是想点某个控件吗。slack 是「按下时落在卡片里」，
    // 决定给不给 NEAR_PADDING 那圈手抖容错：卡片里面点偏了要护着，
    // 遮罩上不给——卡片四边本来就贴着控件（左边编辑框、右边小键盘、
    // 下边一整排推荐词），一给容错，贴着边点遮罩就永远被判成想点控件，
    // 面板再也关不掉。字号调大之后卡片更占地方，这个毛病只会更明显
    nearInteractive(x, y, slack) {
      if (this.insideFloatingOverlay(x, y)) return true
      for (const el of document.elementsFromPoint(x, y) || []) {
        if (el.closest?.(INTERACTIVE_SELECTOR) || el.closest?.(ZOOM_BAR_SELECTOR)) return true
      }
      if (!slack) return false
      // 手抖点偏了：附近 NEAR_PADDING 内还有控件，也不关。只扫对话框内部——
      // 外面展示板上的卡片再密也不该拖住这个面板，合起来又是一次全文档遍历
      const own = this.dialogContent()
      for (const el of own?.querySelectorAll(INTERACTIVE_SELECTOR) || []) {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        if (
          x >= rect.left - NEAR_PADDING &&
          x <= rect.right + NEAR_PADDING &&
          y >= rect.top - NEAR_PADDING &&
          y <= rect.bottom + NEAR_PADDING
        ) {
          return true
        }
      }
      return false
    },

    // Esc / Tab 与 Ctrl/Cmd/Alt+S 都当作「完成编辑」，和点空白一样走保存流程。
    // 挂在 document 捕获阶段：焦点不在卡片里也照样收得到（见 mounted 里的说明）
    handleKeydown(event) {
      if (!this.dialogVisible) return
      // Alt 也算这组快捷键（和 Ctrl/Cmd 等价）
      const isSave = (event.ctrlKey || event.metaKey || event.altKey) && event.key.toLowerCase() === 's'
      if (event.key !== 'Escape' && event.key !== 'Tab' && !isSave) return
      // 日期选择器开着时，Esc/Tab 只收选择器，面板留着继续编辑；
      // 选择器里的方向键、回车等不在这里处理，原样放给 Vuetify
      if (this.pickerOpen && (event.key === 'Escape' || event.key === 'Tab')) {
        this.pickerOpen = false
        event.stopPropagation()
        return
      }
      // Ctrl/Alt+S 默认会弹出浏览器的「保存网页」对话框，Esc/Tab 也别漏给 Vuetify 自己那套
      event.preventDefault()
      event.stopPropagation()
      this.handleClose()
    },
    // 面板开着、且真有没存盘的改动（只是打开不算）：关页面/刷新前先确认一下，
    // 免得草稿跟着页面一起没了。完成编辑时改动已经落盘，这条不会触发
    handleBeforeUnload(event) {
      if (!this.dialogVisible) return
      if (!this.changedDrafts().length) return
      event.preventDefault()
      event.returnValue = ''
    },
    getEditor() {
      return this.$refs.editorRef || null
    },
    // 关闭时把所有改动过的日期一起交回去，不只是当前看得见的那天。
    // 完成编辑这一刻顺便把正文里的「预定」标记落实掉：标记行以下的内容
    // 搬到那一天去，标记行本身不留，被搬进去的那几天也要一并交回去写盘
    async handleClose() {
      // 只关一次：连点、或者倒计到点和手点撞在一起时，别把 save 发两遍
      if (this._closing) return
      this._closing = true
      try {
        // 关的时候现量一次卡片位置，缩回去的落点是它此刻待的地方
        this.closeFrom = this.computeFromRect(this.findCardRect(this.title))
        // 面板要关了，先把还在跑的连删停掉：按钮马上就没了，
        // 停不下来会一路删到面板关完为止
        this.stopHoldRepeat()
        // 先落实预定。它把搬走的内容直接写进目标日的草稿，所以下面
        // changedDrafts 一次就把当天和所有目标日都算上了，不用再单独合并一遍。
        // 顺序反了的话 changedDrafts 拿到的还是没搬过的正文，标记行会被存回去
        await this.settleReservations()
        const entries = this.changedDrafts()
        if (entries.length) this.$emit('save', entries)
        this.dialogVisible = false
      } finally {
        this._closing = false
      }
    },
    // 把手工写的预定标记落实到各个日期上，返回被搬进去的日期和它们的新正文。
    // 只在完成编辑和翻日期这一刻跑：展示和预览都另有自己的一份解析（buildPreviewPayload），
    // 不去动草稿，所以两者不会互相把对方算好的结果改掉
    async settleReservations() {
      // ownDate 传当前天：指回自己这天的标记就地规范化，不进 blocks，
      // 所以即使 blocks 为空也可能改了正文，不能直接 return
      const { blocks, rest } = parseReservations(this.content, this.todayString, this.currentDate)
      if (!blocks.length) {
        if (rest !== this.content) {
          this.content = rest
          this.markCaretAtEnd(rest)
        }
        return []
      }
      this.content = rest
      this.markCaretAtEnd(rest)
      // 同一天可能被预定好几块，按正文里的先后依次追加，别打乱
      const byDate = new Map()
      for (const block of blocks) {
        if (!byDate.has(block.dateString)) byDate.set(block.dateString, [])
        byDate.get(block.dateString).push(block)
      }
      const entries = []
      for (const [dateString, list] of byDate) {
        // 空行统一理一遍，末尾按默认的一份留
        // 编号按目的地那一节重排一遍：搬过去的是别处的行，编号得跟着新位置来，
        // 不然目标日里会并着两个 1.
        // 这段拼装和 buildPreviewPayload 那处逐字相同，但两边的 base 不同：
        // 这里取的是该日草稿/存档原样（可能还带着那天自己的预定标记），预览那边
        // 传的是剥掉标记并重排过编号的正文，语义不一致，所以没有抽成公共方法
        const content = this.padTrailingBlankLines(
          renumberContent(tidyBlankLines(assembleDayContent(await this.ensureBase(dateString), list))),
          DEFAULT_BLANK_LINES
        )
        // 草稿也得立刻跟上。少了这一步，这次编辑里再翻回那天，
        // loadContent 会因为 drafts 里已经有一份（旧的）就直接返回它，
        // 目标日期看到的还是搬过去之前的样子
        this.drafts[dateString] = content
        // 交回去写盘的去掉首尾空白，和 changedDrafts 同一个规矩
        entries.push({ dateString, content: content.trim() })
      }
      return entries
    },
    // 那天的底稿：这次编辑里翻到过就用草稿（别拿存档里旧的覆盖掉），没翻到过才读存档。
    // 读过的把 Promise 本身存下来——预览每敲一个字都要用，存 Promise 既省了重复打存档，
    // 也让并发调用天然共用同一次读取。readStoredDay 读不出来返回空串、不reject，
    // 所以下面那句 ??= 就够了
    async ensureBase(dateString) {
      if (this.drafts[dateString] != null) return this.drafts[dateString]
      this._baseCache[dateString] ??= this.readStoredDay(dateString)
      return this._baseCache[dateString]
    },
    // 存档里那天本子的正文。读进来先去掉首尾空白：存档里本来就该是干净的，
    // 但旧版本会把面板入口要求的空行一起写进去（见 settleReservations），
    // 在这儿理掉，末尾的空行才是我们自己按份数留的
    async readStoredDay(dateString) {
      try {
        const response = await dataProvider.loadData(dayDataKey(dateString))
        if (response.ok) {
          return (response.data?.homework?.[this.title]?.content || '').trim()
        }
      } catch (error) {
        console.error('读取作业失败:', error)
      }
      return ''
    },
    // 给展示板的实时预览：日期 -> 正文。每一份都把预定标记解析掉，
    // 搬走的内容拼到目标日那一节后面——和 settleReservations 用同一套拼法，
    // 区别只是结果不落进草稿。所以展示板上看到的是「将会变成什么样」，
    // 而不是已经存了什么
    async buildPreviewPayload() {
      const payload = {}
      // 标记可能来自任何一天，同一个目标日要把各处的块按正文里的先后并起来
      const byDate = new Map()
      for (const [dateString, draft] of Object.entries(this.drafts)) {
        // ownDate 传这份草稿自己那天：指回当天的不搬走，就地规范化后留在 rest 里。
        // 顺带重排一遍编号：展示板上不该出现「有个号、正文空着」的行
        const { blocks, rest } = parseReservations(draft || '', this.todayString, dateString)
        payload[dateString] = renumberContent(rest)
        for (const block of blocks) {
          if (!byDate.has(block.dateString)) byDate.set(block.dateString, [])
          byDate.get(block.dateString).push(block)
        }
      }
      await Promise.all(
        [...byDate].map(async ([dateString, list]) => {
          // 同一天的预定（比如在今天写「#今天」）要以剥掉标记后的正文为底，
          // 不能拿含标记的草稿自身去拼——不然标记行和内容都会被再接一遍，
          // 预览就成了「#今天\n1\n\n1」。存盘那条路（settleReservations）是先把
          // 当前正文置成 rest 再取底稿，所以没这个问题，这里对齐它
          const base =
            payload[dateString] != null ? payload[dateString] : await this.ensureBase(dateString)
          // 这段拼装和 settleReservations 那处逐字相同，但 base 语义不同：这里传入的是
          // 剥掉该日预定标记并重排过编号的正文，那边传的是该日草稿/存档原样（标记可能还在），
          // 所以没有抽成公共方法
          payload[dateString] = this.padTrailingBlankLines(
            renumberContent(tidyBlankLines(assembleDayContent(base, list))),
            DEFAULT_BLANK_LINES
          )
        })
      )
      return payload
    },
    // 每敲一个字都推一次预览。等底稿的这几毫秒里正文可能又变了，
    // 过期的那一轮直接扔掉，交给新一轮
    async pushPreview() {
      const token = ++this._previewToken
      const payload = await this.buildPreviewPayload()
      if (token !== this._previewToken) return
      // 第二个参数：这次预览相对打开面板时的初始内容有没有真实改动。
      // 刚打开那几轮种子预览没改过，调用方据此不清「已截图」哈希
      this.$emit('preview', payload, this.changedDrafts().length > 0)
    },
    // 改动过的日期：正文和读进来时不一致就算改过（首尾空白不算改动）。
    // 存进去之前重排一遍：空行上挂着的号顺手清掉（它不是一条作业），
    // 存了的话卡片上会多出一行光秃秃的号，板上还白占一行
    changedDrafts() {
      const entries = []
      for (const dateString of Object.keys(this.drafts)) {
        const content = renumberContent((this.drafts[dateString] || '').trim())
        if (content !== (this.initialDrafts[dateString] || '').trim()) {
          entries.push({ dateString, content })
        }
      }
      return entries
    },
    updateCurrentLine() {
      const editor = this.getEditor()
      if (!editor) return
      const sel = editor.getSelection()
      this.selectedRange = this.readSelectedRange()
      this.hasSelection = sel.anchor !== sel.head
      const caret = sel.head
      const { text, start, end, index } = lineAt(this.content, caret)
      this.currentLine = text
      this.currentLineIndex = index
      this.currentLineStart = start
      this.currentLineEnd = end
      const prefix = this.listMap.lines[index].length - this.listMap.bodies[index].length
      this.caretInLine = Math.max(0, Math.min(caret - start - prefix, this.listMap.bodies[index].length))
    },
    // 用户在编辑框里改了什么：正文跟上来，当前行／选区跟着刷一遍
    onEditorUpdate(value) {
      if (this._programmatic) {
        this._programmatic = false
        return
      }
      this.content = value ?? ''
      this.updateCurrentLine()
    },
    // 选区变了就刷当前行／面板。编辑器自己盯着选区，拖选中途、键盘扩选、
    // 原生工具改的选区都能收到。以前另有一条 document 上的 selectionchange
    // 兜底（页面上任何选区都触发它，还得自己筛），现在只剩这一路
    onEditorSelection() {
      this.updateCurrentLine()
    },
    syncEditor(anchor) {
      const editor = this.getEditor()
      if (!editor) return
      this._programmatic = true
      if (anchor != null) editor.setValue(this.content, { anchor })
      else editor.setValue(this.content)
      this._programmatic = false
      this.updateCurrentLine()
    },
    // 卡片上按空白不抢焦点。浏览器把焦点搬走是在 mousedown 的默认行为里，
    // 在这里掐掉就行：焦点一直留在编辑器上，选区也就不会丢。
    // 命中的是真控件就放行——按钮要能按、日期浮层要能收键盘。
    // 以前是靠 document 上那两路全局监听（selectionchange 兜选区、pointerup 抢焦点）
    // 拼出来的，现在这两件都由编辑器自己的 selection-change 和这一处 preventDefault 负责
    holdFocus(event) {
      if (!this.dialogVisible) return
      if (event.target?.closest?.(FOCUS_KEEP_SELECTOR)) return
      event.preventDefault()
    },
    // 卡片上「不是正文的地方」一律不出右键菜单（触屏长按那套占半屏，还顺手把
    // 按着的东西触发掉）。键位和缩放条自己在模板上挂了 @contextmenu.prevent，
    // 这里管的是卡片里剩下的部分：推荐面板、日期那一行的字、卡片留白。
    // .cm-content 放行——正文的右键菜单（复制／粘贴）还得留着
    blockMenu(event) {
      if (!this.dialogVisible) return
      if (event.target?.closest?.('.cm-content')) return
      event.preventDefault()
    },
    // 缩放条拖完写回应用设置，下次打开还是这个大小
    setEditorZoom(value) {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value) || 100))
      this.editorZoom = zoom
      setSetting('editor.zoom', zoom)
    },
    // 选中的多行，整行范围是 { start, end }；没选、或者只选了一行，都返回 null。
    // 只选一行不算多选——单行的走原来那套（#+单行直接改那个 #）
    readSelectedRange() {
      const editor = this.getEditor()
      if (!editor) return null
      const sel = editor.getSelection()
      const from = Math.min(sel.anchor, sel.head)
      const to = Math.max(sel.anchor, sel.head)
      if (from >= to) return null
      const content = this.content
      const start = content.lastIndexOf('\n', from - 1) + 1
      const nl = content.indexOf('\n', to - 1)
      const end = nl < 0 ? content.length : nl
      if (!content.slice(start, end).includes('\n')) return null
      return { start, end }
    },
    // 从 from 起数 count 行，最后一行末尾在哪儿
    lineRangeEnd(content, from, count) {
      let at = from
      for (let index = 1; index < count; index++) {
        const nl = content.indexOf('\n', at)
        if (nl < 0) return content.length
        at = nl + 1
      }
      const nl = content.indexOf('\n', at)
      return nl < 0 ? content.length : nl
    },

    // 面板上点一个词：只往光标处写这几个字。
    // 「作为…的 xx」那一栏点的后果看光标在哪、有没有多选，在 chooseDay 里分派
    tapChip(chip, row) {
      const word = chipLabel(chip)
      if (row?.reserve) {
        this.chooseDay(word, chip.date)
        return
      }
      this.insertWord(word, row, chip)
    },
    // 选了一个日期。点的是「正在编辑的那天」就把日期信息摘掉，点别的日子
    // 就加上/换成那天——正在编辑 10 月 10 号，那天就摘，其余日子都加上。
    // 走哪几条路看光标在哪、有没有多选：
    //   0. 选中了多行            → 整块一起改，只动落在选区里的那些 # 行
    //   1. 光标就在 # 行上        → 改的就是这个标题本身
    //   2. 上面没有小标题          → 老样子，把这一行挪到那天那一节
    //   3. 有小标题，但下面只有一行 → 直接改那个标题（不去新开一节）
    //   4. 有小标题，下面有多行    → 摘出这一行、复制标题改日期、保留空行
    // 走 3、4 之前都先找「那天已经有的那一节」并进去，别再开一个同名的。
    // 这一行本来就归那一天的话，mergeLinesInto 会挡下来，这里等于什么都不做
    chooseDay(day, date) {
      const editor = this.getEditor()
      if (!editor) return
      const strip = date === this.currentDate
      if (this.selectedRange) {
        this.applySelectedDay(day, strip)
        return
      }
      if (isHeadingLine(this.currentLine)) {
        this.retitleHeading(day, strip)
        return
      }
      const ownerStart = headingAboveStart(this.content, this.currentLineStart)
      if (ownerStart < 0) {
        // 上面没有小标题，这一行本来就是这一天的正文。点当天不动它
        if (!strip) this.insertReservation(day)
        return
      }
      if (headingBlockSize(this.content, ownerStart) <= 1) {
        // 那天已经有这一节了就并进去，别再开一个同名的
        if (this.mergeSelectedLines(day, strip)) return
        this.retitleOwner(ownerStart, day, strip)
        return
      }
      // 点的是正在编辑的那天：这行本来就是当天的作业，不用挂标记。
      // 先试并进那天已有的那一节；没处可并就摘出这一行、c/d 上移补位、
      // 末尾配一个去日期的标题——和点别的日子（insertReservation）同一套动作。
      // 不能只在上下补空行：那会把尾巴 c、d 一起隔断归属，它们就成今天的了。
      // 放在单行判断之后——只有一行的那种该删标题，由 retitleOwner 管
      if (strip) {
        const owner = headingAbove(this.content, this.currentLineStart)
        const ownerDate = resolveReserveDay(parseReserveLine(owner)?.word, this.todayString)
        if (!ownerDate || ownerDate === this.currentDate) return
        if (this.mergeSelectedLines(day, true)) return
        const result = stripLineToEnd(this.content, this.currentLineStart)
        if (!result) return
        this.content = result.text
        // 光标跟着摘走的那一行走（行里的列号没变），别掉到文末空行上
        this.renumberNow({ from: result.blockStart + this.caretInLine })
        return
      }
      if (this.mergeSelectedLines(day, false)) return
      // 复制出来跟原来一模一样（本来就是那天的），动了等于没动
      const owner = headingAbove(this.content, this.currentLineStart)
      if (retargetHeading(owner, day) === owner) return
      this.insertReservation(day)
    },
    // 整块选区改日期。选区里有 # 行就只改那些 # 行（正文行、选区外的行、
    // 还有它们各自归着的标题，一个字符都不改）；一个 # 行都没有就整段新起一节
    applySelectedDay(word, strip) {
      const range = this.selectedRange
      if (!range) return
      const before = this.content
      // 选区跨了几段就一段一段改；先试并进那天已有的同名那一节
      const owner = ownerAt(before, range.start)
      const target = resolveReserveDay(word, this.todayString)
      // 这一片本来就归那一天：什么都不做。不挡的话拼回一样的字符串会被当成
      // 「没改动」，掉进兜底白白复制出一个同名的小标题
      if (owner && target) {
        const ownerDate = resolveReserveDay(parseReserveLine(owner)?.word, this.todayString)
        if (ownerDate === target) return
      }
      // 选区跨了好几节就别整块往一处并了——那是一段一段的事，交给下面那个。
      // 只有「就在一节里」才并：整节搬走并进那天同名的某一节，
      // 或者点编辑日时并进上面那个没有小标题的正文块
      const oneSection = selectionHeadings(before, range.start, range.end).every(
        (at) => at === range.start,
      )
      let result = oneSection
        ? mergeLinesInto(
            before,
            range.start,
            range.end,
            this.todayString,
            target || this.currentDate,
            strip,
          )
        : null
      if (!result) result = applyDayToSelection(before, range.start, range.end, word, strip)
      if (!result || result.text === before) return
      this.content = result.text
      // 重编号会改动前面几行那几个字的长度，选区得按「第几行」重新框，
      // 别拿重编号之前的偏移去框
      this.renumberNow({
        from: result.blockStart,
        to: this.lineRangeEnd(result.text, result.blockStart, result.blockLines),
      })
    },
    // 把光标这一行并进那天已有的某一节，而不是新起一节。成功返回 true。
    // 没有可并的地方就返回 false，调用方照原样新起一节
    mergeSelectedLines(day, allowPlain) {
      const target = resolveReserveDay(day, this.todayString)
      if (!target) return false
      const merged = mergeLinesInto(this.content, this.currentLineStart, this.currentLineEnd, this.todayString, target, allowPlain)
      if (!merged) return false
      this.content = merged.text
      // 光标跟着挪过去的那一行走。行里的列号没变（那几行一个字都没动），
      // 用挪动后的行首加上原来的列号就行。搬完按目的地那一节重排一遍编号
      this.renumberNow({ from: merged.blockStart + this.caretInLine })
      return true
    },
    // 光标停在 # 行上：改的就是这个标题本身。
    // 空 #（刚敲下一个 # 就点日期）：日子和「的作业」一次配齐，
    // 去日期/换日期的区分在这里没意义——本来就没有日期可摘。
    // 「某天的作业」这类点编辑日也不去日期：剩个 #作业 删不掉，
    // 直接换成当天日期，当天纯标记存盘时自动整行删掉。
    // 两种都只换日期词，用户写的空格冒号原样保留。
    // 单行换完 # 行：下一行是文末或 # 行就空出一行，下面是正文就不动。
    // 真要删整行是「光标在它下面那一行」时的事（那一节被摘空了才删），见 retitleOwner
    retitleHeading(day, strip) {
      const editor = this.getEditor()
      if (!editor) return
      const column = editor.getSelection().head - this.currentLineStart
      const offsetInName = column - headingTitleStart(this.currentLine)
      const wasEmpty = /^[ \t　]*#[ \t　]*$/.test(this.currentLine)
      const next = wasEmpty || (strip && isPlainReserveHeading(this.currentLine))
        ? retargetHeading(this.currentLine, day)
        : retargetDayHeading(this.currentLine, day, strip)
      if (next === this.currentLine) return
      if (!next) {
        const dropped = dropHeadingLine(this.content, this.currentLineStart)
        this.content = dropped.text
        this.renumberNow({ from: dropped.caretAt })
        return
      }
      this.content = blankAfterHeading(this.content, this.currentLineStart, next)
      // 空 # 刚配好日期光标先落行尾（刚补的「作业」后面，相对位置没意义）；
      // 否则光标跟着标题名走。补的空行都在光标后面，不影响位置。
      // 最后统一：如果下一行为空，光标移到下一行行首
      let caret = wasEmpty
        ? this.currentLineStart + next.length
        : this.currentLineStart + headingTitleStart(next) + offsetInName
      const lineEnd = this.currentLineStart + next.length
      if (/^\n[ \t　]*(\n|$)/.test(this.content.slice(lineEnd))) caret = lineEnd + 1
      this.$nextTick(() => this.placeBodyCaret(caret))
    },
    // 小标题下面只有光标这一行：直接改那个标题，不另开一节。光标仍停在正文那一行
    retitleOwner(ownerStart, day, strip) {
      const editor = this.getEditor()
      if (!editor) return
      const column = editor.getSelection().head - this.currentLineStart
      const ownerEnd = this.content.indexOf('\n', ownerStart)
      const end = ownerEnd < 0 ? this.content.length : ownerEnd
      const owner = this.content.slice(ownerStart, end)
      const next = retargetScopeHeading(owner, day, strip)
      if (next === owner) return
      if (!next) {
        // 整行删掉，正文跟上面那一节并成一段。光标还在原来那一行上
        const dropped = dropHeadingLine(this.content, ownerStart)
        this.content = dropped.text
        this.renumberNow({ from: dropped.caretAt + column })
        return
      }
      this.content = this.content.slice(0, ownerStart) + next + this.content.slice(end)
      // 标题变长了，正文那一行跟着往后挪
      const caret = ownerStart + next.length + 1 + column
      this.$nextTick(() => this.placeBodyCaret(caret))
    },
    // 预定：把光标所在这一行摘下来，挪到那天「的作业」那一节的最后接着写。
    // 那天还没有这一节就在末尾新起一节；已经有了就接在已有内容后面。
    // 这一行原本被某个小标题管着的话，把那个标题也复制一份过去，
    // 是「某天的xx」就只把那天换掉、xx 保留。
    // 这里只挪位置——搬到哪天是完成编辑、或者翻日期时才解析的事
    insertReservation(day) {
      const editor = this.getEditor()
      if (!editor) return
      const line = this.currentLine
      // 光标已经在标题行上了：再套一层标题只会把内容搞乱
      if (isHeadingLine(line)) return

      // 摘掉这一行，连带一个换行，不然原地会留下一个空行
      let cutStart = this.currentLineStart
      let cutEnd = this.currentLineEnd
      if (this.content[cutEnd] === '\n') cutEnd += 1
      else if (cutStart > 0 && this.content[cutStart - 1] === '\n') cutStart -= 1
      // 摘走之前先记住这一行原本是被哪个标题管着的
      const owner = headingAbove(this.content, cutStart)
      let rest = pruneDayHeading(
        this.content.slice(0, cutStart) + this.content.slice(cutEnd),
        cutStart,
      )

      // 新一节的标题：跟着原来那个标题走，只有「某天的xx」才跟（那天要换掉）；
      // 「# 通知」这种普通标题跟过去就是多一份一模一样的标题，还是用「xx的作业」
      const heading = (owner && retargetHeading(owner, day)) || reserveLine(day)

      // 空行统一交给 tidyBlankLines 理，手工写的标题行也一并按这个理。
      // 先理再算插入点：理完偏移才是准的。反过来算的话，原文里那几个多出来的
      // 空行一被收掉，位置全往前挪，光标就落到文末去了
      rest = tidyBlankLines(rest)
      const blockEnd = findDayBlockEnd(rest, day)
      // 搬过去的这一行连着它的编号一起走（line 是带编号的那一截），
      // caretInLine 是光标在**正文**里的第几个字，两边差着一个编号的长度。
      // caret 是正文里的位置，算的时候得把这个差补回去，补错了光标就偏一格
      const prefix = line.length - this.listMap.bodies[this.currentLineIndex].length
      let text = ''
      let caret = 0
      if (blockEnd >= 0) {
        // 已经有那一天的「的作业」：接在已有内容后面。
        // 那一节后面紧跟着的如果不是换行（标题是全文最后一行），
        // 得自己补一个，不然新行会粘在标题那一行上
        const glue = blockEnd > 0 && rest[blockEnd - 1] !== '\n' ? '\n' : ''
        text = rest.slice(0, blockEnd) + glue + line + '\n' + rest.slice(blockEnd)
        // 光标跟着这一行走，停在它原来那个字后面，不是行尾。
        // 光标停在「背|诵」中间，搬完就该还在「背|诵」，落到行尾就偏了
        caret = blockEnd + glue.length + prefix + this.caretInLine
      } else {
        // 末尾新起一节。# 前面留一个空行就好，先把尾部换行抹平，
        // 不然正文末尾本来就有的空行会跟这个叠成两行。
        // 板上一条内容都没有也不补「今天的作业」——那节是空的，看着像真有事
        const body = rest.replace(/\n+$/, '')
        const head = body.trim() ? body + '\n\n' : ''
        text = head + heading + '\n' + line
        // 同上：这一行摆在最后，光标停在它原来那个字后面
        caret = text.length - line.length + prefix + this.caretInLine
      }
      // 插入本身可能造出新的空行（比如新标题前面那一个），所以最后再兜底理一遍
      text = tidyBlankLines(text)
      this.content = text
      this.renumberNow({ from: caret })
    },
    // 往光标处写一个按钮上的字。按钮上的字用户已经自己敲过一半时，只补剩下那几个
    // （已经打了「明天」再点「明天上课对答案」，就只补一个「上课对答案」），
    // 这种接着写完的情况前面不用再补逗号——不是在起一个新词
    insertWord(word, row, chip) {
      const editor = this.getEditor()
      if (!editor) return
      const sel0 = editor.getSelection()
      if (sel0.anchor !== sel0.head) {
        this.insertAtCursor(word)
        return
      }
      const before = this.listMap
      const at = row?.endsLine
        ? this.currentLineEnd
        : sel0.head
      const typed = this.typedPrefix(this.content.slice(this.currentLineStart, at), word)
      const rest = typed ? word.slice(typed.length) : word
      // comma 那一排（收尾建议）是在已有内容后面接一句，所以先补一个逗号隔开。
      // 用户自己已经打了逗号、或者已经在接着写这个词，就只补剩下的，不再来一个逗号；
      // 逗号前面是换行（光标在这一行最开头）也不补，不然那一行会以逗号开头。
      // chip 自己写 comma: false 就整个不补——「做完」直接贴在内容后面才读得通
      const tail = at > 0 ? this.content[at - 1] : ''
      const wantsComma = chip?.comma !== false
      const needsComma = wantsComma && !!row?.comma && !typed && !!tail && !/^[,，\n]$/.test(tail)
      const insert = this.spaceAfterBareMarker(
        at,
        (needsComma ? '，' : '') + rest + (row?.endsLine ? '\n' : ''),
      )
      // 自动换行是替用户做了一件事，说一声，不然光标莫名其妙跳到下一行
      if (row?.endsLine) this.$message.success('已换行', '这一条收尾了，接着写下一条')
      this.content = this.content.slice(0, at) + insert + this.content.slice(at)
      // 这一行刚由空变成有字：把编号补上。少了这一步，点一下建议词就只有正文、
      // 没有号——和打字时补号是同一个规矩（见编辑器收尾里的 anchor 那一段）
      this.commitNumber(this.currentLineIndex, before)
      this.settleNumbers()
      const caret = this.caretAfterInsert(before, at, insert)
      this.$nextTick(() => this.placeBodyCaret(caret))
    },
    // 改完正文之后光标该落回哪儿。补号会让这一行整体往后挪（前面多了「N. 」），
    // 光拿改动前的字符偏移放回去会落进编号里／落在词前面，所以按「第几行第几个字」
    // 重算。at 是改动前的位置，insert 是刚写进去的那一段（可能带换行）
    caretAfterInsert(before, at, insert) {
      const { line, column } = lineColumn(before, at)
      const rows = String(insert).split('\n')
      const caretLine = line + rows.length - 1
      const caretColumn = rows.length > 1 ? rows[rows.length - 1].length : column + insert.length
      return positionAt(this.listMap, caretLine, caretColumn)
    },
    // 光标正压在光杆编号「1.」的末尾（编号后面那个空格还没写上）时，接着写的
    // 内容前面补一个空格。存储口径要求编号后面必须有一个空格，少了它「1.2」
    // 会被整行读成正文，前面那个号就跑进正文里了（和 HomeworkEditor 里同一个规矩）
    spaceAfterBareMarker(at, text) {
      if (!text || /^[ 　]/.test(text)) return text
      const lineStart = this.content.lastIndexOf('\n', at - 1) + 1
      const before = this.content.slice(lineStart, at)
      return /^[ \t]*\d+\.$/.test(before) ? ' ' + text : text
    },
    // 光标前面已经敲进去的、又是这个词开头的，最长能对上几个字。
    // 整个词都敲进去了就不算补全——那属于「再要一个」，照常再加一遍
    typedPrefix(before, word) {
      if (before.endsWith(word)) return ''
      for (let len = Math.min(before.length, word.length - 1); len > 0; len--) {
        const prefix = word.slice(0, len)
        if (before.endsWith(prefix)) return prefix
      }
      return ''
    },
    // 手动换行：和键盘上的回车完全同一个语义，直接调编辑器的回车——
    // 行首回车在上一行插一个空行，行中间回车劈成两半，续号、编号收尾
    // 都在编辑器那边走完。这里不再自己切正文：同一个意思两套算法，
    // 迟早切出两条不一样的线
    startNextItem() {
      const editor = this.getEditor()
      if (!editor) return
      editor.focus?.()
      editor.keyEnter()
    },
    // 把编辑器的值和光标一起摆正。position 是 content 里的偏移，
// 编辑器的 doc 就是 content，两个坐标系是同一套，不用换算
    placeBodyCaret(at, to = at) {
      const editor = this.getEditor()
      if (!editor) return
      editor.focus?.()
      this._programmatic = true
      editor.setValue(this.content, { anchor: at, head: to })
      this._programmatic = false
      this.updateCurrentLine()
    },
    // 正文动过之后，把「光标在末尾那一行」这件事记下来给面板看。
    // 这时候 DOM 还没跟上（value 要等 Vue 渲染完才更新），摸 DOM 读到的是旧值，
    // 所以这一份是照着新正文直接算的
    markCaretAtEnd(content) {
      const map = splitContent(content)
      const index = map.texts.length - 1
      this.currentLine = map.lines[index]
      this.currentLineIndex = index
      this.currentLineStart = map.starts[index]
      this.currentLineEnd = content.length
      this.caretInLine = 0
      this.hasSelection = false
    },
    // 空行刚变成有字的那一下补号。只在「之前是空的、现在有字了」时才补。
    // 「这一行不要编号」由编辑器里的 refusedField 记着（正文里存不下这个状态），
    // 得问编辑器要，不能在这儿自己拿一份行号表——那份早就跟正文错位了
    commitNumber(index, before) {
      const map = this.listMap
      const wasBlank = index < (before?.texts?.length ?? 0) && !before.texts[index].trim()
      if (!wasBlank) return
      if (!map.texts[index] || !map.texts[index].trim()) return
      if (this.getEditor()?.isLineRefused?.(index)) return
      const numbers = map.numbers.slice()
      commitBlank(map.texts, numbers, index)
      this.content = joinContent(map.texts, numbers)
    },
// 编号的收尾跟输入一起办：把整篇按「每一节从上到下连号」重排一遍。
    // 排整篇而不是光标那一节：插个空行把一节劈成两节时，下半截该从 1 重新数起；
    // 删个空行把两节并成一段时，整段该接着上一段往下数。只盯着光标那一节，
    // 另一边的编号就停在旧值上不动了
    //
    // 这里不新增编号：用户敲 `3.` 就已经明说了「这条是第三条」，
    // 代码再去猜哪些行该有号，只会在用户主动去掉号的行被一编辑就冒出号来。
    // 唯一由代码补号的地方在编辑器的收尾锚点（光标那一行刚由空变有字时），
    // 那里摆明了的。
    // 输入框一个子都没变（编号不进正文），所以光标和选区原样不动
    settleNumbers() {
      const map = this.listMap
      const numbers = map.numbers.slice()
      renumberAll(map.texts, numbers)
      const next = joinContent(map.texts, numbers)
      if (next === this.content) return
      this.content = next
    },
    // 键上那个 #：光标这一行是小标题就摘了它，是普通行就补上。
    // 和点左边编号栏那一格是一个动作，两个入口做同一件事
    toggleHeading() {
      this.toggleHeadingAt(this.currentLineIndex)
    },
    // 把第 index 行的 # 状态翻过来。小键盘上那个 # 键走这里
    toggleHeadingAt(index) {
      const map = this.listMap
      if (index < 0 || index >= map.texts.length) return
      if (isHeadingLine(map.texts[index])) this.dropHeadingMark(index)
      else this.addHeadingMark(index)
    },
    // 摘掉标题行行首的 #（连带后面的空白）。点按钮、删除键、行首的 # 键都走这里。
    // 摘掉之后这一行是「无序号」状态：小标题本来就不占编号，变回普通正文也不自动
    // 补一个——用户没说要编号，硬塞一个新号进去就等于替他改主意了。
    // 想要号再点左边那一格
    dropHeadingMark(index) {
      const map = this.listMap
      const texts = map.texts.slice()
      texts[index] = texts[index].replace(/^[ \t　]*#+[ \t　]*/, '')
      const numbers = map.numbers.slice()
      numbers[index] = 0
      this.content = joinContent(texts, numbers)
      this.settleNumbers()
      this.$nextTick(() => this.placeBodyCaret(
        this.listMap.starts[index] +
          (this.listMap.lines[index].length - this.listMap.bodies[index].length),
      ))
    },
    // 补一个 #：空行或普通行变成小标题。有编号的先把号摘掉——小标题不是一条作业
    addHeadingMark(index) {
      const map = this.listMap
      const texts = map.texts.slice()
      texts[index] = '#' + texts[index]
      const numbers = map.numbers.slice()
      numbers[index] = 0
      this.content = joinContent(texts, numbers)
      this.settleNumbers()
      this.$nextTick(() => this.placeBodyCaret(
        this.listMap.starts[index] +
          (this.listMap.lines[index].length - this.listMap.bodies[index].length),
      ))
    },
    // 行搬动之后（预定搬到另一天、并进小节、删掉一整节）节的范围变了，
    // 按「每节自动连续编号」重新对一遍。光标和选区按「第几行第几个字」放回去——
    // 绝对偏移不行：编号从 1. 改成 12. 会把后面所有字的位置都挪一格
    renumberNow(range) {
      const map = this.listMap
      const numbers = map.numbers.slice()
      renumberAll(map.texts, numbers)
      this.content = joinContent(map.texts, numbers)
      const end = this.content.length
      const from = lineColumn(map, range?.from ?? end)
      const to = lineColumn(map, range?.to ?? range?.from ?? end)
      this.$nextTick(() => {
        const after = this.listMap
        this.placeBodyCaret(
          positionAt(after, from.line, from.column),
          positionAt(after, to.line, to.column),
        )
      })
    },
    // 往光标处写一段字（小键盘的键位、推荐面板上的词都走这里）。
    // 选中了字就是替换那一段，位置直接取自编辑器：编辑器的 doc 就是正文，
    // 两边同一套坐标，中间不用换算
    insertAtCursor(text) {
      if (!text) return false
      const editor = this.getEditor()
      if (!editor) return false
      const sel = editor.getSelection()
      const start = Math.min(sel.anchor, sel.head)
      const end = Math.max(sel.anchor, sel.head)
      const before = this.listMap
      const insert = this.spaceAfterBareMarker(start, text)
      this.content = this.content.slice(0, start) + insert + this.content.slice(end)
      // 光标这一行刚由空变成有字：补上编号（和写字时同一个规矩）
      this.commitNumber(this.currentLineIndex, before)
      this.settleNumbers()
      this.syncEditor(this.caretAfterInsert(before, start, insert))
      return false
    },
    // 小键盘的删除格、按住连删：都交给编辑器的退格语义（删字、删换行、
    // 行首摘记号），和键盘上的 Backspace 一个键的事只留一套说法
    deleteAtCursor() {
      const editor = this.getEditor()
      if (!editor) return
      editor.focus?.()
      editor.keyBackspace()
    },
    // 按住删除键（也是轻点一下的那一下）：按下就删一个，然后按 Windows 的默认
    // 延迟和重复速度连着删。整条路只有这一个入口——再挂一份 @click 的话轻点
    // 会删两次（pointerdown 删一个、click 再删一个）
    // 自己管这个计时，不交给 v-repeat-click——那个指令的默认 delay/speed
    // 跟 Windows 对不上，按住一下会删得比系统快一大截
    startHoldRepeat() {
      this.stopHoldRepeat()
      this.deleteAtCursor()
      // 收尾的监听挂 window 捕获阶段，不只挂按钮自己。
      // 触屏上按住手指挪开一点再抬起，pointerup 就送不到按钮上了（按钮身上的
      // @pointerup / @pointerleave 一起收不到），连删停不下来，一直删下去。
      // 鼠标一般挪不出按钮所以没这个毛病。挂在 window 上就跟按钮在不在那儿无关了
      window.addEventListener('pointerup', this.stopHoldRepeat, true)
      window.addEventListener('pointercancel', this.stopHoldRepeat, true)
      window.addEventListener('blur', this.stopHoldRepeat, true)
      this._holdDelay = window.setTimeout(() => {
        this._holdRepeat = window.setInterval(() => this.deleteAtCursor(), HOLD_REPEAT_INTERVAL)
      }, HOLD_REPEAT_DELAY)
    },
    stopHoldRepeat() {
      if (this._holdDelay) window.clearTimeout(this._holdDelay)
      if (this._holdRepeat) window.clearInterval(this._holdRepeat)
      window.removeEventListener('pointerup', this.stopHoldRepeat, true)
      window.removeEventListener('pointercancel', this.stopHoldRepeat, true)
      window.removeEventListener('blur', this.stopHoldRepeat, true)
      this._holdDelay = 0
      this._holdRepeat = 0
    },
    // 从剪贴板粘贴，保留在对话框继续编辑
    async pasteFromClipboard() {
      try {
        await this.pasteClipboard()
      } catch (error) {
        console.error('Failed to read clipboard:', error)
      }
    },
    // 从剪贴板粘贴并直接保存关闭。
    // 关闭走 handleClose，别自己 emit：本次编辑可能改到多天（比如翻到另一天改过），
    // 那些草稿也在 handleClose 的保存范围里，只交回今天会把别的改动丢掉
    async pasteAndComplete() {
      try {
        await this.pasteClipboard()
        this.handleClose()
      } catch (error) {
        console.error('Failed to read clipboard:', error)
      }
    },
    // 粘贴的共同那段。整理（像标题的行补 #、一行里挤着的条目拆开、收拾空白）
    // 都在编辑器那边的 pasteText 里做，原生 Ctrl+V 和这个按钮走的是同一个函数，
    // 两条路不会切出两种结果。这一层只管把剪贴板读出来、按光标／选区插进去
    async pasteClipboard() {
      const text = await navigator.clipboard.readText()
      if (text == null || text === '') return false
      return !!this.getEditor()?.pasteText?.(text)
    },
  },
}
</script>

<style scoped>
.hw-title {
  margin-left: 7px;
  margin-top: 14px;
}

/* 对话框正下方那句提示。挂在对话框内容容器上（那个容器 position: absolute），
   top:100% 落在卡片下面；pointer-events:none 让它不挡点击，点它照样关面板。
   不加底衬/胶囊：小字号、松字距、两级文字色，靠排版本身把主次分开 */
.dialog-slogan {
  position: absolute;
  top: calc(100% + 14px);
  left: 50%;
  transform: translateX(-50%);

  display: flex;
  align-items: center;
  gap: 0.75rem;

  font-size: 0.75rem;
  line-height: 1;
  letter-spacing: 0.08em;
  white-space: nowrap;
  pointer-events: none;

  color: rgba(255, 255, 255, 0.56);
  /* 字压在卡片上时也读得清；比原来的整块黑色虚影轻得多 */
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}

.dialog-slogan-keys {
  padding-left: 0.75rem;
  border-left: 1px solid rgba(255, 255, 255, 0.16);

  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.32);
}

/* 对话框比屏幕高的时候，卡片自己要滚（Vuetify 给卡片加的 overflow-y: auto）。
   滚动条藏起来，而且不留任何替代的指示：它一出现就要吃掉十几像素，编辑框随之
   变窄、正文重新折行、卡片高度又变，排版跟着抖；自绘一条浮在右边的滑块倒是
   不占地方，可它不能拖、也不会跟着系统那条一起淡入淡出，两头都不如
   干脆没有。这个面板开着十几秒就自动关，滚没滚动位置全靠肌肉记忆。
   滚还是照样能滚（滚轮、触摸都行） */
.hw-card {
  /* 小键盘那一列总共占多宽：键位整块 156（跟 .numeric-keypad 的 width 同一个数），
     加它和左边那栏之间的 16px 间距。
     推荐面板要往这一列底下伸（见 .phrase-panel），键位又要挡住伸过去的那一段
     （见 .numeric-keypad 的底色），两处取同一个值，改一处另一处跟着走 */
  --keypad-space: 172px;
  scrollbar-width: none;
  /* 提醒淡出之后回实用这条：比淡下去快，用户一动立刻看清 */
  transition: opacity var(--motion-base) var(--ease-standard);
}

/* 自动关闭前的最后 3 秒：整块面板淡下去。只降不透明度、不动位置，
   是「要收起来了」的提醒；用户一动就回实，回得比淡下去快，不拖 */
.hw-card-closing {
  opacity: 0.5;
  transition: opacity 700ms cubic-bezier(0.2, 0, 0, 1);
}

.hw-card::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/* 内容区。标题栏自带 8px 下内边距，这里再补 8px，标题到内容正好 16px——
   和左边的 16px 对齐 */
.hw-panel {
  margin-top: -26px;
  /* 往左挪一挪：这一栏默认 16px 的左内边距，挪到 6px 之后编辑框的左边缘
     离卡片左边近一点。右内边距不动——右边那一列是键位整块，位置和它自己有关 */
  padding-left: 6px;
}

/* 日期小标题：右侧放切换日期的按钮 */
.date-caption {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  line-height: 1.5;
  margin-bottom: 2px;
}

/* 编辑区。编辑器就是正文本身，编号／# 画在它自己的 gutter 上（见 HomeworkEditor），
   悬挂对齐靠那边给的悬挂缩进，这里只管让编辑器占满这一栏的宽度 */
.hw-area {
  display: flex;
  align-items: flex-start;
  width: 100%;
}

.hw-area :deep(.hw-field) {
  flex: 1 1 auto;
  min-width: 0;
}

/* 编辑框所在那一栏（编辑框 + 推荐面板）。
   min-width 缺省是 auto，也就是「不许比内容还窄」——推荐面板最后一行的小标题名
   是不换行的（超了要出省略号），标题名一长就等于告诉这一栏「你至少这么宽」，
   整栏跟着变宽，编辑框、对话框一起顶出屏幕。归零之后这一栏只吃 flex 分到的那份，
   多出来的字由面板里那个省略号收掉 */
.hw-editor-col {
  min-width: 0;
}

:deep(.v-chip) {
  cursor: pointer;
  user-select: none;
}

</style>

