<template>
  <div class="quick-tools ml-4" style="min-width: 156px" @contextmenu.prevent>
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
          @click="$emit('insert', String(n))"
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
          @click="$emit('insert', String(n))"
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
          @click="$emit('insert', String(n))"
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
          @click="$emit('insert', padKeys[0])"
        >
          {{ padKeys[0] }}
        </v-btn>
        <v-btn
          class="keypad-btn"
          variant="tonal"
          @mousedown.prevent
          @click="$emit('insert', '0')"
        >
          0
        </v-btn>
        <v-btn
          class="keypad-btn vis-fade"
          size="small"
          :class="{ 'vis-fade-off': !padKeys[1] }"
          variant="tonal"
          @mousedown.prevent
          @click="$emit('insert', padKeys[1])"
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
             鼠标上 mousedown 早于 pointerup，所以那条路一直没暴露出来。
             按下就删第一下，抬手（window 捕获阶段）收住连删，
             整条路只有这一个入口 —— 少挂一个 @click 的话单点就不删了。
             收尾仍然由父级挂在 window 上管，这里只管把「按下了」这件事报上去 -->
        <v-btn
          class="keypad-btn"
          color="error"
          variant="tonal"
          title="删除"
          aria-label="删除"
          @mousedown.prevent
          @pointerdown="$emit('hold-start')"
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
          @click="$emit('next-line')"
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
          @click="onSpaceKey"
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
          @click="$emit('insert', key)"
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
          @click="$emit('paste')"
        >
          粘贴
        </v-btn>
        <!-- @mousedown.prevent 不能少：这一下失败时面板还开着（剪贴板读不到、
             或者剪贴板是空的），焦点要留在编辑框里接着写，不被按钮抢走 -->
<!--        <v-btn
          size="small"
          variant="elevated"
          color="primary"
          prepend-icon="mdi-content-paste"
          @mousedown.prevent
          @click="$emit('paste-and-complete')"
        >
          粘贴并完成
        </v-btn>-->
      </div>
    </div>
  </div>
</template>

<script>
// 小键盘 + 粘贴条。只负责按键长什么样、按下去报了什么事；具体往正文哪儿写、
// 能不能换行、什么时候露量词，全由父级算好传进来。
// 这里的根元素 .quick-tools 和里面的 .numeric-keypad 一起决定了键位在视口里的位置
// （fixed 不写 left，落在静态位置上），所以 DOM 层级一层都不能多、不能少
export default {
  name: 'HomeworkKeypad',
  props: {
    // 量词那一排（张 页 题 课 章），见 homeworkPanel 的 BOTTOM_KEYS
    bottomKeys: {
      type: Array,
      default: () => [],
    },
    // 量词该不该露出来。不露也留着位置，键位整块的高度不跟着变
    showBottomKeys: {
      type: Boolean,
      default: false,
    },
    // 0 左边、右边那两格按光标前面停在哪换内容（空串表示这一格先空着），
    // 规则见 homeworkPanel 的 contextKeys
    padKeys: {
      type: Array,
      default: () => ['', ''],
    },
    // 「换行」那个键亮不亮：这一行真有内容才亮
    canEndLine: {
      type: Boolean,
      default: false,
    },
    // 这一行是新起一段的开头：键上的字从「换行」改成「分段」
    atSectionStart: {
      type: Boolean,
      default: false,
    },
    // 光标停在行首：空格那格改成切换小标题的 #
    caretAtLineStart: {
      type: Boolean,
      default: false,
    },
  },
  // hold-stop 由父级挂在 window 上的监听收尾（见 startHoldRepeat），这里不重复触发
  emits: ['insert', 'paste', 'paste-and-complete', 'hold-start', 'hold-stop', 'next-line', 'toggle-heading'],
  methods: {
    // 行首按空格没意义，那一格换成「摘掉／补上 #」，和左边编号栏那一格是同一个动作
    onSpaceKey() {
      if (this.caretAtLineStart) this.$emit('toggle-heading')
      else this.$emit('insert', ' ')
    },
  },
}
</script>

<style scoped>
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

/* 量词那一排。六个键对不上三列，所以自己一行、均分整行，
   硬凑进上面那个网格只会让键宽一会儿宽一会儿窄 */
.measure-row {
  margin: 0 15px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--key-gap);
}

/* 量词上的字跟自动建议区的 chip 一样大（chip 默认档是 0.875rem，
   v-btn 按 size="small" 把它压到 0.75rem，这里改回来，两个区域看齐）。
   五个键分那一百八十来 px，一格三十几，v-btn 默认左右各 12px 的内边距
   会把字挤出去，所以一并收窄 */
.measure-btn {
  width: 100%;
  min-width: 0;
  min-height: 3px;
  padding: 0 2px;
  font-size: 0.8rem;
  /* 六个键挤在一行，字一折行这一排就白高了 */
  white-space: nowrap;
}
</style>
