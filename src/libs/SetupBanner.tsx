// ============================================================
// 首次初始化引导横幅
// 应用模板不含插件绑定；首次打开面板时自动绑定 if-grades-simulation 插件。
// 技能/脚本内置在插件里，不写入用户工作空间。
// 横幅：插件未就绪时一行提示，就绪后自动消失。
// ============================================================
import { useState, useEffect } from 'react'
import { ensureGradesPlugin, isSetupDone, type SetupStatus } from './api'

interface SetupBannerProps {
  workspaceId: string
}

export function SetupBanner({ workspaceId }: SetupBannerProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null)

  useEffect(() => {
    let alive = true
    ensureGradesPlugin(workspaceId)
      .then(s => { if (alive) setStatus(s) })
      .catch(() => { if (alive) setStatus({ pluginBound: false }) })
    return () => { alive = false }
  }, [workspaceId])

  // 已完成（或本地记忆命中）→ 不渲染
  if (isSetupDone(status)) return null

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 flex items-center gap-2 flex-wrap">
      <span>AI 功能准备中，请稍后</span>
      <button className="underline font-medium whitespace-nowrap" onClick={() => location.reload()}>刷新页面</button>
      <span>后使用；仍有问题请联系管理员绑定插件</span>
      <code className="px-1 bg-amber-100 rounded text-xs">if-grades-simulation</code>
    </div>
  )
}
