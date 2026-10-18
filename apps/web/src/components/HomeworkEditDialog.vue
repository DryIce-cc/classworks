<template>
  <v-dialog
    v-model="dialogVisible"
    :fullscreen="false"
    :width="dialogBaseWidth"
    :max-width="dialogMaxWidth"
    content-class="homework-dialog-content"
    :content-props="{ style: dialogZoomStyle }"
    persistent
  >
    <v-card class="hw-card" border>
      <!-- 顶部倒计条：停手一会儿就自动关掉，防的是误触打开。
           卡片顶上的一条细线，面板开着就一直挂着；倒计还剩超过 COUNTDOWN_BAR_DELAY 时
           满格不动，剩不到时才从满格往下走，走完正好赶上关闭。中途一动立刻收回满格。
           脱开文档流盖在卡片上（.progress-bar 的全站口径），钉在滚动区顶边不跟着正文滚，
           见下面的 .close-countdown。
           淡入淡出走通用那套（styles/transitions.scss 的 .fade-*） -->
      <Transition name="fade">
        <div v-if="countdownActive" class="close-countdown progress-bar">
          <div
            class="close-countdown-bar"
            :class="{ 'close-countdown-bar-drain': countdownBarDraining }"
            :style="closeCountdownStyle"
          />
        </div>
      </Transition>

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
                  class="today-btn"
                  variant="text"
                  rounded="pill"
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
                <v-card border rounded="md">
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

            <!-- 值是摘掉编号的那一份正文：编号画在左边的编号栏上（见 buildGutterHtml），
                 悬挂对齐就是那条栏给的。输入框里的位置和正文里的位置差着前面若干个
                 编号的长度，往返换算走 bodyToContent / contentToBody，别直接拿来用。
                 改动一律走 onBodyInput：那里才把输入框并回正文，顺手认下新敲出来的编号 -->
            <!-- 编辑区：左边是编号栏，右边是输入框，两者是并排的两块，不叠在一起。
                     编号栏整块不吃点击（里面那些按钮吃），所以光标照样能落到输入框上。
                     悬挂对齐就是靠这一条栏给的：正文每一行都从它的右边开始，折行也是 -->
            <div class="hw-area">
              <v-textarea
                ref="inputRef"
                class="hw-field"
                :model-value="bodyText"
                auto-grow
                rows="5"
                @update:model-value="onBodyInput"
                @click="scheduleCurrentLine"
                @keydown="onInputKeydown"
                @keyup="updateCurrentLine"
                @mouseup="scheduleCurrentLine"
                @select="updateCurrentLine"
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
            <div class="phrase-panel">
              <div
                v-for="(row, ri) in panel"
                :key="ri"
                class="phrase-row"
                :class="{ 'phrase-row-affix': row.prefix || row.suffix }"
              >
                <!-- 「作为」「的作业」是固定文字，不是按钮。面板换层时这两个会时有时无，
                     进场淡入（通用那套），离场不留恋：删掉 # 的那一下它们就该跟着没，
                     慢慢淡出去的话这段时间字还在、行也还占着，看着比正文慢半拍 -->
                <Transition name="fade" :duration="{ enter: 180, leave: 0 }">
                  <span v-if="row.prefix" class="phrase-affix phrase-affix-prefix">{{ row.prefix }}</span>
                </Transition>
                <div class="phrase-chips">
                  <div v-for="(group, gi) in row.groups" :key="gi" class="phrase-group">
                    <v-chip
                      v-for="chip in group"
                      :key="chipLabel(chip)"
                      class="ma-1 phrase-chip"
                      :variant="chipVariant(row, chip)"
                      :class="{ 'phrase-chip-on': isChipLit(row, chip) }"
                      @mousedown.prevent
                      @click="tapChip(chip, row)"
                    >
                      {{ chipLabel(chip) }}
                    </v-chip>
                  </div>
                  <!-- 「正面/反面」后头那个换行（见 panelRows 里的 newline）。
                       词条是补字，这个是断句，用 flat + primary 跟它们分开；
                       ma-1 和 chip 的间距对齐，height 也照 chip 的 32px，
                       免得这一行比别行长出一截 -->
                  <v-btn
                    v-if="row.newline"
                    class="ma-1 phrase-newline"
                    color="primary"
                    rounded="pill"
                    size="small"
                    variant="flat"
                    @mousedown.prevent
                    @click="startNextItem"
                  >
                    下一行
                  </v-btn>
                </div>
                <Transition name="fade" :duration="{ enter: 180, leave: 0 }">
                  <span v-if="row.suffix" class="phrase-affix phrase-affix-suffix">{{ row.suffix }}</span>
                </Transition>
              </div>
            </div>

          </div>

          <!-- 小键盘：横着还在编辑框右栏里，这一栏继续占位把宽度撑住（编辑框的宽度不能变）；
               竖直却不在这一栏内，它脱开文档流落到视口中线上，见 .numeric-keypad。
               横向不靠算坐标：fixed 不写 left 时落在自己的静态位置上，
               静态位置照这一栏的 flex 排版算，还是原来那个左边 -->
          <div class="quick-tools ml-4" style="min-width: 156px">
            <div class="numeric-keypad">
              <!-- 数字按 789 / 456 / 123 从上往下排：跟电话和计算器一个方向，
                   拇指往上够到的第一排是最大的那几个 -->
              <div class="keypad-row">
                <v-btn
                  v-for="n in [7, 8, 9]"
                  :key="n"
                  class="keypad-btn"
                  variant="tonal"
                  @mousedown.prevent
                  @click="insertAtCursor(String(n))"
                >
                  {{ n }}
                </v-btn>
              </div>
              <div class="keypad-row">
                <v-btn
                  v-for="n in [4, 5, 6]"
                  :key="n"
                  class="keypad-btn"
                  variant="tonal"
                  @mousedown.prevent
                  @click="insertAtCursor(String(n))"
                >
                  {{ n }}
                </v-btn>
              </div>
              <div class="keypad-row">
                <v-btn
                  v-for="n in [1, 2, 3]"
                  :key="n"
                  class="keypad-btn"
                  variant="tonal"
                  @mousedown.prevent
                  @click="insertAtCursor(String(n))"
                >
                  {{ n }}
                </v-btn>
              </div>
              <!-- 这一行：中间是 0，左右两格按光标前面停在哪换（见 contextKeys）。
                   0 在中间是跟着上面 789/456/123 的习惯来：三列的键盘里 0 都在
                   最下面那一排的中间，两边对称，手不用偏 -->
              <div class="keypad-row">
                <v-btn
                  class="keypad-btn vis-fade"
                  size="small"
                  :class="{ 'vis-fade-off': !padKeys[0] }"
                  variant="tonal"
                  @mousedown.prevent
                  @click="insertAtCursor(padKeys[0])"
                >
                  {{ padKeys[0] }}
                </v-btn>
                <v-btn
                  class="keypad-btn"
                  variant="tonal"
                  @mousedown.prevent
                  @click="insertAtCursor('0')"
                >
                  0
                </v-btn>
                <v-btn
                  class="keypad-btn vis-fade"
                  size="small"
                  :class="{ 'vis-fade-off': !padKeys[1] }"
                  variant="tonal"
                  @mousedown.prevent
                  @click="insertAtCursor(padKeys[1])"
                >
                  {{ padKeys[1] }}
                </v-btn>
              </div>
<div class="keypad-row">
                <!-- 按住连删：延迟和重复速度都照 Windows 键盘的默认值，
                     见 HOLD_REPEAT_DELAY / HOLD_REPEAT_INTERVAL 的注释。

                     起始挂在 pointerdown 上，不能挂 mousedown：触屏上 mousedown
                     是在 pointerup 之后才合成出来的，挂在它上面的话，抬手那一下
                     已经过去了，连删收不回来——不光是连删，光点一下也会开始删。
                     鼠标上 mousedown 早于 pointerup，所以那条路一直没暴露出来 -->
                <v-btn
                  class="keypad-btn"
                  color="error"
                  variant="tonal"
                  title="删除"
                  aria-label="删除"
                  @pointerdown.prevent="startHoldRepeat"
                  @pointerup="stopHoldRepeat"
                  @pointerleave="stopHoldRepeat"
                  @pointercancel="stopHoldRepeat"
                >
                  <!-- 图标放默认插槽里，不用 icon 属性：icon 会强制成圆形，和旁边的键位对不上 -->
                  <v-icon icon="mdi-backspace-outline" size="small" />
                </v-btn>
                <v-btn
                  class="keypad-btn keypad-word"
                  size="small"
                  :variant="canEndLine ? 'flat' : 'tonal'"
                  :color="canEndLine ? 'primary' : undefined"
                  @mousedown.prevent
                  @click="startNextItem"
                >
                  {{ atSectionStart ? '分段' : '换行' }}
                </v-btn>
                <!-- 停在行首时空格没意义（顶头补空格只是个前导空格），
                     那一格改成「这一行是不是小标题」。# 不再是一个塞进正文的字，
                     而是编号栏那一格的记号：切过去 = 变成小标题，再按一下变回普通行。
                     两边对得上：左边点一下摘 #，这边按一下摘 # -->
                <v-btn
                  class="keypad-btn keypad-word"
                  size="small"
                  variant="tonal"
                  @mousedown.prevent
                  @click="caretAtLineStart ? toggleHeading() : insertAtCursor(' ')"
                >
                  {{ caretAtLineStart ? '#' : '空格' }}
                </v-btn>
              </div>

              <!-- 量词。刚敲完一个数才淡进来，平时淡出去藏着，但这一排的位置一直留着：
                   键位整块是脱开文档流、按视口中线摆的（见 .numeric-keypad），
                   量词一出现一消失，小键盘高度就跟着变，整块键位在视口里上下一跳。
                   淡入淡出走通用那套 visibility 切换（.vis-fade），高度一点不动 -->
              <div class="measure-row vis-fade" :class="{ 'vis-fade-off': !showBottomKeys }">
                <v-btn
                  v-for="key in bottomKeys"
                  :key="key"
                  class="measure-btn"
                  size="small"
                  variant="text"
                  @mousedown.prevent
                  @click="insertAtCursor(key)"
                >
                  {{ key }}
                </v-btn>
              </div>

              <!-- 粘贴按钮：跟着键位整块飘，横着在量词下面居中（见 .paste-bar）。
                   原来它在左栏、正文和推荐面板之间，现在跟键位并排放在右栏，
                   键位和粘贴都是「整块往正文里加字」的，一起摆一起按更顺手 -->
              <div class="paste-bar">
                <v-btn
                  size="small"
                  variant="outlined"
                  prepend-icon="mdi-content-paste"
                  @mousedown.prevent
                  @click="pasteFromClipboard"
                >
                  粘贴
                </v-btn>
                <!-- @mousedown.prevent 不能少：这一下失败时面板还开着（剪贴板读不到、
                     或者剪贴板是空的），焦点要留在编辑框里接着写，不被按钮抢走 -->
                <v-btn
                  size="small"
                  variant="elevated"
                  color="primary"
                  prepend-icon="mdi-content-paste"
                  @mousedown.prevent
                  @click="pasteAndComplete"
                >
                  粘贴并完成
                </v-btn>
              </div>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

  </v-dialog>

  <!-- 缩放条。整个面板缩着看（见 dialogZoomStyle），所以条不放在卡片里：
       卡片小到一定程度，右下角已经被键位和推荐面板占满了。
       Teleport 到 body 是必须的——Vuetify 自己的浮层容器上带 transform，
       position: fixed 在那样的祖先里会退化成 absolute，跟着卡片一起缩。
       数值记在应用设置里（editor.zoom），下回打开还是这个大小 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="dialogVisible" class="editor-zoom" title="编辑框缩放" @mousedown.prevent>
        <v-slider
          :model-value="editorZoom"
          :min="zoomMin"
          :max="zoomMax"
          :step="5"
          density="compact"
          hide-details
          class="editor-zoom-slider"
          aria-label="编辑框缩放"
          @update:model-value="setEditorZoom"
        >
          <template #label>
            <span class="editor-zoom-value">{{ editorZoom }}%</span>
          </template>
        </v-slider>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
import dataProvider from '@/utils/dataProvider'
import { getSetting, setSetting, watchSettings } from '@/utils/settings'
import { formatDayName, parseDateString, shiftDateString, toDateString } from '@/utils/date'
import { BOTTOM_KEYS, contextKeys, hasContent, hints, panelRows } from '@/utils/homeworkPanel'
import {
  assembleDayContent,
  findDayBlockEnd,
  HEADING_PREFIX,
  headingTitleStart,
  isPlainReserveHeading,
  parseHeadingLine,
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
  bodyLineIndex,
  bodyToContent,
  caretAfterChange,
  commitBlank,
  contentToBody,
  ghostNumber,
  joinContent,
  lineColumn,
  mergeBody,
  nextNumber,
  positionAt,
  renumberAll,
  renumberContent,
  settleEdit,
  splitContent,
  stripLength,
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
  'button, a, input, textarea, select, [role="button"], .v-btn, .v-chip, .v-field, .v-list-item'
// 缩放条是面板自己的控件，但它 teleport 到 body 上（在对话框容器之外），
// 所以上面那份名单扫不到它，扫到了也不会关面板——见 nearInteractive 的注释。
// 它身上也没有 button / role=button，滑块拇指是 role=slider，照样落不到那份名单里
const ZOOM_BAR_SELECTOR = '.editor-zoom'
// 长按按钮弹出来的那套右键菜单，在触屏上是纯添乱：弹出来占半屏，
// 松手的时候还会顺手把按着的那个按钮触发一下。按钮上的右键菜单一律掐掉。
// 输入框不在名单里——正文里的右键菜单（复制、粘贴）还是有用处的
const MENU_BLOCK_SELECTOR = 'button, [role="button"], .v-chip'
// 按下到抬起的位移超过这个值就当作滚动，不关面板
const TAP_SLOP = 10
// 离控件这么近以内也算点到了它
const NEAR_PADDING = 15
// 打开后 10s 内一动不动就自动关掉，防的是误触打开
const IDLE_CLOSE_DELAY = 10000
// 动过一次之后的倒计时长：之后再无动作 20s 关闭，有动作就重置成这个值重新算
const IDLE_CLOSE_RESET_DELAY = 20000
// 倒计只剩这么多秒时，顶上那条细线才挂出来，此前卡片的顶边干干净净。
// 挂出来就是满格，往下走完正好赶上关闭，中途一动就收回去重新算。
// 和 IDLE_CLOSE_DELAY 同值，所以刚打开就摆着；动过之后的那 20s 只在最后 10s 摆
const COUNTDOWN_BAR_DELAY = 10000
// 倒计定时器醒来的间隔。够密，条出现那一刻的误差看不出来；够疏，白跑的轮询少
const COUNTDOWN_TICK = 200
// （appendBlankLines），但那是「另起一份」的排版需求，只对正在编辑的那天成立
const DEFAULT_BLANK_LINES = 1
// 左边编号栏留多宽（字号倍数）。只按「一位数 + 句点 + 右对齐」留：两位数往右探一点，
// 那是用户自己写出来的，不为它把每行的正文都让宽一圈。正文从这条的右边开始，
// 折行也是从这儿开始，悬挂对齐就是这儿来的
const GUTTER_EM = 1.15
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
// 点在这些地方不抢焦点：日期那一排上的按钮（切换日期、回到今天、日历按钮），
// 以及日历自己弹出来的那层浮层。别的控件上点了，焦点还给输入框。
// 注意别把整行 .date-caption 圈进来：那一行里只有按钮是控件，
// 「今天的作业」那几个字只是标签，点它本来该把焦点收回来
const DATE_CONTROL_SELECTOR = '.date-caption .v-btn, .v-date-picker, .v-calendar'

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

// 编辑框高亮：textarea 里只能放纯文本，上色靠垫在它底下的同尺寸 div。
// 灰 `#` 行、黄日期词、有颜色代码的小标题名，只改颜色不改字重字号，
// 换行位置才和原文对得上
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 抄给高亮层的排版属性：缺一个，两边的换行/字宽就可能对不上。
// 错位平时看不见（textarea 的字是透明的），只有选区底色按 textarea 排版
// 画出来、跟底下那层字一比才露馅；英文长串对折行最敏感，所以英文错位最重。
// 全写在 backdrop 上，.hl-line 靠继承拿到，不在 CSS 里手写 assumed 值
const HIGHLIGHT_TEXT_PROPS = [
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'lineHeight', 'fontFamily', 'fontKerning', 'fontFeatureSettings',
  'fontOpticalSizing', 'fontVariantLigatures', 'fontVariantCaps',
  'fontVariantNumeric', 'fontVariantEastAsian', 'letterSpacing',
  'wordSpacing', 'textIndent', 'textTransform', 'tabSize', 'direction',
  'whiteSpace', 'wordBreak', 'overflowWrap', 'textRendering', 'textSizeAdjust',
]

// 上色层里的一行。画的字必须和输入框的值**一个字不差**。
//
// 为什么这么要紧：textarea 自己的字是透明的（只有光标和选区留在这儿），
// 眼睛看到的那行字是高亮层画上去的。两边只要差一个字——哪怕就多画一个 #
// 而值里没有——后面所有字的位置就都错开一格，光标、选区、折行全对不上，
// 而且界面上看不出哪儿错了。所以这里一个字都不自己加，# 和颜色代码都在
// 那份正文之外（左边那一格摆着 #），别在这儿再画一遍。
//
// 颜色仍然按带 # 的那一份算：日子词刷黄、标题名用它自己写的颜色代码，
// 都是从原文那一行解析出来的。刷黄的那一截（day + gap）是从行首开始的，
// 后面剩多少就照原样画多少——不能拿 parseHeadingLine 里那份 title 来画：
// 那份是给语义用的，尾部空白被 trim 掉了，跟正文一比就会少几个字
function buildHighlightHtml(bodies, texts) {
  return bodies
    .map((line, index) => {
      let inner = escapeHtml(line)
      const head = parseHeadingLine(texts[index] ?? line)
      if (head) {
        // 日子词和它后面那个「的」刷黄；日期后面的零碎（「：」）跟普通正文一个颜色，
        // 不抢注意力；剩下的是标题名，跟日期词一样取 hl-head（最高那一档强调）。
        // 三段拼起来必须正好等于 line 本身：刷黄那截占前 colored 个字，其余原样带过，
        // 结尾就算有几个空格也一个字不少
        const colored = head.day.length + head.gap.length
        inner =
          `<span class="hl-date">${escapeHtml(head.day)}</span>` +
          `<span class="hl-head">${escapeHtml(head.gap)}</span>` +
          `<span class="hl-head">${escapeHtml(line.slice(colored))}</span>`
      }
      return `<div class="hl-line">${inner || '<br>'}</div>`
    })
    .join('')
}

// 编号栏里的每一格。格子一行对一个，位置才按行号对得上。三种格子：
//   有正文的行：整个格子是一个按钮。有编号摆编号、没编号摆一个暗点，
//     「点一下加编号／去编号」。整格就是按钮：编号字那么小，点它得瞄准
//   空行：光标停上来的时候摆一个「虚拟序号」按钮——「这行写上字就是第几号」。
//     它也是能点的：点一下 = 明说这一行不要号，敲上字也不补。
//     光标不在这一行时什么都不摆：满屏灰数字比一个号吵得多
//   标题行：也是按钮，上面一个 #。小标题不是一条作业，本不该占编号，
//     但它同样需要「一个能点掉的东西」——点一下就把这行的 # 摘了，变回普通行
function buildGutterHtml(texts, numbers, ghost) {
  return texts
    .map((text, index) => {
      if (isHeadingLine(text)) {
        return cell(index, 'hw-number hw-number-mark', '#', '点一下去掉这个 #')
      }
      if (!text.trim()) {
        const on = ghost && ghost.index === index
        // hw-number 必须带上：它的宽高全在那条样式里（.hw-number），
        // 漏了的话空行上这个格子是 0×0，根本点不着——虚拟序号就变成
        // 「只能收起来、点不出来了」
        return cell(
          index,
          on ? 'hw-number hw-ghost' : 'hw-number',
          on ? ghost.number + '.' : '',
          on ? '点一下这一行不要编号' : '点一下给这一行编号',
        )
      }
      const number = numbers[index]
      return cell(index, number ? 'hw-number hw-number-on' : 'hw-number', number ? number + '.' : '', '点一下加编号／去编号')
    })
    .join('')
}

// 编号栏里的一格。按钮铺满整格，所以点哪儿都是它——编号字小，
// 点偏一格就点到输入框上去放光标了（那里一点光标就跳走）
function cell(index, cls, label, title) {
  return (
    '<div class="hw-number-cell">' +
    `<button type="button" class="${cls}" data-line="${index}"` +
    ` tabindex="-1" aria-label="${title}" title="${title}">${label}</button></div>`
  )
}

export default {
  name: 'HomeworkEditDialog',
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
    // 正文末尾至少留几个空行，方便接着写下一条。
    // 普通入口 1；从「继续添加作业」卡片进来 2，好和已有内容隔开另起一份
    appendBlankLines: {
      type: Number,
      default: 1,
    },
    // 本科目的附加科目名称，给成一键插入「# 名字的作业」小节用
    extraSubjects: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['update:modelValue', 'save', 'preview'],
  data() {
    return {
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
      // 用户明说过「这一行不要编号」的行号。空行默认是要编号的（一敲字就补上），
      // 点它 / 按空格 / 按删除键就是反过来说「这一行不要」。
      // 这个状态不进正文——空行本来没有正文可存，它只活在这一次编辑里；
      // 关掉面板再打开，那一行又是「默认要编号」的样子。
      // 放 data 里是它得是响应式的：virtualNumber 是个 computed，
      // 读的是它；挂在 created 里就是个普通属性，computed 会拿旧值缓存住
      refusedLines: [],
      pickerOpen: false,
      // 编辑框整体缩放（百分比）。从应用设置读进来的，下回打开还是这个大小；
      // 拖缩放条时写回设置
      editorZoom: getSetting('editor.zoom') || 100,
      // 模板要用缩放条的范围，得挂在实例上——Options API 的模板只看得到 data 里的
      zoomMin: ZOOM_MIN,
      zoomMax: ZOOM_MAX,
      // 按下那一刻输入框里的选区。焦点被人抢走以后浏览器不一定留着，
      // 抢回来时照这一份摆回去（见 keepCaretInInput）
      savedSelection: null,
      // 顶部倒计条是否挂着。倒计一起就在，直到面板关闭
      countdownActive: false,
      // 条是否在往下走：倒计剩不到 COUNTDOWN_BAR_DELAY 才是。从满格起走，
      // 走完这一轮正好赶上关闭，中途一动立刻收回满格
      countdownBarDraining: false,
      // 这一轮从满格走到空要多久：起走那一刻到关闭还剩多少，动画时长跟它对齐
      countdownBarDuration: 0
    }
  },

  created() {
    // 按下位置，不进响应式：只是用来判断这一下算不算「点击空白」
    this._press = null
    this._closeTimer = 0
    // 定时器的单调时钟可能差几十毫秒，条走完和自动关闭就对不上了。
    // 非响应式：轮询自己算，不需要触发重渲染
    this._closeDeadline = 0
    // 目标日的存档正文，日期 -> Promise。预览每敲一个字都要用，不能每次都去等
    // IndexedDB，所以连 Promise 一起存着，并发调用自然共用同一次读取
    this._baseCache = {}
    // 预览的世代号：读存档是异步的，回来时正文可能又变了，过期的那份直接扔掉
    this._previewToken = 0
    // 高亮底层那套：当前垫着的 textarea、高亮 div、编号栏（对话框重建时元素会换），
    // 以及上次抄几何时的宽度，变了才重抄。
    // _hlRO 盯着 textarea 的尺寸：auto-grow 改完高度就重对，不用猜时序
    this._hlTextarea = null
    this._hlBackdrop = null
    this._hlGutter = null
    this._hlWidth = 0
    // 中文输入法正在组字：这时候不动行首那个编号，摘字会把组字打断
    this._composing = false
    // 编号栏每一格的位置（上色层量出来的），挪当前行的高亮时直接读，
    // 不用每动一下光标就去量一遍布局
    this._gutterTops = []
    this._gutterHeights = []
    this._gutterClick = (event) => this.onGutterClick(event)
    // 按下就把默认行为掐掉：不然焦点跑到按钮上，输入框失焦，
    // 光标那一行的感知和面板全跟着乱。click 不受影响，照样响
    this._gutterDown = (event) => event.preventDefault()
    // rAF 合并调度的 id：一帧里不管触发多少次，只重画一遍
    this._hlRaf = 0
    // 上次画进编号栏的虚拟序号长什么样（空串 = 没画）。挪光标时先对一下，
    // 只有它变了才重画编号栏——一次挪动一次重画太浪费了
    this._ghostStamp = ''
    // 删除键按住连删的两个定时器（见 startHoldRepeat）
    this._holdDelay = 0
    this._holdRepeat = 0
    // 用户明说过「这一行不要编号」的行号。空行默认是要编号的（一敲字就补上），
    // 点它 / 按空格 / 按删除键就是反过来说「这一行不要」。
    // 这个状态不进正文——空行本来没有正文可存，它只活在这一次编辑里；
    // 关掉面板再打开，那一行又是「默认要编号」的样子
    this._hlRO = new ResizeObserver(() => this.scheduleHighlightSync())
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
    // 选区变化不一定都有 mouseup/click 配对（拖选中途、键盘扩选、还有原生工具）。
    // selectionchange 是唯一兜得住的口子——但页面上任何选区都触发它，
    // 所以只认焦点落在我们这个 textarea 上的情况
    document.addEventListener('selectionchange', this.onDocumentSelectionChange, true)
    // 看不见这个页面（切了标签页、窗口被最小化或完全遮住）就停表，见 handleVisibilityChange
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    // Esc / Ctrl+S 挂 document 捕获阶段，不挂卡片：点了卡片里不可聚焦的地方
    // （正文、推荐面板的空白）焦点会掉回 body，这时卡片上的 @keydown 收不到按键
    document.addEventListener('keydown', this.handleKeydown, true)
    // 窗口缩放会改变编辑框宽度，高亮底层的几何要跟着重抄
    window.addEventListener('resize', this.onWindowResize)
    // 长按按钮弹出来的右键菜单掐掉。挂 document 捕获阶段：编号栏那两颗按钮是
    // JS 现造的，面板里又叠着日期选择器那一层浮层，挨个绑不落得住
    document.addEventListener('contextmenu', this.blockButtonMenu, true)
    // 点哪儿都把焦点还给输入框（日期那一排和日历浮层除外）。
    // 按下记选区、抬手再抢焦点：浏览器的默认移焦点发生在 mousedown 上，
    // 等到 pointerup 再动，焦点才已经被它搬走了
    document.addEventListener('pointerdown', this.rememberSelection, true)
    document.addEventListener('pointerup', this.keepCaretInInput, true)
    // 设置在别的标签页/页面改了（storage 事件），这边跟着走
    this.unwatchSettings = watchSettings((settings, event) => {
      if (event && event.key !== 'editor.zoom') return
      this.editorZoom = getSetting('editor.zoom') || 100
    })
    // 字体后加载会改变换行位置，加载完重抄一份
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => this.syncHighlight())
    }
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
    document.removeEventListener('selectionchange', this.onDocumentSelectionChange, true)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    document.removeEventListener('keydown', this.handleKeydown, true)
    window.removeEventListener('resize', this.onWindowResize)
    document.removeEventListener('contextmenu', this.blockButtonMenu, true)
    document.removeEventListener('pointerdown', this.rememberSelection, true)
    document.removeEventListener('pointerup', this.keepCaretInInput, true)
    if (this.unwatchSettings) this.unwatchSettings()
    if (this._hlRaf) cancelAnimationFrame(this._hlRaf)
    this._hlRaf = 0
    if (this._hlTextarea) this._hlTextarea.removeEventListener('scroll', this.onHighlightScroll)
    if (this._hlTextarea) {
      this._hlTextarea.removeEventListener('compositionstart', this.onCompositionStart)
      this._hlTextarea.removeEventListener('compositionend', this.onCompositionEnd)
    }
    if (this._hlGutter) this._hlGutter.removeEventListener('click', this._gutterClick)
    if (this._hlGutter) this._hlGutter.removeEventListener('mousedown', this._gutterDown)
    this._hlRO?.disconnect()
    this._hlTextarea = null
    this._hlBackdrop = null
    this._hlGutter = null
    this.stopCloseCountdown()
  },
  computed: {
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
      return { zoom: `${this.editorZoom}%` }
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
    // 输入框那份的行首偏移。光标换算、编号栏、面板全都从这一份拿——
    // 同一个正文拆两遍，早晚会对不上
    listMap() {
      return splitContent(this.content)
    },
    // 输入框的值：摘掉编号、也摘掉行首 # 的那一份。编号和 # 都画在左边那一栏上
    // （见 buildGutterHtml / buildHighlightHtml），输入框里一个字都不留
    bodyText() {
      return this.listMap.bodies.join('\n')
    },
    // 光标所在那一行的正文（不带编号、不带 # 的那一份）。面板认的是用户看得见的字，
    // 拿带编号的那一行去认，「1.」和「#」都会被当成正文的一部分
    currentBodyLine() {
      return this.listMap.bodies[this.currentLineIndex] ?? ''
    },
    // 空行上的虚拟序号：这一行写上字的话会编第几号。
    // 两个条件都苛刻是刻意的：
    //   得是空行——有正文的那行摆的是真编号，没这个数了
    //   得是光标停着的这一行、而且没选着字：多选的时候「当前行」是好几行，
    //   报一个号只会指错；再就是满屏灰数字比一个号吵得多
    // 空编辑器就靠它给出第一个「1.」——那时只有一行，正好就是光标那一行
    virtualNumber() {
      if (this.hasSelection) return null
      const map = this.listMap
      const index = this.currentLineIndex
      if (index < 0 || index >= map.texts.length) return null
      if (isHeadingLine(map.texts[index]) || map.texts[index].trim()) return null
      // 用户明说过这一行不要号，就别再拿一个「写上字就是第几号」来引诱他
      if (this.isRefused(index)) return null
      const numbers = map.numbers
      return { index, number: ghostNumber(map.texts, numbers, index) }
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
    // 条挂出来那一刻到关闭还剩多久，动画就走多久，两边不会差半拍
    closeCountdownStyle() {
      return { animationDuration: `${this.countdownBarDuration}ms` }
    },
  },
  watch: {
    // 日期选择器收起来之后把焦点还给输入框。
    // 在选择器里点日期，焦点跟着进了那层浮层；选完它就消失，焦点掉回 body，
    // 接着打字一个字也进不来。点它的时候是特意不抢焦点的（见 keepCaretInInput），
    // 所以还回来得挑这个时候——选完了，就该回到正文上继续写
    pickerOpen(open) {
      if (open || !this.dialogVisible) return
      this.$nextTick(() => {
        const textarea = this.getTextarea()
        if (textarea && document.activeElement !== textarea) {
          textarea.focus({ preventScroll: true })
        }
      })
    },
    // 正文一动就重画高亮底层。翻日期、插入小节走的都是 content，不用每个入口单独调。
    // 走 rAF 合并：auto-grow 改高度、浏览器滚到光标都发生在排版之后，
    // 在 nextTick 里量只能量到旧的，这正是字多时下面一半消失的原因
    content() {
      this.scheduleHighlightSync()
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
        this.drafts = {}
        this.initialDrafts = {}
        // 上一轮编辑里说过的「这一行不要编号」跟正文没关系，带过来就串行了
        this.refusedLines = []
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
      this._closeDeadline = performance.now() + delay
      this.countdownActive = true
      this._closeTimer = window.setInterval(this.tickCloseCountdown, COUNTDOWN_TICK)
      this.tickCloseCountdown()
    },

    stopCloseCountdown() {
      if (this._closeTimer) window.clearInterval(this._closeTimer)
      this._closeTimer = 0
      this._closeDeadline = 0
      this.countdownActive = false
      this.countdownBarDraining = false
    },

    // 轮询醒来：到点了关面板；剩下不到 COUNTDOWN_BAR_DELAY 才让条往下走。
    // 提前于那一刻满格不动，不是一个从头就开始的进度——看着像还早着才像
    tickCloseCountdown() {
      if (!this._closeTimer) return
      const left = this._closeDeadline - performance.now()
      if (left <= 0) {
        this.stopCloseCountdown()
        this.handleClose()
        return
      }
      const drain = left <= COUNTDOWN_BAR_DELAY
      // 只在起走的那一刻改一次 duration：这一轮里条得一直走完，
      // 每轮重算会让动画时长一直跳，视觉上是条在抖
      if (drain !== this.countdownBarDraining) {
        this.countdownBarDraining = drain
        if (drain) this.countdownBarDuration = left
      }
    },

    // 有人动了：截止时刻推到 IDLE_CLOSE_RESET_DELAY 之后，条收回满格。
    // 面板没开着（定时器早清了）就什么都不做，白名单外的按键（比如修饰键）也照样算数。
    // 值本来是 false 时这次赋值不会触发重渲染
    resetCloseCountdown() {
      if (!this._closeTimer) return
      this._closeDeadline = performance.now() + IDLE_CLOSE_RESET_DELAY
      this.countdownBarDraining = false
    },

    // 页面看不见时（切了标签页、窗口最小化或被完全遮住）不计表：
    // 人在别处忙不算「一动不动」，回来反而该重罚，所以从头给一整段
    // IDLE_CLOSE_RESET_DELAY，不再按误触的 IDLE_CLOSE_DELAY 算。
    // 条也跟着重来——startCloseCountdown 会把它收回满格，重新等最后那一段
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
    // want 不传就是跟着面板的进入方式走；预定标记搬过去的目标日要另开一份，
    // 不该跟着那个入口走——传 DEFAULT_BLANK_LINES
    padTrailingBlankLines(content, want = this.appendBlankLines) {
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
      const textarea = this.getTextarea()
      if (!textarea || !name) return
      // 输入框里没有编号，位置得先换算成正文里的，下面才拿它切正文
      const start = this.caretToContent(textarea.selectionStart)
      const end = this.caretToContent(textarea.selectionEnd)
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
    // 输入框重新可用了才能定位光标，所以聚焦要等一拍
    focusAndSync() {
      this.$nextTick(() => {
        this.focusInput()
        this.updateCurrentLine()
        this.syncHighlight()
        // 对话框有出现动画，排版定下来以后再对一遍
        this.scheduleHighlightSync()
      })
    },
    focusInput() {
      if (this.$refs.inputRef) this.$refs.inputRef.focus()
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
      // 触屏滚动：按下到抬起之间移动过就不是「点击」。
      // 只在卡片内这么算——卡片里滑动多半是想滚动或滚掉输入框的焦点，
      // 遮罩上没东西可滑，滑一下照样算「点了外面」，直接关
      if (press.inside && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP) return
      // 这一下是专门用来收起日期选择器的（点在它外面），别顺带把面板也关了
      if (press.pickerOpen && !this.insideFloatingOverlay(event.clientX, event.clientY)) return
      // 落在控件上、或者贴着控件的那一下都算误触：面板留着，焦点还给输入框
      // （keepCaretInInput 挂在 pointerup，这一下已经走过）。NEAR_PADDING 那圈容错
      // 只给卡片里面（slack = press.inside），遮罩上不给，不然贴着卡片边点就关不掉。
      // 落到真正的空白上就关面板——卡片里、遮罩上都一样
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

    // Esc 与 Ctrl/Cmd+S 都当作「完成编辑」，和点空白一样走保存流程。
    // 挂在 document 捕获阶段：焦点不在卡片里也照样收得到（见 mounted 里的说明）
    handleKeydown(event) {
      if (!this.dialogVisible) return
      const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
      if (event.key !== 'Escape' && !isSave) return
      // 日期选择器开着时，Esc 只收选择器，面板留着继续编辑；
      // 选择器里的方向键、回车等不在这里处理，原样放给 Vuetify
      if (this.pickerOpen && event.key === 'Escape') {
        this.pickerOpen = false
        event.stopPropagation()
        return
      }
      // Ctrl+S 默认会弹出浏览器的「保存网页」对话框，Esc 也别漏给 Vuetify 自己那套
      event.preventDefault()
      event.stopPropagation()
      this.handleClose()
    },
    getTextarea() {
      const ref = this.$refs.inputRef
      return ref ? ref.$el.querySelector('textarea') : null
    },
    // 输入框里的位置 → 正文里的位置。输入框里没有编号，直接拿来当正文的位置用，
    // 落点会偏在前面若干个编号的长度上
    caretToContent(pos) {
      return bodyToContent(this.listMap, pos)
    },
    // 正文里的位置 → 输入框里的位置。setSelectionRange 只认输入框那份的坐标
    caretToBody(pos) {
      return contentToBody(this.listMap, pos)
    },
    // 高亮底层：textarea 文字设透明（CSS 里），真正看见的颜色由垫在底下的 div 画。
    // 元素是 JS 现造的，塞进 Vuetify 那个 field 里面、盖在 textarea 正下方
    ensureHighlight() {
      const textarea = this.getTextarea()
      if (!textarea) return false
      if (this._hlTextarea !== textarea) {
        if (this._hlTextarea) {
          this._hlTextarea.removeEventListener('scroll', this.onHighlightScroll)
          this._hlRO?.unobserve(this._hlTextarea)
        }
if (this._hlGutter) {
          this._hlGutter.removeEventListener('click', this._gutterClick)
          this._hlGutter.removeEventListener('mousedown', this._gutterDown)
        }
        this._hlTextarea = textarea
        textarea.addEventListener('scroll', this.onHighlightScroll)
        // 组字期间的 input 事件里，正文是输入法自己拼的半成品，这时候去摘编号
        // 会把组字打断。收尾那一下（compositionend 之后）再认，编号一样跑不掉
        textarea.addEventListener('compositionstart', this.onCompositionStart)
        textarea.addEventListener('compositionend', this.onCompositionEnd)
        // auto-grow 改高度、窗口缩放改宽度都走这里，时序不用猜
        this._hlRO?.observe(textarea)
        const backdrop = document.createElement('div')
        // 普通行的颜色也和正文一致，取最高强调
        backdrop.className = 'hw-highlight text-high-emphasis'
        backdrop.setAttribute('aria-hidden', 'true')
        // 编号栏：每一行左边的编号／虚拟序号／#。它不是盖在输入框上面的，
        // 是摆在输入框左边的一块独立区域（.hw-area 里的第一个子节点）。
        // 整块不吃点击，只有里面那些按钮吃，所以光标照样能落到输入框上
        const gutter = document.createElement('div')
        gutter.className = 'hw-gutter'
        gutter.addEventListener('click', this._gutterClick)
        gutter.addEventListener('mousedown', this._gutterDown)
        // 高亮层还得盖在输入框正下方（和输入框同一份排版，字才对得上），
        // 它贴着 textarea 放，位置和尺寸都跟着 textarea 走
        const host = textarea.closest('.v-field__field') || textarea.parentElement
        host.insertBefore(backdrop, textarea)
        // 编号栏插在 .hw-area 的最前面，也就是输入框左边那一块
        const area = textarea.closest('.hw-area')
        if (area) area.insertBefore(gutter, area.firstChild)
        this._hlBackdrop = backdrop
        this._hlGutter = gutter
        this._hlWidth = 0
      }
      return true
    },
    // 把 textarea 的字形和几何抄给高亮层：两边字不对齐，换行位置就对不上。
    // 只抄影响排版的那些，颜色不管——高亮层自己的颜色就是要画的东西
    copyHighlightStyle() {
      const textarea = this._hlTextarea
      const backdrop = this._hlBackdrop
      const gutter = this._hlGutter
      if (!textarea || !backdrop || !gutter) return
      const computed = window.getComputedStyle(textarea)
      for (const key of HIGHLIGHT_TEXT_PROPS) {
        backdrop.style[key] = computed[key]
        gutter.style[key] = computed[key]
      }
      backdrop.style.padding = computed.padding
      // 编号栏是输入框左边那块独立区域，只定它多宽。输入框自己的内边距一个字
      // 都不动——它和编号栏是并排的两块，各占各的宽，正文从编号栏右边开始。
      // 高亮层钉在输入框正下方，跟着输入框走就行
      gutter.style.width = `${Math.round((parseFloat(computed.fontSize) || 16) * GUTTER_EM)}px`
      backdrop.style.top = `${textarea.offsetTop}px`
      backdrop.style.left = `${textarea.offsetLeft}px`
      backdrop.style.width = `${textarea.offsetWidth}px`
      this._hlWidth = textarea.offsetWidth
    },
    // 重画一次高亮：内容、框高、滚动位置一起同步。
    // auto-grow 会改框高，超 104px 后框内会滚，这两处每次都重新对
    syncHighlight() {
      if (!this.ensureHighlight()) return
      const textarea = this._hlTextarea
      const backdrop = this._hlBackdrop
      const gutter = this._hlGutter
      if (textarea.offsetWidth !== this._hlWidth) this.copyHighlightStyle()
      backdrop.style.height = `${textarea.clientHeight}px`
      gutter.style.height = `${textarea.clientHeight}px`
      const map = this.listMap
      const ghost = this.virtualNumber
      backdrop.innerHTML = buildHighlightHtml(map.bodies, map.texts)
      gutter.innerHTML = buildGutterHtml(map.texts, map.numbers, ghost)
      this._ghostStamp = ghost ? ghost.index + ':' + ghost.number : ''
      // 编号栏的格子要落在正文那一行的第一格上。行会折行，按行数算位置对不上，
      // 直接量上色层里那一格的位置和高度——它和输入框是同一份排版，量出来准
      this.layoutGutter()
      backdrop.scrollTop = textarea.scrollTop
      backdrop.scrollLeft = textarea.scrollLeft
      gutter.scrollTop = textarea.scrollTop
    },
    // 每格的位置和高度：抄上色层里对应那一格量出来的
    layoutGutter() {
      const gutter = this._hlGutter
      const rows = this._hlBackdrop?.children
      if (!gutter || !rows) return
      const cells = gutter.children
      const tops = []
      const heights = []
      for (let i = 0; i < cells.length; i++) {
        const top = rows[i]?.offsetTop ?? 0
        const height = rows[i]?.offsetHeight ?? 0
        cells[i].style.top = `${top}px`
        cells[i].style.height = `${height}px`
        tops.push(top)
        heights.push(height)
      }
      this._gutterTops = tops
      this._gutterHeights = heights
    },
    // 虚拟序号只在「光标停在哪一行」「有没有选着字」「这一行被用户说过不要号」
    // 变的时候才变。这三种变化都不带正文变动，不会走到 syncHighlight，
    // 所以这里自己补画一次；其余时候原样留着——每次挪光标都重画一遍太浪费
    refreshGhost() {
      const ghost = this.virtualNumber
      // 记的是「画过什么」而不只是行号：同一行从「有虚拟序号」变成「没有」
      // 行号没变，光看行号会以为不用重画
      const stamp = ghost ? `${ghost.index}:${ghost.number}` : ''
      if (stamp === this._ghostStamp || !this._hlGutter) return
      this._ghostStamp = stamp
      const map = this.listMap
      this._hlGutter.innerHTML = buildGutterHtml(map.texts, map.numbers, ghost)
      // 内层重造过了，几何得接着摆一遍，不然整栏堆在顶上
      this.layoutGutter()
    },
    // 重画请求合并到下一帧：一帧里不管触发多少次（输入、滚动、尺寸变化），
    // 只在排版之后量一次、画一次，量到的高度和滚动位置才是最新的
    scheduleHighlightSync() {
      if (this._hlRaf) return
      this._hlRaf = requestAnimationFrame(() => {
        this._hlRaf = 0
        this.syncHighlight()
      })
    },
    // 框内滚动时高亮层跟着滚，不然滚下去颜色就错位了。
    // 直接抄一份立刻跟上，再排一帧校准（滚动那一刻底层可能还没画到最新）
    onHighlightScroll() {
      if (!this._hlTextarea || !this._hlBackdrop) return
      this._hlBackdrop.scrollTop = this._hlTextarea.scrollTop
      this._hlBackdrop.scrollLeft = this._hlTextarea.scrollLeft
      if (this._hlGutter) this._hlGutter.scrollTop = this._hlTextarea.scrollTop
      this.scheduleHighlightSync()
    },
    // 窗口缩放：宽度变了换行位置全变，几何重抄（内容重画顺带发生）
    onWindowResize() {
      if (!this.dialogVisible) return
      this._hlWidth = 0
      this.scheduleHighlightSync()
    },
    // 关闭时把所有改动过的日期一起交回去，不只是当前看得见的那天。
    // 完成编辑这一刻顺便把正文里的「预定」标记落实掉：标记行以下的内容
    // 搬到那一天去，标记行本身不留，被搬进去的那几天也要一并交回去写盘
    async handleClose() {
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
        // 空行统一理一遍，末尾按默认的一份留：appendBlankLines 管的是「这个面板怎么打开的」，
        // 从「继续添加作业」进来要 2 个是为了在正文末尾另起一份，
        // 跟往目标日追加一段没关系，跟着走就会凭空多出一个空行。
        // 编号按目的地那一节重排一遍：搬过去的是别处的行，编号得跟着新位置来，
        // 不然目标日里会并着两个 1.
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
        const data = await dataProvider.loadData('classworks-data-' + dateString)
        if (data && data.success !== false) return (data.homework?.[this.title]?.content || '').trim()
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
      this.$emit('preview', payload)
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
      const textarea = this.getTextarea()
      if (!textarea) return
      this.selectedRange = this.readSelectedRange()
      // 有没有选区也在这儿记：readSelectedRange 只管跨行整块，行内选一小段它给 null，
      // 小键盘感知要的分得出「只是光标」还是「选着字」
      this.hasSelection = textarea.selectionStart !== textarea.selectionEnd
      const caret = this.caretToContent(textarea.selectionStart)
      const { text, start, end, index } = lineAt(this.content, caret)
      this.currentLine = text
      this.currentLineIndex = index
      this.currentLineStart = start
      this.currentLineEnd = end
      // 列号从记号后面数：输入框里那一行的开头就是编号、# 后面，
      // 少了这个平移，这一行每个位置都会整体偏一个记号的长度
      const prefix = this.listMap.lines[index].length - this.listMap.bodies[index].length
      this.caretInLine = Math.max(0, Math.min(caret - start - prefix, this.listMap.bodies[index].length))
      this.refreshGhost()
    },
    // 选区变化不一定都有 mouseup/click 配对（拖选中途、键盘扩选、原生工具菜单）。
    // 只认焦点在我们这个 textarea 上的情况，页面上别的选区不管
    onDocumentSelectionChange() {
      if (!this.dialogVisible) return
      if (document.activeElement !== this.getTextarea()) return
      this.updateCurrentLine()
    },
    onCompositionStart() {
      this._composing = true
    },
    onCompositionEnd() {
      this._composing = false
    },
    // 面板开着的时候，按钮上的右键菜单一律掐掉。触屏上长按弹出来的那一套
    // （复制／粘贴／添加到主屏幕）占半屏，松手还容易把长按的那个按钮顺手触发掉。
    // 输入框不在名单里，正文里的右键菜单还得留着
    blockButtonMenu(event) {
      if (!this.dialogVisible) return
      if (event.target?.closest?.(MENU_BLOCK_SELECTOR)) event.preventDefault()
    },
    // 按下那一刻先把输入框里的选区存一份。
    // 点在卡片空白、标题、正文这些不可聚焦的地方，浏览器会把焦点丢回 body，
    // 选区也跟着没了——抢回焦点时没有这一份就得把光标摆到开头
    rememberSelection(event) {
      this.savedSelection = null
      if (!this.dialogVisible || this.isDateControl(event.target)) return
      const textarea = this.getTextarea()
      if (!textarea) return
      this.savedSelection = { start: textarea.selectionStart, end: textarea.selectionEnd }
    },
    // 抬手时把焦点还给输入框。点日期那一排和日历浮层除外——
    // 那上面点了就是要操作日期，焦点得留在那儿给键盘用
    keepCaretInInput(event) {
      const saved = this.savedSelection
      this.savedSelection = null
      if (!saved || !this.dialogVisible) return
      if (this.isDateControl(event.target)) return
      const textarea = this.getTextarea()
      if (!textarea || document.activeElement === textarea) return
      textarea.focus({ preventScroll: true })
      // 照存下来的那份摆回去。整份都在有效范围内才摆，
      // 内容在这中间被改短了就越界了，那时候别硬设（浏览器会自己夹住）
      const length = textarea.value.length
      if (saved.start <= length && saved.end <= length) {
        textarea.setSelectionRange(saved.start, saved.end)
      }
    },
    isDateControl(target) {
      return !!target?.closest?.(DATE_CONTROL_SELECTOR)
    },
    // 缩放条拖完写回应用设置，下次打开还是这个大小
    setEditorZoom(value) {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value) || 100))
      this.editorZoom = zoom
      setSetting('editor.zoom', zoom)
    },
    // 点落在选区内部时，浏览器把选区收掉比 mouseup/click 晚一拍，当场读到的还是
    // 旧选区——表现就是「点在选区内第一次没反应、要点第二下」。
    // 所以当场读一遍，再等这一拍过了补读一遍
    scheduleCurrentLine() {
      this.updateCurrentLine()
      clearTimeout(this._settleTimer)
      this._settleTimer = setTimeout(() => this.updateCurrentLine(), 0)
    },
    // 选中的多行，整行范围是 { start, end }；没选、或者只选了一行，都返回 null。
    // 只选一行不算多选——单行的走原来那套（#+单行直接改那个 #）
    readSelectedRange() {
      const textarea = this.getTextarea()
      if (!textarea) return null
      const map = this.listMap
      const from = bodyToContent(map, textarea.selectionStart)
      const to = bodyToContent(map, textarea.selectionEnd)
      if (from >= to) return null
      const content = this.content
      const start = content.lastIndexOf('\n', from - 1) + 1
      // 末行取「最后一个被选中的字符」那行。选区末尾正好落在下一行开头时，
      // 下一行一个字都没选中，就不能算进来——不然从行首拖到下一行行首
      // 会白捡一整行
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

    // 按钮上显示的字。日期按钮是 { word, date }，别的按钮就是直接一个词
    chipLabel(chip) {
      return typeof chip === 'string' ? chip : chip.word
    },
    // 该亮的按钮垫一层，当选中。不是强调色——拿主题的文字色垫一层，深浅色都跟得住。
    // 光靠 variant="flat" 不够：浅色主题下那层底色几乎看不出来
    chipVariant(row, chip) {
      if (this.isChipLit(row, chip)) return 'flat'
      return row.reserve ? 'outlined' : 'text'
    },
    // 这个按钮是不是当前该亮的那个目标日期。按日期比不按字比——
    // 用户写「周三」，该亮的是写着「下周二」那个按钮
    isChipLit(row, chip) {
      return !!chip.date && !!row.lit?.includes(chip.date)
    },
    // 面板上点一个词：只往光标处写这几个字。
    // 「作为…的 xx」那一栏点的后果看光标在哪、有没有多选，在 chooseDay 里分派
    tapChip(chip, row) {
      const word = this.chipLabel(chip)
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
      const textarea = this.getTextarea()
      if (!textarea) return
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
      const textarea = this.getTextarea()
      if (!textarea) return
      const column = this.caretToContent(textarea.selectionStart) - this.currentLineStart
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
      this.$nextTick(() => this.restoreLineCaret(caret))
    },
    // 小标题下面只有光标这一行：直接改那个标题，不另开一节。光标仍停在正文那一行
    retitleOwner(ownerStart, day, strip) {
      const textarea = this.getTextarea()
      if (!textarea) return
      const column = this.caretToContent(textarea.selectionStart) - this.currentLineStart
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
      this.$nextTick(() => this.restoreLineCaret(caret))
    },
    // 预定：把光标所在这一行摘下来，挪到那天「的作业」那一节的最后接着写。
    // 那天还没有这一节就在末尾新起一节；已经有了就接在已有内容后面。
    // 这一行原本被某个小标题管着的话，把那个标题也复制一份过去，
    // 是「某天的xx」就只把那天换掉、xx 保留。
    // 这里只挪位置——搬到哪天是完成编辑、或者翻日期时才解析的事
    insertReservation(day) {
      const textarea = this.getTextarea()
      if (!textarea) return
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
      const textarea = this.getTextarea()
      if (!textarea) return
      // 选区中就按替换处理，和手打一个字一样。不这么处理的话，选区时 currentLine
      // 是首行，这个词会写到首行去、而选区还挂在正文上，看着就是点了没反应，
      // 得再点一下才反应过来
      if (textarea.selectionStart !== textarea.selectionEnd) {
        this.insertAtCursor(word)
        return
      }
      const at = row?.endsLine
        ? this.currentLineEnd
        : this.caretToContent(textarea.selectionStart)
      const typed = this.typedPrefix(this.content.slice(this.currentLineStart, at), word)
      const rest = typed ? word.slice(typed.length) : word
      // comma 那一排（收尾建议）是在已有内容后面接一句，所以先补一个逗号隔开。
      // 用户自己已经打了逗号、或者已经在接着写这个词，就只补剩下的，不再来一个逗号；
      // 逗号前面是换行（光标在这一行最开头）也不补，不然那一行会以逗号开头。
      // chip 自己写 comma: false 就整个不补——「做完」直接贴在内容后面才读得通
      const tail = at > 0 ? this.content[at - 1] : ''
      const wantsComma = chip?.comma !== false
      const needsComma = wantsComma && !!row?.comma && !typed && !!tail && !/^[,，\n]$/.test(tail)
      const insert = (needsComma ? '，' : '') + rest + (row?.endsLine ? '\n' : '')
      // 自动换行是替用户做了一件事，说一声，不然光标莫名其妙跳到下一行
      if (row?.endsLine) this.$message.success('已换行', '这一条收尾了，接着写下一条')
      // 收尾那一排要写到行尾，不是光标处。挪光标会打断浏览器的撤销分组，
      // 所以那种情况老实走字符串拼接；其余（光标本来就在那儿）走原生通道。
      // 光标位置要比就比换算过的那一份：编号行上两个坐标系差着编号的长度，
      // 直接拿输入框那个来比，编号行会一律走拼接，撤销就没了
      if (at === this.caretToContent(textarea.selectionStart) && this.insertNative(insert)) {
        this.updateCurrentLine()
        return
      }
      this.content = this.content.slice(0, at) + insert + this.content.slice(at)
      this.$nextTick(() => this.restoreLineCaret(at + insert.length))
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
    // 手动换行：结束这一条，另起一行。走光标这一条路——单选时光标在哪就换在哪，
    // 选中了字就用换行把选区替换掉。不再自己挪到行尾：那一套只认行尾，
    // 光标停在行中间会把换行插到别处去，拖着选区更是插出一段重复内容。
    // 编号行的续号也在 breakLine 里一起办了（换行键和回车走同一个入口）
    startNextItem() {
      this.breakLine()
    },
    // 把输入框的值和光标一起摆正。after 是正文里的位置（那边带着编号，要换算）；
// 值排在前面收拾：摘编号那一步改的是浏览器自己的值，正文要是没变，
// Vue 不会重新渲染，那个值就没人管了（见 onBodyInput）
placeBodyCaret(at, to = at) {
      const textarea = this.getTextarea()
      if (!textarea) return
      textarea.focus()
      const want = this.bodyText
      if (textarea.value !== want) textarea.value = want
      textarea.setSelectionRange(at, to)
      this.updateCurrentLine()
    },
    // 正文位置 → 输入框位置再摆正
    placeCaret(from, to = from) {
      this.placeBodyCaret(this.caretToBody(from), this.caretToBody(to))
    },
    // 改完正文重新定位光标：聚焦 + 落到指定位置 + 把当前行刷新一遍。
    // position 是正文里的位置，落进输入框之前要换算（那边没有编号）。
    // DOM 要等 Vue 渲染完才能动，所以调用方一律包在 $nextTick 里
    restoreLineCaret(position) {
      this.placeCaret(position)
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
      this.refreshGhost()
    },
    // 输入框里改了一下：把输入框并回正文。
    // 行首新敲出来的「N.」在这里收成编号，编号连同紧跟的那个空格一起从输入框里
    // 摘掉（摘的是浏览器自己改出来的值，撤销栈不记这一下，所以光标要自己挪回去）。
    // 两边的行号对得上，其余的行原来有没有编号就还有没有——见 mergeBody
    onBodyInput(body) {
      const textarea = this.getTextarea()
      const raw = textarea ? textarea.selectionStart : 0
      const anchor = body.slice(0, raw).split('\n').length - 1
      const before = this.listMap
      const next = mergeBody(body, this.content, anchor, !this._composing)
      const after = splitContent(next)
      // 光标前面那一行开头被摘掉几个字（敲出来的编号连同一个空格），
      // 算光标落点得减掉它，不然敲完「1.」光标停在正文第一个字后面一格
      const cut = stripLength(body.slice(before.bodyStarts[anchor] ?? 0, raw), before.numbers[anchor])
      const caret = caretAfterChange(before, after, raw, cut)
      // 「不要编号」记的是行号，行一增一减就全错位了：删掉上面一行，
      // 记在下面的那条就跑到了别的行头上，回头再敲字就给它补上了号。
      // 这儿按行数差把它挪回去
      this.shiftRefusals(after.texts.length - before.texts.length, anchor)
      if (next !== this.content) this.content = next
      // 空行刚敲上字：默认给它补上编号（用户点过「不要」的那一行除外）。
      // 补的是「刚变有字」这一下，不是每敲一个字都补——已经有字的行被继续
      // 编辑，编号不因为「动了它」而变，用户主动去掉的号也不会自己回来
      this.commitNumber(anchor, before)
      // 编号的收尾：整篇按「每一段从上到下连号」重排一遍
      this.settleNumbers()
      if (this.bodyText === body) {
        this.updateCurrentLine()
        return
      }
      // 编号连同它后面那个空格被摘掉了：输入框里的值和 bodyText 对不上，
      // 浏览器改值会把光标甩到末尾，下一拍按新正文的位置挪回去。
      // caret 已经是输入框里的坐标，直接放回去——再换算一轮反倒会踩到编号那一截
      this.$nextTick(() => this.placeBodyCaret(caret))
    },
    // 空行刚变成有字的那一下补号。只在「之前是空的、现在有字了」时才补；
    // 用户点过/按过空格/按过删除键说「这一行不要号」的，跳过
    commitNumber(index, before) {      const map = this.listMap
      const wasBlank = index < (before?.texts?.length ?? 0) && !before.texts[index].trim()
      if (!wasBlank) return
      if (!map.texts[index] || !map.texts[index].trim()) return
      if (this.isRefused(index)) return
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
    // 唯一由代码补号的地方是 breakLine（回车接着往下编），那里摆明了的。
    // 输入框一个子都没变（编号不进正文），所以光标和选区原样不动
    settleNumbers() {
      const map = this.listMap
      const numbers = map.numbers.slice()
      settleEdit(map.texts, numbers)
      const next = joinContent(map.texts, numbers)
      if (next === this.content) return
      this.content = next
    },
// 输入框里按回车、空格、删除键。
    // 回车：切行，新行摆出「写上字就是第几号」的虚拟序号（见 virtualNumber）。
    //       在一行中间回车是把一行劈成两半，劈出来那半不该自动拿号——
    //       那是同一件事的两半，不是新的一条
    // 空格：行首按 = 点这一行的记号按钮（加编号／去编号／去 #）
    // 删除键：只在全文最开头用来摘掉那一行的编号（见下面）
    // 其余的键一律不插手：退格、删除键都得能正常删字、删换行符
    onInputKeydown(event) {
      // 中文输入法组字中：回车是「上屏」，交回输入法
      if (event.isComposing) return
      if (event.key === 'Enter') {
        event.preventDefault()
        this.breakLine()
        return
      }
      // 光标停在行首按 #：切换这一行的 # 状态。不能把 # 真塞进输入框——
      // 那个字一进来就会顶在正文最前面，光标和正文当场错开一格（见下面的说明）
      if (event.key === '#') {
        const line = this.lineUnderCaret()
        if (line < 0) return
        event.preventDefault()
        this.toggleHeadingAt(line)
        return
      }
      if (event.key === ' ') {
        const line = this.lineUnderCaret()
        if (line < 0) return
        event.preventDefault()
        this.toggleLineNumber(line)
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const line = this.lineUnderCaret()
      if (line < 0) return
      // # 行开头：删除键／退格清掉 # 状态（这一行变回无序号），不删换行符。
      // 不管这一行是不是在全文最开头都这么办
      if (isHeadingLine(this.listMap.texts[line])) {
        event.preventDefault()
        this.dropHeadingMark(line)
        return
      }
      // 有编号的行：只有全文最开头才拿删除键去摘编号——那儿光标前面本来就没有字，
      // Delete 删不掉什么，摘掉编号正合适。别的位置上删除键就老老实实
      // 删正文／删换行符——用户在那儿是要删字，不是要改编号
      if (this.getTextarea()?.selectionStart !== 0) return
      if (!this.markedLine(line)) return
      event.preventDefault()
      this.dropMark(line)
    },
    // 光标停在某一行的正文最开头（后面没选着字），返回那一行的行号；
    // 不在行首就返回 -1。空行也算——行首按删除键/空格就是动它的记号
    lineUnderCaret() {
      const textarea = this.getTextarea()
      if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return -1
      const map = this.listMap
      const index = bodyLineIndex(map, textarea.selectionStart)
      return textarea.selectionStart === map.bodyStarts[index] ? index : -1
    },
    // 同一行上头顶有没有记号（编号／#／空行上的虚拟序号）。没有的话删键就
    // 老老实实去删字／删换行符，不拦它
    markedLine(index) {
      const map = this.listMap
      if (index < 0 || index >= map.texts.length) return false
      if (isHeadingLine(map.texts[index])) return true
      if (!map.texts[index].trim()) return !this.isRefused(index)
      return map.numbers[index] > 0
    },
    // 摘掉一行顶上的记号：标题行去 #，空行记下「不要编号」并收掉虚拟序号，
    // 有正文的行去编号（去完那行还是普通正文）
    dropMark(index) {
      const map = this.listMap
      if (index < 0 || index >= map.texts.length) return
      if (isHeadingLine(map.texts[index])) {
        this.dropHeadingMark(index)
        return
      }
      if (!map.texts[index].trim()) {
        if (!this.refuse(index)) return
        this.refreshGhost()
        this.syncHighlight()
        return
      }
      this.writeNumbers((numbers) => {
        numbers[index] = 0
      })
    },
    // 换行。编号是「有正文才算」的：新行现在就是空的，正文里不留号，
    // 编号栏上摆一个虚拟序号告诉用户「这行写上字就是第几号」。
    // 自己切正文，不走原生插入那条路：那条路要靠 input 事件再把正文跟上，
    // 中间只要错开一拍（失焦、浏览器不认带换行的 insertText），
    // 这一下就等于什么都没发生——回车没反应、编号更是无从谈起
    breakLine() {
      const textarea = this.getTextarea()
      if (!textarea) return
      const map = this.listMap
      const { selectionStart, selectionEnd } = textarea
      // 选区横跨好几行时，回车是把这几行切开重排，不是照原样插一个换行。
      // 切片按输入框那份（摘掉编号也摘掉 # 的）切，光标位置正好对上
      const first = bodyLineIndex(map, selectionStart)
      const last = bodyLineIndex(map, selectionEnd)
      const head = map.bodies[first].slice(0, selectionStart - map.bodyStarts[first])
      const tail = map.bodies[last].slice(selectionEnd - map.bodyStarts[last])
      // 光标停在行首（没选字）按回车：在它上面插一个空行，原来这一行连同它的
      // #／编号原样留在下面，光标落到新的空行上。有 # 的行、有序号的行都按这个来——
      // 老写法是把这一行劈成空的上半截和带正文的下半截，上半截继承了 #／编号、
      // 正文那一截反倒丢了，按一下回车等于把 # 和序号搬到了上面那行
      if (selectionStart === selectionEnd && selectionStart === map.bodyStarts[first]) {
        const texts = map.texts.slice()
        const numbers = map.numbers.slice()
        texts.splice(first, 0, '')
        numbers.splice(first, 0, 0)
        // 「不要编号」记的是行号，前面插一行之后下面全往后挪一位
        this.refusedLines = this.refusedLines.map((i) => (i < first ? i : i + 1))
        this.content = joinContent(texts, numbers)
        this.settleNumbers()
        // 新空行的行首在输入框里还是原位置（它上面那些行一个字没动）
        this.$nextTick(() => this.placeBodyCaret(this.listMap.bodyStarts[first]))
        return
      }
      // 标题行的 # 输入框里没有，劈开的时候留在上半截，下半截就不算小标题了
      const mark = HEADING_PREFIX.exec(map.texts[first])
      const texts = map.texts.slice()
      const numbers = map.numbers.slice()
      texts.splice(first, last - first + 1, (mark ? mark[0] : '') + head, tail)
      numbers.splice(first, last - first + 1, numbers[first], 0)
      // 「不要编号」记的是行号，插一行之后 first 之下全往后挪一位，
      // 不跟着挪的话那些记号就落到别的行上去了
      this.refusedLines = this.refusedLines.map((i) => (i < first ? i : i + 1))
      // 在一行中间回车是把这一行劈成两半。劈出来的那半不是新的一条作业，
      // 是同一件事的下半截，不该自己拿号——标成「这一行不要编号」，
      // 敲上字也不会补。在行尾回车（tail 是空的）才是接着往下写，那行照常给号
      if (tail) this.refusedLines = [...this.refusedLines, first + 1]
      // 新行不挂号：空行本来就不算一条作业，编号栏上摆的是「写上字就是第几号」
      // 的虚拟序号（见 virtualNumber / ghostNumber），等真敲上字 commitBlank
      // 才把上一行的号接上来。在这里就把号挂上去的话，用户点一下虚拟序号
      // 说「这一行不要」，下一拍 mergeBody 会把挂着的号原样带回来，拒绝就白给了
      this.content = joinContent(texts, numbers)
      this.settleNumbers()
      // 光标落在新行行首。那本来就是输入框里的坐标（输入框里没有编号，
      // 正文的行首在它后面还差着一个编号），直接摆过去，别绕换算
      this.$nextTick(() => this.placeBodyCaret(this.listMap.bodyStarts[first + 1]))
    },
    // 编号栏上的一个格子被点了。它管的是「这一行顶上的那个记号」，三套动作：
    //   标题行：把行首的 # 摘掉，这一行变回普通正文
    //   空行：光标那一行上点一下 = 收起虚拟序号；点在别的空行上 =
    //         把光标搬过去（虚拟序号只画在光标那一行，见 virtualNumber），
    //         搬过去还得把「这一行不要编号」的记号撤掉，不然搬了也白搬
    //   有正文的行：加编号／去编号
    toggleLineNumber(index) {
      const map = this.listMap
      if (index < 0 || index >= map.texts.length) return
      if (isHeadingLine(map.texts[index])) {
        this.dropHeadingMark(index)
        return
      }
      if (!map.texts[index].trim()) {
        if (index === this.currentLineIndex) this.toggleRefuse(index)
        else this.focusLine(index)
        return
      }
      this.writeNumbers((numbers) => {
        numbers[index] = numbers[index] > 0 ? 0 : nextNumber(map.texts, map.numbers, index)
      })
    },
    // 把光标搬到某一空行的行首（点编号栏上的空格子时用）。
    // 虚拟序号只画在光标那一行，所以要先搬过去它才看得见；
    // 搬过去还得撤掉「这一行不要编号」，否则搬了也是白搬
    focusLine(index) {
      const at = this.refusedLines.indexOf(index)
      if (at >= 0) this.refusedLines = this.refusedLines.filter((i) => i !== index)
      const textarea = this.getTextarea()
      if (!textarea) {
        this.refreshGhost()
        return
      }
      textarea.focus({ preventScroll: true })
      const pos = this.listMap.bodyStarts[index]
      textarea.setSelectionRange(pos, pos)
      this.updateCurrentLine()
    },
    // 键上那个 #：光标这一行是小标题就摘了它，是普通行就补上。
    // 和点左边编号栏那一格是一个动作，两个入口做同一件事
    toggleHeading() {
      this.toggleHeadingAt(this.currentLineIndex)
    },
    // 把第 index 行的 # 状态翻过来。行首按 # 键也走这里（见 onInputKeydown）
    toggleHeadingAt(index) {
      const map = this.listMap
      if (index < 0 || index >= map.texts.length) return
      if (isHeadingLine(map.texts[index])) this.dropHeadingMark(index)
      else this.addHeadingMark(index)
    },
    // 点编号栏上的哪一个
    onGutterClick(event) {
      const cell = event.target.closest('[data-line]')
      if (!cell) return
      this.toggleLineNumber(Number(cell.dataset.line))
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
      this.$nextTick(() => this.placeBodyCaret(this.listMap.bodyStarts[index]))
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
      this.$nextTick(() => this.placeBodyCaret(this.listMap.bodyStarts[index]))
    },
    // 这一行是不是被用户明说过「不要编号」
    isRefused(index) {
      return this.refusedLines.includes(index)
    },
    // 行数变了之后把「不要编号」的记号挪到正确的行上。
    // 改动都发生在光标那一行（anchor）：anchor 之上少了几行，下面的记号就得跟着往前挪；
    // 多出来几行同理往后挪。挪不动、也判断不了归属的就丢了——少记一行号顶多
    // 让用户多点一下，比记号落到别的行上、回头又冒出序号要好
    shiftRefusals(shift, anchor) {
      if (!shift || !this.refusedLines.length) return
      if (shift < 0) {
        this.refusedLines = this.refusedLines
          .filter((i) => i > anchor)
          .map((i) => Math.max(0, i + shift))
      } else {
        this.refusedLines = this.refusedLines.map((i) => (i < anchor ? i : i + shift))
      }
    },
    // 空行上「要不要编号」的开关。默认是要的（点开编辑器第一行就是 1.），
    // 点一下 / 按空格 / 按删除键就是不要了；再点一下又要回来
    toggleRefuse(index) {
      const at = this.refusedLines.indexOf(index)
      this.refusedLines = at < 0 ? [...this.refusedLines, index] : this.refusedLines.filter((i) => i !== index)
      this.refreshGhost()
      this.syncHighlight()
    },
    // 删除键只做「去」，不做「加」：空行上它把虚拟序号收起来，
    // 有编号的行上它把编号摘掉。用户明说了这个键不负责加号
    refuse(index) {
      if (this.isRefused(index)) return false
      this.refusedLines = [...this.refusedLines, index]
      return true
    },
    // 写编号。动完按「每一节从上到下连号」把整篇重排一遍——
    // 用户点最上面那一行，多半是嫌下面的号乱了（存档里旧版本存下来的正文
    // 就常是 1. / 1. / 5. 这种），期望的是点一下下面全跟着修正。
    // 所以这里排的是整篇，不是点的那一节：点最上面一行，修正的是下面所有行
    // 动的只是正文里的那几个字，bodyText 一个子都没变，所以输入框和光标原样不动
    writeNumbers(change) {
      const map = this.listMap
      const numbers = map.numbers.slice()
      change(numbers)
      renumberAll(map.texts, numbers)
      const next = joinContent(map.texts, numbers)
      if (next === this.content) return
      this.content = next
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
        this.placeCaret(
          positionAt(after, from.line, from.column),
          positionAt(after, to.line, to.column),
        )
      })
    },
    // 尽量走浏览器自己的插入通道 insertText。它是往「当前光标/选区」插，
    // 浏览器会把它记进原生撤销栈，用户 ctrl+z 能撤掉；
    // 直接改 this.content 的话 v-model 一设 .value，撤销栈就被清空了。
    // 返回 false 表示这条路走不通，调用方退回字符串拼接（没有撤销，但行为一致）
    // replaceSelection：粘贴时要替换选区。插入通道本来不碰有选区的情况
    // （把选区替换掉这一下，用户按 ctrl+z 未必预期），粘贴不一样——
    // 换掉选区正是粘贴的语义，而且得让撤销栈记上
    insertNative(text, replaceSelection = false) {
      const textarea = this.getTextarea()
      if (!textarea || !text) return false
      if (document.activeElement !== textarea) return false
      // 有选区时等于替换选区。原生撤销能记这一下，但把选区替换掉的语义
      // 用户按 ctrl+z 未必预期得到，这种就别凑这个热闹了
      if (!replaceSelection && textarea.selectionStart !== textarea.selectionEnd) return false
      try {
        return document.execCommand('insertText', false, text)
      } catch (error) {
        return false
      }
    },
    insertAtCursor(text, replaceSelection = false) {
      if (!text) return false
      const textarea = this.getTextarea()
      if (!textarea) return false
      // 原生通道：DOM 已经被浏览器改好，input 事件同步把正文跟上（onBodyInput），
      // 光标也已经在插入内容后面，不用再手动挪
      if (this.insertNative(text, replaceSelection)) {
        this.updateCurrentLine()
        return true
      }
      const start = this.caretToContent(textarea.selectionStart)
      const end = this.caretToContent(textarea.selectionEnd)
      this.content = this.content.slice(0, start) + text + this.content.slice(end)
      this.$nextTick(() => this.restoreLineCaret(start + text.length))
      return false
    },
    // 原生删除，跟 insertText 一个路子。返回 false 表示走不通，调用方退回字符串拼接
    deleteNative() {
      const textarea = this.getTextarea()
      if (!textarea) return false
      if (document.activeElement !== textarea) return false
      try {
        return document.execCommand('delete')
      } catch (error) {
        return false
      }
    },
        // 按住删除键：立刻删一个，然后按 Windows 的默认延迟和重复速度连着删。
    // 自己管这个计时，不交给 v-repeat-click——那个指令的默认 delay/speed
    // 跟 Windows 对不上，按住一下会删得比系统快一大截
    startHoldRepeat() {
      this.stopHoldRepeat()
      this.deleteLastChar()
      // 收尾的监听挂 window 捕获阶段，不只挂按钮自己。
      // 触屏上按住手指挪开一点再抬起，pointerup 就送不到按钮上了（按钮身上的
      // @pointerup / @pointerleave 一起收不到），连删停不下来，一直删下去。
      // 鼠标一般挪不出按钮所以没这个毛病。挂在 window 上就跟按钮在不在那儿无关了
      window.addEventListener('pointerup', this.stopHoldRepeat, true)
      window.addEventListener('pointercancel', this.stopHoldRepeat, true)
      window.addEventListener('blur', this.stopHoldRepeat, true)
      this._holdDelay = window.setTimeout(() => {
        this._holdRepeat = window.setInterval(() => this.deleteLastChar(), HOLD_REPEAT_INTERVAL)
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
    // 退格。删字、删换行符都让它照常来。
    // 唯一插一手的是全文最开头：那儿光标前面没有字，删不掉什么，
    // 正好拿它把这一行的编号摘掉。别的位置上不插手——用户在那儿是要删字
    deleteLastChar() {
      const textarea = this.getTextarea()
      if (!textarea) return
      const { selectionStart, selectionEnd } = textarea
      const collapsed = selectionStart === selectionEnd
      if (collapsed && selectionStart === 0 && this.markedLine(0)) {
        this.dropMark(0)
        return
      }
      if (this.deleteNative()) {
        this.updateCurrentLine()
        return
      }
      // 走不通原生删除时退回拼接：照样在输入框那份上切（那边没有编号，
      // 切的是换行符而不是编号那一截），切完走 commitBody 并回正文
      if (selectionEnd < selectionStart) return
      const from = collapsed ? selectionStart - 1 : selectionStart
      if (from < 0) return
      const body = this.bodyText
      this.commitBody(
        body.slice(0, from) + body.slice(selectionEnd),
        (body.slice(0, from).match(/\n/g) || []).length,
        from,
      )
    },
    // 从剪贴板读取内容并按光标位置组装新正文：有选中则替换，否则在光标处插入。
    // 剪贴板完全为空时返回 null，空格或换行视为有效内容原样粘贴。
    // 拼的是输入框那份（摘掉编号的），不是正文——粘进来的「1. 2.」那些编号
    // 交给 mergeBody 收，和手敲出来的一个样
    buildContentWithPaste(text) {
      const textarea = this.getTextarea()
      if (!textarea) return null
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const body = this.bodyText
      const cursor = start + text.length
      return {
        body: body.slice(0, start) + text + body.slice(end),
        anchor: (body.slice(0, cursor).match(/\n/g) || []).length,
        cursorPosition: cursor,
      }
    },
    // 把输入框那份（摘掉编号的）写回正文，顺手收下新敲出来的编号、重排那一节的编号。
    // 粘贴、退格退到拼接那条路都走这儿——两边改的都是输入框那份
    commitBody(body, anchor, cursor) {
      this.content = mergeBody(body, this.content, anchor)
      this.settleNumbers()
      this.$nextTick(() => this.restoreLineCaret(this.caretToContent(cursor)))
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
    // 粘贴的共同那段：优先走原生插入通道，撤销栈记得住，Ctrl+Z 能把这一下撤掉。
    // 通道走不通时（输入框没焦点之类）退回拼字符串——那条路没有原生撤销，
    // 行为和以前一样，只是少了一步可撤销性
    async pasteClipboard() {
      const text = await navigator.clipboard.readText()
      if (text == null || text === '') return false
      if (this.insertAtCursor(text, true)) return true
      const result = this.buildContentWithPaste(text)
      if (!result) return false
      this.commitBody(result.body, result.anchor, result.cursorPosition)
      return true
    },
  },
}
</script>

<style scoped>
/* 顶部倒计条：贴在卡片顶边的一条细线，倒计走完就自动关掉面板。
   一直挂着，剩得还久时就是满格的一条细线，不抢注意力。
   颜色取 currentColor 再压到很低的透明度，深色下是浅灰、浅色下是深灰。
   脱开文档流是 .progress-bar 给的全站口径（见 styles/global.scss），
   下面只改这条线自己的：钉在滚动区顶边、高 1px */
.close-countdown {
  /* 对话框比屏幕高时滚动的是卡片本身（见 .hw-card），absolute 会跟着正文滚上去。
     sticky 要留在文档流里才钉得住，所以拿回 1px 的位置，再用负外边距还回去——
     排版一点不动，露出/收起都不会让标题挪一挪 */
  position: sticky;
  top: 0;
  height: 1px;
  margin-bottom: -1px;
  overflow: hidden;
  /* 纯装饰，挡在标题上面也不能挡点击 */
  pointer-events: none;
}

.close-countdown-bar {
  height: 100%;
  background: currentColor;
  opacity: 0.2;
  transform-origin: left center;
}

/* 倒计进入最后一段才挂上这个类，动画才从头走一遍。类一撤，条立刻回到满格 */
.close-countdown-bar-drain {
  animation-name: close-countdown-drain;
  animation-timing-function: linear;
  /* forwards：走完后停在空处，不会闪回满格 */
  animation-fill-mode: forwards;
}

/* 时长由 closeCountdownStyle 绑进来，取的是起走那一刻到关闭还剩的时间 */
@keyframes close-countdown-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.hw-title {
  margin-left: 7px;
  margin-top: 14px;
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
}

.hw-card::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/* 内容区。标题栏自带 8px 下内边距，这里再补 8px，标题到内容正好 16px——
   和左边的 16px 对齐 */
.hw-panel {
  margin-top: -26px;
  /* 编号栏和输入框是并排的两块，一起往左挪一挪：这一栏默认 16px 的左内边距，
     挪到 6px 之后，编号栏和输入框的左边缘都离卡片左边近一点。
     右内边距不动——右边那一列是键位整块，位置和它自己有关 */
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

/* 编辑区：左边一块编号栏、右边一块输入框，并排摆着，不叠在一起。
   悬挂对齐就是靠这条栏给的：正文每一行都从栏右边开始，折行也是 */
.hw-area {
  --v-textarea-scroll-bar-width: 0;
  display: flex;
  align-items: flex-start;
  width: 100%;
}

.hw-area :deep(.hw-field) {
  flex: 1 1 auto;
  min-width: 0;
}

.hw-area :deep(textarea) {
  scrollbar-width: none;
  -ms-overflow-style: none;
  /* 高亮底层画颜色，textarea 只留光标和选区：文字本身透明。
     提到高亮层上面来，光标和选区才不会被底下的字盖住 */
  position: relative;
  z-index: 1;
  color: transparent;
  background-color: transparent;
  /* 面板在下面折行占掉不少高度，编辑框不能无限长：正文一长就顶出屏幕，
     推荐按钮全看不见了。封顶之后正文在框里滚。约四行 */
  max-height: 104px;
  overflow-y: auto;
}

/* 高亮底层的宿主：Vuetify 那个 field，几何（top/left/宽/内边距）在 JS 里抄 */
.hw-area :deep(.v-field__field) {
  position: relative;
}

.hw-area :deep(.hw-highlight) {
  position: absolute;
  overflow: hidden;
  box-sizing: border-box;
  pointer-events: none;
}

/* 编号栏：输入框左边那一块，宽度在 JS 里给（见 copyHighlightStyle）。
   它是 flow 里的一块，不盖在输入框上面；整块不吃点击，只有里面的按钮吃，
   所以光标该落在输入框上就落输入框上 */
.hw-area :deep(.hw-gutter) {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  box-sizing: border-box;
  pointer-events: none;
}

/* 一行一格。位置和高度都在 JS 里按上色层那一格给的——行会折行，
   按行数算位置对不上 */
.hw-area :deep(.hw-number-cell) {
  position: absolute;
  left: 0;
  right: 0;
}

/* 编号／圆点本身。整格就是按钮：编号字那么小，点它得瞄准，
   手一抖就点到输入框上去了（那里可是光标位置，点了就跳走）。
   没有编号的行给一个暗点：有编号的行摆的是编号，两者占同一个位置，
   切换的时候不会跳 */
.hw-area :deep(.hw-number) {
  position: absolute;
  top: 0;
  bottom: 0;
  /* 编号栏本身留得窄（不然每行正文都白白让开一截），但按钮得够大点得着：
     26px 过得去手指和鼠标（24px 是下限，再窄就容易点偏到输入框上去放光标）。
     宽度锚在右边，多的那几像素往左探出去，
     探到卡片自己的留白里去了，不挤正文 */
  right: 0;
  width: 26px;
  pointer-events: auto;
  appearance: none;
  border: 0;
  background: none;
  margin: 0;
  padding: 0 3px 0 0;
  font: inherit;
  font-size: 0.8em;
  line-height: inherit;
  color: rgba(127, 127, 127, 0.45);
  text-align: right;
  cursor: pointer;
  white-space: nowrap;
  overflow: visible;
}

.hw-area :deep(.hw-number::before) {
  content: '·';
  opacity: 0;
}

.hw-area :deep(.hw-number:not(.hw-number-on):not(.hw-number-mark)::before) {
  opacity: 1;
}

/* 标题行那一格：摆一个 #。# 只活在按钮上，输入框里那个不显示（见 buildHighlightHtml）。
   前面那个 · 是「没编号」的意思，标题行不是「没编号」，所以得把它压掉 */
.hw-area :deep(.hw-number-mark) {
  color: rgba(127, 127, 127, 0.45);
  font-weight: 700;
}

.hw-area :deep(.hw-number-on) {
  color: rgba(127, 127, 127, 0.85);
}

/* 空行上的虚拟序号：「这行写上字就是第几号」。比真编号淡一档——
   它还不是一条作业，只是提示；也不吃点击，那一行还没东西可编号 */
.hw-area :deep(.hw-ghost) {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 26px;
  box-sizing: border-box;
  padding: 0 3px 0 0;
  font-size: 0.8em;
  line-height: inherit;
  color: rgba(127, 127, 127, 0.3);
  text-align: right;
  white-space: nowrap;
  overflow: visible;
  user-select: none;
  pointer-events: auto;
  appearance: none;
  border: 0;
  background: none;
  margin: 0;
  font-family: inherit;
  cursor: pointer;
}

/* 标题行那一格：摆一个 #。它和编号是同一个位置，所以小标题的正文
   和编号行的正文一样从同一条栏后面起，折行也对得上。
   高亮行本身不写样式：行高、折行规则全部从 backdrop 上继承
   （JS 全量抄的 textarea 实测值），写死一个跟 textarea 不一样的，
   英文长串两边断行就错开了 */

/* 只改颜色不改字重，字一粗换行就对不上了 */
.v-theme--light .hw-area :deep(textarea) {
  /* textarea 自己的文字已透明，这里只定光标：取 Vuetify 浅色主题正文同色 */
  caret-color: rgba(0, 0, 0, 0.87);
}

.v-theme--dark .hw-area :deep(textarea) {
  caret-color: #fff;
}

/* 高亮颜色：只改颜色不改字重，字一粗换行就对不上了。
   起步是「今天的作业」那对色（灰 medium-emphasis、黄 yellow），
   灰往下压一档、黄往上提一档 */
.v-theme--dark .hw-area :deep(.hl-head) {
  color: #A9A9A9;
}

.v-theme--dark .hw-area :deep(.hl-date) {
  color: #FFEB3B;
}

.hw-area :deep(textarea::-webkit-scrollbar) {
  display: none;
}

/* 粘贴按钮：在键位整块的最下面，跟量词那一排一起飘（容器见 .numeric-keypad）。
   两个横着摆，整行 189 宽（71.75 + 8 + 108.95），比这一栏的 180 宽出一丁点。
   不缩它——缩了字就挤；让它按自己的宽度摆，靠 justify-content: center
   落在键位正中，左右各探出去 4.35px。
   键位自己的横向位置不受影响（它脱开文档流，left 是 auto） */
.paste-bar {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

/* 编辑框所在那一栏（编辑框 + 推荐面板）。
   min-width 缺省是 auto，也就是「不许比内容还窄」——推荐面板最后一行的小标题名
   是不换行的（超了要出省略号），标题名一长就等于告诉这一栏「你至少这么宽」，
   整栏跟着变宽，编辑框、对话框一起顶出屏幕。归零之后这一栏只吃 flex 分到的那份，
   多出来的字由面板里那个省略号收掉 */
.hw-editor-col {
  min-width: 0;
}

/* 推荐面板：收在左栏里、文本框正下方，只撑满文本框那一列（右边缘对齐文本框的右边），
   不再横铺到小键盘下面去。
   高度写死，编辑框就不会被面板顶得上下跳——三层词表轮着上，
   每一层有几行按钮还不一样，不写死的话打字时编辑框会跟着上下跳。
   三行词（一行 chip 32px 加 ma-1 的 4px，上下共 40px）+ 两个 2px 的间隙，
   再留 2px 余量。写多了底下就空在那儿，看着像还该有点什么。
   两条跟外面有关联的改动：
     往右多铺出小键盘那一列。面板本来就在键位下方，两者纵向基本不重叠，
     这段宽度是真能用的；铺不出的话那些词就得折行，一折行面板就变高、
     对话框跟着长高、滚动条冒出来。伸到键位底下的那段由 .numeric-keypad 的底色盖住，
     那里真有重叠时也不漏字。负外边距把多铺的那段抵掉，这一栏的排版一点不变
     （编辑框的宽度照旧由右边那栏决定，恒定不变）
   min-height 而不是 height：词多到一行放不下时，面板按内容的行数长高，
   而不是让多出来的行掉到框外——掉出去的那些字要么被卡片切掉，要么逼得对话框滚动。
   平常一行放得下一行时它还是 126，编辑框照样不会上下跳 */
.phrase-panel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  width: calc(100% + var(--keypad-space));
  margin-right: calc(-1 * var(--keypad-space));
  min-height: 126px;
  gap: 2px;
  margin-top: 4px;
}

.phrase-row {
  display: flex;
  align-items: flex-start;
  align-self: stretch;
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
}

.phrase-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

/* 一组词。组只是折行的单位，不表示分组——所有按钮的间距一样，靠 chip 自己的 ma-1。
   组内自己也折行，「明天上课对答案」这种长句才不会被挤出面板 */
.phrase-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

/* 有前缀/后缀文字的那一行（「作为 … 的作业」）：词只占它自己那么宽，
   后缀紧跟在词后面，不推到行的最右边去。
   空间不够时也不许压缩词：整行的收缩量全给后缀，让它截成省略号 */
.phrase-row-affix .phrase-chips {
  flex: 0 0 auto;
}

/* 「正面/反面」后头那个换行按钮。词条是补字、这个是断句，所以配色上挑明：
   primary + flat，一眼就看出不是往正文里加字的。
   高度照词条那个 32px，这一行才跟别行一样高（词条是 32 + ma-1 的 4）；
   字号也照词条——v-btn 按 size="small" 压到 0.75rem，比 chip 的 0.875rem 小一号，
   并排摆着大小不齐。圆角走 rounded="pill"（9999px，两头圆），
   别用 rounded="circle"：那个是 50%，长短不一的按钮上就成了椭圆 */
.phrase-newline {
  min-height: 32px;
  padding: 0 12px;
  font-size: 0.875rem;
}

/* 「作为」「的作业」这类固定文字，不是按钮 */
.phrase-affix {
  flex: 0 0 auto;
  align-self: center;
  padding: 0 2px;
  font-size: 0.85rem;
  line-height: 1.5;
  opacity: 0.7;
}

/* 前缀（「作为」）要和上面两行的按钮左对齐。按钮那个字的起点是 ma-1 的
   4px 外边距加 chip 默认档左右各 12px 的内边距，这里让出同样的一截 */
.phrase-affix-prefix {
  margin-left: 4px;
  padding-left: 12px;
}

/* 后缀（「的作业」）允许被挤窄：词排满一行时它不能顶出面板，
   宁可自己截成省略号。min-width:0 是 flex 项能缩到内容宽度以下的开关 */
.phrase-affix-suffix {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.v-chip) {
  cursor: pointer;
  user-select: none;
}

/* 键位之间的间距，横竖一律用这一个值：行与行靠 .numeric-keypad 的 gap，
   一行之内靠各网格自己的 gap，两者都取它，不会一处宽一处窄。
   小键盘那一栏：横着的位置由它占住（宽度给 180，编辑框的宽度才不会跟着变宽）。
   竖直方向它已经不管键位了——键位脱开文档流落到视口中线，见 .numeric-keypad。
   align-items: center 留着：脱开文档流的键位没写 left，浏览器按这一栏的对齐方式
   定它的静态位置，键位就还贴在原来那个左边，别以为它没用了就删 */
.quick-tools {
  --key-gap: 4px;
  border-left: none;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 竖直落在视口中线上：fixed + top:50% + 往上挪回自己一半高。
   50% 是按谁算的：Vuetify 的 .v-overlay__content 带 contain: layout，
   fixed 的包含块就是它（也就是对话框那个盒子），而对话框永远上下居中摆在视口里，
   所以那个盒子的中线就是视口的中线，键位落点正好在视口中线。
   别改成 top: 50vh——vh 量的是视口，可起点仍是包含块的左上角，会整体偏高半个视口。
   横向一个字都不写：left、right 都是 auto 时 fixed 落在静态位置上，静态位置照
   .quick-tools 的 flex 排版算，不用算坐标（实测 700/900/1440 三种宽度，一个像素没动过）。
   窄到这一行比卡片还宽时（视口不足 ~465px，本来就在溢出、右边那列键位被切掉），
   左栏的固有宽度是顶宽的那几件东西撑出来的，粘贴按钮搬走之后它窄了二十几像素，
   键位跟着左移一点——那边本来就是坏的，不在这条规则的射程内。
   不垫底色：推荐面板已经收进左栏（见 .phrase-panel），键位整块不再压着它，
   底下透出来的就是卡片自己的底色，不用再盖一层 */
/* 键位底下垫的那一层底色，等于把这一块「擦」回卡片自己的样子。
   键位是 fixed，压在文字上面，键与键之间的缝本来会漏出底下的字；
   推荐面板现在往这一列底下伸（见 .phrase-panel），漏字的机会更多了。
   取色就用卡片自己的底色（v-theme-surface），换主题它跟着变。
   z-index:-1 是关键：这一层要压在键位底下，别把键位盖了。
   fixed 的元素自成一个层叠上下文，这一层就只在自己这层里排在内容后面。
   左右各多垫 8px：粘贴那一行比键位整块还宽一点（见 .paste-bar），
   刚好盖住它探出来的那两截 */
.numeric-keypad::before {
  content: '';
  position: absolute;
  top: -4px;
  bottom: -4px;
  left: -8px;
  right: -8px;
  background: rgb(var(--v-theme-surface));
  z-index: -1;
}

.numeric-keypad {
  /* 键位整块多宽。键宽是这个数减掉两条 --key-gap 再三等分来的（见 .keypad-row），
     想让键窄一点就改这里，间距一个字不动 */
  width: 156px;
  display: flex;
  flex-direction: column;
  gap: var(--key-gap);
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
}

/* 小键盘整列：每一行都是同一个三列网格，按钮尺寸只由网格决定，
   所以没有任何按钮自带宽度 */
.keypad-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  /* 横竖都用这一个间距：键与键、键与行透出同样宽的一条底色。
     键变窄是靠 .numeric-keypad 收窄整块来的，不是靠加大这个间距——
     间距一大，键就宽了，等于没变窄 */
  gap: var(--key-gap);
}

.keypad-btn {
  width: 100%;
  min-width: 0;
}

/* 换行、空格：两个汉字挤在数字键那么宽的一格里，字号比数字键小一号才匀。
   size="small" 本来就是 0.75rem，这里写死是免得改尺寸时跟着一起变 */
.keypad-word {
  font-size: 0.75rem;
}

/* 量词那一排。五个键对不上三列，所以自己一行、均分整行，
   硬凑进上面那个网格只会让键宽一会儿宽一会儿窄 */
.measure-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--key-gap);
}

/* 量词上的字跟自动建议区的 chip 一样大（chip 默认档是 0.875rem，
   v-btn 按 size="small" 把它压到 0.75rem，这里改回来，两个区域看齐）。
   五个键分那一百八十来 px，一格三十几，v-btn 默认左右各 12px 的内边距
   会把字挤出去，所以一并收窄 */
.measure-btn {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 0 2px;
  font-size: 0.8rem;
}
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

