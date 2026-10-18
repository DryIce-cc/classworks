import { test } from '@playwright/test'

const textarea = '.hw-area textarea:not(.v-textarea__sizer)'

test('slider thumb at 100% stays inside bar', async ({ page }) => {
  await page.goto('/classworks/')
  await page.getByText('点击添加作业').first().click()
  await page.locator(textarea).waitFor()
  await page.waitForTimeout(200)
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.editor-zoom')
    const thumb = document.querySelector('.editor-zoom .v-slider-thumb')
    const track = document.querySelector('.editor-zoom .v-slider-track__background')
    const r = (n) => {
      const b = n.getBoundingClientRect()
      return { x: Math.round(b.x), right: Math.round(b.right) }
    }
    return {
      bar: r(bar),
      thumb: r(thumb),
      track: r(track),
      innerW: window.innerWidth,
      clientW: document.documentElement.clientWidth,
    }
  })
  console.log('PROBE slider@100', JSON.stringify(m))
  const ok = m.thumb.right <= m.bar.right
  console.log('PROBE thumbInsideBar', ok)
})
