// ============================================================
// @knodo/api 站点版 shim
// 站点模式下没有平台对话窗口，chat.send 无法投递消息。
// 这里做安全降级：提示用户到工作空间内使用该功能，
// 而不是静默丢弃（用户至少要知道命令没被执行）。
// ============================================================

let lastToast = 0

function toastSiteLimitation() {
  // 简易去重：3 秒内多条命令只弹一次提示
  const now = Date.now()
  if (now - lastToast < 3000) return
  lastToast = now
  const el = document.createElement('div')
  el.textContent = '该功能依赖工作空间 AI 会话，请在 Knodo 工作空间内的本 App 中使用'
  el.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;' +
    'padding:10px 18px;border-radius:8px;font-size:13px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.25)'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 3200)
}

export const chat = {
  /** 站点模式：不可用，提示用户回工作空间使用 */
  send(_message: string) {
    toastSiteLimitation()
  },
  /** 站点模式：填入输入框同样不可用 */
  fill(_message: string) {
    toastSiteLimitation()
  },
}
