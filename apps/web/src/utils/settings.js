// 设置项存 localStorage；改动通过事件广播给各页面
// 科目清单不在这里，默认值与规整都在 utils/subjects.js

const SETTINGS_STORAGE_KEY = 'Classworks_settings'
const SETTINGS_CHANGED_EVENT = 'classworks:settings:changed'

// 所有配置项的定义（精简版）
const settingsDefinitions = {
  // 字体设置（唯一保留的可配置项）
  'font.size': {
    type: 'number',
    default: 18,
    validate: (value) => value >= 16 && value <= 32,
  },
  // 编辑对话框整体缩放（百分比）。只往小缩：放大不如调字体设置来得正经
  'editor.zoom': {
    type: 'number',
    default: 100,
    validate: (value) => value >= 50 && value <= 100,
  },
}

class SettingsManagerClass {
  constructor() {
    this.settingsCache = null
    this.isInitialized = false
  }

  init() {
    if (this.isInitialized) return
    this.loadSettings()
    this.isInitialized = true
  }

  loadSettings() {
    this.settingsCache = {}
    try {
      const stored =
        typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_STORAGE_KEY) : null
      if (stored) {
        this.settingsCache = JSON.parse(stored)
      }
    } catch (error) {
      console.error('加载设置失败:', error)
    }
    for (const [key, definition] of Object.entries(settingsDefinitions)) {
      if (!(key in this.settingsCache)) {
        this.settingsCache[key] = definition.default
      }
    }
    return this.settingsCache
  }

  saveSettings() {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settingsCache))
    } catch (error) {
      console.error('保存设置失败:', error)
    }
  }

  getSetting(key) {
    if (!this.isInitialized) this.init()
    const definition = settingsDefinitions[key]
    if (!definition) {
      console.warn(`未定义的设置项: ${key}`)
      return null
    }
    const value = this.settingsCache[key]
    return value !== undefined ? value : definition.default
  }

  setSetting(key, value) {
    if (!this.isInitialized) this.init()
    const definition = settingsDefinitions[key]
    if (!definition) {
      console.warn(`未定义的设置项: ${key}`)
      return false
    }
    try {
      if (typeof value !== definition.type) {
        value =
          definition.type === 'boolean'
            ? Boolean(value)
            : definition.type === 'number'
              ? Number(value)
              : String(value)
      }
      if (definition.validate && !definition.validate(value)) {
        console.warn(`设置项 ${key} 的值无效`)
        return false
      }
      this.settingsCache[key] = value
      this.saveSettings()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: { key, value } }),
        )
      }
      return true
    } catch (error) {
      console.error(`设置配置项 ${key} 失败:`, error)
      return false
    }
  }

  watchSettings(callback) {
    if (typeof window === 'undefined') return () => {}
    const storageHandler = (event) => {
      if (event.key === SETTINGS_STORAGE_KEY) {
        this.settingsCache = JSON.parse(event.newValue)
        callback(this.settingsCache, null)
      }
    }
    const customHandler = (event) => {
      callback(this.settingsCache, event)
    }
    window.addEventListener('storage', storageHandler)
    window.addEventListener(SETTINGS_CHANGED_EVENT, customHandler)
    return () => {
      window.removeEventListener('storage', storageHandler)
      window.removeEventListener(SETTINGS_CHANGED_EVENT, customHandler)
    }
  }
}

const SettingsManager = new SettingsManagerClass()

if (typeof window !== 'undefined') {
  SettingsManager.init()
}

const getSetting = (key) => SettingsManager.getSetting(key)
const setSetting = (key, value) => SettingsManager.setSetting(key, value)
const watchSettings = (callback) => SettingsManager.watchSettings(callback)

export { getSetting, setSetting, watchSettings }
