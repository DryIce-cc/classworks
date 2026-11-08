<template>
  <div class="phrase-panel">
    <div
      v-for="(row, ri) in rows"
      :key="ri"
      class="phrase-row"
      :class="{ 'phrase-row-affix': row.prefix || row.suffix }"
    >
      <!-- 「作为」「的作业」是固定文字，不是按钮。面板换层时这两个会时有时无，
           直接跟着 v-show 的 display 切换出现／消失，不做淡入淡出：
           它们是常驻的小标签，每换一层就淡一下反而晃眼 -->
      <span v-show="row.prefix" class="phrase-affix phrase-affix-prefix">{{ row.prefix }}</span>
      <div class="phrase-chips">
        <div v-for="(group, gi) in row.groups" :key="gi" class="phrase-group">
          <v-chip
            v-for="chip in group"
            :key="chipLabel(chip)"
            class="ma-1 phrase-chip"
            :variant="chipVariant(row, chip)"
            :class="{ 'phrase-chip-on': isChipLit(row, chip) }"
            @mousedown.prevent
            @click="$emit('tap', chip, row)"
          >
            {{ chipLabel(chip) }}
          </v-chip>
        </div>
      </div>
      <span v-show="row.suffix" class="phrase-affix phrase-affix-suffix">{{ row.suffix }}</span>
    </div>
  </div>
</template>

<script>
import { chipLabel } from '@/utils/homeworkPanel'

// 推荐面板：词表怎么分层、每层给哪几行，全在父级的 panel computed 里算好；
// 这里只负责把 rows 摆出来，点下去也只是把 chip 和它所在的行交回父级。
// chipLabel / chipVariant / isChipLit 都只依赖入参，不碰别的状态
export default {
  name: 'HomeworkPhrasePanel',
  props: {
    // 四行词，直接接父级的 panel computed（见 utils/homeworkPanel 的 panelRows）
    rows: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['tap', 'next-line'],
  methods: {
    chipLabel,
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
  },
}
</script>

<style scoped>
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

/* 「作为」「的作业」这类固定文字，不是按钮。面板换层时它们时有时无，
   直接跟着 display 切换出现／消失就好，不做淡入淡出——这两个词是常驻的小标签，
   每换一层就淡一下反而晃眼。span 常驻 DOM（v-show），只切 display */
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
</style>
