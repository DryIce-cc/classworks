/**
 * router/index.js
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router/auto'
import { setupLayouts } from 'virtual:generated-layouts'
import { routes } from 'vue-router/auto-routes'

// 仅开发时存在的自查页：生产构建里把这个路由整个摘掉，
// 不留一个能打开的调试入口（dev-editor.vue 只在 DEV 注册）
const devOnlyPaths = import.meta.env.DEV ? [] : ['/dev-editor']
const publicRoutes = routes.filter((route) => !devOnlyPaths.includes(route.path))

const router = createRouter({
  // 根目录部署，history 模式干净 URL（/settings），不再用 hash
  history: createWebHistory(import.meta.env.BASE_URL),
  // 兜底：认不出来的地址一律回首页，不给 404 页面。
  // 这类地址多半是旧书签或手敲错的一截（GitHub Pages 会拿 404.html 顶上，
  // 也就是把首页发给浏览器），停在「不认识」上只会让人以为是应用坏了。
  // 放在自动路由后面，接住的就是所有没匹配上的地址
  routes: setupLayouts([...publicRoutes, { path: '/:pathMatch(.*)*', redirect: '/' }]),
})

// Workaround for https://github.com/vitejs/vite/issues/11804
router.onError((err, to) => {
  if (err?.message?.includes?.('Failed to fetch dynamically imported module')) {
    if (!localStorage.getItem('vuetify:dynamic-reload')) {
      console.log('Reloading page to fix dynamic import error')
      localStorage.setItem('vuetify:dynamic-reload', 'true')
      location.assign(to.fullPath)
    } else {
      console.error('Dynamic import error, reloading page did not fix it', err)
    }
  } else {
    console.error(err)
  }
})

router.isReady().then(() => {
  localStorage.removeItem('vuetify:dynamic-reload')
})

export default router