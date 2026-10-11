// Plugins
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import Layouts from 'vite-plugin-vue-layouts'
import Vue from '@vitejs/plugin-vue'
import VueRouter from 'unplugin-vue-router/vite'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// 站点挂在 GitHub Pages 的子路径下（仓库名即路径），base 必须带上这一段，
// 否则产物里的 /assets/... 会指到域名根，整站资源 404。
// 路径大小写照 GitHub Pages 上实际能访问到的那个写，别自己改成大写：
// 仓库名改了，这里、下面 runtimeCaching 里写死的那几处字面量、
// 以及 manifest 的 start_url/scope 都得跟着改
const BASE = '/classworks/'

// 开发服务器上把少一个结尾斜杠的 /classworks 领到 /classworks/ 去。
// base 写的是带斜杠那一份，Vite 认的也只有带斜杠的写法，所以直接敲
// http://localhost:3031/classworks 既不匹配也不重定向，只能吃一个 404。
// （生产那边是 GitHub Pages 按目录给补这个斜杠，所以只有开发时会撞上；
//  别改成「开发时 base 改成 /」来躲——那样开发环境和线上就不是同一个路径了）
function redirectBaseSlash() {
  const bare = BASE.slice(0, -1)
  return {
    name: 'redirect-base-slash',
    // configureServer 里注册的中间件排在 Vite 自带的那一堆之前，
    // 所以拦在它前头，不用管它认不认这个路径
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === bare) {
          res.writeHead(302, { Location: BASE })
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  base: BASE,
  plugins: [
    redirectBaseSlash(),
    VueRouter(),
    Layouts(),
    Vue({
      template: { transformAssetUrls },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        navigateFallback: 'index.html',
        enabled: false,
        suppressWarnings: true,
      },

      lang: 'zh-CN',
      injectRegister: 'auto',
      strategies: 'generateSW',
      // manifest.webmanifest 和 manifest.icons 里的图标，插件已经按
      // includeManifestIcons 自动追加进预缓存，这里补的是 icons 之外的两个
      // （mask-icon、apple-touch-icon）；插件会去重，manifest 文件本身不用列
      includeAssets: ['pwa/**'],
      // sw.js 本身不要走 HTTP 缓存。默认的 'imports' 会让浏览器最长 24 小时
      // 直接拿缓存里的 sw.js 比对，新构建出来的改动半天都推不到浏览器上
      updateViaCache: 'none',

      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // 不 glob png/svg/webmanifest：这几个已经由上面的 includeAssets 和
        // manifest 追加过，再 glob 一遍会在 sw.js 里留下重复条目
        globPatterns: ['**/*.{js,css,html,ico,txt,json,woff2,ttf}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // 注意：这里的函数体会被 workbox 原样抄进 sw.js，闭包里的 BASE
            // 在那边不存在，${BASE} 会留成字面量、这条规则永远匹配不上。
            // 所以只能写死字面量，改 BASE 时记得连这里一起改
            urlPattern: ({ url, sameOrigin }) => {
              // 站点在子路径下，资源实际在 /classworks/assets/... 而不是 /assets/...
              return sameOrigin && url.pathname.startsWith('/classworks/assets/')
            },
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => {
              return sameOrigin && url.pathname.startsWith('/classworks/pwa/')
            },
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pwa-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // 匹配当前域名下除了上述规则外的所有请求
            urlPattern: ({ url, sameOrigin }) => {
              if (!sameOrigin) return false
              const path = url.pathname
              // 排除已经由其他规则处理的路径
              return !(
                path.includes('/classworks/assets/') ||
                path.includes('/classworks/pwa/')
              )
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'other-resources',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 1 天
              },
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
        clientsClaim: true,
        skipWaiting: true,
      },
      manifest: {
        id: '7C24F2B3.ClassworksPWA',
        name: 'Classworks PWA',
        short_name: 'Classworks PWA',
        description: '适用于班级大屏的作业板小工具，支持记录、查看作业（本地存储）。',
        theme_color: '#212121',
        background_color: '#212121',
        lang: 'zh-CN',
        dir: 'ltr',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui', 'fullscreen'],
        // 都在子路径下，填 '/' 的话装成应用后启动和作用域会落到域名根上（那边是空白页）
        start_url: BASE,
        scope: BASE,
        orientation: 'any',
        categories: ['education', 'productivity', 'utilities'],
        prefer_related_applications: false,
        launch_handler: {
          client_mode: 'navigate-existing',
        },
        // file_handlers / protocol_handlers 已删：声明了但代码零实现（无 launchQueue），先不挂
        // shortcuts 也删了：装成应用后它会变成系统菜单/任务栏跳转列表里的一条
        // （Windows 上叫「任务 - 设置」），这个应用本来就在一块屏上开着，
        // 多给一个进设置的入口反而像是另一个页面
        icons: [
          {
            src: './pwa/image/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: './pwa/image/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: './pwa/image/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: './pwa/image/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify({
      autoImport: true,
      styles: {
        configFile: 'src/styles/settings.scss',
      },
    }),
    Components({
      directoryAsNamespace: false,
      globs: ['src/components/**/[A-Z]*.vue'],
    }),
    AutoImport({
      imports: ['vue', 'vue-router'],
      vueTemplate: true,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    extensions: ['.js', '.mjs', '.json', '.vue'],
  },
  build: {
    // ===== Chunk 分割优化 =====
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          // 核心框架（极少变动，长缓存）
          'vendor-vue': ['vue', 'vue-router'],
          // UI 框架
          'vendor-vuetify': ['vuetify'],
        },
      },
    },
  },
  // legalComments: 'none' 会连 /*! … */ 和 /* @license … */ 这类法律声明一起删掉。
  // esbuild 默认保留它们，产物里因此留着 Vue 和 ress.css 的版权头，浏览器
  // DevTools 的 Sources 面板里能直接读到。注释本身不是秘密，但上线产物
  // 带着别人的版权声明既不准确也显脏。
  esbuild: {
    legalComments: 'none',
  },
  server: {
    port: 3031,
  },
  css: {
    preprocessorOptions: {
      sass: {
        api: 'modern-compiler',
      },
    },
  },
}))
