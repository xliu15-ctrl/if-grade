// ============================================================
// 均分绩点模拟器 — 分析报告面板 (analyze.tsx)
// 纯 SVG 图表，无 Recharts 依赖
// ============================================================

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useVersionCheck } from '../libs/useVersionCheck'
import type { ScoreRecord, AlgorithmConfig, CustomAlgorithm } from '../libs/types'
import {
  calculateGPA, weightedAvg, arithmeticAvg, getSemesterStats,
  scoreToGPA, calculateWESGPA,
  PRESET_ALGORITHMS, DEFAULT_WES_CONFIG, customToAlgoConfig,
} from '../libs/gpa-engine'
import { ensureDataFile, readJSON, writeJSON, syncKBManifest, API_PREFIX, IS_SITE_MODE, IS_BROWSER_MODE, ensureGradesPlugin } from '../libs/api'
import { SetupBanner } from '../libs/SetupBanner'
import { chat } from '@knodo/api'
import ReportExport from '../../site/ReportExport'

const SCORES_FILE = 'data/scores.json'
const CONFIG_FILE = 'data/gpa_config.json'
const ANALYZE_STATE_FILE = 'data/analyze_state.json'
const DrawRevision = createContext('')

// ============================================================
// 颜色系统
// ============================================================

const C = {
  primary: IS_BROWSER_MODE ? '#4b6857' : '#2563eb', gray: '#6b7280', green: '#059669',
  red: '#dc2626', amber: '#d97706', light: '#f3f4f6',
  grid: '#e5e7eb', text: '#374151', muted: '#9ca3af',
  purple: IS_BROWSER_MODE ? '#ab815f' : '#8b5cf6',
} as const

const SCORE_RANGES = [
  { lo: 0, hi: 59, label: '0-59' },
  { lo: 60, hi: 69, label: '60-69' },
  { lo: 70, hi: 79, label: '70-79' },
  { lo: 80, hi: 89, label: '80-89' },
  { lo: 90, hi: 100, label: '90-100' },
]

// ============================================================
// 主组件
// ============================================================

export default function AnalyzePanel({ workspaceId, view }: { workspaceId: string; view?: 'charts' | 'wes' }) {
  useVersionCheck()

  // key 带 workspaceId：sessionStorage 按域名共享，不同空间会串数据
  const ANALYZE_CACHE_KEY = `if-gpa_analyze_cache_${workspaceId}`
  let initCache: any = {}
  try { const raw = sessionStorage.getItem(ANALYZE_CACHE_KEY); if (raw) initCache = JSON.parse(raw) } catch {}

  const [courses, setCourses] = useState<ScoreRecord[]>(initCache.courses || [])
  const [algoId, setAlgoId] = useState(initCache.algoId || 'five_point')
  const [customAlgorithms, setCustomAlgorithms] = useState<CustomAlgorithm[]>([])
  const [loading, setLoading] = useState(false) // 不再显示加载中，用缓存直出
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<'charts' | 'wes' | 'export'>('charts')
  const tabRestored = useRef(false)
  const isInitialLoad = useRef(true)

  // 各 tab 的滚动容器 ref + 保存的滚动位置
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({ charts: null, wes: null, export: null })
  const pendingScroll = useRef<Record<string, number>>({})

  // 合并写入状态文件（避免覆盖其他字段）
  const mergeState = useCallback(async (patch: Record<string, unknown>) => {
    try {
      const prev = await readJSON<any>(workspaceId, ANALYZE_STATE_FILE).catch(() => ({}))
      await writeJSON(workspaceId, ANALYZE_STATE_FILE, { ...prev, ...patch })
    } catch { /* 静默 */ }
  }, [workspaceId])

  // 挂载时恢复上次保存的 tab 状态和滚动位置
  useEffect(() => {
    let cancelled = false
    readJSON<{ activeTab?: string; scrollPositions?: Record<string, number> }>(workspaceId, ANALYZE_STATE_FILE)
      .then(state => {
        if (cancelled) return
        if (state?.activeTab && ['charts', 'wes', 'export'].includes(state.activeTab)) {
          setActiveTab(IS_BROWSER_MODE && state.activeTab === 'export' ? 'charts' : state.activeTab as 'charts' | 'wes' | 'export')
        }
        if (state?.scrollPositions) {
          pendingScroll.current = state.scrollPositions
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) tabRestored.current = true
      })
    return () => { cancelled = true }
  }, [workspaceId])

  // 恢复滚动位置（tab 内容渲染后执行）
  useEffect(() => {
    if (!tabRestored.current) return
    const saved = pendingScroll.current[activeTab]
    if (saved == null) return
    // 延迟到下一帧，确保内容已渲染
    let raf = 0
    const tryRestore = (attempts: number) => {
      const el = scrollRefs.current[activeTab]
      if (el && el.scrollHeight > saved) {
        el.scrollTop = saved
      } else if (attempts > 0) {
        raf = requestAnimationFrame(() => tryRestore(attempts - 1))
      }
    }
    raf = requestAnimationFrame(() => tryRestore(5))
    return () => cancelAnimationFrame(raf)
  }, [activeTab, tabRestored.current])

  // 收集当前所有 tab 的滚动位置
  const captureScrollPositions = useCallback(() => {
    const pos: Record<string, number> = {}
    for (const [k, el] of Object.entries(scrollRefs.current)) {
      if (el) pos[k] = el.scrollTop
    }
    return pos
  }, [])

  // 包装 setActiveTab：切换前保存滚动位置，切换后持久化
  const switchTab = useCallback((tab: 'charts' | 'wes' | 'export') => {
    // 保存当前 tab 的滚动位置
    const pos = captureScrollPositions()
    setActiveTab(tab)
    if (tabRestored.current) {
      mergeState({ activeTab: tab, scrollPositions: pos })
    }
  }, [captureScrollPositions, mergeState])

  // 组件卸载时保存滚动位置
  useEffect(() => {
    return () => {
      const pos = captureScrollPositions()
      mergeState({ scrollPositions: pos })
    }
  }, [captureScrollPositions, mergeState])

  // ---- 反馈对话框 ----
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackType, setFeedbackType] = useState<'bug' | 'suggestion' | 'question'>('suggestion')
  const [feedbackContent, setFeedbackContent] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)

  // 「反馈自动处理」定时任务 ID：当前空间已配置，委派 grades-bot（K豆）处理反馈并钉钉通知开发者
  const FEEDBACK_TASK_ID = 'd6571a13-6a2d-476f-8eb6-2ef7b933e70b'

  const submitFeedback = async () => {
    if (!feedbackContent.trim()) return
    setFeedbackSending(true)
    try {
      await writeJSON(workspaceId, 'data/feedback/pending.json', {
        id: 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        type: feedbackType,
        content: feedbackContent.trim(),
        submittedAt: new Date().toISOString(),
        status: 'pending', // 审批状态机: pending→proposed→approved→implemented | rejected
        solution: '',      // 当前方案（定时任务/K豆 生成，钉钉通知开发者审批）
        solutionHistory: [], // 方案修订历史（多轮"提要求→重新生成"）
        decision: null,    // 开发者审批结论: approved | rejected | {modify: 修改要求}
        implementedAt: null,
        version: null
      })
      // 触发「反馈自动处理」定时任务立即执行（K豆 处理并钉钉通知开发者）
      // 站点模式下该接口未开放给站点授权，跳过触发，由定时任务周期性兜底处理
      try {
        if (!IS_SITE_MODE) {
          await fetch(
            `/api/v1/workspaces/${workspaceId}/scheduled-tasks/${FEEDBACK_TASK_ID}/execute`,
            { method: 'POST', credentials: 'include' }
          )
        }
      } catch { /* 任务不存在则静默降级，定时任务周期性兜底处理 */ }
      alert('非常感谢您的反馈！！！')
      setShowFeedback(false)
      setFeedbackContent('')
    } catch (err) {
      alert('发送失败，请稍后重试')
    } finally {
      setFeedbackSending(false)
    }
  }

  const loadData = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setRefreshing(true)
      const data = await ensureDataFile<ScoreRecord[]>(workspaceId, SCORES_FILE, [])
      const config = await readJSON<{ activeAlgorithm: string; customAlgorithms?: CustomAlgorithm[] }>(workspaceId, CONFIG_FILE)
      setCustomAlgorithms(config?.customAlgorithms || [])
      setCourses(data || [])
      const configuredId = config?.activeAlgorithm || 'five_point'
      setAlgoId(Object.entries(PRESET_ALGORITHMS).find(([key, value]) =>
        key === configuredId || value.id === configuredId
      )?.[0] || configuredId)
      // 同步缓存到 sessionStorage，下次切 Tab 直出
      try { sessionStorage.setItem(ANALYZE_CACHE_KEY, JSON.stringify({ courses: data || [], algoId: config?.activeAlgorithm || 'five_point' })) } catch {}
      isInitialLoad.current = false
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        console.error('加载成绩数据失败:', e)
      }
    } finally {
      if (showSpinner) setRefreshing(false)
    }
  }, [workspaceId])

  // 首次加载（插件安装由 <SetupBanner> 触发）
  useEffect(() => {
    loadData()
  }, [loadData, workspaceId])

  useEffect(() => {
    if (!IS_BROWSER_MODE) return
    const sync = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail.workspaceId === workspaceId &&
        (detail.filePath === SCORES_FILE || detail.filePath === CONFIG_FILE)) void loadData()
    }
    window.addEventListener('gpa-data-change', sync)
    return () => window.removeEventListener('gpa-data-change', sync)
  }, [workspaceId, loadData])

  // 浏览器 Tab / 窗口重新获得焦点时自动刷新（覆盖从成绩管理切回的场景）
  useEffect(() => {
    const onFocus = () => { if (!isInitialLoad.current) loadData() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadData])

  // 分离真实课程和预测课程（必须在使用它们的 useEffect 之前）
  const custom = customAlgorithms.find(a => a.id === algoId)
  const algo = custom ? customToAlgoConfig(custom) : PRESET_ALGORITHMS[algoId] || PRESET_ALGORITHMS.five_point
  const realCourses = courses.filter(c => !c.isPredicted)
  const predictedCourses = courses.filter(c => c.isPredicted)
  const semStats = getSemesterStats(realCourses, algo)

  // 定期检查：每隔 5 秒对比课程数量，如有变化则自动刷新
  useEffect(() => {
    const interval = setInterval(async () => {
      if (isInitialLoad.current) return
      try {
        const data = await ensureDataFile<ScoreRecord[]>(workspaceId, SCORES_FILE, [])
        if (data && data.length !== realCourses.length) {
          loadData()
        }
      } catch { /* 静默失败 */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [workspaceId, realCourses.length, loadData])

  // 自动保存 GPA 计算结果到 gpa_result.json（供 AI 技能读取）
  useEffect(() => {
    if (realCourses.length === 0 || isInitialLoad.current) return

    const saveGpaResult = async () => {
      try {
        // 按学期分组计算
        const bySemester: Record<string, ScoreRecord[]> = {}
        realCourses.forEach(c => {
          const sem = c.semester || 'unknown'
          if (!bySemester[sem]) bySemester[sem] = []
          bySemester[sem].push(c)
        })

        const semesterStats = Object.keys(bySemester).sort().map(sem => {
          const semCourses = bySemester[sem]
          return {
            semester: sem,
            courseCount: semCourses.length,
            totalCredits: semCourses.reduce((s, c) => s + c.credits, 0),
            originalAvg: weightedAvg(semCourses, 'originalScore'),
            simulatedAvg: weightedAvg(semCourses, 'simulatedScore'),
            originalGPA: calculateGPA(semCourses, 'originalScore', algo),
            simulatedGPA: calculateGPA(semCourses, 'simulatedScore', algo),
          }
        })

        const hasPred = predictedCourses.length > 0
        const allForPred = hasPred ? [...realCourses, ...predictedCourses] : []
        const result = {
          algorithm: algo.name,
          overall: {
            courseCount: realCourses.length,
            totalCredits: realCourses.reduce((s, c) => s + c.credits, 0),
            originalAvg: weightedAvg(realCourses, 'originalScore'),
            simulatedAvg: weightedAvg(realCourses, 'simulatedScore'),
            originalArithAvg: arithmeticAvg(realCourses, 'originalScore'),
            simulatedArithAvg: arithmeticAvg(realCourses, 'simulatedScore'),
            originalGPA: calculateGPA(realCourses, 'originalScore', algo),
            simulatedGPA: calculateGPA(realCourses, 'simulatedScore', algo),
            predictedGPA: hasPred ? calculateGPA(allForPred, 'simulatedScore', algo) : null,
            predictedAvg: hasPred ? weightedAvg(allForPred, 'simulatedScore') : null,
            predictedArithAvg: hasPred ? arithmeticAvg(allForPred, 'simulatedScore') : null,
            wesOriginalGPA: calculateWESGPA(realCourses, 'originalScore'),
            wesSimulatedGPA: calculateWESGPA(realCourses, 'simulatedScore'),
          },
          semesters: semesterStats,
        }

        await writeJSON(workspaceId, 'data/gpa_result.json', result)
      } catch (e) {
        // 静默失败，不影响用户界面
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
          console.error('保存 GPA 结果失败:', e)
        }
      }
    }

    saveGpaResult()
  }, [courses, algo, workspaceId])

  if (loading) return <div className="flex h-full items-center justify-center text-muted-foreground">加载中...</div>

  if (realCourses.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-4xl mb-2">📊</div>
          <div>暂无数据，请先在「数据导入」面板导入成绩</div>
          <button
            onClick={() => loadData(true)}
            className="mt-3 px-4 py-1.5 text-xs rounded border border-gray-200 hover:bg-gray-50"
          >
            🔄 检查新数据
          </button>
        </div>
      </div>
    )
  }

  if (view) {
    return <div className="analysis-page-view p-4">
      {view === 'charts' ? <><ReportExport workspaceId={workspaceId} /><ChartsTab courses={courses} algo={algo} semStats={semStats} workspaceId={workspaceId} /></>
        : <WESTab courses={realCourses} algo={algo} />}
    </div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b items-center justify-between">
        <div className="flex">
        {[
          ['charts', '📊 图表分析'],
          ['wes', '🎓 WES 模拟'],
          ...(!IS_BROWSER_MODE ? [['export', '📤 导出报告']] : []),
        ].map(([key, label]) => (
          <button key={key}
            className={`px-4 py-2 text-sm border-b-2 ${activeTab === key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-muted-foreground'}`}
            onClick={() => switchTab(key as typeof activeTab)}>{label}</button>
        ))}
        {!IS_BROWSER_MODE && <button
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowFeedback(true)}
        >
          💡 建议反馈
        </button>}
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="px-3 py-1 mr-2 text-xs rounded border border-gray-200 hover:bg-gray-50 text-muted-foreground disabled:opacity-50"
          title="从成绩管理同步最新数据"
        >
          {refreshing ? '⏳ 同步中...' : '🔄 刷新数据'}
        </button>
      </div>
      <div className="flex-1 p-4 overflow-hidden">
        <div ref={(el) => { scrollRefs.current.charts = el }} style={{display: activeTab === 'charts' ? 'block' : 'none'}} className="h-full overflow-auto">
          <ChartsTab courses={courses} algo={algo} semStats={semStats} workspaceId={workspaceId} />
        </div>
        <div ref={(el) => { scrollRefs.current.wes = el }} style={{display: activeTab === 'wes' ? 'block' : 'none'}} className="h-full overflow-auto">
          <WESTab courses={realCourses} algo={algo} />
        </div>
        {!IS_BROWSER_MODE && <div ref={(el) => { scrollRefs.current.export = el }} style={{display: activeTab === 'export' ? 'block' : 'none'}} className="h-full overflow-auto">
          <ExportTab workspaceId={workspaceId} courses={realCourses} algo={algo} />
        </div>}
      </div>

      {/* 反馈对话框模态框 */}
      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">💡 建议反馈</h3>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => { setShowFeedback(false); setFeedbackContent('') }}
              >✕</button>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">反馈类型</label>
              <div className="flex gap-2">
                {([
                  ['bug', '🐛 Bug'],
                  ['suggestion', '💡 建议'],
                  ['question', '❓ 使用问题'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      feedbackType === value
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => setFeedbackType(value)}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">反馈内容</label>
              <textarea
                className="w-full rounded-md border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={4}
                placeholder="请详细描述您的问题或建议..."
                value={feedbackContent}
                onChange={(e) => setFeedbackContent(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                onClick={() => { setShowFeedback(false); setFeedbackContent('') }}
              >取消</button>
              <button
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={submitFeedback}
                disabled={feedbackSending || !feedbackContent.trim()}
              >
                {feedbackSending ? '发送中...' : '发送反馈'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// 通用 UI 组件
// ============================================================

function KPICard({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string
}) {
  return (
    <div className="report-kpi rounded-lg border p-3 bg-white">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub != null && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

function Card({ title, children, extra, drawVersion = '' }: {
  title: string; children: React.ReactNode; extra?: React.ReactNode; drawVersion?: string
}) {
  const revision = useContext(DrawRevision)
  const [redraw, setRedraw] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const content = contentRef.current
    if (!content || !IS_BROWSER_MODE) return
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const animations: Animation[] = []
    const cancel = () => animations.forEach(animation => animation.cancel())
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      if (media.matches) return
      content.dataset.draw = String(redraw)
      content.querySelectorAll<SVGGeometryElement>('svg polyline, svg path[stroke]').forEach(line => {
        const length = line.getTotalLength()
        if (!length) return
        animations.push(line.animate([
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
        ], { duration: 1000, easing: 'cubic-bezier(.22,1,.36,1)' }))
      })
      content.querySelectorAll('svg rect, .course-score-track span, .algorithm-range').forEach((bar, index) => {
        animations.push(bar.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
          { duration: 750, delay: Math.min(index * 22, 180), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }))
      })
      animations.push(content.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 600 }))
    }, { threshold: .1 })
    observer.observe(content)
    media.addEventListener('change', cancel)
    return () => { observer.disconnect(); cancel(); media.removeEventListener('change', cancel) }
  }, [revision, redraw, title, drawVersion])
  return (
    <div className="report-card rounded-lg border p-4 bg-white">
      <div className="report-card-heading flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="widget-actions">{extra}{IS_BROWSER_MODE && <button type="button" className="widget-redraw" aria-label={`重新绘制${title}`} title="重新绘制" onClick={() => setRedraw(value => value + 1)}>↻</button>}</div>
      </div>
      <div ref={contentRef} className="widget-content">{children}</div>
    </div>
  )
}

// ============================================================
// 纯 SVG 图表组件
// ============================================================

/** 简易柱状图 */
function SVGBarChart({ data, xKey, bars, height = 200, yLabel }: {
  data: Record<string, any>[]
  xKey: string
  bars: { key: string; color: string; label: string }[]
  height?: number
  yLabel?: string
}) {
  const pad = { top: 10, right: 10, bottom: 48, left: 40 }
  const w = 500, h = height
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom
  const allVals = data.flatMap(d => bars.map(b => Number(d[b.key]) || 0))
  const maxAbs = Math.max(...allVals.map(Math.abs), 0.01)
  const maxVal = maxAbs * 1.2
  const tickPrecision = maxVal >= 10 ? 0 : maxVal >= 1 ? 1 : Math.ceil(-Math.log10(maxVal)) + 1
  const minVal = allVals.some(value => value < 0) ? -maxVal : 0
  const range = maxVal - minVal
  const zeroY = pad.top + (maxVal / range) * ch
  const groupW = cw / data.length
  const barW = (groupW - 8) / bars.length

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }}>
      {/* Y轴网格 */}
      {Array.from({ length: 5 }, (_, i) => {
        const y = pad.top + (ch / 4) * i
        const val = (maxVal - range * i / 4).toFixed(tickPrecision)
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke={C.grid} />
            <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize={10} fill={C.muted}>{val}</text>
          </g>
        )
      })}
      {/* X轴基线 */}
      <line x1={pad.left} y1={zeroY} x2={w - pad.right} y2={zeroY} stroke={C.text} />
      {/* 柱子 */}
      {data.map((d, di) => {
        const gx = pad.left + groupW * di + 4
        return bars.map((b, bi) => {
          const val = Number(d[b.key]) || 0
          const bh = (Math.abs(val) / range) * ch
          const x = gx + barW * bi
          const y = val >= 0 ? zeroY - bh : zeroY
          return (
            <g key={`${di}-${bi}`}>
              <rect x={x} y={y} width={barW - 2} height={bh} fill={b.color} rx={2} />
              {val !== 0 && (
                <text x={x + (barW - 2) / 2} y={val > 0 ? y - 3 : y + bh + 10} textAnchor="middle" fontSize={9} fontWeight="bold" fill={b.color}>
                  {val}
                </text>
              )}
            </g>
          )
        })
      })}
      {/* X轴标签 */}
      {data.map((d, i) => {
        const x = pad.left + groupW * i + groupW / 2
        return <text key={i} x={x} y={h - 18} textAnchor="middle" fontSize={10} fill={C.text}>{d[xKey]}</text>
      })}
      {/* 图例 */}
      {bars.map((b, i) => {
        const legendW = bars.length * 72
        const startX = (w - legendW) / 2
        return (
        <g key={b.key} transform={`translate(${startX + i * 72}, ${h - 3})`}>
          <rect x={0} y={-10} width={10} height={10} fill={b.color} rx={2} />
          <text x={14} y={0} fontSize={10} fill={C.text}>{b.label}</text>
        </g>
      )})}
    </svg>
  )
}

/** 简易折线图 */
function SVGLineChart({ data, xKey, lines, height = 200, yLabel }: {
  data: Record<string, any>[]
  xKey: string
  lines: { key: string; color: string; label: string; dash?: boolean }[]
  height?: number
  yLabel?: string
}) {
  const pad = { top: 10, right: 10, bottom: 52, left: 45 }
  const w = 500, h = height
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom
  const allVals = data.flatMap(d => lines.map(l => Number(d[l.key]) || 0))
  const minVal = Math.min(...allVals) * 0.9
  const maxVal = Math.max(...allVals) * 1.1 || 1
  const range = maxVal - minVal || 1
  const n = data.length

  const toXY = (di: number, val: number) => ({
    x: pad.left + (n > 1 ? (cw / (n - 1)) * di : cw / 2),
    y: pad.top + ch - ((val - minVal) / range) * ch,
  })

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }}>
      {/* 网格 */}
      {Array.from({ length: 5 }, (_, i) => {
        const y = pad.top + (ch / 4) * i
        const val = (maxVal - (range / 4) * i).toFixed(1)
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke={C.grid} />
            <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize={10} fill={C.muted}>{val}</text>
          </g>
        )
      })}
      <line x1={pad.left} y1={pad.top + ch} x2={w - pad.right} y2={pad.top + ch} stroke={C.text} />
      {/* 折线 */}
      {lines.map(line => {
        const pts = data.map((d, i) => {
          const p = toXY(i, Number(d[line.key]) || 0)
          return `${p.x},${p.y}`
        }).join(' ')
        return (
          <g key={line.key}>
            <polyline points={pts} fill="none" stroke={line.color} strokeWidth={2}
              strokeDasharray={line.dash ? '6,3' : undefined} />
            {data.map((d, i) => {
              const p = toXY(i, Number(d[line.key]) || 0)
              return <circle key={i} cx={p.x} cy={p.y} r={3} fill={line.color} />
            })}
          </g>
        )
      })}
      {/* X轴标签 */}
      {data.map((d, i) => {
        const x = pad.left + (n > 1 ? (cw / (n - 1)) * i : cw / 2)
        return (
          <text key={i} x={x} y={h - 20} textAnchor="middle" fontSize={10} fill={C.text}>
            {d[xKey]}
          </text>
        )
      })}
      {/* 图例 — 居中排列，多行时避免重叠 */}
      {(() => {
        const maxW = Math.min(110, (cw - 10) / lines.length)
        const totalW = lines.length * maxW
        const startX = pad.left + (cw - totalW) / 2
        return lines.map((l, i) => (
          <g key={l.key} transform={`translate(${startX + i * maxW}, ${h - 4})`}>
            <line x1={0} y1={-5} x2={16} y2={-5} stroke={l.color} strokeWidth={2} strokeDasharray={l.dash ? '4,2' : undefined} />
            <text x={18} y={0} fontSize={9} fill={C.text}>{l.label}</text>
          </g>
        ))
      })()}
    </svg>
  )
}

// ============================================================
// 数据准备
// ============================================================

function getDistData(realCourses: ScoreRecord[], predictedCourses: ScoreRecord[], mode: 'count' | 'percent') {
  const total = realCourses.length || 1
  return SCORE_RANGES.map(r => {
    const origCount = realCourses.filter(c => c.originalScore >= r.lo && c.originalScore < r.hi + 1).length
    const simCount = realCourses.filter(c => {
      const score = c.simulatedScore ?? c.originalScore
      return score >= r.lo && score < r.hi + 1
    }).length
    const predCount = predictedCourses.filter(c => c.simulatedScore !== null && c.simulatedScore >= r.lo && c.simulatedScore < r.hi + 1).length
    return {
      range: r.label,
      原始: mode === 'count' ? origCount : +(origCount / total * 100).toFixed(1),
      模拟: mode === 'count' ? simCount : +(simCount / total * 100).toFixed(1),
      预测: mode === 'count' ? predCount : +(predCount / (predictedCourses.length || 1) * 100).toFixed(1),
    }
  })
}

function getTrendData(semStats: ReturnType<typeof getSemesterStats>, predictedGPA?: number, predictedAvg?: number) {
  const data = semStats.map(s => ({
    name: `第${s.semester}学期`,
    '原始 GPA': +s.originalGPA.toFixed(2),
    '模拟 GPA': +s.simulatedGPA.toFixed(2),
    '原始均分': +s.originalAvg.toFixed(1),
    '模拟均分': +s.simulatedAvg.toFixed(1),
  }))
  // 如果有预测数据，将预测值附着在最后一个学期数据点上
  if (predictedGPA !== undefined && predictedAvg !== undefined && data.length > 0) {
    const last = data[data.length - 1]
    ;(last as any)['预测 GPA'] = +predictedGPA.toFixed(2)
    ;(last as any)['预测均分'] = +predictedAvg.toFixed(1)
  }
  return data
}

function getWaterfallData(courses: ScoreRecord[], algo: AlgorithmConfig) {
  const modified = courses.filter(c => c.simulatedScore !== null)
  if (!modified.length) return []
  const tc = courses.reduce((s, c) => s + c.credits, 0)
  if (!tc) return []
  const items = modified.map(c => {
    const impact = +((scoreToGPA(c.simulatedScore!, algo) - scoreToGPA(c.originalScore, algo)) * c.credits / tc).toFixed(4)
    return { name: c.courseName.length > 8 ? c.courseName.slice(0, 8) + '…' : c.courseName, impact }
  })
  items.push({ name: '总变化', impact: +items.reduce((s, it) => s + it.impact, 0).toFixed(4) })
  return items
}

function getAlgoRadarData(courses: ScoreRecord[]) {
  return Object.values(PRESET_ALGORITHMS).map(a => ({
    name: a.name,
    maxGPA: a.maxGPA,
    available: a.type !== 'grade' || courses.some(course => course.gradePoint != null),
    原始: calculateGPA(courses, 'originalScore', a),
    模拟: calculateGPA(courses, 'simulatedScore', a),
  }))
}

function getImprovementData(courses: ScoreRecord[], algo: AlgorithmConfig) {
  const deltas = [5, 10, 15, 20]
  const tc = courses.reduce((s, c) => s + c.credits, 0) || 1
  // 按学分加权提分潜力排序：学分 × 提10分后的GPA增量
  const ranked = [...courses]
    .map(c => {
      const impact10 = (scoreToGPA(Math.min(100, c.originalScore + 10), algo) - scoreToGPA(c.originalScore, algo)) * c.credits / tc
      return { ...c, impact10 }
    })
    .sort((a, b) => b.impact10 - a.impact10)
    .slice(0, 12)
  return ranked.map(c => {
    const entry: Record<string, any> = {
      id: c.id,
      name: c.courseName,
      credits: c.credits,
      score: c.originalScore,
    }
    for (const d of deltas) {
      const ns = Math.min(100, c.originalScore + d)
      entry[`+${d}`] = +((scoreToGPA(ns, algo) - scoreToGPA(c.originalScore, algo)) * c.credits / tc).toFixed(4)
    }
    return entry
  })
}

// ============================================================
// 图表 Tab
// ============================================================

function ChartsTab({ courses, algo, semStats, workspaceId }: {
  courses: ScoreRecord[]; algo: AlgorithmConfig; semStats: ReturnType<typeof getSemesterStats>; workspaceId: string
}) {
  const [distMode, setDistMode] = useState<'count' | 'percent'>('count')
  const [trendMetric, setTrendMetric] = useState<'gpa' | 'average'>('gpa')

  // 分离真实课程和预测课程（必须在所有使用它们的变量之前）
  const realCourses = courses.filter(c => !c.isPredicted)
  const predictedCourses = courses.filter(c => c.isPredicted)
  const hasPredicted = predictedCourses.length > 0
  const hasMod = realCourses.some(c => c.simulatedScore !== null)

  // 趋势图线条定义（颜色鲜明区分）
  const GPA_LINES = [
    { key: '原始 GPA', color: C.primary, label: '原始 GPA', dash: false },
    { key: '模拟 GPA', color: C.purple, label: '模拟 GPA', dash: true },
    ...(hasPredicted ? [{ key: '预测 GPA', color: '#6b7280', label: '预测 GPA', dash: true }] : []),
  ]
  const AVG_LINES = [
    { key: '原始均分', color: IS_BROWSER_MODE ? C.primary : '#059669', label: '原始均分', dash: false },
    { key: '模拟均分', color: IS_BROWSER_MODE ? C.purple : '#dc2626', label: '模拟均分', dash: true },
    ...(hasPredicted ? [{ key: '预测均分', color: '#6b7280', label: '预测均分', dash: true }] : []),
  ]
  const [visibleGPALines, setVisibleGPALines] = useState<Set<string>>(() => {
    const init = new Set<string>(['原始 GPA'])
    if (hasMod) init.add('模拟 GPA')
    if (hasPredicted) init.add('预测 GPA')
    return init
  })
  const [visibleAvgLines, setVisibleAvgLines] = useState<Set<string>>(() => {
    const init = new Set<string>(['原始均分'])
    if (hasMod) init.add('模拟均分')
    if (hasPredicted) init.add('预测均分')
    return init
  })
  const toggleGPALine = (key: string) => {
    setVisibleGPALines(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  const toggleAvgLine = (key: string) => {
    setVisibleAvgLines(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }

  const origGPA = calculateGPA(realCourses, 'originalScore', algo)
  const simGPA = calculateGPA(realCourses, 'simulatedScore', algo)
  const predGPA = hasPredicted ? calculateGPA(courses, 'simulatedScore', algo) : 0
  const origAvg = weightedAvg(realCourses, 'originalScore')
  const simAvg = weightedAvg(realCourses, 'simulatedScore')
  const predAvg = hasPredicted ? weightedAvg(courses, 'simulatedScore') : 0
  const origArithAvg = arithmeticAvg(realCourses, 'originalScore')
  const simArithAvg = arithmeticAvg(realCourses, 'simulatedScore')
  const wesOrig = calculateWESGPA(realCourses, 'originalScore')
  const wesSim = calculateWESGPA(realCourses, 'simulatedScore')
  const totalCredits = realCourses.reduce((s, c) => s + c.credits, 0)
  // 按原始成绩升序排列，取最低3门
  const sortedByScore = [...realCourses].sort((a, b) => a.originalScore - b.originalScore)
  const lowest3 = sortedByScore.slice(0, 3)
  // 建议提分：综合考虑学分权重和提分空间 (学分 × (100-成绩))
  const improvementRank = [...realCourses]
    .map(c => ({ ...c, potential: +(c.credits * (100 - c.originalScore)).toFixed(1) }))
    .sort((a, b) => b.potential - a.potential)
    .slice(0, 3)

  const distData = getDistData(realCourses, predictedCourses, distMode)
  const trendData = getTrendData(semStats, hasPredicted ? predGPA : undefined, hasPredicted ? predAvg : undefined)
  const waterfallData = getWaterfallData(realCourses, algo)
  const algoData = getAlgoRadarData(realCourses)
  const impData = getImprovementData(realCourses, algo)
  const trendLines = trendMetric === 'gpa' ? GPA_LINES : AVG_LINES
  const selectedTrendLines = trendMetric === 'gpa' ? visibleGPALines : visibleAvgLines
  const displayedTrendLines = trendLines.filter(line => selectedTrendLines.has(line.key))

  const diff = (o: number, s: number, d = 2) => {
    const v = s - o
    if (Math.abs(v) < 0.001) return null
    const isUp = v > 0
    return <span style={{color: isUp ? C.green : C.red, fontSize: '11px'}}>{isUp ? '↑' : '↓'}{Math.abs(v).toFixed(d)}</span>
  }

  return (
    <DrawRevision.Provider value={JSON.stringify([courses, algo.id])}><div className="report-dashboard">
      <SetupBanner workspaceId={workspaceId} />
      <div className="report-kpis">
        <KPICard label="GPA" value={hasMod ? <>{origGPA.toFixed(2)} <span className="metric-arrow">→</span> <span style={{ color: C.purple }}>{simGPA.toFixed(2)}</span></> : origGPA.toFixed(2)} sub={diff(origGPA, simGPA)} />
        <KPICard label="加权均分" value={hasMod ? <>{origAvg.toFixed(1)} <span className="metric-arrow">→</span> <span style={{ color: C.purple }}>{simAvg.toFixed(1)}</span></> : origAvg.toFixed(1)} sub={diff(origAvg, simAvg, 1)} />
        <KPICard label="算术均分" value={hasMod ? <>{origArithAvg.toFixed(1)} <span className="metric-arrow">→</span> <span style={{ color: C.purple }}>{simArithAvg.toFixed(1)}</span></> : origArithAvg.toFixed(1)} sub={diff(origArithAvg, simArithAvg, 1)} />
        <KPICard label="学分 / 课程" value={`${totalCredits} 学分`} sub={`${realCourses.length} 门课程`} />
        <KPICard label="WES GPA" value={hasMod ? `${wesOrig.toFixed(2)} → ${wesSim.toFixed(2)}` : wesOrig.toFixed(2)} sub={diff(wesOrig, wesSim)} />
        <KPICard label="最低三科" value={`${lowest3.map(c => c.originalScore).join(' / ')} 分`} sub={lowest3.map(c => c.courseName).join('、')} />
      </div>

      <aside className="report-priority">
        <span>优先关注</span>
        {improvementRank.map(c => <span className="priority-course" key={c.id}>{c.courseName}<small>{c.originalScore} 分 · {c.credits} 学分</small></span>)}
      </aside>

      <section className="report-group" aria-labelledby="report-distribution">
        <div className="report-group-heading"><h3 id="report-distribution">成绩分布与学期趋势</h3></div>
        <div className="report-grid">
          <Card title="成绩分布" drawVersion={distMode} extra={
            <div className="report-segment" role="group" aria-label="分布显示方式">
              <button type="button" aria-pressed={distMode === 'count'} onClick={() => setDistMode('count')}>科目数</button>
              <button type="button" aria-pressed={distMode === 'percent'} onClick={() => setDistMode('percent')}>占比%</button>
            </div>
          }>
            <SVGBarChart data={distData} xKey="range" height={210} bars={[
              { key: '原始', color: C.primary, label: '原始' },
              ...(hasMod ? [{ key: '模拟', color: C.purple, label: '模拟' }] : []),
              ...(hasPredicted ? [{ key: '预测', color: C.gray, label: '预测' }] : []),
            ]} />
          </Card>

          <Card title={trendMetric === 'gpa' ? '学期 GPA 变化趋势' : '学期均分变化趋势'} drawVersion={[...selectedTrendLines].join(',')} extra={
            <div className="report-segment" role="group" aria-label="趋势指标">
              <button type="button" aria-pressed={trendMetric === 'gpa'} onClick={() => setTrendMetric('gpa')}>GPA</button>
              <button type="button" aria-pressed={trendMetric === 'average'} onClick={() => setTrendMetric('average')}>均分</button>
            </div>
          }>
            <div className="trend-line-controls" role="group" aria-label="显示曲线">
              {trendLines.map(line => {
                const selected = selectedTrendLines.has(line.key)
                return <button type="button" key={line.key} aria-pressed={selected}
                  style={{ color: selected ? line.color : C.gray }}
                  onClick={() => trendMetric === 'gpa' ? toggleGPALine(line.key) : toggleAvgLine(line.key)}>
                  <span aria-hidden="true">{line.dash ? '┅' : '━'}</span> {line.label}
                </button>
              })}
            </div>
            {displayedTrendLines.length > 0 ? <SVGLineChart data={trendData} xKey="name" height={186} lines={displayedTrendLines} />
              : <p className="report-empty trend-empty">选择上方曲线，查看学期变化。</p>}
          </Card>
        </div>
      </section>

      <section className="report-group" aria-labelledby="report-comparison">
        <div className="report-group-heading"><h3 id="report-comparison">模拟影响与算法对比</h3></div>
        <div className="report-grid">
          <Card title="课程对 GPA 的影响">
            {hasMod && waterfallData.length > 0 ? <>
              <SVGBarChart data={waterfallData} xKey="name" bars={[{ key: 'impact', color: C.primary, label: 'GPA 变化量' }]} height={220} />
              <p className="report-footnote">正值为提升，负值为下降。最后一列为总变化。</p>
            </> : <p className="report-empty">在成绩模拟中调整分数，即可查看每门课程带来的 GPA 变化。</p>}
          </Card>

          <Card title="多算法 GPA 对比" extra={
            <div className="comparison-legend"><span><i className="original-dot" />原始</span><span><i className="simulated-dot" />模拟</span></div>
          }>
            <div className="algorithm-comparison">
              {algoData.map(item => (
                <div className="algorithm-row" key={item.name}>
                  <span className="algorithm-name" title={item.name}>{item.name}</span>
                  {item.available ? <>
                    <div className="algorithm-track" aria-hidden="true">
                      <i className="algorithm-range" style={{
                        left: `${Math.max(0, Math.min(item.原始, item.模拟) / item.maxGPA * 100)}%`,
                        width: `${Math.min(100, Math.abs(item.模拟 - item.原始) / item.maxGPA * 100)}%`,
                      }} />
                      <i className="original-dot" style={{ left: `${Math.max(0, Math.min(100, item.原始 / item.maxGPA * 100))}%` }} />
                      <i className="simulated-dot" style={{ left: `${Math.max(0, Math.min(100, item.模拟 / item.maxGPA * 100))}%` }} />
                    </div>
                    <span className="algorithm-values">{item.原始.toFixed(2)} <span>→</span> <b>{item.模拟.toFixed(2)}</b></span>
                  </> : <span className="algorithm-unavailable">缺少原始绩点</span>}
                </div>
              ))}
            </div>
            <p className="report-footnote">各行按对应算法的满分绘制位置。</p>
          </Card>
        </div>
      </section>

      <section className="report-group" aria-labelledby="report-courses">
        <div className="report-group-heading"><h3 id="report-courses">课程明细与提分规划</h3></div>
        <div className="report-grid">
          <Card title="课程成绩明细">
            <div className="report-table-scroll">
              <table className="report-table">
                <thead><tr><th>课程</th><th>成绩</th><th>GPA</th><th>学分</th><th>分数</th></tr></thead>
                <tbody>
                  {[...realCourses].sort((a, b) => a.originalScore - b.originalScore).map(course => (
                    <tr key={course.id}>
                      <td title={course.courseName}>{course.courseName}</td>
                      <td>{course.originalScore}</td>
                      <td>{scoreToGPA(course.originalScore, algo).toFixed(2)}</td>
                      <td>{course.credits}</td>
                      <td><div className="course-score-track" aria-label={`${course.originalScore} 分`}>
                        <span style={{ width: `${Math.max(0, Math.min(100, course.originalScore))}%` }} />
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="提分潜力">
            <div className="improvement-picks">
              {impData.slice(0, 3).map(course => <div key={course.id}>
                <span title={course.name}>{course.name}</span>
                <b>+{course['+10'].toFixed(3)}</b>
                <small>课程提高 10 分后的 GPA 增量</small>
              </div>)}
            </div>
            <div className="report-table-scroll">
              <table className="report-table">
                <thead><tr><th>课程</th><th>当前分</th><th>+5 分</th><th>+10 分</th><th>+15 分</th><th>+20 分</th></tr></thead>
                <tbody>{impData.slice(0, 8).map(course => <tr key={course.id}>
                  <td title={course.name}>{course.name}</td><td>{course.score}</td>
                  {['+5', '+10', '+15', '+20'].map(key => <td key={key}>
                    {course[key] > 0.0001 ? `+${course[key].toFixed(3)}` : '—'}
                  </td>)}
                </tr>)}
                </tbody>
              </table>
            </div>
            <p className="report-footnote">表内为 GPA 增加量，按学分加权的提分潜力排序，展示前 8 门。</p>
          </Card>
        </div>
      </section>
    </div></DrawRevision.Provider>
  )
}


// ============================================================
// Tab 2: WES 模拟
// ============================================================

function WESTab({ courses, algo }: { courses: ScoreRecord[]; algo: AlgorithmConfig }) {
  const hasMod = courses.some(c => c.simulatedScore !== null)
  const wesConfig = DEFAULT_WES_CONFIG
  const wesOriginal = calculateWESGPA(courses, 'originalScore')
  const wesSimulated = calculateWESGPA(courses, 'simulatedScore')

  const rows = courses.map(c => {
    const coeff = wesConfig.creditCoefficients[c.category as keyof typeof wesConfig.creditCoefficients] ?? 0.75
    const usCredits = (c.credits * coeff).toFixed(1)
    const excluded = wesConfig.excludeCategories.includes(c.category as any)
    const score = c.simulatedScore ?? c.originalScore
    const wesGrade = score >= 85 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'F'
    const wesGP = score >= 85 ? 4.0 : score >= 75 ? 3.0 : score >= 60 ? 2.0 : 0
    const warning = !excluded && score >= 75 && score < 85 ? '⚡B→A仅差' + (85 - score) + '分' : ''
    return { ...c, score, wesGrade, wesGP, usCredits, excluded, warning }
  })

  const bCourses = rows.filter(r => r.warning)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-4 bg-white">
          <div className="text-xs text-muted-foreground">原始 GPA → WES 预估</div>
          <div className="text-2xl font-bold mt-1">
            {calculateGPA(courses, 'originalScore', algo).toFixed(2)} → {wesOriginal.toFixed(2)}
            <span className={`text-sm ml-2 ${wesOriginal > calculateGPA(courses, 'originalScore', algo) ? 'text-green-600' : 'text-red-500'}`}>
              {wesOriginal > calculateGPA(courses, 'originalScore', algo) ? '↑' : '↓'}{Math.abs(wesOriginal - calculateGPA(courses, 'originalScore', algo)).toFixed(2)}
            </span>
          </div>
        </div>
        <div className="rounded-lg border p-4 bg-white">
          <div className="text-xs text-muted-foreground">模拟 GPA → WES 预估</div>
          <div className="text-2xl font-bold mt-1 text-blue-600">
            {hasMod ? `${calculateGPA(courses, 'simulatedScore', algo).toFixed(2)} → ${wesSimulated.toFixed(2)}` : '—'}
          </div>
        </div>
      </div>

      {bCourses.length > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">⚡ WES 降分预警（{bCourses.length}门课）</h3>
          <p className="text-xs text-yellow-700 mb-2">以下课程当前在B区间(75-84)，WES中计为3.0。只需提高数分即可跨越到A区间(4.0)：</p>
          <div className="space-y-1 max-h-40 overflow-auto">
            {bCourses.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1">
                <span>{r.courseName}</span>
                <span className="text-muted-foreground">{r.score}分(B)</span>
                <span className="text-green-600 font-medium">{r.warning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white overflow-hidden">
        <h3 className="text-sm font-medium px-4 py-2 border-b bg-gray-50">WES 逐科转换表</h3>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-1 px-2">课程名</th>
                <th className="text-center py-1">学分</th>
                <th className="text-center py-1">类型</th>
                <th className="text-center py-1">系数</th>
                <th className="text-center py-1">美制学分</th>
                <th className="text-center py-1">成绩</th>
                <th className="text-center py-1">WES等级</th>
                <th className="text-center py-1">WES绩点</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={`border-t ${r.excluded ? 'text-muted-foreground line-through opacity-60' : ''} ${r.warning ? 'bg-yellow-50' : ''}`}>
                  <td className="py-1 px-2">{r.courseName}</td>
                  <td className="text-center">{r.credits.toFixed(1)}</td>
                  <td className="text-center text-xs">{r.category}</td>
                  <td className="text-center text-xs">{r.excluded ? '×0' : `×${wesConfig.creditCoefficients[r.category as keyof typeof wesConfig.creditCoefficients] ?? 0.75}`}</td>
                  <td className="text-center">{r.excluded ? '0' : r.usCredits}</td>
                  <td className="text-center">{r.score}</td>
                  <td className="text-center font-medium">{r.excluded ? '—' : r.wesGrade}</td>
                  <td className="text-center font-medium">{r.excluded ? '—' : r.wesGP.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Tab 3: 导出报告
// ============================================================

function ExportTab({ workspaceId, courses, algo }: { workspaceId: string; courses: ScoreRecord[]; algo: AlgorithmConfig }) {
  const origGPA = calculateGPA(courses, 'originalScore', algo)
  const simGPA = calculateGPA(courses, 'simulatedScore', algo)
  const wesOrig = calculateWESGPA(courses, 'originalScore')
  const wesSim = calculateWESGPA(courses, 'simulatedScore')
  const hasMod = courses.some(c => c.simulatedScore !== null)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [showTargetPicker, setShowTargetPicker] = useState(false)
  const [kbEntryCount, setKbEntryCount] = useState(0)
  const [kbTotalReports, setKbTotalReports] = useState(0)

  // 加载知识库状态
  useEffect(() => {
    (async () => {
      try {
        const manifest = await syncKBManifest(workspaceId)
        setKbEntryCount(manifest.entries.length)
        setKbTotalReports(manifest.entries.reduce((s, e) => s + (e.reportCount || 0), 0))
      } catch { /* KB 不可用时忽略 */ }
    })()
  }, [workspaceId])

  const exportPDF = async () => {
    if (exportingPDF) return
    setExportingPDF(true)
    try {
      // 1. 读取知识库会话，确定 PDF 保存路径
      const session = await readJSON<{ activeFolder?: string }>(workspaceId, '成绩知识库/.kb_session.json')
      const kbFolder = session?.activeFolder || ''
      const pdfPath = kbFolder ? `${kbFolder}/reports/成绩分析报告.pdf` : 'data/成绩分析报告.pdf'

      // 2. 触发 AI 执行 Python 脚本生成 PDF（异步，用户可在 AI 面板看到进度）
      chat.send('/if-grades-simulation:pdf-report')

      // 3. 轮询等待 PDF 生成完成（最多 30 秒）
      const fileUrl = `${API_PREFIX}/api/v1/workspaces/${workspaceId}/files?filePath=${encodeURIComponent(pdfPath)}`
      let ready = false
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const res = await fetch(fileUrl, { credentials: 'include' })
        if (res.ok) { ready = true; break }
      }
      if (!ready) { alert('PDF 生成超时，请稍后重试'); return }
      // 4. 下载 PDF（fetch → blob → <a download>，避免浏览器内联打开）
      const res = await fetch(fileUrl, { credentials: 'include' })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = '成绩分析报告.pdf'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('导出 PDF 失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportingPDF(false)
    }
  }

  const triggerAnalysis = (mode: string) => {
    setShowTargetPicker(false)
    if (mode === 'abroad') {
      chat.send('/if-grades-simulation:gpa-analysis-report --mode=abroad 请分析我的成绩数据，生成留学申请分析报告，包含目标院校录取标准、WES认证分析和软背景要求。')
    } else if (mode === 'domestic') {
      chat.send('/if-grades-simulation:gpa-analysis-report --mode=domestic 请分析我的成绩数据，生成国内升学分析报告，包含保研/考研分数线和软背景要求。')
    } else {
      chat.send('/if-grades-simulation:gpa-analysis-report --mode=graduate 请分析我的成绩数据，生成毕业达标分析报告，包含挂科风险评估、学分缺口分析、每门课最低过线分数和底线保过策略。')
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="font-medium">导出分析报告</h3>

      <div className="rounded-lg border p-5 bg-white space-y-4">
        <div className="text-center">
          <div className="text-sm font-medium text-muted-foreground">📊 图表数据快照</div>
          <div className="text-xs text-muted-foreground mt-1">导出当前图表中的 GPA 统计、学期趋势等数据为 PDF 文件</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2 border rounded">
            <div className="text-xs text-muted-foreground">原始 GPA</div>
            <div className="text-xl font-bold">{origGPA.toFixed(2)}</div>
          </div>
          <div className="text-center p-2 border rounded bg-blue-50">
            <div className="text-xs text-muted-foreground">模拟 GPA</div>
            <div className="text-xl font-bold text-blue-600">{hasMod ? simGPA.toFixed(2) : '—'}</div>
          </div>
          <div className="text-center p-2 border rounded">
            <div className="text-xs text-muted-foreground">WES 原始</div>
            <div className="text-xl font-bold">{wesOrig.toFixed(2)}</div>
          </div>
          <div className="text-center p-2 border rounded bg-blue-50">
            <div className="text-xs text-muted-foreground">WES 模拟</div>
            <div className="text-xl font-bold text-blue-600">{hasMod ? wesSim.toFixed(2) : '—'}</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          <div>总课程: {courses.length} 门 | 总学分: {courses.reduce((s, c) => s + c.credits, 0)}</div>
          <div>已修正: {courses.filter(c => c.isCorrected).length} 门 | 模拟中: {courses.filter(c => c.simulatedScore !== null).length} 门</div>
          <div>算法: {algo.name}</div>
        </div>

        <button
          style={{ width: '100%', background: '#2563eb', color: '#fff', padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: exportingPDF ? 'wait' : 'pointer', fontSize: '14px', opacity: exportingPDF ? 0.7 : 1 }}
          onClick={exportPDF}
          disabled={exportingPDF}
        >
          {exportingPDF ? '⏳ 生成 PDF 中...' : '📄 导出 PDF 成绩分析报告'}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">🤖 AI 深度分析报告（主要功能）</p>
        {!showTargetPicker ? (
          <button
            style={{ width: '100%', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px' }}
            onClick={() => setShowTargetPicker(true)}
          >
            🤖 选择分析方向，生成深度报告
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                style={{ flex: 1, background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', padding: '12px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px' }}
                onClick={() => triggerAnalysis('abroad')}
              >
                <div className="text-lg">🎓</div>
                <div className="font-medium">留学申请</div>
              </button>
              <button
                style={{ flex: 1, background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', padding: '12px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px' }}
                onClick={() => triggerAnalysis('domestic')}
              >
                <div className="text-lg">🏫</div>
                <div className="font-medium">国内升学</div>
              </button>
              <button
                style={{ flex: 1, background: 'linear-gradient(135deg, #d97706, #f59e0b)', color: '#fff', padding: '12px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px' }}
                onClick={() => triggerAnalysis('graduate')}
              >
                <div className="text-lg">🛡️</div>
                <div className="font-medium">毕业达标</div>
              </button>
            </div>
            <button
              style={{ width: '100%', background: 'transparent', color: '#6b7280', padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px' }}
              onClick={() => setShowTargetPicker(false)}
            >
              取消
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">AI 成绩分析师将自动读取成绩数据，联网查询权威录取标准，生成包含留学竞争力评估、WES认证分析、软背景要求和提分策略的专业报告。</p>
      <p className="text-[11px] text-muted-foreground/70 mt-1">⚠️ 本报告由AI自动生成，仅供学习参考。录取标准、分数线等外部数据请以各校官网为准。依据本报告做出的决策及后果，由使用者自行承担。</p>

      {/* 知识库报告状态 */}
      {kbEntryCount > 0 && (
        <div className="rounded-lg border border-dashed p-3 bg-muted/30">
          <div className="flex items-center gap-2 text-sm">
            <span>📚</span>
            <span className="font-medium">知识库</span>
            <span className="text-muted-foreground">|</span>
            <span>{kbEntryCount} 个文件夹</span>
            <span className="text-muted-foreground">|</span>
            <span>{kbTotalReports} 份报告</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            每次导入成绩单时自动创建专属文件夹，AI 分析报告自动保存至对应目录。
          </p>
        </div>
      )}
    </div>
  )
}
