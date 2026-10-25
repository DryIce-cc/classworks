/**
 * icons/mdi.js
 *
 * 项目里用到的 MDI 图标，名字 -> SVG path。
 *
 * 原来引的是 @mdi/font 的图标字体：一份 woff2 加一份 CSS 共约 820KB，
 * 里面装着 7400 多个字形，而这里只用到 22 个。改成 SVG 路径后，发布产物里
 * 只剩这 22 条 path，图标也顺带能跟着 currentColor 变色、不再有字体加载闪烁。
 *
 * 新增图标两步：
 * 1. 在 @mdi/js 里查名字（把 mdi-calendar-today 这类连字符写法转成 mdiCalendarToday）
 * 2. 下面 import 加上、下面表里加一行
 * 没收录的名字会在 dev 模式下打一条控制台警告，不会静默空白
 */
import {
  mdiAlert,
  mdiAlertCircle,
  mdiArrowLeft,
  mdiBackspaceOutline,
  mdiBookMultiple,
  mdiCalendar,
  mdiCalendarToday,
  mdiCameraOutline,
  mdiCheckCircle,
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiCog,
  mdiContentPaste,
  mdiContentSave,
  mdiDelete,
  mdiDrag,
  mdiFormatFontSizeDecrease,
  mdiFormatFontSizeIncrease,
  mdiInformation,
  mdiPlus,
  mdiRestore,
} from '@mdi/js'

export const MDI_ICONS = {
  'mdi-alert': mdiAlert,
  'mdi-alert-circle': mdiAlertCircle,
  'mdi-arrow-left': mdiArrowLeft,
  'mdi-backspace-outline': mdiBackspaceOutline,
  'mdi-book-multiple': mdiBookMultiple,
  'mdi-calendar': mdiCalendar,
  'mdi-calendar-today': mdiCalendarToday,
  'mdi-camera-outline': mdiCameraOutline,
  'mdi-check-circle': mdiCheckCircle,
  'mdi-chevron-left': mdiChevronLeft,
  'mdi-chevron-right': mdiChevronRight,
  'mdi-close': mdiClose,
  'mdi-cog': mdiCog,
  'mdi-content-paste': mdiContentPaste,
  'mdi-content-save': mdiContentSave,
  'mdi-delete': mdiDelete,
  'mdi-drag': mdiDrag,
  'mdi-format-font-size-decrease': mdiFormatFontSizeDecrease,
  'mdi-format-font-size-increase': mdiFormatFontSizeIncrease,
  'mdi-information': mdiInformation,
  'mdi-plus': mdiPlus,
  'mdi-restore': mdiRestore,
}
