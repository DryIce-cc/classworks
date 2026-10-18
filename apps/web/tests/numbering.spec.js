import { expect, test } from '@playwright/test'

// 编辑面板里编号这一套的端到端。
// 这里写的每一条都是用户在界面上真会做一遍的动作：敲编号、回车、退格、
// 行首按空格、点左边那个点。断言看三样东西：输入框里的值、编号栏上画出来的、
// 以及最后存进 IndexedDB 的正文。

// 那个 sizer 是 auto-grow 量高度用的副本，得躲开，不然选择器命中两个
const textarea = '.hw-area textarea:not(.v-textarea__sizer)'
// 编号栏上一格（真编号的按钮、暗点都住在里面）
const cell = (page, n) => page.locator('.hw-gutter .hw-number-cell').nth(n)
// 能点的编号按钮：只在「已经写成一条作业」的行上（空行上没有）
// 通过格子里的按钮来点，而不是靠 .hw-number 这个类去数：
// 空行上的暗点按钮也带这个类（宽高全在那条样式里，漏了点不着），
// 数它的话空行会把序数顶偏。.hw-number-on 才是「这一行真有编号」
const button = (page, n) => page.locator('.hw-gutter .hw-number-cell button').nth(n)
// 空行上的虚拟序号：写上字就是第几号，只在光标停着的空行上出现
const ghost = (page) => page.locator('.hw-gutter .hw-ghost')

// 打开某个科目的编辑面板
async function openEditor(page) {
  await page.goto('/classworks/')
  await page.getByText('点击添加作业').first().click()
  await expect(page.locator(textarea)).toBeFocused()
}

// 往存档里直接塞一天的内容，再刷页面。用来复现「早先版本存下来的正文」——
// 那种正文里会有「3.」这种只有号、没有字的行，界面上照理也该正常对待
async function seed(page, content) {
  const title = await page
    .locator('.empty-subject-card')
    .first()
    .locator('.v-card-title')
    .textContent()
  await page.evaluate(
    async ({ title, content }) => {
      // 版本号和 dataProvider 一致；库还不存在时这里顺手把它建出来
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('ClassworksDB', 3)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv')
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const key =
        'classworks-data-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite')
        tx.objectStore('kv').put(JSON.stringify({ homework: { [title]: { content } } }), key)
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
    },
    { title: title.trim(), content },
  )
  await page.reload()
  await expect(page.locator(textarea)).toHaveCount(0)
}

// 输入框里现在是什么（就是用户看得见的那份正文，没有编号）
const body = (page) => page.locator(textarea).inputValue()
// 编号栏每一格画的是什么。编号栏是 rAF 里重画的，读之前先等两帧，
// 不然读到的是上一拍
const cells = async (page) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.locator('.hw-gutter .hw-number-cell').allTextContents()
}
// 面板上「作为…的作业」那一栏的日期 chip。两个坑：日期标题栏上那个「▶ 明天」
// 按钮也叫「明天」；chip 本身不是 <button>，按角色找不到。都用选择器躲开
const reserveChip = (page, word) =>
  page.locator('.phrase-panel .v-chip').filter({ hasText: new RegExp(`^${word}$`) })
// 明天的日期字符串：存档的 key 是 YYYYMMDD，「明天」相对真正的今天解
const tomorrowKey = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10).replace(/-/g, '')
// 存档里那一天（key 以 day 结尾）的正文
const storedFor = (page, day) =>
  page.evaluate(async (suffix) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ClassworksDB')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const keys = await new Promise((resolve) => {
      const req = db.transaction('kv').objectStore('kv').getAllKeys()
      req.onsuccess = () => resolve(req.result)
    })
    const key = keys.find((k) => String(k).endsWith(suffix))
    if (!key) return ''
    const raw = await new Promise((resolve) => {
      const req = db.transaction('kv').objectStore('kv').get(key)
      req.onsuccess = () => resolve(req.result)
    })
    const data = JSON.parse(raw) // 存档里存的是 JSON 字符串
    return Object.values(data?.homework || {})[0]?.content || ''
  }, day)
// 今天那一份（第一天那个 key）
const stored = (page) => storedFor(page, todayKey())
const todayKey = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

// 关掉面板并存盘
async function save(page) {
  await page.locator(textarea).press('Control+s')
  await expect(page.locator(textarea)).toHaveCount(0)
}

// 光标定位到第 n 行行首（0 起）。从文首一步步走，位置是确切的
async function gotoLine(page, n) {
  const box = page.locator(textarea)
  await box.press('Control+Home')
  for (let i = 0; i < n; i++) await box.press('ArrowDown')
  await box.press('Home')
}

test.describe('编号', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page)
  })

  test('敲 1. 变成编号：输入框里不留编号，编号栏上画出来', async ({ page }) => {
    await page.locator(textarea).pressSequentially('1.')
    await expect(page.locator(textarea)).toHaveValue('')
    // 号敲了字还没写，先是一个虚拟序号顶在那儿（这就是「敲 1. 立刻有号」）
    await expect(ghost(page)).toHaveText('1.')
    await page.locator(textarea).pressSequentially('订正')
    await expect(page.locator(textarea)).toHaveValue('订正')
    // 字一写上去，那个号就落成真的了。不用再去点一下才变对
    await expect(button(page, 0)).toHaveText('1.')
    await expect(ghost(page)).toHaveCount(0)
  })

  test('手动敲的序号：空行上敲 3. 就摆 3.，写上字后按连续编号重排', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    // 第二行手动敲 3.（字还没写）：虚拟序号摆的就是 3.
    await box.pressSequentially('3.')
    await expect(ghost(page)).toHaveText('3.')
    await box.pressSequentially('默写')
    // 只允许连续号：这一段才两行，它就是 2.
    await expect(button(page, 1)).toHaveText('2.')
    await save(page)
    expect(await stored(page)).toContain('2. 默写')
  })

  test('空行一敲字就默认给编号', async ({ page }) => {
    const box = page.locator(textarea)
    // 什么都没敲，光标那一行摆着虚拟的 1.
    await expect(ghost(page)).toHaveText('1.')
    // 一敲字就落成真的
    await box.pressSequentially('订正')
    expect(await cells(page)).toEqual(['1.'])
    await box.press('Enter')
    await box.pressSequentially('默写')
    expect(await cells(page)).toEqual(['1.', '2.'])
    await expect(box).toHaveValue('订正\n默写')
  })

  test('点空行上的虚拟序号：这行不要编号，写上字也不给', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('订正')
    await box.press('Enter')
    await expect(ghost(page)).toHaveText('2.')
    // 点那个虚拟序号 = 明说这一行不要号，序号立刻收起来
    await ghost(page).click()
    await expect(ghost(page)).toHaveCount(0)
    // 写上字也不补
    await box.pressSequentially('默写')
    expect(await cells(page)).toEqual(['1.', ''])
    await expect(box).toHaveValue('订正\n默写')
  })

  test('去掉编号之后再编辑，这一行不会自己冒出序号', async ({ page }) => {
    await seed(page, '1. 订正\n2. 默写')
    await page.locator('.hw-card').first().click()
    const box = page.locator(textarea)
    await expect(box).toHaveValue('订正\n默写\n')
    // 第二行行首按空格：去掉它的编号
    await gotoLine(page, 1)
    await box.press(' ')
    expect(await cells(page)).toEqual(['1.', '', ''])
    // 在这一行里接着写，它该一直是「没有编号」的一行
    await box.press('End')
    await box.pressSequentially('订正2')
    expect(await cells(page)).toEqual(['1.', '', ''])
    await expect(box).toHaveValue('订正\n默写订正2\n')
    await save(page)
    expect(await stored(page)).not.toMatch(/^\s*\d+\.\s*默写订正2$/m)
  })

  test('空编辑器一打开就有第一个号', async ({ page }) => {
    // 一条作业都还没有，光标停着的那个空行就是第一条
    await expect(ghost(page)).toHaveText('1.')
    await expect(page.locator('.hw-gutter .hw-number-on')).toHaveCount(0)
  })

  test('回车接着往下编号，光标落在新行行首', async ({ page }) => {
    await page.locator(textarea).pressSequentially('1.')
    await page.locator(textarea).pressSequentially('订正')
    await page.locator(textarea).press('Enter')
    // 新行还是空的：先摆个虚拟序号，写上字才落成真的
    await expect(ghost(page)).toHaveText('2.')
    await page.locator(textarea).pressSequentially('默写')
    await page.locator(textarea).press('Enter')
    await page.locator(textarea).pressSequentially('小白')
    await expect(page.locator(textarea)).toHaveValue('订正\n默写\n小白')
    await expect(button(page, 0)).toHaveText('1.')
    await expect(button(page, 1)).toHaveText('2.')
    await expect(button(page, 2)).toHaveText('3.')
    // 光标得在最后一行末尾，再敲一个字应该接在「小白」后面
    await page.locator(textarea).pressSequentially('p30')
    await expect(page.locator(textarea)).toHaveValue('订正\n默写\n小白p30')
  })

  test('文档第一行就编号，回车照样续', async ({ page }) => {
    await page.locator(textarea).pressSequentially('1.')
    await page.locator(textarea).pressSequentially('订正')
    await page.locator(textarea).press('Enter')
    await expect(ghost(page)).toHaveText('2.')
  })

  test('虚拟序号只在光标停着的那个空行上出现', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await expect(ghost(page)).toHaveText('2.')
    // 光标挪到上面那行（它有正文，本来就没号）——底下那个空行不摆虚拟序号了
    await box.press('ArrowUp')
    await box.press('Home')
    await expect(ghost(page)).toHaveCount(0)
    await box.press('ArrowDown')
    await expect(ghost(page)).toHaveText('2.')
  })

  test('多选的时候不给虚拟序号', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await expect(ghost(page)).toHaveText('2.')
    await box.press('ArrowUp')
    await box.press('Home')
    await box.press('Shift+ArrowDown')
    // 选着字的时候「当前行」是好几行，报一个号只会指错
    await expect(ghost(page)).toHaveCount(0)
  })

  test('行首按空格等于点这一行的编号按钮', async ({ page }) => {
    await page.locator(textarea).pressSequentially('订正')
    // 每行默认都有号
    await expect(button(page, 0)).toHaveText('1.')
    await page.locator(textarea).press('Home')
    await page.locator(textarea).press(' ')
    await expect(page.locator(textarea)).toHaveValue('订正')
    await expect(button(page, 0)).toHaveText('')
    // 再按一次就加回来
    await page.locator(textarea).press(' ')
    await expect(button(page, 0)).toHaveText('1.')
    // 行中间按空格还是打空格
    await page.locator(textarea).press('End')
    await page.locator(textarea).press(' ')
    await expect(page.locator(textarea)).toHaveValue('订正 ')
  })

  test('退格在行首：直接删换行符，编号跟着重排', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await box.pressSequentially('默写')
    expect(await cells(page)).toEqual(['1.', '2.'])
    await gotoLine(page, 1)
    // 行首按退格就是删前面的换行符，把这一行并到上一行后面，不先去摘编号
    await box.press('Backspace')
    await expect(box).toHaveValue('订正默写')
    expect(await cells(page)).toEqual(['1.'])
  })

  test('全文最开头按退格：摘掉这一行的编号', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await box.pressSequentially('默写')
    await box.press('Control+Home')
    // 光标前面本来就没有字，删不掉什么，正好拿它把编号摘掉
    await box.press('Backspace')
    await expect(box).toHaveValue('订正\n默写')
    // 第一行摘了号，第二行就成了这一段里第一个有编号的，收成 1.
    expect(await cells(page)).toEqual(['', '1.'])
  })

  test('空行一个退格删掉一整行', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await box.pressSequentially('2.')
    await box.pressSequentially('默写')
    await box.press('Enter')
    // 回车续行：新行空着，摆着一个虚拟序号
    await expect(ghost(page)).toHaveText('3.')
    await box.press('Backspace')
    await expect(box).toHaveValue('订正\n默写')
    expect(await cells(page)).toEqual(['1.', '2.'])
  })

  test('删除键在行首：删掉后一个字，编号不动', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await box.pressSequentially('默写')
    await gotoLine(page, 1)
    // 行首按删除键就是往后删一个字，不是去改编号
    await box.press('Delete')
    await expect(box).toHaveValue('订正\n写')
    expect(await cells(page)).toEqual(['1.', '2.'])
  })

  test('点编号栏上的点切换编号', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('订正')
    await box.press('Enter')
    await box.pressSequentially('默写')
    // 每行默认都有号，点一下是去掉
    expect(await cells(page)).toEqual(['1.', '2.'])
    await button(page, 1).click()
    expect(await cells(page)).toEqual(['1.', ''])
    // 第一行也去掉
    await button(page, 0).click()
    expect(await cells(page)).toEqual(['', ''])
    // 再点第一行：它回到 1.
    await button(page, 0).click()
    expect(await cells(page)).toEqual(['1.', ''])
    // 第二行点回来接着往下数
    await button(page, 1).click()
    expect(await cells(page)).toEqual(['1.', '2.'])
  })

  test('在行首敲 1.：光标不往后跳', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('订正')
    await box.press('Home')
    // 敲 1. 转成编号，光标得停在「订正」前面，不该滑到「订」后面一格
    await box.pressSequentially('1')
    await box.pressSequentially('.')
    await expect(box).toHaveValue('订正')
    expect(await box.evaluate((el) => el.selectionStart), '光标位置').toBe(0)
    // 接着敲字，字要接在光标后面，不能插到编号和正文中间
    await box.pressSequentially('订')
    await expect(box).toHaveValue('订订正')
    expect(await box.evaluate((el) => el.selectionStart), '光标位置').toBe(1)
  })

  test('一行中间回车：劈出来的那半不自己拿号', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    // 光标停在「订|正」中间，回车把这一行劈成两半
    await box.press('Home')
    await box.press('ArrowRight')
    await box.press('Enter')
    await expect(box).toHaveValue('订\n正')
    // 下半截是同一件事的下半截，不是新的一条，不该自己拿号
    expect(await cells(page)).toEqual(['1.', ''])
    await box.pressSequentially('正')
    expect(await cells(page)).toEqual(['1.', ''])
  })

  test('编号栏在输入框左边，不压在输入框上头', async ({ page }) => {
    await page.locator(textarea).pressSequentially('订正')
    const geo = await page.evaluate(() => {
      const ta = document.querySelector('.hw-area textarea:not(.v-textarea__sizer)')
      const gutter = ta.closest('.hw-area').querySelector('.hw-gutter')
      return {
        gutterRight: Math.round(gutter.getBoundingClientRect().right),
        fieldLeft: Math.round(ta.getBoundingClientRect().left),
      }
    })
    // 两块并排，编号栏的右边缘正好是输入框的左边缘，一点都不重叠
    expect(geo.gutterRight).toBeLessThanOrEqual(geo.fieldLeft)
    expect(geo.gutterRight).toBeGreaterThan(0)
  })

  test('标题行的 # 只在按钮上，输入框里一个字都不留', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    // 用「#通知」这种普通小标题：「#明天的作业」是预定标记，存盘时会搬到明天去，
    // 那个另有一处测试在管
    await box.pressSequentially('#')
    await box.pressSequentially('通知')
    // 按钮上摆着 #
    expect(await cells(page)).toEqual(['1.', '#'])
    // 输入框里那个 # 已经不在了——它只活在左边那一格上
    await expect(box).toHaveValue('订正\n通知')
    // 存档里那个 # 还在（存盘、判小标题、归属全靠它）
    await save(page)
    expect(await stored(page)).toContain('#通知')
    // 再打开还是小标题。末尾那个空行落在标题后面，是一个新段，虚拟序号从头数
    await page.locator('.hw-card').first().click()
    await expect(page.locator(textarea)).toHaveValue('订正\n通知\n')
    expect(await cells(page)).toEqual(['1.', '#', '1.'])
  })

  test('空行上取消了编号，上面的行被删掉之后也不会冒出序号', async ({ page }) => {
    const box = page.locator(textarea)
    // 「N.正文」这么敲：编号和正文之间没有回车，敲回车就真的分成两行了
    for (const line of ['1.订正', '2.默写', '3.小白']) {
      await box.pressSequentially(line.slice(0, line.indexOf('.')))
      await box.pressSequentially('.')
      await box.pressSequentially(line.slice(line.indexOf('.') + 1))
      await box.press('Enter')
    }
    await expect(box).toHaveValue('订正\n默写\n小白\n')
    // 光标落在末尾那个空行上，先把它取消了
    await expect(ghost(page)).toHaveText('4.')
    await ghost(page).click()
    expect(await cells(page)).toEqual(['1.', '2.', '3.', ''])
    // 上面那行被删掉，记号得跟着走，不能落到别的行头上
    await gotoLine(page, 1)
    await box.press('Backspace')
    expect(await cells(page)).toEqual(['1.', '2.', ''])
    // 在最后那一行敲字，它仍然是「不要编号」的那一行
    await box.press('Control+End')
    await box.pressSequentially('作文')
    expect(await cells(page)).toEqual(['1.', '2.', ''])
    await expect(box).toHaveValue('订正默写\n小白\n作文')
  })

  test('标题行的 # 在编号按钮上，点一下就摘掉', async ({ page }) => {
    await seed(page, '1. 订正\n#明天的作业\n1. 小白')
    await page.locator('.hw-card').first().click()
    await expect(page.locator(textarea)).toHaveValue('订正\n明天的作业\n小白\n')
    // 标题那一格上摆着 #，输入框里那个 # 不在
    expect(await cells(page)).toEqual(['1.', '#', '1.', '2.'])
    await page.locator('.hw-number-mark').click()
    // 摘掉之后这一行变回普通正文，按「每行默认都有号」接上号，下面那行跟着往后挪
    await expect(page.locator(textarea)).toHaveValue('订正\n明天的作业\n小白\n')
    expect(await cells(page)).toEqual(['1.', '2.', '3.', ''])
  })

  test('改一行，后面几行的编号跟着更新', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    for (const text of ['订正', '默写', '小白']) {
      await box.pressSequentially(text)
      if (text !== '小白') await box.press('Enter')
    }
    expect(await cells(page)).toEqual(['1.', '2.', '3.'])
    // 把第一行的字全删了：它不再是一条作业，后面几行跟着往上收
    await gotoLine(page, 0)
    await box.press('Shift+End')
    await box.press('Delete')
    await expect(box).toHaveValue('\n默写\n小白')
    expect(await cells(page)).toEqual(['1.', '1.', '2.'])
    // 第一行重新写上字：这一节从它开始重新编，下面那几行跟着回去
    await box.pressSequentially('订正2')
    await expect(box).toHaveValue('订正2\n默写\n小白')
    expect(await cells(page)).toEqual(['1.', '2.', '3.'])
  })

  test('清空一行再填回来，下面的号也跟着回位', async ({ page }) => {
    await seed(page, '1. 订正\n2. 默写\n3. 小白')
    await page.locator('.hw-card').first().click()
    const box = page.locator(textarea)
    await expect(box).toHaveValue('订正\n默写\n小白\n')
    // 中间那一行清空：它不算一条作业了，小白 收成 1.
    await gotoLine(page, 1)
    await box.press('Shift+End')
    await box.press('Delete')
    await expect(box).toHaveValue('订正\n\n小白\n')
    expect(await cells(page)).toEqual(['1.', '2.', '1.', ''])
    // 填回来：小白 得跟着回到 3.
    await box.pressSequentially('默写')
    expect(await cells(page)).toEqual(['1.', '2.', '3.', ''])
  })

  test('清空一行再删掉整行，下面一行接上', async ({ page }) => {
    await seed(page, '1. 订正\n2. 默写\n3. 小白')
    await page.locator('.hw-card').first().click()
    const box = page.locator(textarea)
    await gotoLine(page, 1)
    await box.press('Shift+End')
    await box.press('Delete')
    expect(await cells(page)).toEqual(['1.', '2.', '1.', ''])
    // 退格删掉这一行，小白 接到 2.
    await box.press('Backspace')
    await expect(box).toHaveValue('订正\n小白\n')
    expect(await cells(page)).toEqual(['1.', '2.', ''])
  })

  test('分段：插一个空行，下面那半截从头数起', async ({ page }) => {
    await seed(page, '1. 订正\n2. 默写\n3. 小白')
    await page.locator('.hw-card').first().click()
    const box = page.locator(textarea)
    await gotoLine(page, 0)
    await box.press('End')
    await box.press('Enter')
    await expect(box).toHaveValue('订正\n\n默写\n小白\n')
    // 空行把一节劈成两节：下半截重新从 1 数，别留在 2. 3. 上
    expect(await cells(page)).toEqual(['1.', '2.', '1.', '2.', ''])
    await box.pressSequentially('订正2')
    expect(await cells(page)).toEqual(['1.', '2.', '3.', '4.', ''])
  })

  test('合并：删掉中间空行，整段接着上一段往下数', async ({ page }) => {
    await seed(page, '1. 订正\n2. 默写\n\n1. 小白\n2. 卷子')
    await page.locator('.hw-card').first().click()
    const box = page.locator(textarea)
    expect(await cells(page)).toEqual(['1.', '2.', '', '1.', '2.', '3.'])
    await gotoLine(page, 2)
    // 一个退格把这个空行删掉，两段并成一段
    await box.press('Backspace')
    await expect(box).toHaveValue('订正\n默写\n小白\n卷子\n')
    // 小白、卷子 接到 3. 4.，不是各自从头数
    expect(await cells(page)).toEqual(['1.', '2.', '3.', '4.', ''])
  })

  test('点最上面一行，下面乱掉的号全跟着修正', async ({ page }) => {
    // 存档里存着一串乱号（早先版本会存成这样）
    await seed(page, '1. 订正\n1. 默写\n5. 小白')
    await page.locator('.hw-card').first().click()
    expect(await cells(page)).toEqual(['1.', '1.', '5.', '6.'])
    // 点最上面那一行（它自己去掉号），下面两行被修正成连号
    await button(page, 0).click()
    expect(await cells(page)).toEqual(['', '1.', '2.', '3.'])
  })

  test('编号按钮点得中（点击区域够大）', async ({ page }) => {
    await page.locator(textarea).pressSequentially('订正')
    const box = await button(page, 0).boundingBox()
    expect(box.width, '编号按钮的宽度').toBeGreaterThanOrEqual(24)
    expect(box.height, '编号按钮的高度').toBeGreaterThanOrEqual(20)
  })

  test('编号栏和正文错开一整条栏，折行也挂在编号后面', async ({ page }) => {
    // 一行写得足够长，逼它折行
    await page.locator(textarea).pressSequentially('1.')
    await page.locator(textarea).pressSequentially('订正'.repeat(20))
    await expect(page.locator(textarea)).toHaveValue('订正'.repeat(20))
    const bodyBox = await page.locator(textarea).boundingBox()
    const numberBox = await button(page, 0).boundingBox()
    // 编号栏整个压在输入框的左边距里，右边缘不能伸到正文上头去
    expect(numberBox.x + numberBox.width).toBeLessThanOrEqual(bodyBox.x + 60)
    // 编号栏的每一格都要落在那一行上：折行的行占两格，编号只挂在第一格
    const one = await cell(page, 0).boundingBox()
    expect(one.x).toBeLessThan(bodyBox.x + 60)
    expect(one.height, '折行的那一格要够两行高').toBeGreaterThan(30)
  })

  test('存盘：编号存进正文，卡片上悬挂对齐', async ({ page }) => {
    await page.locator(textarea).pressSequentially('1.')
    await page.locator(textarea).pressSequentially('订正')
    await page.locator(textarea).press('Enter')
    await page.locator(textarea).pressSequentially('默写')
    await save(page)
    expect(await stored(page)).toContain('1. 订正')

    // 卡片上的编号行：编号顶格往左探出去，正文从同一条竖线开始
    const line = page.locator('.hw-line-num').first()
    await expect(line).toBeVisible()
    const num = await line.locator('.hw-num').boundingBox()
    const left = await line.evaluate((el) => el.getBoundingClientRect().left)
    const pad = await line.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
    // 序号顶在行首（往左探出去那一截就是悬挂对齐），右边缘离正文还有那一个空格
    expect(Math.abs(num.x - left), '序号顶在行首').toBeLessThan(2)
    const gap = left + pad - (num.x + num.width)
    expect(gap, '序号和正文之间的那一个空格').toBeGreaterThan(4)
    expect(gap, '序号和正文之间的那一个空格').toBeLessThan(14)
  })

  test('板上：有没有序号的行正文都对齐，序号右对齐', async ({ page }) => {
    // 中间插一行没有编号的：它也得跟别的行对齐到同一条竖线
    await seed(page, '1. 订正\n随便一句没编号的话\n2. 默写')
    await expect(page.locator('.hw-line')).toHaveCount(3)
    const geo = await page.evaluate(() =>
      [...document.querySelectorAll('.hw-line')].map((el) => {
        // 要量的是**正文**那几个字，不能顺手当成编号里那几个——有序号的行
        // 第一个文本节点是编号自己，量它就量成左边去了
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let node = null
        let step
        while ((step = walker.nextNode())) {
          if (step.textContent.trim() && !step.parentElement.classList.contains('hw-num')) {
            node = step
            break
          }
        }
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, 1)
        const body = range.getBoundingClientRect()
        const num = el.querySelector('.hw-num')?.getBoundingClientRect()
        return {
          // 正文起始位置（没编号的行也一样，两边必须重合）
          bodyLeft: Math.round(body.left),
          // 序号右边缘：有序号的那些都在同一条竖线上（右对齐）
          numRight: num ? Math.round(num.right) : null,
        }
      }),
    )
    // 四行的正文起始位置一模一样——不管有没有编号
    expect(new Set(geo.map((g) => g.bodyLeft)).size, '正文起始位置').toBe(1)
    // 有序号的那些，序号右边缘也都一样（同一列里右对齐）
    const numbered = geo.filter((x) => x.numRight !== null)
    expect(new Set(numbered.map((g) => g.numRight)).size, '序号右边缘').toBe(1)
    // 序号和正文之间留一个空格左右，不挤在一起
    const gap = geo[0].bodyLeft - numbered[0].numRight
    expect(gap, '序号和正文之间的距离').toBeGreaterThan(4)
    expect(gap, '序号和正文之间的距离').toBeLessThan(14)
  })

  test('按钮上的右键菜单被掐掉，输入框里的留着', async ({ page }) => {
    await page.locator(textarea).pressSequentially('订正')
    const onButton = await page.evaluate(() => {
      const el = document.querySelector('.hw-gutter .hw-number')
      if (!el) return 'no-button'
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      return el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        ? 'not-blocked'
        : 'blocked'
    })
    expect(onButton).toBe('blocked')
  })

  test('存盘再打开：看到的东西一个字都不差', async ({ page }) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    await box.pressSequentially('订正')
    await box.press('Enter')
    await box.pressSequentially('默写')
    await box.press('Enter')
    await box.pressSequentially('1.')
    await box.pressSequentially('完成')
    await box.press('Enter')
    await box.pressSequentially('1.5米那面墙')
    const before = await box.inputValue()
    await save(page)
    // 重新打开同一张卡，正文得原样回来（存储 ↔ 输入框这一趟往返）。
    // 末尾那个空行不比：面板每次打开都会按 appendBlankLines 补一个，那是老规矩
    await page.locator('.hw-card').first().click()
    await expect(page.locator(textarea)).toBeVisible()
    await expect
      .poll(async () => (await page.locator(textarea).inputValue()).trim())
      .toBe(before.trim())
    await expect(button(page, 0)).toHaveText('1.')
    await expect(button(page, 3)).toHaveText('4.')
  })

  test('敲完 1. 立刻变成编号（数字紧跟着来也算正文）', async ({ page }) => {
    // 「只认 1.」这条规则是看到就转，所以 1.5 这种写法会被读成
    // 「编号 1 + 正文 5…」。这是有意为之：等一个空格再转的话，
    // 中文输入法敲完 1. 直接接字（中间没有空格）的写法就再也认不出来了
    await page.locator(textarea).pressSequentially('1.')
    await expect(ghost(page)).toHaveText('1.')
    await page.locator(textarea).pressSequentially('5米那面墙')
    await expect(page.locator(textarea)).toHaveValue('5米那面墙')
    await save(page)
    expect(await stored(page)).toContain('1. 5米那面墙')
  })
})

test.describe('只有号的空行', () => {
  // 早先版本存下来的正文里可能有「3.」这种只有号、没有字的行（敲了号又删了字）。
  // 它不该在板上摆一条出来，也不该逼用户先点掉那个号才删得掉

  test('板上不摆光秃秃的号', async ({ page }) => {
    await page.goto('/classworks/')
    await seed(page, '1. 订正\n2.\n3. 默写\n4.')
    await expect(page.locator('.hw-line')).toHaveCount(2)
    await expect(page.locator('.hw-num')).toHaveText(['1.', '2.'])
  })

  test('一个退格删掉整行，编号跟着收连续', async ({ page }) => {
    await page.goto('/classworks/')
    await seed(page, '1. 订正\n2.\n3. 默写')
    await page.locator('.hw-card').first().click()
    await expect(page.locator(textarea)).toBeVisible()
    await expect(page.locator(textarea)).toHaveValue('订正\n\n默写\n')
    // 那个空行不摆编号，也点不到号：它不是一条作业
    await expect(page.locator('.hw-gutter .hw-number-on')).toHaveCount(2)
    // 光标挪到那个空行上：虚拟序号接着往下数
    const box = page.locator(textarea)
    await box.press('Control+Home')
    await box.press('ArrowDown')
    await expect(ghost(page)).toHaveText('2.')
    // 一个退格把这个空行删掉，原来那个 3. 收成 2.
    await box.press('Backspace')
    await expect(box).toHaveValue('订正\n默写\n')
    await expect(button(page, 0)).toHaveText('1.')
    await expect(button(page, 1)).toHaveText('2.')
  })

  test('存盘不把空编号行留下来', async ({ page }) => {
    await page.goto('/classworks/')
    await seed(page, '1. 订正\n2.\n3. 默写')
    await page.locator('.hw-card').first().click()
    await expect(page.locator(textarea)).toBeVisible()
    await save(page)
    const content = await stored(page)
    expect(content).toContain('1. 订正')
    expect(content).not.toMatch(/^\s*\d+\.\s*$/m)
  })
})

// 一串随机操作之后，这些不变式必须还成立：
//   输入框里的行数 = 编号栏的格子数（一行对一格，位置才对得上）
//   光标还在输入框的范围内
//   存盘再打开，输入框里的内容一个字不多一个字不少
test.describe('随机敲一通', () => {
  test('操作之后输入框和编号栏还对得上', async ({ page }) => {
    await openEditor(page)
    const keys = ['订', '正', '默', '1', '.', ' ', 'a', '3']
    const actions = ['type', 'enter', 'backspace', 'home', 'end', 'space']
    // 固定种子：跑挂了能原样复现，不用每次都换一串
    let seed = 20261011
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let step = 0; step < 40; step++) {
      const action = actions[rand(actions.length)]
      const box = page.locator(textarea)
      if (action === 'type') await box.pressSequentially(keys[rand(keys.length)])
      else if (action === 'space') await box.press(' ')
      else if (action === 'enter') await box.press('Enter')
      else if (action === 'backspace') await box.press('Backspace')
      else if (action === 'home') await box.press('Home')
      else await box.press('End')
    }
    const state = await page.evaluate(() => {
      const area = document.querySelector('.hw-area textarea:not(.v-textarea__sizer)')
      const cells = document.querySelectorAll('.hw-gutter .hw-number-cell')
      return { lines: area.value.split('\n').length, cells: cells.length, caret: area.selectionStart }
    })
    expect(state.lines, '输入框的行数和编号栏的格子数').toBe(state.cells)
    expect(state.caret).toBeGreaterThanOrEqual(0)
    expect(state.caret).toBeLessThanOrEqual((await page.locator(textarea).inputValue()).length)
  })
})

test.describe('鼠标静止之后收掉悬停', () => {
  // :hover 是浏览器的伪类，JS 取消不了——这一整套是靠 App.vue 挂类名 +
  // index.scss 里逐条覆盖做出来的。测的就是这两半接得上
  const card = '.empty-subject-card'
  const look = (page) =>
    page.evaluate((sel) => {
      const cs = getComputedStyle(document.querySelector(sel))
      return {
        hovered: cs.transform !== 'none',
        dimmed: cs.opacity !== '1',
        idle: document.documentElement.classList.contains('hw-hover-idle'),
      }
    }, card)

  test('静止超过 3 秒退回非悬停，动一下立刻恢复', async ({ page }) => {
    await page.goto('/classworks/')
    const box = await page.locator(card).first().boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => look(page)).toMatchObject({ hovered: true, idle: false })
    // 还没到 3 秒，悬停还在
    await page.waitForTimeout(1200)
    expect((await look(page)).hovered, '1.2 秒时还悬停着').toBe(true)
    // 到了 3 秒就收回去
    await expect.poll(() => look(page), { timeout: 4000 }).toMatchObject({ hovered: false, idle: true })
    expect((await look(page)).dimmed, '同时回到平时的压暗').toBe(true)
    // 鼠标动一下（哪怕 2px），悬停当场回来
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2)
    await expect.poll(() => look(page), { timeout: 2000 }).toMatchObject({ hovered: true, idle: false })
  })

  test('按住不放的时候不收：按下的效果不能被收掉', async ({ page }) => {
    await page.goto('/classworks/')
    const box = await page.locator(card).first().boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(3600)
    const held = await look(page)
    // 按着的时候不算「静止」：那是用户捏着一个东西在等
    expect(held.idle, '按住时不该挂上静止标记').toBe(false)
    expect(held.hovered, '按住时悬停还在').toBe(true)
    await page.mouse.up()
  })

  test('静止之后仍然点得开卡片', async ({ page }) => {
    await page.goto('/classworks/')
    const box = await page.locator(card).first().boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => look(page), { timeout: 4000 }).toMatchObject({ idle: true })
    // 动一下再点——真实用户也是先动再点
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2)
    await page.locator(card).first().click()
    await expect(page.locator(textarea)).toBeVisible()
  })
})

test.describe('跟已有功能混着来', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page)
  })

  // 敲一个编号，后面两行靠回车自己往下接（编号 1. 2. 3.）
  const threeNumbered = async (page) => {
    const box = page.locator(textarea)
    await box.pressSequentially('1.')
    for (const text of ['订正', '默写', '小白']) {
      await box.pressSequentially(text)
      if (text !== '小白') await box.press('Enter')
    }
  }

  test('预定到明天：那一行搬过去，剩下的编号收成连续', async ({ page }) => {
    await threeNumbered(page)
    // 光标停在第三行，点「作为…的作业」那一栏的「明天」
    await reserveChip(page, '明天').click()
    // 搬走之后原来那节只剩两行；小白进了「#明天的作业」标题下面那一节，
    // 编号从 1 重新数。空行不摆号，标题那一格摆 #
    expect(await cells(page)).toEqual(['1.', '2.', '', '#', '1.', ''])
    // 正文里那行还是「小白」，一个字没少
    await expect
      .poll(async () => (await page.locator(textarea).inputValue()).trim())
      .toBe('订正\n默写\n\n明天的作业\n小白')
  })

  test('点预定日期：光标跟着搬走的那一行走，还停在原来那个字后面', async ({ page }) => {
    // 编号要排到两位数：搬完之后这一行的编号从 9. 变成 1.，宽度变了，
    // 光标要是按绝对偏移放回去就会偏一格
    await seed(page, '1. 订正\n2. 默写\n3. 小白\n4. 卷子\n5. 作文\n6. 单词\n7. 错题\n8. 默读\n9. 背诵')
    await page.locator('.hw-card').first().click()
    const box = page.locator(textarea)
    await expect(box).toHaveValue('订正\n默写\n小白\n卷子\n作文\n单词\n错题\n默读\n背诵\n')
    // 光标停在「背|诵」中间
    await gotoLine(page, 8)
    await box.press('ArrowRight')
    await expect
      .poll(async () => box.evaluate((el) => el.value.slice(0, el.selectionStart).split('\n').pop().length))
      .toBe(1)
    await reserveChip(page, '明天').click()
    // 背诵从原位摘走了，搬到了「#明天的作业」标题下面
    await expect
      .poll(async () => (await box.inputValue()).trim())
      .toBe('订正\n默写\n小白\n卷子\n作文\n单词\n错题\n默读\n\n明天的作业\n背诵')
    // 搬到了新位置，光标还在这一行里、也还在「背|诵」中间：没跑到行尾，也没跑到行首
    await expect
      .poll(async () =>
        box.evaluate((el) => {
          const all = el.value.slice(0, el.selectionStart).split('\n')
          return `${all[all.length - 1]}|${el.value[el.selectionStart]}`
        }),
      )
      .toBe('背|诵')
  })

  test('预定到明天并存盘：内容真的搬到明天那一天', async ({ page }) => {
    await threeNumbered(page)
    await reserveChip(page, '明天').click()
    await save(page)
    // 存盘这一刻预定标记就落实了：今天只剩两行，标记行不留
    const today = await stored(page)
    expect(today).toContain('1. 订正')
    expect(today).not.toContain('小白')
    // 搬过去的那天：另起一节，编号从 1 开始
    const tomorrow = await storedFor(page, tomorrowKey())
    expect(tomorrow).toContain('1. 小白')
    expect(tomorrow).not.toContain('订正')
  })

  test('多选整块改日期：编号跟着重排，光标不乱', async ({ page }) => {
    await threeNumbered(page)
    await expect(button(page, 2)).toHaveText('3.')
    // 选中第二行，点「明天」：它搬进明天那节
    await page.locator(textarea).press('ArrowUp')
    await page.locator(textarea).press('Home')
    await page.locator(textarea).press('Shift+ArrowDown')
    await reserveChip(page, '明天').click()
    // 搬过去的那一节：标题下面是 默写(1.) 小白(2.)。空行不摆号，标题那一格摆 #
    expect(await cells(page)).toEqual(['1.', '', '#', '1.', '2.', ''])
    // 光标还落在输入框里，且没有跑到正文之外
    const caret = await page.locator(textarea).evaluate((el) => el.selectionStart)
    expect(caret).toBeGreaterThanOrEqual(0)
  })
})
