# JustClassworks 项目约定

## 项目速览
- pnpm monorepo，实际应用在 `apps/web`：Vue 3 + Vuetify 3 + Vite。
- 纯前端、无后端；数据存在浏览器 IndexedDB（`src/utils/dataProvider.js`）。
- PWA，部署在 GitHub Pages 子路径 `/classworks/`；开发地址 `http://localhost:3031/classworks/`。
- 固定深色主题，界面文案中文，注释中文且简洁。

## 新会话启动（按顺序，不要全仓扫描）
1. 先读本文件。
2. `git status --short` 和 `git diff --stat`：先弄清有没有未提交改动，避免覆盖别人的工作。
3. 只读任务相关文件；不确定时再用 `rg` 定位，不要递归读整个 `src`。
4. 改完运行 `pnpm build`（自带样式校验和 404 生成）；复杂交互再用 Playwright 验证。

## 关键文件
- `apps/web/src/pages/index.vue`：作业板主页、工具栏、日期切换、截图入口。
- `apps/web/src/components/HomeworkEditDialog.vue`：编辑弹窗、日期翻页、点空白完成编辑。
- `apps/web/src/components/HomeworkEditor.vue`：正文编辑器（CodeMirror），编号、光标、粘贴逻辑。
- `apps/web/src/components/home/`：卡片区、小键盘、推荐面板、缩放条。
- `apps/web/src/styles/`：`index.scss` 全局布局，`transitions.scss` 动画（`fade` / `vis-fade` 在文件末尾且必须靠后），`global.scss` 应用级样式。
- `apps/web/src/utils/`：数据读写、日期、作业解析、截图、科目、设置等纯逻辑。

## 数据与渲染主线
- 页面只维护 `state.boardData`（当天）和 `state.otherDays`（后续日期）；`sortedItems` 由 `buildSegments` 汇总当天 + 后续日期生成。
- 编辑面板实时预览写入 `state.preview`，完成编辑后才由 `handleHomeworkSave` 落盘；预览绝不能混进 `boardData/otherDays`。
- 翻日期走 `handleDateSelect`：先改 `dateString`，再 `loadDayData()` + `loadSubjects()`，最后 `refreshScreenshotMatch()`。
- 截图哈希在 `utils/screenshot.js`；`screenshotMatched` 只表示当前内容与上次截图一致。
- 日期键格式见 `utils/storageKeys.js`；日期工具在 `utils/date.js`。

## UI / 样式约定
- 优先用 Vuetify 组件和现有间距/字号，不引入新 UI 库。
- 动效只做 opacity / 轻微 transform，短、克制；避免重阴影、毛玻璃底衬、复杂装饰。
- 元素显隐若不应引起工具栏/布局跳动，优先固定占位或不要用会重排的 `v-if`；写完用浏览器点一遍检查。
- 工具条按钮顺序：回到今天 → 已截图 → 截图 → 前一天 → 字体 → 日期 → 后一天 → 设置。
- 有内容才显示截图按钮（无内容隐藏，不要只置灰）。

## 已知易错点
- 工具栏翻日期时，异步状态（如截图核对）变化不要驱动「回到今天」重新挂载，否则会闪隐/闪现。
- `transitions.scss` 尾部 `.fade-*`、`.vis-fade*` 的书写顺序不能随意挪，否则会被 `.v-btn` / `.v-card` 的 transition 盖掉。
- 作业卡片分列依赖实测高度；改卡片结构后留意 `HomeworkGrid.vue` 的测量/`layoutVersion` 逻辑。
- 子路径部署：Vite `base`、PWA manifest、`runtimeCaching` 中的 `/classworks/` 字面量要一起改。

## 交付惯例
- 不主动重构无关代码，不额外加测试（复杂或易回归逻辑除外）。
- 修改完成时说明：改了哪些文件、为什么、运行了什么验证。
- 重要改动后建议提交 git；未提交改动会让下一次会话先花时间判断现状。

## 省 token 约定
- 开场只跑 `git status --short` 和 `git diff --stat`；不查 `git log` / `git branch` / `git remote` / `git blame`，除非任务明确需要。
- 只展开任务相关文件的 diff，不逐行读无关的未提交改动。
- 定位先用 `rg -n`，再按行号读必要区段；搜索输出要限量，不要整文件通读大型 `.vue`。
- 验证集中在改完后一次 `pnpm build`；UI 检查优先用单个脚本断言 DOM/文本/样式，只有布局问题才截图。
- 回复只说明改了什么、为什么、验证结果，不复述大段代码和命令输出。