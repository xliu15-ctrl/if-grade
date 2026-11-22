// ============================================================
// 均分绩点模拟器 — 成绩管理面板 (scores.tsx)
// ============================================================

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useVersionCheck } from '../libs/useVersionCheck'
import type {
  ScoreRecord, AlgorithmConfig, SemesterStats,
  ReverseResult, DragState, CourseCategory, ArchiveMeta,
  CustomAlgorithm,
} from '../libs/types'
import { COURSE_CATEGORIES, SEMESTER_LABELS } from '../libs/types'
import {
  getSemesterStats,
  validateMappings, scoreToGPA, scoreToGrade, gradeToGPA, gradeToScore, getAvailableGrades, gpaToScore, inRange, courseGPA, isModified, summarize, displayMetric,
  calculateReverseTargets,
  PRESET_ALGORITHMS, customToAlgoConfig,
} from '../libs/gpa-engine'
import {
  readJSON, writeJSON, ensureDataFile,
  ensureManifest, saveArchive, restoreArchive,
  deleteArchiveById, overwriteArchive, renameArchive,
  API_PREFIX, IS_BROWSER_MODE, SCORES_FILE, ensureGradesPlugin,
} from '../libs/api'
import { SetupBanner } from '../libs/SetupBanner'
import { applyProposal, forecastBase, futureRecords, forecast, type FutureCourse } from '../libs/forecast'
import { chat } from '@knodo/api'

const TRANSCRIPT_FILE = 'data/成绩单.pdf'
const CONFIG_FILE = 'data/gpa_config.json'

// 合并所有可用算法（预设 + 自定义）
function getAllAlgorithms(customs: CustomAlgorithm[]): Record<string, AlgorithmConfig> {
  const all = { ...PRESET_ALGORITHMS }
  for (const c of customs) {
    all[c.id] = customToAlgoConfig(c)
  }
  return all
}

// ============================================================
// 主组件
// ============================================================

export default function ScoresPanel({ workspaceId }: { workspaceId: string }) {
  useVersionCheck()

  // 同步缓存：sessionStorage 读取是同步的，消除切 Tab 闪烁
  // key 必须带 workspaceId：sessionStorage 按域名共享，不同空间会串数据
  const SCORES_CACHE_KEY = `if-gpa_scores_cache_${workspaceId}`
  let initCache: any = {}
  try { const raw = sessionStorage.getItem(SCORES_CACHE_KEY); if (raw) initCache = JSON.parse(raw) } catch {}

  // ---- 数据状态 ----
  const [courses, setCourses] = useState<ScoreRecord[]>(initCache.courses || [])
  const [activeAlgoId, setActiveAlgoId] = useState(initCache.activeAlgoId || 'standard_4_0')
  const [loading, setLoading] = useState(false) // 不再显示加载中，用缓存直出

  // ---- 自定义算法状态 ----
  const [customAlgorithms, setCustomAlgorithms] = useState<CustomAlgorithm[]>([])
  const [showCustomAlgoEditor, setShowCustomAlgoEditor] = useState(false)
  const [editingCustomAlgo, setEditingCustomAlgo] = useState<CustomAlgorithm | null>(null)
  const [ruleError, setRuleError] = useState('')
  const [newAlgoName, setNewAlgoName] = useState('')
  const [newAlgoType, setNewAlgoType] = useState<'grade' | 'segmented'>('grade')
  const [newAlgoMaxGPA, setNewAlgoMaxGPA] = useState('4.0')
  const [newAlgoMappings, setNewAlgoMappings] = useState<Array<{ grade: string; min: string; max: string; gpa: string }>>([
    { grade: 'A', min: '90', max: '100', gpa: '4.0' },
    { grade: 'B', min: '80', max: '89', gpa: '3.0' },
    { grade: 'C', min: '70', max: '79', gpa: '2.0' },
    { grade: 'D', min: '60', max: '69', gpa: '1.0' },
    { grade: 'F', min: '0', max: '59', gpa: '0.0' },
  ])

  // ---- UI 状态 ----
  const [collapsedSemesters, setCollapsedSemesters] = useState<Set<number>>(new Set())
  const [editingCell, setEditingCell] = useState<{ courseId: string; field: string; value: string } | null>(null)
  const [dragState, setDragState] = useState<DragState>({
    draggedCourseId: null, draggedCourseIds: new Set(),
    sourceSemester: null, targetSemester: null, dropIndex: null,
  })
  const [semesterDragSource, setSemesterDragSource] = useState<number | null>(null)

  // ---- 多选状态 ----
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set())
  const [lastSelectedCourseId, setLastSelectedCourseId] = useState<string | null>(null)
  const shiftKey = useRef(false)
  const ctrlKey = useRef(false)
  const metaKey = useRef(false)

  // ---- 撤回栈 ----
  const undoStackRef = useRef<ScoreRecord[][]>([])
  const undoIndexRef = useRef(-1)
  const [canUndo, setCanUndo] = useState(false)

  // ---- 添加课程状态 ----
  const [draftSemester, setDraftSemester] = useState<number | null>(null)
  const [planMessage, setPlanMessage] = useState('')
  const [addingSemester, setAddingSemester] = useState<number | null>(null)
  const [newCourse, setNewCourse] = useState({ courseName: '', credits: '', score: '', gp: '', category: '专业必修' as CourseCategory })

  // ---- 学期标题编辑状态 ----
  const [editingSemesterTitle, setEditingSemesterTitle] = useState<number | null>(null)
  const [semesterTitleValue, setSemesterTitleValue] = useState('')

  // ---- 反推状态 ----
  const [showReverse, setShowReverse] = useState(false)
  const [reverseMode, setReverseMode] = useState<'retake' | 'predict'>('retake')
  const [targetGPA, setTargetGPA] = useState<string>(initCache.targetGPA || '')
  // ---- 3D 目标卡片状态 ----
  const [targetCardIndex, setTargetCardIndex] = useState<number>(initCache.targetCardIndex ?? 0) // 0=GPA, 1=加权均分, 2=算术均分
  const [targetCardInput, setTargetCardInput] = useState<string>(initCache.targetCardInput || '') // 当前选中卡片的输入值
  const [selectedRetakeIds, setSelectedRetakeIds] = useState<Set<string>>(new Set())
  const [retakeSearch, setRetakeSearch] = useState('')
  const [retakeSort, setRetakeSort] = useState<'default' | 'lowScore'>('default')
  const [lockedScores, setLockedScores] = useState<Map<string, number>>(new Map())
  const [savedRetake, setRetakeResult] = useState<ReverseResult | null>(null)
  const [savedPredict, setPredictResult] = useState<ReverseResult | null>(null)
  // 面板可调高度（目标反推和未来预测共用，切换时高度不变）
  const [reversePanelHeight, setReversePanelHeight] = useState(0)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null)
  const [editTargetValue, setEditTargetValue] = useState('')
  const editTargetOriginalRef = useRef('')
  const [useWES, setUseWES] = useState(false)
  // 未来预测模式下的假设课程
  const [predictCourses, setPredictCourses] = useState<FutureCourse[]>([])
  const [predictBase, setPredictBase] = useState<'original' | 'simulated' | 'reverse'>('original')
  const [predictNewName, setPredictNewName] = useState('')
  const [predictNewCredits, setPredictNewCredits] = useState('')
  const [predictNewScore, setPredictNewScore] = useState('')
  const [predictNewGP, setPredictNewGP] = useState('')
  const [addingPredict, setAddingPredict] = useState(false)
  const [predictNewCategory, setPredictNewCategory] = useState('专业必修')

  // ---- 存档管理状态 ----
  const [showArchivePanel, setShowArchivePanel] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState<number | null>(null)
  const [archives, setArchives] = useState<ArchiveMeta[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [newArchiveName, setNewArchiveName] = useState('')
  const [archiveMessage, setArchiveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [exportingTranscript, setExportingTranscript] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'restore' | 'overwrite'; archiveId: string } | null>(null)
  const [renamingArchiveId, setRenamingArchiveId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const currentAlgo = getAllAlgorithms(customAlgorithms)[activeAlgoId] || PRESET_ALGORITHMS.standard_4_0
  const targetAlgo = useWES ? PRESET_ALGORITHMS.wes_4_0 : currentAlgo
  const sourceKey = JSON.stringify([courses, targetAlgo])
  const selections = JSON.stringify([...selectedRetakeIds].sort())
  const retakeKey = JSON.stringify([selections, targetCardIndex, targetCardInput, [...lockedScores]])
  const retakeBase = savedRetake?.basis === sourceKey && savedRetake.selection === selections ? savedRetake : null
  const retakeResult = retakeBase?.inputs === retakeKey ? retakeBase : null
  const predictKey = JSON.stringify([predictBase, predictBase === 'reverse' ? [retakeBase?.inputUnit,retakeBase?.targets] : null, predictCourses, targetCardIndex, targetCardInput])
  const predictResult = savedPredict?.basis === sourceKey && savedPredict.inputs === predictKey ? savedPredict : null
  const reverseResult = reverseMode === 'retake' ? retakeResult : predictResult
  const [loaded, setLoaded] = useState(false)

  // ---- 加载数据 ----
  useEffect(() => {
    let alive = true
    ;(async () => {
      const data = await ensureDataFile<ScoreRecord[]>(workspaceId, SCORES_FILE, [])
      const config = await ensureDataFile<{ activeAlgorithm: string; customAlgorithms?: CustomAlgorithm[] }>(workspaceId, CONFIG_FILE, { activeAlgorithm: 'standard_4_0' })
      config.activeAlgorithm = Object.entries(PRESET_ALGORITHMS).find(([key, value]) =>
        key === config.activeAlgorithm || value.id === config.activeAlgorithm
      )?.[0] || config.activeAlgorithm
      if (!alive) return
      setCourses(data)
      setActiveAlgoId(getAllAlgorithms(config.customAlgorithms || [])[config.activeAlgorithm] ? config.activeAlgorithm : 'standard_4_0')
      setCustomAlgorithms(config.customAlgorithms || [])
      try { sessionStorage.setItem(SCORES_CACHE_KEY, JSON.stringify({ courses: data, activeAlgoId: config.activeAlgorithm })) } catch {}

      // 恢复反推/预测面板状态
      try {
        const saved = await readJSON<{
          version?: number; showReverse: boolean; reverseMode: 'retake' | 'predict'; targetGPA: string
          targetCardIndex: number; targetCardInput: string
          useWES: boolean; predictBase: string
          predictCourses: FutureCourse[]; selectedRetakeIds: string[]
          lockedScores: [string, number][]
          retakeResult: ReverseResult | null; predictResult: ReverseResult | null; reversePanelHeight: number
        }>(workspaceId, 'data/reverse_state.json')
        if (!alive) return
        if (saved) {
          setShowReverse(saved.showReverse)
          setReverseMode(saved.reverseMode)
          setTargetGPA(saved.targetCardIndex === 0 ? saved.targetCardInput || '' : '')
          setTargetCardIndex(saved.targetCardIndex ?? 0)
          setTargetCardInput(saved.targetCardInput || '')
          setUseWES(saved.useWES || false)
          setPredictBase(saved.predictBase as any || 'original')
          setPredictCourses((saved.predictCourses || []).map(c => saved.version === 2 ? c : { ...c, lockedGP: null }))
          setSelectedRetakeIds(new Set((saved.selectedRetakeIds || []).filter(id => data.some(course => course.id === id && !course.isPredicted))))
          if (saved.version === 2) {
            setLockedScores(new Map(saved.lockedScores || []))
            setRetakeResult(saved.retakeResult || null)
            setPredictResult(saved.predictResult || null)
          }
          if (saved.reversePanelHeight) setReversePanelHeight(saved.reversePanelHeight)
          // 如果面板打开但高度为 0（之前拖到底了），恢复默认 200px
          if (saved.showReverse && saved.reversePanelHeight === 0) setReversePanelHeight(200)
        }
      } catch { /* ignore */ }

      if (alive) setLoaded(true)
    })()
    return () => { alive = false }
  }, [workspaceId])

  useEffect(() => {
    if (!loaded) return
    writeJSON(workspaceId, 'data/reverse_state.json', {
      version: 2, activeRetake: Boolean(retakeResult), showReverse, reverseMode, targetGPA, targetCardIndex, targetCardInput,
      useWES, predictBase, predictCourses, selectedRetakeIds: [...selectedRetakeIds],
      lockedScores: [...lockedScores], retakeResult: retakeBase, predictResult, reversePanelHeight,
    }).catch(() => {})
  }, [loaded, workspaceId, showReverse, reverseMode, targetGPA, targetCardIndex, targetCardInput, useWES,
      predictBase, predictCourses, selectedRetakeIds, lockedScores, retakeBase, retakeResult, predictResult, reversePanelHeight])

  // ---- 保存数据（带撤回支持） ----
  const coursesRef = useRef(courses)
  coursesRef.current = courses

  const saveCourses = useCallback(async (newCourses: ScoreRecord[]) => {
    // 推入撤回栈
    undoStackRef.current = undoStackRef.current.slice(0, undoIndexRef.current + 1)
    undoStackRef.current.push(coursesRef.current)
    if (undoStackRef.current.length > 50) undoStackRef.current.shift()
    undoIndexRef.current = undoStackRef.current.length - 1
    setCanUndo(true)

    setCourses(newCourses)
    await writeJSON(workspaceId, SCORES_FILE, newCourses)
    // 同步缓存
    try { sessionStorage.setItem(SCORES_CACHE_KEY, JSON.stringify({ courses: newCourses, activeAlgoId, targetGPA, targetCardIndex })) } catch {}

  }, [workspaceId, activeAlgoId, targetGPA, targetCardIndex])

  const handleUndo = useCallback(async () => {
    if (undoIndexRef.current < 0) return
    const prev = undoStackRef.current[undoIndexRef.current]
    undoIndexRef.current--
    setCanUndo(undoIndexRef.current >= 0)
    setCourses(prev)
    await writeJSON(workspaceId, SCORES_FILE, prev)
  }, [workspaceId])

  // ---- 键盘修饰键 + Escape 清空选择 + Ctrl+Z 撤回 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return
      shiftKey.current = e.shiftKey
      ctrlKey.current = e.ctrlKey
      metaKey.current = e.metaKey
      if (e.key === 'Escape') {
        setSelectedCourseIds(new Set())
        setLastSelectedCourseId(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      shiftKey.current = e.shiftKey
      ctrlKey.current = e.ctrlKey
      metaKey.current = e.metaKey
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [handleUndo])

  const saveConfig = useCallback(async (algoId: string) => {
    setActiveAlgoId(algoId)
    setLockedScores(new Map())
    await writeJSON(workspaceId, CONFIG_FILE, { activeAlgorithm: algoId, customAlgorithms })
  }, [workspaceId, customAlgorithms])

  const saveCustomAlgorithms = useCallback(async (newCustoms: CustomAlgorithm[], selected: string) => {
    setActiveAlgoId(selected)
    setCustomAlgorithms(newCustoms)
    await writeJSON(workspaceId, CONFIG_FILE, { activeAlgorithm: selected, customAlgorithms: newCustoms })
  }, [workspaceId, activeAlgoId])

  // ---- 导出成绩单 ----
  const exportTranscript = useCallback(async () => {
    if (exportingTranscript || courses.length === 0) return
    setExportingTranscript(true)
    try {
      // 1. 读取知识库会话，确定成绩单保存路径（与后端脚本保持一致）
      let transcriptPath = TRANSCRIPT_FILE
      try {
        const session = await readJSON<{ activeFolder?: string }>(workspaceId, '成绩知识库/.kb_session.json')
        const kbFolder = session?.activeFolder || ''
        if (kbFolder) transcriptPath = `${kbFolder}/reports/成绩单.pdf`
      } catch { /* 无活跃 KB 会话时使用 data/ 兜底 */ }

      // 2. 触发 AI 执行 Python 脚本生成成绩单 PDF（异步，用户可在 AI 面板看到进度）
      chat.send('/if-grades-simulation:transcript')
      // 3. 轮询等待 PDF 生成完成（最多 30 秒）
      const fileUrl = `${API_PREFIX}/api/v1/workspaces/${workspaceId}/files?filePath=${encodeURIComponent(transcriptPath)}`
      let ready = false
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const res = await fetch(fileUrl, { credentials: 'include' })
        if (res.ok) { ready = true; break }
      }
      if (!ready) { alert('成绩单生成超时，请稍后重试'); return }
      // 4. 下载 PDF（fetch → blob → <a download>，避免浏览器内联打开）
      const res = await fetch(fileUrl, { credentials: 'include' })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = '成绩单.pdf'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('导出成绩单失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportingTranscript(false)
    }
  }, [workspaceId, courses.length, exportingTranscript])

  // ---- 存档管理回调 ----
  const refreshArchives = useCallback(async () => {
    try {
      const manifest = await ensureManifest(workspaceId)
      setArchives(manifest.archives.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
    } catch {
      setArchives([])
    }
  }, [workspaceId])

  const handleCreateArchive = useCallback(async () => {
    if (!newArchiveName.trim() || courses.length === 0) return
    setArchiveLoading(true)
    setArchiveMessage(null)
    try {
      await saveArchive(workspaceId, courses, newArchiveName.trim())
      setNewArchiveName('')
      await refreshArchives()
      setArchiveMessage({ type: 'success', text: `存档「${newArchiveName.trim()}」已保存（${courses.length} 门课程）` })
    } catch (err) {
      setArchiveMessage({ type: 'error', text: `保存失败: ${String(err)}` })
    } finally {
      setArchiveLoading(false)
    }
  }, [workspaceId, courses, newArchiveName, refreshArchives])

  const handleRestoreArchive = useCallback(async (archiveId: string) => {
    setArchiveLoading(true)
    try {
      const manifest = await ensureManifest(workspaceId)
      const meta = manifest.archives.find(a => a.id === archiveId)
      if (!meta) throw new Error('存档不存在')
      const data = await restoreArchive(workspaceId, meta)
      await saveCourses(data)
      setArchiveMessage({ type: 'success', text: `已恢复存档「${meta.name}」（${data.length} 门课程）` })
      setConfirmAction(null)
    } catch (err) {
      setArchiveMessage({ type: 'error', text: `恢复失败: ${String(err)}` })
    } finally {
      setArchiveLoading(false)
    }
  }, [workspaceId, saveCourses])

  const handleOverwriteArchive = useCallback(async (archiveId: string) => {
    setArchiveLoading(true)
    try {
      await overwriteArchive(workspaceId, archiveId, courses)
      await refreshArchives()
      setArchiveMessage({ type: 'success', text: '存档已覆盖为当前数据' })
      setConfirmAction(null)
    } catch (err) {
      setArchiveMessage({ type: 'error', text: `覆盖失败: ${String(err)}` })
    } finally {
      setArchiveLoading(false)
    }
  }, [workspaceId, courses, refreshArchives])

  const handleDeleteArchive = useCallback(async (archiveId: string) => {
    setArchiveLoading(true)
    try {
      await deleteArchiveById(workspaceId, archiveId)
      await refreshArchives()
      setArchiveMessage({ type: 'success', text: '存档已删除' })
      setConfirmAction(null)
    } catch (err) {
      setArchiveMessage({ type: 'error', text: `删除失败: ${String(err)}` })
    } finally {
      setArchiveLoading(false)
    }
  }, [workspaceId, refreshArchives])

  // ---- 重命名存档 ----
  const handleStartRename = useCallback((archiveId: string, currentName: string) => {
    setRenamingArchiveId(archiveId)
    setRenameValue(currentName)
    setConfirmAction(null)
  }, [])

  const handleCancelRename = useCallback(() => {
    setRenamingArchiveId(null)
    setRenameValue('')
  }, [])

  const handleConfirmRename = useCallback(async () => {
    if (!renamingArchiveId || !renameValue.trim()) return
    setArchiveLoading(true)
    try {
      await renameArchive(workspaceId, renamingArchiveId, renameValue.trim())
      await refreshArchives()
      setRenamingArchiveId(null)
      setRenameValue('')
      setArchiveMessage({ type: 'success', text: `已重命名为「${renameValue.trim()}」` })
    } catch (err) {
      setArchiveMessage({ type: 'error', text: `重命名失败: ${String(err)}` })
    } finally {
      setArchiveLoading(false)
    }
  }, [workspaceId, renamingArchiveId, renameValue, refreshArchives])

  // ---- 当前算法 ----
  const availableGrades = getAvailableGrades(currentAlgo)

  // ---- 课程分组 ----
  const realCourses = courses.filter(c => !c.isPredicted)
  const predictedOnly = courses.filter(c => c.isPredicted)
  const allCoursesForPredict = [...realCourses, ...predictedOnly]

  const coursesBySemester = new Map<number, ScoreRecord[]>()
  for (const c of realCourses) {
    const list = coursesBySemester.get(c.semester) || []
    list.push(c)
    coursesBySemester.set(c.semester, list)
  }
  // 按 order 排序
  for (const [, list] of coursesBySemester) {
    list.sort((a, b) => a.order - b.order)
  }

  const semesterStats = getSemesterStats(realCourses, currentAlgo)
  if (draftSemester != null && !coursesBySemester.has(draftSemester)) {
    semesterStats.push({ semester: draftSemester, semesterLabel: SEMESTER_LABELS[draftSemester] || '第' + draftSemester + '学期',
      courseCount: 0, totalCredits: 0, originalAvg: 0, simulatedAvg: 0, originalArithAvg: 0, simulatedArithAvg: 0,
      originalGPA: 0, simulatedGPA: 0, hasModifications: false, modifiedCount: 0, correctedCount: 0 })
  }
  const sortedSemesters = [...semesterStats].sort((a, b) => a.semester - b.semester)

  // ---- 计算 ----
  const { gpa: originalGPA, weighted: originalAvg, arithmetic: originalArithAvg } = summarize(realCourses, 'originalScore', currentAlgo)
  const { gpa: simulatedGPA, weighted: simulatedAvg, arithmetic: simulatedArithAvg } = summarize(realCourses, 'simulatedScore', currentAlgo)
  const { gpa: predictedGPA, weighted: predictedAvg, arithmetic: predictedArithAvg } = summarize(allCoursesForPredict, 'simulatedScore', currentAlgo)
  const totalCredits = realCourses.reduce((s, c) => s + c.credits, 0)
  const correctedCount = realCourses.filter(c => c.isCorrected).length
  const modifiedCount = realCourses.filter(isModified).length

  // WES 计算
  const wesAlgo = PRESET_ALGORITHMS.wes_4_0
  const wesOriginalGPA = summarize(realCourses, 'originalScore', wesAlgo).gpa
  const wesSimulatedGPA = summarize(realCourses, 'simulatedScore', wesAlgo).gpa
  const wesPredictedGPA = summarize(allCoursesForPredict, 'simulatedScore', wesAlgo).gpa

  // 输入目标 GPA 时，计算目标绩点对应的最低分数，用于大成绩单颜色标记
  const targetThresholdScore = (() => {
    const tgpa = parseFloat(targetGPA)
    if (!inRange(tgpa, targetAlgo.maxGPA) || targetAlgo.type === 'grade' || courses.length === 0) return null
    const algo = useWES ? PRESET_ALGORITHMS.wes_4_0 : currentAlgo
    return gpaToScore(tgpa, algo)
  })()

  const TARGET_CARDS = [
    { key: 'gpa', label: '目标 GPA' },
    { key: 'weighted', label: '目标加权均分' },
    { key: 'arithmetic', label: '目标算术均分' },
  ]

  const getCardGradient = (): string => {
    const gpa = parseFloat(targetGPA)
    if (isNaN(gpa)) return 'linear-gradient(135deg, #64748b, #475569)'
    const maxGPA = targetAlgo.maxGPA
    const ratio = Math.max(0, Math.min(1, gpa / maxGPA))
    const hue = ratio * 120
    return `linear-gradient(135deg, hsl(${hue}, 75%, 42%), hsl(${Math.min(hue + 15, 135)}, 65%, 32%))`
  }

  useEffect(() => {
    if (!loaded) return
    const value = Number(targetCardInput)
    const valid = targetCardInput.trim() && inRange(value, targetCardIndex === 0 ? targetAlgo.maxGPA : 100)
    const key = ['targetGPA', 'targetWeightedAvg', 'targetArithmeticAvg'][targetCardIndex]
    writeJSON(workspaceId, 'data/target.json', valid ? { [key]: value, algorithm: targetAlgo.id, useWES } : null).catch(() => {})
  }, [loaded, targetCardInput, targetCardIndex, targetAlgo.id, targetAlgo.maxGPA, useWES, workspaceId])

  const handleTargetCardChange = (value: string) => {
    setTargetCardInput(value)
    setTargetGPA(targetCardIndex === 0 ? value : '')
    setPlanMessage('')
  }

  const switchTargetCard = (index: number) => {
    if (index === targetCardIndex) return
    setTargetCardIndex(index)
    setTargetCardInput('')
    setTargetGPA('')
    setPlanMessage('')
    setLockedScores(new Map())
  }

  // ---- 单元格编辑 ----
  const startCellEdit = (courseId: string, field: string, currentValue: string) => {
    setEditingCell({ courseId, field, value: currentValue })
  }

  const confirmCellEdit = async () => {
    if (!editingCell) return
    const { courseId, field, value } = editingCell
    setEditingCell(null)

    const course = courses.find(c => c.id === courseId)
    if (!course) return


    const updated = courses.map(c => {
      if (c.id !== courseId) return c

      if (field === 'category') {
        const trimmed = value.trim()
        if (!trimmed || trimmed === c.category) return c
        return { ...c, category: trimmed }
      }
      if (field === 'courseName') {
        const trimmed = value.trim()
        if (!trimmed || trimmed === c.courseName) return c
        return { ...c, courseName: trimmed }
      }
      const number = value.trim() === '' ? null : Number(value)
      if (field === 'credits') return number != null && Number.isFinite(number) && number >= 0 ? { ...c, credits: number } : c
      if (field === 'originalScore' || field === 'simulatedScore') {
        if (number != null && !inRange(number)) return c
        if (number == null && field === 'originalScore' && c.gradePoint == null) return c
        return { ...c, [field]: number }
      }
      if (field === 'gradePoint' || field === 'simulatedGP') {
        if (number != null && !inRange(number, currentAlgo.maxGPA)) return c
        if (currentAlgo.type === 'grade') return { ...c, [field]: number }
        // The displayed GP is derived from the percentage under the selected scale.
        const scoreField = field === 'gradePoint' ? 'originalScore' : 'simulatedScore'
        if (number == null) return scoreField === 'simulatedScore' ? { ...c, simulatedScore: null } : c
        const existing = courseGPA(c, scoreField, currentAlgo)
        if (existing != null && displayMetric(existing) === displayMetric(number)) return c
        const score = gpaToScore(number, currentAlgo)
        if (!inRange(score) || Math.abs(scoreToGPA(score, currentAlgo) - number) > .001) {
          setPlanMessage('该绩点在当前换算规则中没有对应分数，请直接编辑百分制成绩。')
          return c
        }
        return { ...c, [scoreField]: score }
      }
      return c
    })
    if (updated.every((c, i) => c === courses[i])) return
    await saveCourses(updated)
  }

  const cancelCellEdit = () => setEditingCell(null)

  // ---- 删除课程 ----
  const deleteCourse = async (courseId: string) => {
    const updated = courses.filter(c => c.id !== courseId)
    await saveCourses(updated)
  }

  // ---- 添加课程 ----
  const startAddCourse = (semester: number) => {
    setAddingSemester(semester)
    setNewCourse({ courseName: '', credits: '', score: '', gp: '', category: '专业必修' })
  }

  const confirmAddCourse = async () => {
    const credits = Number(newCourse.credits)
    const score = newCourse.score.trim() ? Number(newCourse.score) : null
    const gp = newCourse.gp.trim() ? Number(newCourse.gp) : null
    if (addingSemester == null || !newCourse.courseName.trim() || !newCourse.credits.trim() || !Number.isFinite(credits) || credits < 0 ||
        (score == null && gp == null) || (score != null && !inRange(score)) || (gp != null && !inRange(gp, currentAlgo.maxGPA))) {
      setPlanMessage('请填写课程名、有效学分，以及分数或绩点。')
      return
    }
    setPlanMessage('')

    const maxOrder = (coursesBySemester.get(addingSemester) || []).reduce((max, c) => Math.max(max, c.order), 0)

    const newRecord: ScoreRecord = {
      id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      courseName: newCourse.courseName.trim(),
      credits,
      originalScore: score, gradePoint: gp,
      simulatedScore: null,
      semester: addingSemester,
      category: newCourse.category,
      source: 'manual',
      isCorrected: false,
      order: maxOrder + 1,
    }

    setAddingSemester(null)
    setDraftSemester(null)
    await saveCourses([...courses, newRecord])
  }

  const cancelAddCourse = () => {
    setDraftSemester(null)
    setAddingSemester(null)
  }

  // ---- 添加预测课程 ----
  const confirmAddPredictCourse = () => {
    const score = predictNewScore.trim() ? Number(predictNewScore) : null
    const gp = targetAlgo.type === 'grade' && predictNewGP.trim() ? Number(predictNewGP) : null
    const credits = Number(predictNewCredits)
    if (!predictNewName.trim() || !predictNewCredits.trim() || !Number.isFinite(credits) || credits < 0 ||
        (score != null && !inRange(score)) || (gp != null && !inRange(gp, targetAlgo.maxGPA))) {
      setPlanMessage('请核对课程名、学分和成绩范围。')
      return
    }
    setPlanMessage('')
    setPredictCourses(prev => [...prev, {
      id: crypto.randomUUID(),
      courseName: predictNewName.trim(),
      credits,
      category: predictNewCategory as CourseCategory,
      lockedScore: score,
      lockedGP: gp,
    }])
    setPredictNewName('')
    setPredictNewCredits('')
    setPredictNewScore('')
    setPredictNewGP('')
    setPredictNewCategory('专业必修')
    setAddingPredict(false)
  }

  const editFutureValue = (input: HTMLInputElement, course: FutureCourse, field: 'lockedScore' | 'lockedGP') => {
    const value = input.value.trim() ? Number(input.value) : null
    const max = field === 'lockedGP' ? targetAlgo.maxGPA : 100
    if (value != null && !inRange(value, max)) {
      input.value = String(course[field] ?? '')
      setPlanMessage('请输入 0 到 ' + max + ' 之间的数值。')
      return
    }
    if (value !== course[field]) setPredictCourses(rows => rows.map(c => c.id === course.id ? {...c, [field]: value} : c))
  }

  const cancelAddPredictCourse = () => {
    setAddingPredict(false)
    setPredictNewName('')
    setPredictNewCredits('')
    setPredictNewScore('')
    setPredictNewGP('')
  }

  // ---- 添加新学期 ----
  const addNewSemester = () => {
    const next = Math.max(0, ...realCourses.map(c => c.semester)) + 1
    setDraftSemester(next)
    startAddCourse(next)
  }

  // ---- 编辑学期标题 ----
  const startEditSemesterTitle = (semester: number, currentLabel: string) => {
    setEditingSemesterTitle(semester)
    setSemesterTitleValue(currentLabel)
  }

  const confirmSemesterTitleEdit = async () => {
    if (editingSemesterTitle === null) return
    const updated = courses.map(c => {
      if (c.semester === editingSemesterTitle) {
        return { ...c, semesterTitle: semesterTitleValue.trim() || undefined }
      }
      return c
    })
    setEditingSemesterTitle(null)
    setSemesterTitleValue('')
    await saveCourses(updated)
  }

  const cancelSemesterTitleEdit = () => {
    setEditingSemesterTitle(null)
    setSemesterTitleValue('')
  }

  // ---- 多选点击处理 ----
  const handleCourseClick = (courseId: string, semester: number, indexInSemester: number) => {
    if (editingCell?.courseId === courseId) return

    setSelectedCourseIds(prev => {
      const next = new Set(prev)
      if (shiftKey.current && lastSelectedCourseId) {
        const semCourses = coursesBySemester.get(semester) || []
        const lastIdx = semCourses.findIndex(c => c.id === lastSelectedCourseId)
        const curIdx = indexInSemester
        if (lastIdx !== -1 && curIdx !== -1) {
          const start = Math.min(lastIdx, curIdx)
          const end = Math.max(lastIdx, curIdx)
          if (ctrlKey.current) {
            for (let i = start; i <= end; i++) next.add(semCourses[i].id)
          } else {
            next.clear()
            for (let i = start; i <= end; i++) next.add(semCourses[i].id)
          }
        }
      } else if (ctrlKey.current || metaKey.current) {
        if (next.has(courseId)) next.delete(courseId)
        else next.add(courseId)
      } else {
        // 普通点击：切换选中状态（累加选择，与 Ctrl+点击 行为一致）
        if (next.has(courseId)) next.delete(courseId)
        else next.add(courseId)
      }
      return next
    })
    setLastSelectedCourseId(courseId)
  }

  const clearSelection = () => {
    setSelectedCourseIds(new Set())
    setLastSelectedCourseId(null)
  }

  const deleteSelected = async () => {
    if (selectedCourseIds.size === 0) return
    const updated = courses.filter(c => !selectedCourseIds.has(c.id))
    await saveCourses(updated)
    clearSelection()
  }

  // ---- 拖拽 ----
  const handleDragStart = (courseId: string, semester: number) => {
    const draggedIds = selectedCourseIds.has(courseId)
      ? new Set(selectedCourseIds)
      : new Set([courseId])
    setDragState({
      draggedCourseId: courseId,
      draggedCourseIds: draggedIds,
      sourceSemester: semester,
      targetSemester: null,
      dropIndex: null,
    })
  }

  const handleDragOver = (e: React.DragEvent, semester: number, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragState(s => ({ ...s, targetSemester: semester, dropIndex: index }))
  }

  const handleDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as Node | null
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragState(s => ({ ...s, targetSemester: null, dropIndex: null }))
    }
  }

  const handleDrop = async (e: React.DragEvent, targetSemester: number) => {
    e.preventDefault()
    const { draggedCourseId, sourceSemester, draggedCourseIds, dropIndex } = dragState
    if (!draggedCourseId || sourceSemester === null || draggedCourseIds.size === 0) {
      setDragState({ draggedCourseId: null, draggedCourseIds: new Set(), sourceSemester: null, targetSemester: null, dropIndex: null })
      return
    }

    const sourceSemCourses = (coursesBySemester.get(sourceSemester) || []).slice()
    const draggedCourses = sourceSemCourses.filter(c => draggedCourseIds.has(c.id))

    if (sourceSemester === targetSemester) {
      // 同学期排序
      const remaining = sourceSemCourses.filter(c => !draggedCourseIds.has(c.id))
      const insertAt = Math.min(dropIndex ?? remaining.length, remaining.length)
      remaining.splice(insertAt, 0, ...draggedCourses)
      const updated = courses.map(c => {
        const newIdx = remaining.findIndex(r => r.id === c.id)
        return newIdx !== -1 ? { ...c, order: newIdx } : c
      })
      setDragState({ draggedCourseId: null, draggedCourseIds: new Set(), sourceSemester: null, targetSemester: null, dropIndex: null })
      await saveCourses(updated)
      return
    }

    // 跨学期移动
    const remainingSource = sourceSemCourses.filter(c => !draggedCourseIds.has(c.id))
    const reorderedSource = remainingSource.map((c, i) => ({ ...c, order: i }))

    const targetSemCourses = (coursesBySemester.get(targetSemester) || []).slice()
    const insertAt = Math.min(dropIndex ?? targetSemCourses.length, targetSemCourses.length)
    const movedCourses = draggedCourses.map(c => ({ ...c, semester: targetSemester }))
    targetSemCourses.splice(insertAt, 0, ...movedCourses)
    const reorderedTarget = targetSemCourses.map((c, i) => ({ ...c, order: i }))

    const updated = courses.map(c => {
      const srcIdx = reorderedSource.findIndex(r => r.id === c.id)
      if (srcIdx !== -1) return { ...c, order: srcIdx }
      const tgtIdx = reorderedTarget.findIndex(r => r.id === c.id)
      if (tgtIdx !== -1) return { ...c, semester: targetSemester, order: tgtIdx }
      return c
    })

    setDragState({ draggedCourseId: null, draggedCourseIds: new Set(), sourceSemester: null, targetSemester: null, dropIndex: null })
    clearSelection()
    await saveCourses(updated)
  }

  const handleDragEnd = () => {
    setDragState({ draggedCourseId: null, draggedCourseIds: new Set(), sourceSemester: null, targetSemester: null, dropIndex: null })
    setSemesterDragSource(null)
  }

  // ---- 学期拖拽排序 ----
  const handleSemesterDrop = async (targetSemester: number) => {
    const source = semesterDragSource
    setSemesterDragSource(null)
    if (source === null || source === targetSemester) return

    // 交换两个学期的学期号
    const updated = courses.map(c => {
      if (c.semester === source) return { ...c, semester: targetSemester }
      if (c.semester === targetSemester) return { ...c, semester: source }
      return c
    })
    await saveCourses(updated)
  }

  // ---- 折叠切换 ----
  const toggleSemester = (sem: number) => {
    setCollapsedSemesters(prev => {
      const next = new Set(prev)
      if (next.has(sem)) next.delete(sem)
      else next.add(sem)
      return next
    })
  }

  const expandAll = () => setCollapsedSemesters(new Set())
  const collapseAll = () => setCollapsedSemesters(new Set(sortedSemesters.map(s => s.semester)))

  // ---- 反推 ----
  const reversePanelRef = useRef<HTMLDivElement>(null)
  const courseListRef = useRef<HTMLDivElement>(null)

  const openReversePanel = (mode: 'retake' | 'predict') => {
    setShowReverse(true)
    setReverseMode(mode)
    setPlanMessage('')
    // 如果当前高度太小（用户拖到底关闭了），恢复到默认 120px
    if (reversePanelHeight < 200) setReversePanelHeight(200)
  }

  // ---- 面板高度拖拽调整 ----
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startHeight: reversePanelHeight }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startY - ev.clientY
      const newHeight = Math.max(0, Math.min(1200, resizeRef.current.startHeight + delta))
      setReversePanelHeight(newHeight)
    }
    const onUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [reversePanelHeight])

  const baseCourses = forecastBase(courses, predictBase, retakeBase)
  const baseSummary = summarize(baseCourses, 'simulatedScore', targetAlgo)
  const runReverse = () => {
    const type = targetCardIndex === 0 ? 'gpa' : targetCardIndex === 1 ? 'weighted' : 'arithmetic'
    const target = targetCardInput.trim() ? Number(targetCardInput) : null
    const max = type === 'gpa' ? targetAlgo.maxGPA : 100
    setPlanMessage('')
    if (target != null && !inRange(target, max)) return setPlanMessage('目标值须在 0 到 ' + max + ' 之间。')
    if (reverseMode === 'retake') {
      if (target == null) return setPlanMessage('请先填写目标值。')
      const result = calculateReverseTargets(realCourses.filter(c => selectedRetakeIds.has(c.id)),
        realCourses.filter(c => !selectedRetakeIds.has(c.id)), target, targetAlgo, lockedScores, type)
      setRetakeResult({ ...result, hasTarget: true, basis: sourceKey, selection: selections, inputs: retakeKey })
      return
    }
    if (predictBase === 'reverse' && !retakeBase?.achievable) return setPlanMessage('请先计算重修方案，或选择原始、模拟成绩作为基准。')
    try {
      const result = forecast(baseCourses, futureRecords(predictCourses, courses), targetAlgo, target, type)
      setPredictResult({ ...result, basis: sourceKey, inputs: predictKey })
    } catch (err) {
      setPredictResult(null)
      setPlanMessage(err instanceof Error ? err.message : '请核对预测课程。')
    }
  }

  const applyReverseTargets = async () => {
    if (!retakeResult?.achievable) return
    await saveCourses(applyProposal(courses, retakeResult))
    setShowReverse(false)
  }

  const toggleLockTarget = (courseId: string, locked: boolean, value?: number) => {
    setLockedScores(prev => {
      const next = new Map(prev)
      if (locked) {
        next.set(courseId, value ?? 0)
      } else {
        next.delete(courseId)
      }
      return next
    })
  }

  // lockedScores 变化后自动重算（用 useEffect 确保拿到最新的 lockedScores 值）
  const lockedKeyRef = useRef('')
  useEffect(() => {
    const key = JSON.stringify([...lockedScores.entries()])
    if (key === lockedKeyRef.current) return
    lockedKeyRef.current = key
    // 仅在已有结果时自动重算
    if (reverseMode === 'retake' && retakeBase && loaded) {
      if (selectedRetakeIds.size > 0) {
        runReverse()
      }
    }
  }, [lockedScores])

  // ---- 渲染 ----
  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">加载中...</div>
  }

  return (
    <div className="flex h-full flex-col">
      {/* 首次初始化引导（装完应用模板即用；完成自动消失） */}
      {!IS_BROWSER_MODE && <SetupBanner workspaceId={workspaceId} />}
      {/* === 工具栏 === */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <label className="text-sm text-muted-foreground">算法:</label>
        <select
          className="rounded border px-2 py-1 text-sm"
          aria-label="GPA 算法" title={currentAlgo.description} value={activeAlgoId}
          onChange={e => saveConfig(e.target.value)}
        >
          <optgroup label="预设算法">
            {Object.entries(PRESET_ALGORITHMS).map(([id, a]) => (
              <option key={id} value={id}>{a.name}</option>
            ))}
          </optgroup>
          {customAlgorithms.length > 0 && (
            <optgroup label="自定义算法">
              {customAlgorithms.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        <details className="text-xs text-muted-foreground"><summary>计算规则</summary><p>{currentAlgo.description}</p></details>
        <button
          className={`rounded border px-2 py-1 text-xs hover:bg-accent ${showCustomAlgoEditor ? 'bg-blue-100 border-blue-400' : ''}`}
          onClick={() => { setShowCustomAlgoEditor(!showCustomAlgoEditor); setEditingCustomAlgo(null) }}
          title="自定义成绩-绩点映射规则"
        >⚙️ 自定义算法</button>

        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground" title="Ctrl+Z撤回 · Shift范围选 · Ctrl多选 · 拖拽排序">
          {IS_BROWSER_MODE ? '点击「试算」模拟分数 · 双击编辑原始成绩' : '💡 双击编辑 | 点击切换选中 | 拖拽跨学期 | Ctrl+Z撤回'}
        </span>

        {selectedCourseIds.size > 0 && (
          <>
            <span className="text-xs text-indigo-600 font-medium">已选 {selectedCourseIds.size} 门</span>
            <button
              className="rounded border px-2 py-1 text-xs hover:bg-red-50 text-red-600"
              onClick={deleteSelected}
            >🗑 删除选中</button>
            <button
              className="rounded border px-2 py-1 text-xs hover:bg-accent"
              onClick={clearSelection}
            >清空选择</button>
          </>
        )}

        <button
          className="rounded border px-2 py-1 text-xs hover:bg-accent"
          onClick={expandAll}
        >展开全部</button>
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-accent"
          onClick={collapseAll}
        >折叠全部</button>
        <button
          className={`rounded border px-2 py-1 text-xs hover:bg-accent ${!canUndo ? 'opacity-30' : ''}`}
          onClick={handleUndo}
          disabled={!canUndo}
          title="Ctrl+Z 撤回上一步操作"
        >↩ 撤回</button>
        {!IS_BROWSER_MODE && <button
          style={{ background: '#2563eb', color: '#fff', border: 'none' }}
          className="rounded px-2 py-1 text-xs hover:opacity-90 disabled:opacity-50 cursor-pointer"
          disabled={courses.length === 0 || exportingTranscript}
          onClick={exportTranscript}
          title="导出完整成绩表（含预测课程）为 PDF 成绩单"
        >{exportingTranscript ? '⏳ 生成中...' : '📄 导出成绩单'}</button>}
        <button
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          disabled={courses.length === 0 || archiveLoading}
          onClick={async () => {
            if (!confirm(`确定要存档并清空当前成绩吗？\n\n将保存 ${courses.length} 门课程到存档，然后清空成绩管理。`)) return
            const now = new Date()
            const name = `存档 ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
            setArchiveLoading(true)
            try {
              await saveArchive(workspaceId, courses, name)
              await saveCourses([])
              setArchiveMessage({ type: 'success', text: `已存档「${name}」（${courses.length} 门课程）并清空成绩` })
              await refreshArchives()
            } catch (err) {
              setArchiveMessage({ type: 'error', text: `存档失败: ${String(err)}` })
            } finally {
              setArchiveLoading(false)
            }
          }}
          title="将当前成绩保存为存档，然后清空成绩管理"
        >📦 存档并清空</button>
        <button
          className={`rounded border px-2 py-1 text-xs hover:bg-accent ${showArchivePanel ? 'bg-blue-100 border-blue-400' : ''}`}
          onClick={() => { setShowArchivePanel(!showArchivePanel); if (!showArchivePanel) refreshArchives() }}
        >📋 存档列表</button>
      </div>

      {/* === 存档管理面板 === */}
      {showArchivePanel && (
        <div className="border-b px-4 py-3 bg-muted/20">
          {/* 操作提示 */}
          {archiveMessage && (
            <div className={`mb-2 rounded px-3 py-1.5 text-xs ${archiveMessage.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-600 border border-red-200'}`}>
              {archiveMessage.text}
              <button className="ml-2 underline hover:no-underline" onClick={() => setArchiveMessage(null)}>✕</button>
            </div>
          )}

          {/* 新建存档 */}
          <div className="flex items-center gap-2 mb-2">
            <input
              className="flex-1 rounded border px-2 py-1 text-sm min-w-0"
              placeholder="输入存档名称，如：大一上学期成绩"
              value={newArchiveName}
              onChange={e => setNewArchiveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateArchive() }}
              disabled={archiveLoading || courses.length === 0}
            />
            <button
              className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: '#4f46e5' }}
              disabled={archiveLoading || !newArchiveName.trim() || courses.length === 0}
              onClick={handleCreateArchive}
            >💾 新建存档</button>
            {courses.length === 0 && (
              <span className="text-[10px] text-muted-foreground">（当前无成绩数据）</span>
            )}
          </div>

          {/* 存档列表 */}
          {archives.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2 text-center">
              还没有存档。保存当前成绩数据为存档，方便后续恢复和对比。
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-auto">
              {archives.map(arch => {
                const isRenaming = renamingArchiveId === arch.id
                const isConfirming = confirmAction && confirmAction.archiveId === arch.id
                return (
                <div key={arch.id} className="flex items-center gap-2 rounded border px-3 py-2 bg-background hover:bg-accent/30">
                  <span className="text-sm">📁</span>
                  {isRenaming ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        className="flex-1 rounded border px-2 py-0.5 text-xs"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') handleCancelRename() }}
                        autoFocus
                        disabled={archiveLoading}
                      />
                      <button className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 shrink-0"
                        onClick={handleConfirmRename} disabled={archiveLoading || !renameValue.trim()}>确定</button>
                      <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 shrink-0"
                        onClick={handleCancelRename}>取消</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{arch.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {arch.courseCount}门 / {arch.totalCredits}学分 / {arch.semesterCount}学期
                          <span className="ml-1">· {new Date(arch.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      {isConfirming ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-red-600">
                            {confirmAction!.type === 'delete'
                              ? (arch.kbFolder ? '删除存档及知识库文件夹？' : '确认删除？')
                              : confirmAction!.type === 'restore' ? '恢复（替换当前数据）' : '覆盖'}？</span>
                          <button className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200"
                            onClick={() => {
                              if (confirmAction!.type === 'delete') handleDeleteArchive(arch.id)
                              else if (confirmAction!.type === 'restore') handleRestoreArchive(arch.id)
                              else handleOverwriteArchive(arch.id)
                            }}>确定</button>
                          <button className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200"
                            onClick={() => setConfirmAction(null)}>取消</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button className="text-[10px] px-1.5 py-0.5 rounded hover:bg-accent"
                            onClick={() => setConfirmAction({ type: 'restore', archiveId: arch.id })}
                            disabled={archiveLoading}>📥 恢复</button>
                          <button className="text-[10px] px-1.5 py-0.5 rounded hover:bg-accent"
                            onClick={() => setConfirmAction({ type: 'overwrite', archiveId: arch.id })}
                            disabled={archiveLoading}>🔄 覆盖</button>
                          <button className="text-[10px] px-1.5 py-0.5 rounded hover:bg-accent"
                            onClick={() => handleStartRename(arch.id, arch.name)}
                            disabled={archiveLoading}>✏️ 重命名</button>
                          <button className="text-[10px] px-1.5 py-0.5 rounded text-red-600 hover:bg-red-50"
                            onClick={() => setConfirmAction({ type: 'delete', archiveId: arch.id })}
                            disabled={archiveLoading}>🗑 删除</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      {/* === 自定义算法编辑面板 === */}
      {showCustomAlgoEditor && (
        <div className="border-b px-4 py-3 bg-muted/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">⚙️ 自定义算法</span>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowCustomAlgoEditor(false)}>✕</button>
          </div>

          {/* AI 辅助创建 */}
          <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
            <div className="text-sm font-medium mb-1">🤖 AI 辅助创建算法</div>
            <p className="text-xs text-muted-foreground mb-2">
              在下方描述你的学校成绩算法规则（如：A+对应4.0，B+对应3.3...），AI 助手会自动解析并创建映射表。
              描述越详细越准确，例如：<br/>
              <span className="text-indigo-600">"我校使用4.0制，A+=4.0≥90分, A=4.0≥85分, A-=3.7≥82分, B+=3.3≥78分, B=3.0≥75分, B-=2.7≥72分, C=2.0≥65分, D=1.0≥60分"</span>
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border px-2 py-1.5 text-sm"
                placeholder="描述你的算法规则，AI 帮你自动创建映射表..."
                value={newAlgoName && editingCustomAlgo ? '' : ''}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    // 提交给 AI 处理 — 在聊天中告知 AI
                    const desc = e.currentTarget.value.trim()
                    setNewAlgoName('AI: ' + desc.slice(0, 20))
                    // 简单解析常见格式
                    const pattern = /([A-Z][+-]?)\s*[=＝]\s*(\d+\.?\d*)\s*(?:[≥≧]\s*(\d+)\s*分?)?/g
                    const matches = [...desc.matchAll(pattern)]
                    if (matches.length > 0) {
                      const mappings = matches.map(m => {
                        const grade = m[1]
                        const gpa = parseFloat(m[2])
                        const min = m[3] ? parseInt(m[3]) : Math.round(gpa * 20 + 60) // 如果没有分数，从GPA推算
                        const max = 100
                        return { grade, min: String(min), max: String(max), gpa: String(gpa) }
                      })
                      // 修正每个等级的 max 为上一等级的 min-1
                      const sorted = mappings.sort((a, b) => parseFloat(b.gpa) - parseFloat(a.gpa))
                      for (let i = 0; i < sorted.length; i++) {
                        if (i > 0) {
                          sorted[i].max = String(parseInt(sorted[i-1].min) - 1)
                        }
                      }
                      // 最后一个等级的 min 设为0
                      if (sorted.length > 0) sorted[sorted.length - 1].min = '0'
                      setNewAlgoMappings(sorted)
                      setNewAlgoType('segmented')
                      setNewAlgoName(desc.slice(0, 30) || '自定义算法')
                      e.currentTarget.value = ''
                    } else {
                      e.currentTarget.value = ''
                      alert('未能自动解析，请在聊天中详细描述你的算法规则，AI 助手会帮你处理。')
                    }
                  }
                }}
              />
              <span className="text-[10px] text-muted-foreground self-center">按Enter解析</span>
            </div>
          </div>

          {/* 已有自定义算法列表 */}
          {customAlgorithms.length > 0 && (
            <div className="mb-2 space-y-1">
              {customAlgorithms.map(ca => (
                <div key={ca.id} className="flex items-center gap-2 rounded border px-3 py-2 bg-background hover:bg-accent/30 text-xs">
                  <span className="flex-1 font-medium">{ca.name}</span>
                  <span className="text-muted-foreground">{ca.mappings.length}个等级</span>
                  <span className="text-muted-foreground">maxGPA={ca.maxGPA}</span>
                  <button className="text-blue-600 hover:underline" onClick={() => {
                    setEditingCustomAlgo(ca)
                    setNewAlgoName(ca.name)
                    setNewAlgoType(ca.type)
                    setNewAlgoMaxGPA(String(ca.maxGPA))
                    setNewAlgoMappings(ca.mappings.map(m => ({ grade: m.grade, min: String(m.min), max: String(m.max), gpa: String(m.gpa) })))
                  }}>编辑</button>
                  <button className="text-blue-600 hover:underline" onClick={() => saveConfig(ca.id)}>使用</button>
                  <button className="text-red-500 hover:underline" onClick={() => {
                    const updated = customAlgorithms.filter(c => c.id !== ca.id)
                    saveCustomAlgorithms(updated, activeAlgoId === ca.id ? 'standard_4_0' : activeAlgoId)
                  }}>删除</button>
                </div>
              ))}
            </div>
          )}

          {/* 编辑/新建表单 */}
          <div className="border rounded-md p-3 bg-background">
            <div className="flex items-end gap-2 mb-2 flex-wrap">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">算法名称</span>
                <input className="rounded border px-2 py-1 text-sm w-32" placeholder="如：我校4.0制"
                  value={newAlgoName} onChange={e => setNewAlgoName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">类型</span>
                <select className="rounded border px-2 py-1 text-sm" value={newAlgoType}
                  onChange={e => {
                    setNewAlgoType(e.target.value as 'grade' | 'segmented')
                    // 等级制：min/max 用 GPA 值；分段制：min/max 用分数范围
                  }}>
                  <option value="grade">等级制（A/B/C/D → GPA）</option>
                  <option value="segmented">分段制（分数范围 → GPA）</option>
                </select>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">最高 GPA</span>
                <input className="rounded border px-2 py-1 text-sm w-14" value={newAlgoMaxGPA}
                  onChange={e => setNewAlgoMaxGPA(e.target.value)} />
              </div>
            </div>

            {/* 映射表 */}
            <div className="border rounded mb-2">
              <div className="flex text-[10px] text-muted-foreground border-b bg-muted/50 px-2 py-1">
                <span className="flex-1">等级</span>
                <span className="w-14 text-center">下限</span>
                <span className="w-14 text-center">上限</span>
                <span className="w-14 text-center">GPA</span>
                <span className="w-8"></span>
              </div>
              <div className="max-h-40 overflow-auto">
                {newAlgoMappings.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-1 text-xs px-2 py-1 border-b last:border-b-0 hover:bg-muted/50">
                    <input className="flex-1 rounded border px-1 py-0.5 text-xs" placeholder="A"
                      value={m.grade} onChange={e => {
                        setNewAlgoMappings(prev => prev.map((p, i) => i === idx ? { ...p, grade: e.target.value } : p))
                      }} />
                    <input className="w-14 rounded border px-1 py-0.5 text-xs text-center"
                      disabled={newAlgoType === 'grade'} value={newAlgoType === 'grade' ? m.gpa : m.min} onChange={e => {
                        setNewAlgoMappings(prev => prev.map((p, i) => i === idx ? { ...p, min: e.target.value } : p))
                      }} />
                    <input className="w-14 rounded border px-1 py-0.5 text-xs text-center"
                      disabled={newAlgoType === 'grade'} value={newAlgoType === 'grade' ? m.gpa : m.max} onChange={e => {
                        setNewAlgoMappings(prev => prev.map((p, i) => i === idx ? { ...p, max: e.target.value } : p))
                      }} />
                    <input className="w-14 rounded border px-1 py-0.5 text-xs text-center"
                      value={m.gpa} onChange={e => {
                        setNewAlgoMappings(prev => prev.map((p, i) => i === idx ? { ...p, gpa: e.target.value } : p))
                      }} />
                    <button className="w-8 text-center text-red-500 text-xs"
                      onClick={() => setNewAlgoMappings(prev => prev.filter((_, i) => i !== idx))}>⊖</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button className="rounded border px-2 py-1 text-xs hover:bg-accent"
                onClick={() => {
                  setNewAlgoMappings(prev => [...prev, { grade: '', min: '', max: '', gpa: '' }])
                }}>+ 添加一行</button>
              <div className="flex-1" />
              {editingCustomAlgo && (
                <button className="rounded border px-2 py-1 text-xs hover:bg-accent"
                  onClick={() => { setEditingCustomAlgo(null); setNewAlgoName(''); setNewAlgoMappings([
                    { grade: 'A', min: '90', max: '100', gpa: '4.0' },
                    { grade: 'B', min: '80', max: '89', gpa: '3.0' },
                    { grade: 'C', min: '70', max: '79', gpa: '2.0' },
                    { grade: 'D', min: '60', max: '69', gpa: '1.0' },
                    { grade: 'F', min: '0', max: '59', gpa: '0.0' },
                  ]) }}>取消编辑</button>
              )}
              <button className="bg-primary text-primary-foreground px-3 py-1 rounded text-xs font-medium border-none cursor-pointer hover:bg-primary/90"
                onClick={() => {
                  if (!newAlgoName.trim()) return setRuleError('请填写算法名称。')
                  const asNumber = (v: string) => v.trim() ? Number(v) : NaN
                  const parsed = newAlgoMappings.map(m => ({ grade: m.grade.trim(), gpa: asNumber(m.gpa),
                    min: asNumber(newAlgoType === 'grade' ? m.gpa : m.min), max: asNumber(newAlgoType === 'grade' ? m.gpa : m.max) }))
                  const error = validateMappings(newAlgoType, asNumber(newAlgoMaxGPA), parsed)
                  if (error) return setRuleError(error)
                  setRuleError('')
                  const algo: CustomAlgorithm = {
                    id: editingCustomAlgo?.id || `custom_${Date.now()}`,
                    name: newAlgoName.trim(),
                    description: `自定义${newAlgoType === 'grade' ? '等级制' : '分段制'}算法`,
                    maxGPA: Number(newAlgoMaxGPA),
                    precision: 2,
                    type: newAlgoType,
                    mappings: parsed,
                  }
                  const existing = customAlgorithms.find(c => c.id === algo.id)
                  let updated: CustomAlgorithm[]
                  if (existing) {
                    updated = customAlgorithms.map(c => c.id === algo.id ? algo : c)
                  } else {
                    updated = [...customAlgorithms, algo]
                  }
                  saveCustomAlgorithms(updated, algo.id)
                  setEditingCustomAlgo(null)
                  setNewAlgoName('')
                  setNewAlgoMappings([
                    { grade: 'A', min: '90', max: '100', gpa: '4.0' },
                    { grade: 'B', min: '80', max: '89', gpa: '3.0' },
                    { grade: 'C', min: '70', max: '79', gpa: '2.0' },
                    { grade: 'D', min: '60', max: '69', gpa: '1.0' },
                    { grade: 'F', min: '0', max: '59', gpa: '0.0' },
                  ])
                }}
              >💾 {editingCustomAlgo ? '保存修改' : '创建并使用'}</button>
              {ruleError && <span role="alert" className="text-red-600 text-xs">{ruleError}</span>}
            </div>
          </div>
        </div>
      )}

      {/* === 课程列表（滚动区） === */}
      <div ref={courseListRef} className="px-4 py-2" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {sortedSemesters.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <div className="mb-2 text-4xl">📚</div>
            <div className="text-lg">还没有成绩数据</div>
            <div className="mt-1 text-sm">切换到「数据导入」面板开始导入成绩</div>
          </div>
        ) : (
          sortedSemesters.map(stat => {
            const semCourses = coursesBySemester.get(stat.semester) || []
            const termBefore = summarize(semCourses, 'originalScore', currentAlgo)
            const termAfter = summarize(semCourses, 'simulatedScore', currentAlgo)
            const isCollapsed = collapsedSemesters.has(stat.semester)
            const isCrossSemDrag = dragState.targetSemester === stat.semester && dragState.sourceSemester !== null && dragState.sourceSemester !== stat.semester
            const semSelectedCount = semCourses.filter(c => selectedCourseIds.has(c.id)).length

            return (
              <div key={stat.semester} className="mb-3">
                {/* 学期头 */}
                <button
                  className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-accent/50 ${
                    isCrossSemDrag ? 'border-2 border-dashed border-blue-400 bg-blue-50/30' : ''
                  } ${semesterDragSource !== null ? 'cursor-grabbing' : ''}`}
                  draggable
                  onClick={() => toggleSemester(stat.semester)}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    setSemesterDragSource(stat.semester)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (semesterDragSource !== null) return  // 学期拖拽优先
                    const len = semCourses.length
                    setDragState(s => ({ ...s, targetSemester: stat.semester, dropIndex: len }))
                  }}
                  onDrop={(e) => {
                    if (semesterDragSource !== null) {
                      handleSemesterDrop(stat.semester)
                    } else {
                      handleDrop(e, stat.semester)
                    }
                  }}
                >
                  <span className="text-xs text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">⠿</span>
                  <span className="text-xs">{isCollapsed ? '▶' : '▼'}</span>
                  {editingSemesterTitle === stat.semester ? (
                    <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <input
                        className="border rounded px-1 py-0.5 text-sm w-40"
                        value={semesterTitleValue}
                        onChange={e => setSemesterTitleValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') confirmSemesterTitleEdit(); if (e.key === 'Escape') cancelSemesterTitleEdit() }}
                        autoFocus
                      />
                      <button className="text-green-600 hover:text-green-700 text-xs px-1" onClick={confirmSemesterTitleEdit}>✓</button>
                      <button className="text-red-500 hover:text-red-600 text-xs px-1" onClick={cancelSemesterTitleEdit}>✕</button>
                    </span>
                  ) : (
                    <>
                      <span className="font-medium text-sm">{stat.semesterLabel}</span>
                      <button
                        className="text-muted-foreground hover:text-foreground text-xs ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => { e.stopPropagation(); startEditSemesterTitle(stat.semester, stat.semesterLabel) }}
                        title="编辑学期标题"
                      >✏️</button>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">
                    均分 {displayMetric(termBefore.weighted)}
                    {termAfter.weighted !== termBefore.weighted && (
                      <span className="text-blue-600 ml-0.5">→{displayMetric(termAfter.weighted)}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    算术 {displayMetric(termBefore.arithmetic)}
                    {termAfter.arithmetic !== termBefore.arithmetic && (
                      <span className="text-blue-600 ml-0.5">→{displayMetric(termAfter.arithmetic)}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    GPA {displayMetric(termBefore.gpa)}
                    {termAfter.gpa !== termBefore.gpa && (
                      <span className="text-blue-600 ml-0.5">→{displayMetric(termAfter.gpa)}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">({stat.courseCount}门)</span>
                  {stat.hasModifications && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                  {stat.correctedCount > 0 && (
                    <span className="text-xs text-orange-500">已修正{stat.correctedCount}门</span>
                  )}
                </button>

                {/* 课程表格 */}
                {!isCollapsed && (
                  <div
                    className={`mt-1 overflow-hidden rounded-md border ${isCrossSemDrag ? 'border-2 border-dashed border-blue-400 bg-blue-50/20' : ''}`}
                    onDragLeave={handleDragLeave}
                  >
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                          <th className="w-8 py-1.5 text-center relative">
                            <input type="checkbox" title="全选/取消本学期"
                              checked={semSelectedCount === semCourses.length && semCourses.length > 0}
                              ref={el => {
                                if (el) el.indeterminate = semSelectedCount > 0 && semSelectedCount < semCourses.length
                              }}
                              onChange={() => {
                                if (semSelectedCount === semCourses.length) {
                                  setSelectedCourseIds(prev => {
                                    const next = new Set(prev)
                                    semCourses.forEach(c => next.delete(c.id))
                                    return next
                                  })
                                } else {
                                  setSelectedCourseIds(prev => {
                                    const next = new Set(prev)
                                    semCourses.forEach(c => next.add(c.id))
                                    return next
                                  })
                                }
                              }}
                            />
                            <span className="ml-0.5 cursor-help text-[10px] text-muted-foreground hover:text-foreground"
                              title="快捷键帮助"
                              onClick={(e) => { e.stopPropagation(); setShowShortcutHelp(showShortcutHelp === stat.semester ? null : stat.semester) }}
                            >?</span>
                            {showShortcutHelp === stat.semester && (
                              <div className="absolute top-6 left-0 z-50 w-48 rounded border bg-white shadow-lg p-2 text-left text-[10px] leading-relaxed"
                                onClick={e => e.stopPropagation()}>
                                <div className="font-medium mb-1">🖱️ 鼠标 + ⌨️ 快捷键</div>
                                <div>· 点击 ☐ 选中/取消</div>
                                <div>· Shift+点击 = 范围选中</div>
                                <div>· Ctrl+点击 = 多选/取消</div>
                                <div>· 拖拽 ⠿ = 移动/排序</div>
                                <div>· 跨学期拖拽 = 移动课程</div>
                                <div>· 双击课程名 = 编辑</div>
                                <div>· Ctrl+Z = 撤回</div>
                                <div>· Esc = 清空选择</div>
                                <button className="mt-1 text-blue-600 hover:underline"
                                  onClick={() => setShowShortcutHelp(null)}>关闭</button>
                              </div>
                            )}
                          </th>
                          <th className="w-8 py-1.5 text-center">⠿</th>
                          <th className="py-1.5 text-left pl-2">课程名</th>
                          <th className="w-16 py-1.5 text-center">性质</th>
                          <th className="w-14 py-1.5 text-center">学分</th>
                          <th className="w-28 py-1.5 text-center">成绩(模拟)</th>
                          <th className="w-24 py-1.5 text-center">绩点(模拟)</th>
                          <th className="w-8 py-1.5 text-center">⊖</th>
                        </tr>
                      </thead>
                      <tbody>
                        {semCourses.map((course, idx) => (
                          <CourseRow
                            key={course.id}
                            course={course}
                            algo={currentAlgo}
                            targetSuggestedScore={targetThresholdScore}
                            targetGPA={parseFloat(targetGPA) || null}
                            editingField={editingCell?.courseId === course.id ? editingCell.field : null}
                            editValue={editingCell?.courseId === course.id ? editingCell.value : ''}
                            onStartEdit={(field: string, value: string) => startCellEdit(course.id, field, value)}
                            onConfirmEdit={confirmCellEdit}
                            onCancelEdit={cancelCellEdit}
                            onEditValueChange={(v: string) => setEditingCell(ec => ec ? { ...ec, value: v } : null)}
                            onDelete={() => deleteCourse(course.id)}
                            isDragOver={dragState.dropIndex === idx && dragState.targetSemester === stat.semester}
                            onDragStart={() => handleDragStart(course.id, stat.semester)}
                            onDragOver={(e) => handleDragOver(e, stat.semester, idx)}
                            onDrop={(e) => handleDrop(e, stat.semester)}
                            onDragEnd={handleDragEnd}
                            isSelected={selectedCourseIds.has(course.id)}
                            isDragging={dragState.draggedCourseIds.has(course.id)}
                            onRowClick={() => handleCourseClick(course.id, stat.semester, idx)}
                            availableGrades={availableGrades}
                          />
                        ))}

                        {/* 拖拽放置区 — 放到学期末尾 */}
                        {dragState.sourceSemester !== null && (
                          <tr className={`h-3 transition-colors ${
                            dragState.dropIndex === semCourses.length && dragState.targetSemester === stat.semester
                              ? 'bg-blue-100' : 'hover:bg-blue-50'
                          }`}
                            onDragOver={(e) => handleDragOver(e, stat.semester, semCourses.length)}
                            onDrop={(e) => handleDrop(e, stat.semester)}
                          >
                            <td colSpan={8} className="text-center text-[9px] text-blue-400 py-0.5">
                              {dragState.targetSemester === stat.semester && dragState.dropIndex === semCourses.length
                                ? `📂 放置到此处（${dragState.draggedCourseIds.size > 1 ? dragState.draggedCourseIds.size + '门课程' : '1门课程'}）` : ''}
                            </td>
                          </tr>
                        )}

                        {/* 添加新行或按钮 */}
                        {addingSemester === stat.semester ? (
                          <tr className="border-t bg-blue-50/50">
                            <td className="py-1.5 text-center text-muted-foreground">+</td>
                            <td className="py-1.5 text-center text-muted-foreground"></td>
                            <td className="py-1.5 pl-2">
                              <input className="w-full rounded border px-1.5 py-0.5 text-sm" placeholder="课程名"
                                value={newCourse.courseName} autoFocus
                                onChange={e => setNewCourse(n => ({ ...n, courseName: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && e.ctrlKey && confirmAddCourse()} />
                            </td>
                            <td className="py-1.5 text-center">
                              <select className="rounded border px-1 py-0.5 text-xs w-14" value={newCourse.category}
                                onChange={e => setNewCourse(n => ({ ...n, category: e.target.value }))}>
                                {COURSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="py-1.5 text-center">
                              <input className="w-12 rounded border px-1 py-0.5 text-xs text-center" placeholder="学分"
                                value={newCourse.credits}
                                onChange={e => setNewCourse(n => ({ ...n, credits: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && e.ctrlKey && confirmAddCourse()} />
                            </td>
                            <td className="py-1.5 text-center">
                              <input className="w-14 rounded border px-1 py-0.5 text-xs text-center" placeholder="成绩"
                                value={newCourse.score}
                                onChange={e => setNewCourse(n => ({ ...n, score: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && e.ctrlKey && confirmAddCourse()} />
                            </td>
                            <td className="py-1.5 text-center text-xs text-muted-foreground">{currentAlgo.type === 'grade' ?
                                <input className="w-14 rounded border" aria-label="原始绩点" value={newCourse.gp}
                                  onChange={e => setNewCourse(n => ({...n, gp: e.target.value}))} /> : '—'}</td>
                            <td className="py-1.5 text-center">
                              <button className="text-green-600 hover:text-green-700 text-xs" onClick={confirmAddCourse}>✓</button>
                              <button className="text-red-500 hover:text-red-600 text-xs ml-1" onClick={cancelAddCourse}>✕</button>
                            </td>
                          </tr>
                        ) : null}

                        <tr>
                          <td colSpan={8} className="py-1 text-center">
                            <button
                              className="text-xs text-primary hover:text-primary/80 font-medium"
                              onClick={() => startAddCourse(stat.semester)}
                            >+ 添加课程到此学期</button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
        {/* 添加新学期按钮 */}
        <div className="mt-2 mb-4 text-center">
          <button
            className="text-xs text-primary hover:text-primary/80 font-medium border border-dashed border-primary/30 rounded-md px-4 py-2 hover:bg-primary/5 transition-colors"
            onClick={addNewSemester}
          >
            ➕ 添加新学期
          </button>
        </div>

        {/* === 🔮 未来学期（预测课程） === */}
        {predictedOnly.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-3 rounded-md border px-3 py-2 bg-muted/20">
              <span className="text-sm font-medium text-muted-foreground">🔮 未来学期（预测）</span>
              <span className="text-xs text-muted-foreground">{predictedOnly.length}门 / {predictedOnly.reduce((s, c) => s + c.credits, 0)}学分</span>
            </div>
            <div className="mt-1 rounded-md border bg-muted/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1 pl-2">课程名</th>
                    <th className="w-16 py-1 text-center">性质</th>
                    <th className="w-14 py-1 text-center">学分</th>
                    <th className="w-28 py-1 text-center">成绩 / 模拟</th>
                    <th className="w-20 py-1 text-center">绩点 / 模拟</th>
                    <th className="w-8 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {predictedOnly.map(c => {
                    const hasSim = c.simulatedScore !== null
                    const simGP = courseGPA(c, 'simulatedScore', currentAlgo)?.toFixed(2) ?? null
                    const targetScore = parseFloat(targetGPA)
                    const targetThreshold = !isNaN(targetScore) ? gpaToScore(targetScore, useWES ? PRESET_ALGORITHMS.wes_4_0 : currentAlgo) : null
                    const simColor = (hasSim && targetThreshold != null)
                      ? gapColor(c.simulatedScore!, targetThreshold)
                      : undefined
                    const isEditing = editingCell?.courseId === c.id ? editingCell.field : null
                    const editVal = editingCell?.courseId === c.id ? editingCell.value : ''
                    const fmtScore = (v: number | null | undefined) => v != null ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '—'
                    const inputProps = {
                      autoFocus: true,
                      onBlur: confirmCellEdit,
                      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') confirmCellEdit(); if (e.key === 'Escape') cancelCellEdit() },
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditingCell(ec => ec ? { ...ec, value: e.target.value } : null),
                    }
                    return (
                    <tr key={c.id} className="border-t border-muted hover:bg-accent/30">
                      {/* 课程名（可编辑） */}
                      {isEditing === 'courseName' ? (
                        <td className="py-1 pl-2">
                          <input className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm bg-background"
                            value={editVal} {...inputProps} />
                        </td>
                      ) : (
                        <td className="py-1 pl-2 text-muted-foreground cursor-text hover:bg-blue-50/50 rounded transition-colors"
                          title="双击编辑" onDoubleClick={() => startCellEdit(c.id, 'courseName', c.courseName)}>{c.courseName}</td>
                      )}

                      {/* 性质（可编辑） */}
                      {isEditing === 'category' ? (
                        <td className="py-1 text-center">
                          <input className="w-14 rounded border border-blue-400 px-1 py-0.5 text-xs text-center bg-background"
                            value={editVal} {...inputProps} />
                        </td>
                      ) : (
                        <td className="py-1 text-center text-muted-foreground text-xs cursor-text hover:bg-blue-50/50 rounded transition-colors"
                          title="双击编辑" onDoubleClick={() => startCellEdit(c.id, 'category', c.category)}>{c.category}</td>
                      )}

                      {/* 学分（可编辑，保留一位小数） */}
                      {isEditing === 'credits' ? (
                        <td className="py-1 text-center">
                          <input className="w-12 rounded border border-blue-400 px-1 py-0.5 text-xs text-center bg-background"
                            value={editVal} {...inputProps} />
                        </td>
                      ) : (
                        <td className="py-1 text-center text-muted-foreground text-xs cursor-text hover:bg-blue-50/50 rounded transition-colors"
                          title="双击编辑" onDoubleClick={() => startCellEdit(c.id, 'credits', String(c.credits))}>{String(c.credits)}</td>
                      )}

                      {/* 成绩 / 模拟（预测课程无原始成绩，仅模拟成绩可编辑） */}
                      {isEditing === 'simulatedScore' ? (
                        <td className="py-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-muted-foreground text-[10px]">→</span>
                            <input className="w-12 rounded border border-blue-400 px-1 py-0.5 text-sm text-center bg-background"
                              value={editVal} {...inputProps} />
                          </div>
                        </td>
                      ) : (
                        <td className="py-1 text-center">
                          <span className="text-muted-foreground">—</span>
                          <span className="text-muted-foreground text-[10px] mx-0.5">→</span>
                          <span
                            className={`cursor-text hover:bg-blue-50/50 rounded px-0.5 transition-colors ${hasSim ? 'text-blue-600 font-medium' : 'text-muted-foreground'}`}
                            style={hasSim && simColor ? { color: simColor } : undefined}
                            title={hasSim ? '双击编辑模拟成绩' : '双击填写模拟成绩'}
                            onDoubleClick={() => startCellEdit(c.id, 'simulatedScore', hasSim ? String(c.simulatedScore) : '')}
                          >{hasSim ? fmtScore(c.simulatedScore) : '—'}</span>
                        </td>
                      )}

                      {/* 绩点 / 模拟（仅模拟绩点可编辑） */}
                      {isEditing === 'simulatedGP' ? (
                        <td className="py-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-muted-foreground text-[10px]">→</span>
                            <input className="w-12 rounded border border-blue-400 px-1 py-0.5 text-sm text-center bg-background"
                              value={editVal} {...inputProps} />
                          </div>
                        </td>
                      ) : (
                        <td className="py-1 text-center">
                          <span className="text-muted-foreground">—</span>
                          <span className="text-muted-foreground text-[10px] mx-0.5">→</span>
                          <span
                            className={`cursor-text hover:bg-blue-50/50 rounded px-0.5 transition-colors ${simGP ? 'text-blue-600 font-medium' : 'text-muted-foreground'}`}
                            style={simGP && simColor ? { color: simColor } : undefined}
                            title={simGP ? '双击编辑模拟绩点' : '双击填写模拟绩点'}
                            onDoubleClick={() => startCellEdit(c.id, 'simulatedGP', simGP ?? '')}
                          >{simGP ?? '—'}</span>
                        </td>
                      )}

                      <td className="py-1 text-center">
                        <button className="text-red-400 hover:text-red-600 text-xs" onClick={() => {
                          const updated = courses.filter(x => x.id !== c.id)
                          saveCourses(updated)
                        }}>✕</button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* === 拖拽手柄 === */}
      {showReverse && !IS_BROWSER_MODE && (
        <div
          ref={handleRef}
          className="h-3 cursor-ns-resize bg-border/30 hover:bg-blue-200 flex items-center justify-center group shrink-0"
          onMouseDown={onResizeStart}
        >
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30 group-hover:bg-blue-400 transition-colors" />
        </div>
      )}

      {/* === 底部汇总栏 === */}
        <div ref={bottomBarRef} className="planning-summary border-t px-4 py-3">
        <div className="flex items-start gap-4">
          {/* 对比卡片 */}
          <div className="flex gap-3 flex-1 items-center">
            <StatCard label="原始 GPA" value={displayMetric(originalGPA)} />
            <StatCard label="模拟 GPA" value={modifiedCount > 0 ? displayMetric(simulatedGPA) : '—'}
              highlight={modifiedCount > 0 && simulatedGPA !== originalGPA}
              diff={modifiedCount > 0 && simulatedGPA != null && originalGPA != null ? simulatedGPA - originalGPA : undefined}
            />
            <StatCard label="原始均分" value={displayMetric(originalAvg)} subtitle={`算术 ${displayMetric(originalArithAvg)}`} />
            <StatCard label="模拟均分" value={modifiedCount > 0 ? displayMetric(simulatedAvg) : '—'}
              highlight={modifiedCount > 0 && simulatedAvg !== originalAvg}
              diff={modifiedCount > 0 && simulatedAvg != null && originalAvg != null ? simulatedAvg - originalAvg : undefined}
              subtitle={modifiedCount > 0 ? `算术 ${displayMetric(simulatedArithAvg)}` : undefined}
            />
            {predictedOnly.length > 0 && (
              <>
                <div className="w-px h-10 bg-border/50 mx-1" />
                <StatCard label="预测 GPA" value={predictedGPA != null ? displayMetric(predictedGPA) : '—'} highlight={true} />
                <StatCard label="预测均分" value={predictedAvg != null ? displayMetric(predictedAvg) : '—'} highlight={true}
                  subtitle={predictedAvg != null ? `算术 ${displayMetric(predictedArithAvg)}` : undefined} />
              </>
            )}
            {useWES && (
              <>
                <StatCard label="WES 原始" value={displayMetric(wesOriginalGPA)} />
                <StatCard label="WES 模拟" value={modifiedCount > 0 ? displayMetric(wesSimulatedGPA) : '—'}
                  highlight={modifiedCount > 0 && wesSimulatedGPA !== wesOriginalGPA}
                  diff={modifiedCount > 0 && wesSimulatedGPA != null && wesOriginalGPA != null ? wesSimulatedGPA - wesOriginalGPA : undefined}
                />
                {predictedOnly.length > 0 && (
                  <StatCard label="WES 预测" value={wesPredictedGPA != null ? displayMetric(wesPredictedGPA) : '—'} highlight={true} />
                )}
              </>
            )}
            {/* 分隔线 */}
            <div className="w-px h-10 bg-border mx-1" />
            {/* 3D 目标卡片 + WES */}
            <div className="flex items-center gap-2">
              {IS_BROWSER_MODE ? <div className="target-editor">
                <label>目标类型<select aria-label="目标类型" value={targetCardIndex} onChange={e => switchTargetCard(Number(e.target.value))}>
                  {TARGET_CARDS.map((card, index) => <option key={card.key} value={index}>{card.label}</option>)}
                </select></label>
                <label>目标值<input aria-label="目标值" inputMode="decimal" value={targetCardInput}
                  onChange={e => handleTargetCardChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runReverse()} /></label>
              </div> : (<div style={{ position: 'relative', width: 160, height: 80 }}>
                {TARGET_CARDS.map((card, i) => {
                  const stackPos = ((i - targetCardIndex) % 3 + 3) % 3
                  const isSelected = stackPos === 0
                  const yOff = stackPos === 0 ? 20 : stackPos === 1 ? 40 : 0
                  return (
                    <div
                      key={card.key}
                      onClick={() => switchTargetCard(i)}
                      style={{
                        position: 'absolute', left: 0, width: 160, height: 40,
                        borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        background: isSelected ? '#ffffff' : '#f5f4f1',
                        border: isSelected ? '2px solid #e2e0db' : '1px solid #eae8e3',
                        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        cursor: 'pointer',
                        transform: `translateY(${yOff}px) scale(${isSelected ? 1.06 : 0.9})`,
                        zIndex: isSelected ? 3 : 3 - stackPos,
                        boxShadow: isSelected
                          ? '0 2px 8px rgba(0,0,0,0.08)'
                          : `0 1px 3px rgba(0,0,0,0.05)`,
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#000', whiteSpace: 'nowrap', fontWeight: 500 }}>{card.label}</span>
                      {isSelected ? (
                        <input
                          value={targetCardInput}
                          onChange={e => handleTargetCardChange(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && runReverse()}
                          style={{
                            width: 64, background: 'transparent',
                            border: 'none', borderBottom: '2px solid #1a1a1a',
                            borderRadius: 0, color: '#000', fontSize: 18, fontWeight: 700,
                            textAlign: 'center', outline: 'none', padding: '1px 2px',
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span style={{ fontSize: 18, fontWeight: 600, color: '#000' }}>—</span>
                      )}
                    </div>
                  )
                })}
              </div>)}
              <label className="flex items-center gap-1 px-2 py-1 border border-border rounded cursor-pointer text-xs whitespace-nowrap">
                <input type="checkbox" checked={useWES} onChange={e => { setUseWES(e.target.checked); setRetakeResult(null); setPredictResult(null); setLockedScores(new Map()) }} />
                <span className="font-medium">WES</span>
              </label>
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right whitespace-nowrap">
            <div>实修课程: {realCourses.length}门</div>
            <div>总学分: {totalCredits}</div>
            <div>已修正: {correctedCount}门</div>
            <div>模拟中: {modifiedCount}门</div>
          </div>
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${showReverse && reverseMode === 'retake' ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground hover:bg-accent'}`}
            onClick={() => {
              if (showReverse && reverseMode === 'retake') { setShowReverse(false); return }
              openReversePanel('retake')
            }}
          >🎯 目标反推</button>
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${showReverse && reverseMode === 'predict' ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground hover:bg-accent'}`}
            onClick={() => {
              if (showReverse && reverseMode === 'predict') { setShowReverse(false); return }
              openReversePanel('predict')
            }}
          >🔮 未来预测</button>
        </div>
      </div>

      {planMessage && <p role="status" className="px-4 py-2 text-sm">{planMessage}</p>}
      {/* === 反推面板 === */}
      {showReverse && (
          <div ref={reversePanelRef} className="planning-panel border border-t-0 rounded-b-md bg-background" style={IS_BROWSER_MODE ? { height: 'auto', overflow: 'visible' } : { height: reversePanelHeight, overflow: 'auto' }}>
            <div className="p-4">{/* content wrapper */}
            {/* 模式切换 + 目标设置 */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex rounded-md overflow-hidden text-sm border-2 border-border">
                <button
                  className={`px-4 py-1.5 font-medium ${reverseMode === 'retake' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                  onClick={() => setReverseMode('retake')}
                >🔧 重修反推</button>
                <button
                  className={`px-4 py-1.5 font-medium border-l ${reverseMode === 'predict' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                  onClick={() => setReverseMode('predict')}
                >🔮 未来预测</button>
              </div>
            </div>

            {/* 重修模式：选择课程 */}
            {!IS_BROWSER_MODE && reverseMode === 'retake' && !retakeResult && (
              <div className="text-sm">
                <div className="mb-2 text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>选择可以重修的科目：</span>
                  <button className="text-blue-600 hover:underline text-xs"
                    onClick={() => {
                      setSelectedRetakeIds(prev => prev.size === realCourses.length ? new Set() : new Set(realCourses.map(c => c.id)))
                    }}>全选/取消</button>
                  <span className="text-xs">已选: {selectedRetakeIds.size}门</span>
                  <div className="flex rounded-md overflow-hidden text-xs border border-border ml-1">
                    <button
                      className={`px-2 py-0.5 ${retakeSort === 'default' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      onClick={() => setRetakeSort('default')}
                    >📋 原顺序</button>
                    <button
                      className={`px-2 py-0.5 border-l ${retakeSort === 'lowScore' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      onClick={() => setRetakeSort('lowScore')}
                    >📉 低分在前</button>
                  </div>
                </div>
                <input className="w-full rounded border px-2 py-1 text-xs mb-2"
                  placeholder="搜索课程名..." value={retakeSearch} onChange={e => setRetakeSearch(e.target.value)} />
                <div className="overflow-auto space-y-1" style={{ maxHeight: '240px', minHeight: '200px' }}>
                  {(() => {
                    const filtered = realCourses.filter(c => !retakeSearch || c.courseName.includes(retakeSearch))
                    const sorted = retakeSort === 'lowScore'
                      ? [...filtered].sort((a, b) => (a.originalScore ?? Infinity) - (b.originalScore ?? Infinity))
                      : filtered
                    return sorted.map(c => (
                    <label key={c.id} className="flex items-center gap-2 py-0.5 hover:bg-accent/30 rounded px-1">
                      <input
                        type="checkbox"
                        checked={selectedRetakeIds.has(c.id)}
                        onChange={() => {
                          setSelectedRetakeIds(prev => {
                            const next = new Set(prev)
                            if (next.has(c.id)) next.delete(c.id)
                            else next.add(c.id)
                            return next
                          })
                        }}
                      />
                      <span>{c.courseName}</span>
                      <span className="text-xs text-muted-foreground">{c.credits}学分</span>
                      <span className="text-xs">{c.originalScore == null ? '—' : c.originalScore + '分'}</span>
                      <span className="text-xs text-muted-foreground">({c.originalScore == null ? '—' : scoreToGrade(c.originalScore, currentAlgo)})</span>
                    </label>
                  ))})()}
                </div>
                {selectedRetakeIds.size > 0 && (
                  <button
                    className="bg-primary text-primary-foreground px-4 py-1.5 rounded-lg text-sm font-medium border-none cursor-pointer hover:bg-primary/90 mt-2"
                    onClick={runReverse}
                  >🎯 开始反推</button>
                )}
              </div>
            )}

            {/* 预测模式：添加假设课程 */}
            {reverseMode === 'predict' && (
              <div className="text-sm" style={{ minHeight: '200px' }}>
                {/* 预测基准切换 */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">预测基准：</span>
                  <div className="flex rounded-md overflow-hidden text-xs border border-border">
                    <button className={`px-2 py-1 ${predictBase === 'original' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      onClick={() => { setPredictBase('original'); setPredictResult(null) }}
                      title="以当前原始成绩为基准预测未来">📋 原始成绩</button>
                    <button className={`px-2 py-1 border-l ${predictBase === 'simulated' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      onClick={() => { setPredictBase('simulated'); setPredictResult(null) }}
                      title="以编辑后的模拟成绩为基准预测未来">✏️ 模拟成绩</button>
                    <button className={`px-2 py-1 border-l ${predictBase === 'reverse' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      disabled={!retakeBase?.achievable} onClick={() => { setPredictBase('reverse'); setPredictResult(null) }}
                      title="以反推/模拟后的成绩为基准预测未来">🎯 反推后成绩</button>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    ({predictBase === 'original' ? '基于原始成绩' : predictBase === 'simulated' ? '基于模拟成绩' : '基于反推后成绩'})
                  </span>
                </div>

                <div className="mb-2 text-muted-foreground">添加未来学期的假设课程：</div>
                {/* 课程表格 — 与成绩列表统一设计 */}
                <div className="rounded-md border mb-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1 pl-2">课程名</th>
                        <th className="w-16 py-1 text-center">性质</th>
                        <th className="w-14 py-1 text-center">学分</th>
                        <th className="w-24 py-1 text-center">预期成绩</th>
                        <th className="w-20 py-1 text-center">绩点</th>
                        <th className="w-8 py-1 text-center">⊖</th>
                      </tr>
                    </thead>
                    <tbody>
                      {predictCourses.map(pc => (
                        <tr key={pc.id} className="border-t border-muted hover:bg-accent/30">
                          <td className="py-1 pl-2">{pc.courseName}</td>
                          <td className="py-1 text-center text-muted-foreground">{pc.category}</td>
                          <td className="py-1 text-center text-muted-foreground">{String(pc.credits)}</td>
                          <td className="py-1 text-center">
                            <input className="w-14 rounded border px-1 py-0.5 text-xs text-center"
                              aria-label={pc.courseName + '预期分数'} placeholder="85" inputMode="decimal" defaultValue={pc.lockedScore ?? ''}
                              onBlur={e => editFutureValue(e.currentTarget, pc, 'lockedScore')} />
                          </td>
                          <td className="py-1 text-center">
                            {targetAlgo.type === 'grade' ? <input className="w-14 rounded border px-1 py-0.5 text-xs text-center"
                              aria-label={pc.courseName + '预期绩点'} placeholder="3.5" inputMode="decimal" defaultValue={pc.lockedGP ?? ''}
                              onBlur={e => editFutureValue(e.currentTarget, pc, 'lockedGP')} /> :
                              pc.lockedScore == null ? '—' : displayMetric(scoreToGPA(pc.lockedScore, targetAlgo))}
                          </td>
                          <td className="py-1 text-center">
                            <button className="text-red-400 hover:text-red-600 text-xs"
                              onClick={() => setPredictCourses(prev => prev.filter(p => p.id !== pc.id))}>✕</button>
                          </td>
                        </tr>
                      ))}
                      {/* 添加行 — 与成绩表添加行设计一致 */}
                      {addingPredict ? (
                        <tr className="border-t bg-blue-50/50">
                          <td className="py-1.5 pl-2">
                            <input className="w-full rounded border px-1.5 py-0.5 text-sm" placeholder="课程名"
                              value={predictNewName} autoFocus
                              onChange={e => setPredictNewName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && e.ctrlKey && confirmAddPredictCourse()} />
                          </td>
                          <td className="py-1.5 text-center">
                            <select className="rounded border px-1 py-0.5 text-xs w-14" value={predictNewCategory}
                              onChange={e => setPredictNewCategory(e.target.value)}>
                              {['专必','公必','公选','专选','其他'].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 text-center">
                            <input className="w-12 rounded border px-1 py-0.5 text-xs text-center" placeholder="学分"
                              value={predictNewCredits}
                              onChange={e => setPredictNewCredits(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && e.ctrlKey && confirmAddPredictCourse()} />
                          </td>
                          <td className="py-1.5 text-center">
                            <input className="w-14 rounded border px-1 py-0.5 text-xs text-center" placeholder="成绩"
                              value={predictNewScore}
                              onChange={e => setPredictNewScore(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && e.ctrlKey && confirmAddPredictCourse()} />
                          </td>
                          <td className="py-1.5 text-center text-xs text-muted-foreground">{targetAlgo.type === 'grade'
                              ? <input aria-label="预期绩点" className="w-14 rounded border" value={predictNewGP} onChange={e => setPredictNewGP(e.target.value)} />
                              : predictNewScore.trim() && inRange(Number(predictNewScore)) ? displayMetric(scoreToGPA(Number(predictNewScore), targetAlgo)) : '—'}</td>
                          <td className="py-1.5 text-center">
                            <button className="text-green-600 hover:text-green-700 text-xs" onClick={confirmAddPredictCourse}>✓</button>
                            <button className="text-red-500 hover:text-red-600 text-xs ml-1" onClick={cancelAddPredictCourse}>✕</button>
                          </td>
                        </tr>
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-1 text-center">
                            <button
                              className="text-xs text-primary hover:text-primary/80 font-medium"
                              onClick={() => setAddingPredict(true)}
                            >+ 添加课程</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  基准 GPA {displayMetric(baseSummary.gpa)}
                  {predictCourses.length > 0 && ` | 未来学分: ${predictCourses.reduce((s, c) => s + c.credits, 0).toFixed(1)}`}
                </div>
                {predictCourses.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      className="bg-primary text-primary-foreground px-4 py-1.5 rounded-lg text-sm font-medium border-none cursor-pointer hover:bg-primary/90"
                      onClick={runReverse}
                    >🔮 开始预测</button>
                    <button
                      className="border border-border bg-background text-foreground px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer hover:bg-accent"
                      disabled={!predictResult?.achievable}
                      title="先计算预测，再将本次假设保存到未来学期"
                      onClick={async () => {
                        if (!predictResult?.achievable) return
                        const records = applyProposal(futureRecords(predictCourses, courses), predictResult)
                        await saveCourses([...courses, ...records])
                        setPredictCourses([])
                      }}
                    >📥 导入至成绩列表</button>
                  </div>
                )}
              </div>
            )}

            {/* 反推结果 */}
            {reverseResult && (
              <div>
                {/* 预测模式：显示未来统计 */}
                {reverseMode === 'predict' && (
                  <div className="flex gap-4 mb-3 p-3 rounded-md bg-indigo-50/50 border border-indigo-200">
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">当前 GPA</div>
                      <div className="text-lg font-semibold">{displayMetric(baseSummary.gpa)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">当前均分</div>
                      <div className="text-lg font-semibold">{displayMetric(baseSummary.weighted)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">当前算术均分</div>
                      <div className="text-lg font-semibold">{displayMetric(baseSummary.arithmetic)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">当前总学分</div>
                      <div className="text-lg font-semibold">{baseCourses.reduce((sum, c) => sum + c.credits, 0)}</div>
                    </div>
                    <div className="w-px bg-border" />
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">未来 GPA</div>
                      <div className={`text-lg font-semibold ${reverseResult.achievable ? 'text-green-600' : 'text-red-500'}`}>
                        {displayMetric(reverseResult.estimatedGPA)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">未来均分</div>
                      <div className={`text-lg font-semibold ${reverseResult.achievable ? 'text-green-600' : 'text-red-500'}`}>
                        {displayMetric(reverseResult.estimatedWeightedAvg)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">未来算术均分</div>
                      <div className={`text-lg font-semibold ${reverseResult.achievable ? 'text-green-600' : 'text-red-500'}`}>
                        {displayMetric(reverseResult.estimatedArithAvg)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-muted-foreground">未来总学分</div>
                      <div className="text-lg font-semibold">{[...baseCourses, ...predictCourses].reduce((sum, c) => sum + c.credits, 0)}</div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 mb-2 text-sm">
                  {reverseMode === 'predict' && !reverseResult.hasTarget ? (
                    <span>预测结果（未设置目标）</span>
                  ) : (() => {
                    const r = reverseResult
                    const label = r.targetType === 'gpa' ? 'GPA' : r.targetType === 'weighted' ? '加权均分' : '算术均分'
                    const fmt = r.targetType === 'gpa' ? (v: number) => v.toFixed(2) : (v: number) => v.toFixed(1)
                    const currentVal = r.gap == null ? null : r.targetGPA - r.gap
                    const displayGap = r.gap
                    return <>
                      <span>当前{label} {currentVal == null ? '—' : fmt(currentVal)}</span>
                      <span>→ 目标{label} {fmt(r.targetGPA)}</span>
                      <span className={displayGap != null && displayGap > 0 ? 'text-red-500' : 'text-green-500'}>
                        差距 {displayGap == null ? '—' : (displayGap > 0 ? '+' : '') + fmt(displayGap)}
                      </span>
                    </>
                  })()}
                </div>

                {reverseResult.targets.length > 0 && (
                  <div className="overflow-auto max-h-60">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="text-left py-1">课程</th>
                          <th className="text-center py-1">学分</th>
                          {reverseMode === 'predict' ? (
                            <>
                              <th className="text-center py-1">预期成绩</th>
                              <th className="text-center py-1">绩点</th>
                              <th className="text-center py-1">{reverseResult.inputUnit === 'gpa' ? '建议绩点' : '建议分数'}</th>
                            </>
                          ) : (
                            <>
                              <th className="text-center py-1">当前 → 建议</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {reverseResult.targets.map(t => (
                          <tr key={t.courseId} className={`border-t ${t.locked ? 'bg-blue-50' : t.overflow ? 'bg-red-50' : ''}`}>
                            <td className="py-1">{t.courseName}</td>
                            <td className="text-center py-1">{t.credits}</td>
                            {reverseMode === 'predict' ? (
                              <>
                                <td className="text-center py-1">
                                  {(() => {
                                    const pc = predictCourses.find(p => p.id === t.courseId)
                                    return pc?.lockedScore ?? '—'
                                  })()}
                                </td>
                                <td className="text-center py-1 text-xs text-muted-foreground">
                                  {(() => {
                                    const pc = predictCourses.find(p => p.id === t.courseId)
                                    const score = pc?.lockedScore
                                    if (targetAlgo.type === 'grade') return displayMetric(pc?.lockedGP)
                                    return score == null ? '—' : displayMetric(scoreToGPA(score, targetAlgo))
                                  })()}
                                </td>
                                <td className="text-center py-1">
                                  <span style={{color: '#374151', fontWeight: 'bold'}}>{t.suggestedScore}</span>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className={`text-center py-1 ${t.boundaryGain ? 'text-green-600 font-medium' : ''}`}>
                                  {editingTargetId === t.courseId ? (
                                    <input
                                      className="w-14 rounded border border-blue-400 px-1 py-0.5 text-xs text-center bg-background"
                                      value={editTargetValue}
                                      autoFocus
                                      onChange={e => setEditTargetValue(e.target.value)}
                                      onBlur={() => {
                                        const v = parseFloat(editTargetValue)
                                        const orig = parseFloat(editTargetOriginalRef.current)
                                        if (!isNaN(v) && v >= 0 && v <= (reverseResult.inputUnit === 'gpa' ? targetAlgo.maxGPA : 100) && v !== orig) {
                                          toggleLockTarget(t.courseId, true, v)
                                        }
                                        setEditingTargetId(null)
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          const v = parseFloat(editTargetValue)
                                          const orig = parseFloat(editTargetOriginalRef.current)
                                          if (!isNaN(v) && v >= 0 && v <= (reverseResult.inputUnit === 'gpa' ? targetAlgo.maxGPA : 100) && v !== orig) {
                                            toggleLockTarget(t.courseId, true, v)
                                          }
                                          setEditingTargetId(null)
                                        }
                                        if (e.key === 'Escape') setEditingTargetId(null)
                                      }}
                                    />
                                  ) : (
                                    <span
                                      className={`cursor-text hover:bg-blue-50/50 rounded px-0.5 ${t.locked ? 'text-blue-600 font-medium' : ''}`}
                                      title={t.locked ? '已锁定，双击修改' : '双击编辑建议成绩'}
                                      onDoubleClick={() => {
                                        const val = String(t.locked ? (t.lockedValue ?? t.suggestedScore) : t.suggestedScore)
                                        setEditingTargetId(t.courseId)
                                        setEditTargetValue(val)
                                        editTargetOriginalRef.current = val
                                      }}
                                    >
                                      {t.currentScore ?? '—'} → <span style={{color: '#374151', fontWeight: 'bold'}}>{t.locked ? (t.lockedValue ?? t.suggestedScore) : t.suggestedScore}</span>
                                    </span>
                                  )}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex items-center justify-between mt-2 flex-wrap gap-1">
                  <div className="text-sm flex items-center gap-3">
                    {['GPA', '加权均分', '算术均分'].map((label, i) => <span key={label}>
                      {label} {displayMetric([reverseResult.estimatedGPA, reverseResult.estimatedWeightedAvg, reverseResult.estimatedArithAvg][i])}
                      {reverseResult.hasTarget && i === targetCardIndex && (reverseResult.achievable ? ' ✓' : '（未达标）')}
                    </span>)}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      onClick={runReverse}
                    >重新计算</button>
                    {reverseMode === 'retake' && (
                      <button
                        className="bg-primary text-primary-foreground px-3 py-1 rounded text-xs font-medium border-none cursor-pointer hover:bg-primary/90"
                        disabled={!retakeResult?.achievable} onClick={applyReverseTargets}
                      >一键应用到模拟成绩</button>
                    )}
                  </div>
                </div>

                {reverseResult.warningMessage && (
                  <div className="mt-2 rounded bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
                    ⚠️ {reverseResult.warningMessage}
                  </div>
                )}
              </div>
            )}
            {/* 重修模式：选择课程 */}
            {IS_BROWSER_MODE && reverseMode === 'retake' && (
              <details className="retake-picker"><summary>选择重修反推科目（已选 {selectedRetakeIds.size} 门）</summary><div className="text-sm">
                <div className="mb-2 text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>选择可以重修的科目：</span>
                  <button className="text-blue-600 hover:underline text-xs"
                    onClick={() => {
                      setSelectedRetakeIds(prev => prev.size === realCourses.length ? new Set() : new Set(realCourses.map(c => c.id)))
                    }}>全选/取消</button>
                  <span className="text-xs">已选: {selectedRetakeIds.size}门</span>
                  <div className="flex rounded-md overflow-hidden text-xs border border-border ml-1">
                    <button
                      className={`px-2 py-0.5 ${retakeSort === 'default' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      onClick={() => setRetakeSort('default')}
                    >📋 原顺序</button>
                    <button
                      className={`px-2 py-0.5 border-l ${retakeSort === 'lowScore' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
                      onClick={() => setRetakeSort('lowScore')}
                    >📉 低分在前</button>
                  </div>
                </div>
                <input className="w-full rounded border px-2 py-1 text-xs mb-2"
                  placeholder="搜索课程名..." value={retakeSearch} onChange={e => setRetakeSearch(e.target.value)} />
                <div className="overflow-auto space-y-1" style={{ maxHeight: '240px', minHeight: '200px' }}>
                  {(() => {
                    const filtered = realCourses.filter(c => !retakeSearch || c.courseName.includes(retakeSearch))
                    const sorted = retakeSort === 'lowScore'
                      ? [...filtered].sort((a, b) => (a.originalScore ?? Infinity) - (b.originalScore ?? Infinity))
                      : filtered
                    return sorted.map(c => (
                    <label key={c.id} className="flex items-center gap-2 py-0.5 hover:bg-accent/30 rounded px-1">
                      <input
                        type="checkbox"
                        checked={selectedRetakeIds.has(c.id)}
                        onChange={() => {
                          setSelectedRetakeIds(prev => {
                            const next = new Set(prev)
                            if (next.has(c.id)) next.delete(c.id)
                            else next.add(c.id)
                            return next
                          })
                        }}
                      />
                      <span>{c.courseName}</span>
                      <span className="text-xs text-muted-foreground">{c.credits}学分</span>
                      <span className="text-xs">{c.originalScore == null ? '—' : c.originalScore + '分'}</span>
                      <span className="text-xs text-muted-foreground">({c.originalScore == null ? '—' : scoreToGrade(c.originalScore, currentAlgo)})</span>
                    </label>
                  ))})()}
                </div>
                {selectedRetakeIds.size > 0 && (
                  <button
                    className="bg-primary text-primary-foreground px-4 py-1.5 rounded-lg text-sm font-medium border-none cursor-pointer hover:bg-primary/90 mt-2"
                    onClick={runReverse}
                  >🎯 开始反推</button>
                )}
              </div></details>
            )}
            </div>{/* content wrapper close */}
          </div>
        )}
    </div>
    )
  }

// ---- 成绩差距颜色（基于原始分数差） ----
// 规则：
//   成绩 > 目标成绩 0~5分(含5) → 青色
//   成绩 > 目标成绩 >5分(不含5) → 绿色
//   成绩 = 目标成绩 → 黑色
//   成绩 < 目标成绩 0~5分(含5) → 橙色
//   成绩 < 目标成绩 >5分(不含5) → 红色
function gapColor(currentScore: number, targetScore: number): string {
  const diff = currentScore - targetScore
  if (diff > 5) return '#16a34a'       // green  - 超过目标5分以上
  if (diff > 0) return '#0891b2'       // cyan   - 超过目标0~5分
  if (diff >= -5) return '#d97706'     // orange - 低于目标0~5分
  return '#dc2626'                      // red    - 低于目标5分以上
}

// GP 差距颜色：基于绩点差，与成绩列颜色规则一致
// 规则（绩点差≈分数差/10）：
//   绩点 > 目标 0~0.5(含0.5) → 青色
//   绩点 > 目标 >0.5(不含0.5) → 绿色
//   绩点 = 目标 → 黑色
//   绩点 < 目标 0~0.5(含0.5) → 橙色
//   绩点 < 目标 >0.5(不含0.5) → 红色
function gpGapColor(currentGP: number, targetGP: number): string {
  const diff = currentGP - targetGP
  if (diff > 0.5) return '#16a34a'       // green
  if (diff > 0) return '#0891b2'         // cyan
  if (diff >= -0.5) return '#d97706'     // orange
  return '#dc2626'                        // red
}

// ============================================================
// 子组件：单行课程 — 双击单元格直接编辑，模拟成绩用括号
// ============================================================

function CourseRow({
  course, algo, editingField, editValue,
  targetSuggestedScore, targetGPA,
  onStartEdit, onConfirmEdit, onCancelEdit,
  onDelete, onEditValueChange,
  isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
  isSelected, isDragging, onRowClick,
  availableGrades,
}: {
  course: ScoreRecord
  algo: AlgorithmConfig
  editingField: string | null
  editValue: string
  targetSuggestedScore: number | null
  targetGPA: number | null
  onStartEdit: (field: string, value: string) => void
  onConfirmEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onEditValueChange: (v: string) => void
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isSelected: boolean
  isDragging: boolean
  onRowClick: () => void
  availableGrades: string[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const SimulationControl = IS_BROWSER_MODE ? 'button' : 'span'
  const hasSim = course.simulatedScore != null
  const gp = displayMetric(courseGPA(course, 'originalScore', algo))
  const simulationShown = algo.type === 'grade' ? course.simulatedGP != null : hasSim
  const simGP = simulationShown ? displayMetric(courseGPA(course, 'simulatedScore', algo)) : null
  const hasGrades = algo.type !== 'grade' && availableGrades.length > 0
  const origGrade = hasGrades && course.originalScore != null ? scoreToGrade(course.originalScore, algo) : null
  const simGrade = hasGrades && hasSim ? scoreToGrade(course.simulatedScore!, algo) : null
  const fmt = (v: number | null | undefined) => v == null ? '—' : String(v)

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  /** 渲染双值单元格：原始值 (→模拟值) */
  const renderDualCell = (
    origField: string,
    simField: string,
    origValue: string,
    simValue: string | null,
    origDisplay: React.ReactNode,
    simDisplay: React.ReactNode,
    opts?: { origClass?: string; simClass?: string; origStyle?: React.CSSProperties; simStyle?: React.CSSProperties }
  ) => {
    // 正在编辑原始值
    if (editingField === origField) {
      return (
        <td className="py-1.5 text-center">
          <input ref={inputRef} className="w-14 rounded border border-blue-400 px-1 py-0.5 text-sm text-center bg-background"
            value={editValue} onChange={e => onEditValueChange(e.target.value)}
            onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
        </td>
      )
    }
    // 正在编辑模拟值
    if (editingField === simField) {
      return (
        <td className="py-1.5 text-center">
          <span className="text-muted-foreground text-xs mr-1">→</span>
          <input ref={inputRef} className="w-14 rounded border border-blue-400 px-1 py-0.5 text-sm text-center bg-background"
            value={editValue} onChange={e => onEditValueChange(e.target.value)}
            onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
        </td>
      )
    }
    // 显示模式
    return (
      <td className="py-1.5 text-center group">
        <span
          className={`cursor-text hover:bg-blue-50/50 rounded px-0.5 transition-colors ${opts?.origClass ?? ''} ${course.isCorrected ? 'text-orange-600' : ''}`}
          style={opts?.origStyle}
          title="双击编辑"
          onDoubleClick={() => onStartEdit(origField, origValue === '—' ? '' : origValue)}
        >{origDisplay}</span>
        <span className="text-muted-foreground text-[10px] mx-0.5">(→</span>
        <SimulationControl
          type={IS_BROWSER_MODE ? 'button' : undefined}
          className={`${IS_BROWSER_MODE ? 'bg-emerald-50 text-emerald-800 rounded px-2 py-1 hover:bg-emerald-100' : `cursor-text hover:bg-blue-50/50 rounded px-0.5 transition-colors ${simValue ? 'text-blue-600 font-medium' : 'text-muted-foreground'}`}`}
          style={opts?.simStyle}
          aria-label={IS_BROWSER_MODE ? `${course.courseName}模拟绩点` : undefined}
          title={IS_BROWSER_MODE ? '模拟绩点' : simValue ? '双击编辑模拟值' : '双击填写模拟值'}
          onClick={IS_BROWSER_MODE ? event => {
            event.stopPropagation()
            onStartEdit(simField, simValue || '')
          } : undefined}
          onDoubleClick={!IS_BROWSER_MODE ? () => onStartEdit(simField, simValue || '') : undefined}
        >{simValue || (IS_BROWSER_MODE ? '试算' : '—')}</SimulationControl>
        <span className="text-muted-foreground text-[10px]">)</span>
      </td>
    )
  }

  return (
    <tr
      className={`border-t transition-colors ${isSelected ? 'bg-indigo-50 border-l-2 border-l-indigo-400' : ''} ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-t-2 border-t-blue-500' : ''} ${hasSim ? 'bg-blue-50/30' : ''} ${!isSelected && course.isCorrected ? 'border-l-2 border-l-orange-400' : ''}`}
      draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
    >
      {/* 复选框 — 仅点击此处切换选中 */}
      <td className="py-1.5 text-center">
        <input type="checkbox" checked={isSelected} onChange={onRowClick} className="accent-indigo-500" />
      </td>

      {/* 拖拽手柄 */}
      <td className="py-1.5 text-center cursor-grab text-muted-foreground hover:text-foreground relative"
        title="拖拽排序" onClick={e => e.stopPropagation()}>
        ⠿
      </td>

      {/* 课程名（可编辑） */}
      {editingField === 'courseName' ? (
        <td className="py-1.5 pl-2">
          <input ref={inputRef} className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm bg-background"
            value={editValue} onChange={e => onEditValueChange(e.target.value)}
            onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
        </td>
      ) : (
        <td className="py-1.5 pl-2 font-medium text-sm cursor-text hover:bg-blue-50/50 rounded transition-colors"
          title="双击编辑" onDoubleClick={() => onStartEdit('courseName', course.courseName)}>
          {course.courseName}
        </td>
      )}

      {/* 性质（可编辑） */}
      {editingField === 'category' ? (
        <td className="py-1.5 text-center">
          <input ref={inputRef} className="w-14 rounded border border-blue-400 px-1 py-0.5 text-xs text-center bg-background"
            value={editValue} onChange={e => onEditValueChange(e.target.value)}
            onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
        </td>
      ) : (
        <td className="py-1.5 text-center text-muted-foreground text-xs cursor-text hover:bg-blue-50/50 rounded transition-colors"
          title="双击编辑" onDoubleClick={() => onStartEdit('category', course.category)}>
          {course.category}
        </td>
      )}

      {/* 学分（可编辑） */}
      {editingField === 'credits' ? (
        <td className="py-1.5 text-center">
          <input ref={inputRef} className="w-12 rounded border border-blue-400 px-1 py-0.5 text-xs text-center bg-background"
            value={editValue} onChange={e => onEditValueChange(e.target.value)}
            onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
        </td>
      ) : (
        <td className="py-1.5 text-center text-muted-foreground text-xs cursor-text hover:bg-blue-50/50 rounded transition-colors"
          title="双击编辑" onDoubleClick={() => onStartEdit('credits', String(course.credits))}>
          {String(course.credits)}
        </td>
      )}

      {/* 成绩 (→模拟) */}
      <td className="py-1.5 text-center group">
        {editingField === 'originalScore' ? (
          <div className="flex items-center justify-center gap-1">
            <input ref={inputRef} className="w-12 rounded border border-blue-400 px-1 py-0.5 text-sm text-center bg-background"
              value={editValue} onChange={e => onEditValueChange(e.target.value)}
              onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
            {hasGrades && (
              <select className="rounded border border-blue-400 px-0.5 py-0.5 text-xs bg-background"
                value={origGrade || ''}
                onChange={e => {
                  if (!e.target.value) return
                  const gpa = gradeToGPA(e.target.value, algo)
                  if (gpa != null) {
                    const repScore = gradeToScore(e.target.value, algo) ?? gpa
                    onEditValueChange(String(repScore))
                    onStartEdit('originalScore', String(repScore))
                  }
                }}
                onBlur={onConfirmEdit}>
                <option value="">—</option>
                {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
          </div>
        ) : editingField === 'simulatedScore' ? (
          <div className="flex items-center justify-center gap-1">
            <span className="text-muted-foreground text-xs">→</span>
            <input ref={inputRef} className="w-12 rounded border border-blue-400 px-1 py-0.5 text-sm text-center bg-background"
              value={editValue} onChange={e => onEditValueChange(e.target.value)}
              onBlur={onConfirmEdit} onKeyDown={e => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit() }} />
            {hasGrades && (
              <select className="rounded border border-blue-400 px-0.5 py-0.5 text-xs bg-background"
                value={simGrade || ''}
                onChange={e => {
                  if (!e.target.value) return
                  const gpa = gradeToGPA(e.target.value, algo)
                  if (gpa != null) {
                    const repScore = gradeToScore(e.target.value, algo) ?? gpa
                    onEditValueChange(String(repScore))
                    onStartEdit('simulatedScore', String(repScore))
                  }
                }}
                onBlur={onConfirmEdit}>
                <option value="">—</option>
                {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
          </div>
        ) : (
          <>
            <span
              className={`cursor-text hover:bg-blue-50/50 rounded px-0.5 transition-colors`}
              style={course.originalScore != null && targetSuggestedScore != null ? { color: gapColor(course.originalScore, targetSuggestedScore), fontWeight: '500' } : undefined}
              title="双击编辑"
              onDoubleClick={() => onStartEdit('originalScore', String(course.originalScore ?? ''))}
            >{fmt(course.originalScore)}</span>
            {hasGrades && origGrade && origGrade !== '-' && (
              <span className="text-[10px] text-indigo-500 ml-0.5 font-medium" title="双击可切换等级编辑">{origGrade}</span>
            )}
            <span className="text-muted-foreground text-[10px] mx-0.5">(→</span>
            <SimulationControl
              type={IS_BROWSER_MODE ? 'button' : undefined}
              className={`${IS_BROWSER_MODE ? 'bg-emerald-50 text-emerald-800 rounded px-2 py-1 hover:bg-emerald-100' : `cursor-text hover:bg-blue-50/50 rounded px-0.5 transition-colors ${hasSim ? 'font-medium' : 'text-muted-foreground'}`}`}
              style={hasSim && targetSuggestedScore != null ? { color: gapColor(course.simulatedScore!, targetSuggestedScore), fontWeight: '500' } : undefined}
              aria-label={IS_BROWSER_MODE ? `${course.courseName}模拟分数` : undefined}
              title={IS_BROWSER_MODE ? '模拟分数' : hasSim ? '双击编辑模拟值' : '双击填写模拟值'}
              onClick={IS_BROWSER_MODE ? event => {
                event.stopPropagation()
                onStartEdit('simulatedScore', hasSim ? String(course.simulatedScore) : '')
              } : undefined}
              onDoubleClick={!IS_BROWSER_MODE ? () => onStartEdit('simulatedScore', hasSim ? String(course.simulatedScore) : '') : undefined}
            >{IS_BROWSER_MODE && !hasSim ? '试算' : fmt(course.simulatedScore)}</SimulationControl>
            {hasGrades && hasSim && simGrade && simGrade !== '-' && (
              <span className="text-[10px] text-indigo-400 ml-0.5">{simGrade}</span>
            )}
            <span className="text-muted-foreground text-[10px]">)</span>
          </>
        )}
      </td>

      {/* 绩点 (→模拟) */}
      {renderDualCell(
        'gradePoint', 'simulatedGP',
        gp, simGP,
        <span>{gp}</span>,
        <span>{simGP}</span>,
        { origStyle: targetGPA != null ? { color: gpGapColor(parseFloat(gp), targetGPA), fontWeight: '500' } : undefined,
          simStyle: simGP != null && targetGPA != null ? { color: gpGapColor(parseFloat(simGP), targetGPA), fontWeight: '500' } : undefined }
      )}

      {/* 删除 */}
      <td className="py-1.5 text-center">
        <button className="rounded p-0.5 text-xs text-muted-foreground hover:text-red-500 hover:bg-accent"
          onClick={onDelete} title="删除此课程">⊖</button>
      </td>
    </tr>
  )
}

// ============================================================
// 子组件：统计卡片
// ============================================================

function StatCard({ label, value, highlight, diff, subtitle }: {
  label: string
  value: string
  highlight?: boolean
  diff?: number
  subtitle?: string
}) {
  return (
    <div className={`rounded-md border px-3 py-1.5 text-center min-w-[80px] ${highlight ? 'border-blue-300 bg-blue-50/50' : ''}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${highlight ? 'text-blue-600' : ''}`}>{value}</div>
      {diff !== undefined && diff !== 0 && (
        <div className={`text-[10px] ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {diff > 0 ? '+' : ''}{diff.toFixed(2)} {diff > 0 ? '▲' : '▼'}
        </div>
      )}
      {subtitle && (
        <div className="text-[9px] text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )
}
