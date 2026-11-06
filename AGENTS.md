> **硬约束：省 token。** 用户经常新开对话，不要把「新会话」当成「重新摸底项目」。
> 只读本文件 + 按任务定位表直读相关文件；不跑 git，除非用户要求提交或排查冲突。
> 禁止全仓扫描、递归列目录、整文件通读大型 `.vue`、重复跑构建、把长日志贴回来。

# JustClassworks 项目约定

## 项目速览
- pnpm monorepo，实际应用在 `apps/web`：Vue 3 + Vuetify 3 + Vite。
- 纯前端、无后端；数据存在浏览器 IndexedDB（`src/utils/dataProvider.js`）。
- PWA，部署在 GitHub Pages 子路径 `/classworks/`；开发地址 `http://localhost:3031/classworks/`。
- 固定深色主题，界面文案中文，注释中文且简洁。

## 新会话启动（硬性流程，默认只做这 3 步）
1. 读本文件。不要先读 README、锁文件、`node_modules` 或全项目。
2. 按下面的「任务定位表」直接打开相关文件；最多再跑 1 次限定路径的 `rg -n`。
3. 修改后只跑 1 次 `pnpm build`；复杂交互最多再跑 1 个精简 Playwright 断言脚本。

### 任务定位表
- 首页布局、工具栏、日期切换：`apps/web/src/pages/index.vue`、`apps/web/src/styles/index.scss`
- 作业卡片分列、卡片内容、截图：`apps/web/src/components/home/HomeworkGrid.vue`、`apps/web/src/utils/masonry.js`
- 编辑弹窗、日期翻页、点空白关闭：`apps/web/src/components/HomeworkEditDialog.vue`
- 正文编辑、编号、光标、粘贴：`apps/web/src/components/HomeworkEditor.vue`
- 数据读写 / 日期 / 科目 / 设置：`apps/web/src/utils/` 下对应文件
- 动画、淡入淡出：`apps/web/src/styles/transitions.scss`

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
- 是否提交 git 由用户决定，不主动提交。

## 省 token 约定（必须执行）
- 禁止递归列目录、全仓 `rg`、无范围读取大型 `.vue`；先定位行号，只读必要区段。
- 禁止输出长日志：验证命令重定向到临时文件，只读末尾摘要；临时文件用完立刻删。
- 同一项验证不要反复跑；改完最多 1 次 `pnpm build`，Playwright 只在确有必要时跑 1 次并只打印结论。
- 不主动重构、不额外加测试、不写解释性文档；除非任务明确要求。
- 回复只说明：改了哪些文件、为什么、验证结果。通常不超过 6 条，不复述代码和长命令输出。
