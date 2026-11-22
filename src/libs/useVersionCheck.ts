import { useEffect } from 'react'

/**
 * 当前 App 版本号，与 app.yaml 保持同步。
 * 每次发布前手动更新此值。
 */
export const APP_VERSION = '1.1.5'

/**
 * 版本更新检测 Hook。
 * 每次面板挂载时比较 localStorage 中记录的版本号，
 * 如果不同则提示用户刷新页面。
 *
 * ⚠️ 由于浏览器对面板 JS 有强缓存（max-age=31536000），
 * 此检测仅在用户已刷新浏览器后生效。
 * 真正可靠的更新通知需要开发者主动告知用户 Ctrl+Shift+R。
 */
export function useVersionCheck() {
  useEffect(() => {
    const storedVersion = localStorage.getItem('app_version')

    if (storedVersion && storedVersion !== APP_VERSION) {
      console.log(
        `[GPA Simulator] 版本已更新: ${storedVersion} → ${APP_VERSION}，请 Ctrl+Shift+R 刷新`
      )
    }

    localStorage.setItem('app_version', APP_VERSION)
  }, [])
}
