import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 基于脚本位置定位 dist，不依赖 CWD（根目录跑 pwa:validate 也能找到）
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(scriptDir, '..', 'dist')
const manifestPath = path.join(distDir, 'manifest.webmanifest')
const indexPath = path.join(distDir, 'index.html')
const serviceWorkerPath = path.join(distDir, 'sw.js')

const errors = []

function fail(message) {
  errors.push(message)
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`无法读取或解析 ${path.relative(process.cwd(), filePath)}: ${error.message}`)
    return null
  }
}

function fileExistsFromManifest(src) {
  const normalized = src.replace(/^\.?\//, '').split('?')[0]
  return fs.existsSync(path.join(distDir, normalized))
}

if (!fs.existsSync(distDir)) {
  fail('dist 目录不存在，请先运行构建。')
}

const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null
if (!manifest) {
  fail('dist/manifest.webmanifest 不存在。')
} else {
  for (const field of [
    'id',
    'name',
    'short_name',
    'description',
    'start_url',
    'scope',
    'display',
    'theme_color',
    'background_color',
  ]) {
    if (!manifest[field]) {
      fail(`manifest 缺少 ${field}。`)
    }
  }

  if (manifest.id !== '7C24F2B3.ClassworksPWA') {
    fail('manifest.id 必须是 7C24F2B3.ClassworksPWA。')
  }

  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
    fail('manifest.display 应为 standalone、fullscreen 或 minimal-ui。')
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : []
  const has192 = icons.some(
    (icon) => icon.sizes?.includes('192x192') && fileExistsFromManifest(icon.src),
  )
  const has512 = icons.some(
    (icon) => icon.sizes?.includes('512x512') && fileExistsFromManifest(icon.src),
  )
  const hasMaskable = icons.some(
    (icon) =>
      icon.sizes?.includes('512x512') &&
      icon.purpose?.includes('maskable') &&
      fileExistsFromManifest(icon.src),
  )

  if (!has192) fail('manifest 缺少可访问的 192x192 图标。')
  if (!has512) fail('manifest 缺少可访问的 512x512 图标。')
  if (!hasMaskable) fail('manifest 缺少可访问的 512x512 maskable 图标。')

  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
    fail('manifest 缺少 categories，Microsoft Store/PWABuilder 会降低质量评分。')
  }

  // file_handlers / protocol_handlers 的校验已删：这两项在 vite.config.mjs 里
  // 从来没声明过（那是给「用本应用打开 .csb 文件」的桌面集成留的口子，代码里零实现），
  // 留着只会是一段永远进不去的死分支

  if (manifest.edge_side_panel) {
    fail('manifest 不应声明 edge_side_panel。')
  }
}

if (!fs.existsSync(indexPath)) {
  fail('dist/index.html 不存在。')
} else {
  const html = fs.readFileSync(indexPath, 'utf8')
  if (!html.includes('rel="manifest"')) {
    fail('index.html 缺少 manifest 链接。')
  }
  if (!html.includes('apple-touch-icon')) {
    fail('index.html 缺少 apple-touch-icon。')
  }
  if (!html.includes('msapplication-TileImage')) {
    fail('index.html 缺少 Windows tile 图标声明。')
  }
}

if (!fs.existsSync(serviceWorkerPath)) {
  fail('dist/sw.js 不存在，PWA 离线能力未生成。')
} else {
  const sw = fs.readFileSync(serviceWorkerPath, 'utf8')
  if (!sw.includes('index.html')) {
    fail('sw.js 未包含导航回退，离线打开应用可能失败。')
  }
  if (!sw.includes('clientsClaim')) {
    fail('sw.js 未开启 clientsClaim，新版本可能无法立刻接管已打开的页面。')
  }
  // 预缓存表里同一个文件出现两次会让 sw.js 体积翻倍、还要多占一份缓存配额，
  // 通常是 globPatterns 和 manifest 自动追加的条目撞上了
  const entries = sw.match(/\{url:"[^"]+",revision:(?:"[^"]*"|null)\}/g) ?? []
  const urls = entries.map((entry) => entry.split('"')[1])
  const duplicated = [...new Set(urls.filter((url, i) => urls.indexOf(url) !== i))]
  if (duplicated.length > 0) {
    fail(`sw.js 预缓存表里有重复条目：${duplicated.join(', ')}`)
  }
}

if (errors.length > 0) {
  console.error('PWA 构建校验失败:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('PWA 构建校验通过。')
