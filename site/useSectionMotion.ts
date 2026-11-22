import { useEffect } from 'react'

export function useSectionMotion() {
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>('.site-main > section[id]')]
    const header = document.querySelector<HTMLElement>('.site-header')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let stopped = false

    const clamp = (value: number) => Math.max(0, Math.min(1, value))

    function update() {
      frame = 0
      const viewportHeight = window.innerHeight
      const headerHeight = header?.offsetHeight || 80
      // Read every rectangle before applying styles so scrolling avoids layout thrashing.
      const measurements = sections.map(section => ({ section, rect: section.getBoundingClientRect() }))
      for (const { section, rect } of measurements) {
        const focused = section.contains(document.activeElement)
        const staticContent = reducedMotion.matches || focused
        const enter = staticContent ? 1 : clamp((viewportHeight - rect.top - 50) / Math.min(280, viewportHeight * .38))
        const leave = staticContent ? 0 : clamp((headerHeight + 160 - rect.bottom) / 160)
        const opacity = Math.max(.06, enter * (1 - leave))
        section.style.setProperty('--section-line', String(enter))
        section.style.setProperty('--section-opacity', String(opacity))
        // Enter from below, then move upward while fading out at the top.
        section.style.setProperty('--section-shift', `${staticContent ? 0 : (1 - enter) * 28 - leave * 24}px`)
      }
    }

    function schedule() {
      if (!frame && !stopped) frame = requestAnimationFrame(update)
    }

    const resizeObserver = new ResizeObserver(schedule)
    sections.forEach(section => resizeObserver.observe(section))
    document.documentElement.classList.add('section-motion-enabled')
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    reducedMotion.addEventListener('change', schedule)
    schedule()

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      reducedMotion.removeEventListener('change', schedule)
      document.documentElement.classList.remove('section-motion-enabled')
      sections.forEach(section => {
        section.style.removeProperty('--section-line')
        section.style.removeProperty('--section-opacity')
        section.style.removeProperty('--section-shift')
      })
    }
  }, [])
}
