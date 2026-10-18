import { defineConfig } from '@playwright/test'

// 端到端：真开一个浏览器去点、去敲。
// 这个应用最要紧的几处（光标落点、输入框里的值、编号栏的位置、折行的悬挂对齐）
// 全都是 DOM 行为，jsdom 一概测不了（它没有排版，offsetTop 恒等于 0），
// 所以只上 Playwright，不另配单元测试框架。
export default defineConfig({
  testDir: './tests',
  timeout: 20000,
  expect: { timeout: 4000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3031',
    trace: 'retain-on-failure',
    // 面板停手 10s 就自己关掉，别让测试慢一点就扑空
    actionTimeout: 5000,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3031/classworks/',
    reuseExistingServer: true,
    timeout: 60000,
  },
})