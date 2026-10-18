// 离场的卡片马上要脱离文档流（见 transitions.scss 的 .v-list-leave-active），
// 脱离后网格不再给它宽度、静态位置也会重排到别的格子去，淡出那一瞬看着像
// 「往下挪一截再消失」。这里把当前的位置和尺寸钉死，它就只在原地淡出。
//
// 展示板的「点击添加作业」和设置页的科目管理用的是同一份（两处原先逐字相同）：
// 只在 TransitionGroup 的 before-leave 里调用，el 就是即将离场的那张卡片。
// 越界的坐标按宿主元素的滚动位置补回来：offsetParent 不一定就是滚动容器。
export function holdLeavingBox(el) {
  const box = el.getBoundingClientRect()
  const host = el.offsetParent
  if (host) {
    const hostBox = host.getBoundingClientRect()
    el.style.left = `${box.left - hostBox.left + host.scrollLeft}px`
    el.style.top = `${box.top - hostBox.top + host.scrollTop}px`
  }
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
}
