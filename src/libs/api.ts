import type { ScoreRecord, ArchiveMeta, ArchiveManifest } from './types'

declare const __GPA_BROWSER_MODE__: boolean

export const IS_BROWSER_MODE = typeof __GPA_BROWSER_MODE__ !== 'undefined' && __GPA_BROWSER_MODE__

function browserFileKey(workspaceId: string, filePath: string): string {
  const basePath = new URL('.', window.location.href).pathname
  return `gpa-simulator:${basePath}:${workspaceId}:${filePath}`
}

// ============================================================
// 均分绩点模拟器 — API 封装
// ============================================================

/**
 * API 前缀：站点模式下（window.__SITE_API_PREFIX__ 由 site/server.mjs 注入）
 * 平台 API 需加 /.well-known/knodo-site-auth 前缀走站点授权；
 * 工作空间面板模式下为空字符串，直接调平台同源 API。
 */
export const API_PREFIX: string =
  typeof window !== 'undefined' && (window as any).__SITE_API_PREFIX__ ? (window as any).__SITE_API_PREFIX__ as string : ''

/** 站点模式标记：true 时隐藏依赖工作空间 AI/脚本桥的能力（AI 解析、反馈按钮等） */
export const IS_SITE_MODE: boolean = API_PREFIX !== ''

/** 统一响应格式 */
interface ApiResponse<T> {
  code: 'SUCCESS' | 'ERROR'
  data: T
  message?: string
  error?: string
}

/** 通用 fetch 封装 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_PREFIX}${path}`, { credentials: 'include', ...init })
  const json: ApiResponse<T> = await resp.json()
  if (!resp.ok || json.code !== 'SUCCESS') {
    throw new Error(json.error ?? json.message ?? `HTTP ${resp.status}`)
  }
  return json.data
}

/** 读取 JSON 文件内容 */
export async function readJSON<T>(workspaceId: string, filePath: string): Promise<T> {
  if (IS_BROWSER_MODE) {
    const value = localStorage.getItem(browserFileKey(workspaceId, filePath))
    if (value === null) throw new Error('HTTP 404: file not found')
    return JSON.parse(value) as T
  }
  const resp = await fetch(
    `${API_PREFIX}/api/v1/workspaces/${workspaceId}/files/content?filePath=${filePath}`,
    { credentials: 'include' }
  )
  if (!resp.ok) {
    // 404 = 文件不存在，其他状态码（401/403/500等）= 认证或服务端错误
    throw new Error(`HTTP ${resp.status}: ${resp.status === 404 ? 'file not found' : 'auth or server error'}`)
  }
  const text = await resp.text()
  return JSON.parse(text)
}

/** 写入 JSON 文件 */
export async function writeJSON(
  workspaceId: string,
  filePath: string,
  data: unknown
): Promise<void> {
  if (IS_BROWSER_MODE) {
    localStorage.setItem(browserFileKey(workspaceId, filePath), JSON.stringify(data))
    window.dispatchEvent(new CustomEvent('gpa-data-change', { detail: { workspaceId, filePath } }))
    return
  }
  await api(`/api/v1/workspaces/${workspaceId}/files/text-file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: filePath,
      content: JSON.stringify(data, null, 2),
    }),
  })
}

/** 初始化数据文件（如果不存在则创建；认证错误不覆盖已有数据） */
export async function ensureDataFile<T>(
  workspaceId: string,
  filePath: string,
  defaultValue: T
): Promise<T> {
  try {
    const data = await readJSON<T>(workspaceId, filePath)
    if (data === null) throw new Error('file not found')
    return data
  } catch (err) {
    const msg = String(err)
    // 只在文件确实不存在时初始化；认证/网络错误不覆盖数据
    if (msg.includes('file not found') || msg.includes('404')) {
      await writeJSON(workspaceId, filePath, defaultValue)
      return defaultValue
    }
    throw err  // 认证/网络错误向外抛出，由调用方重试
  }
}

/** 上传二进制文件 */
export async function uploadFile(
  workspaceId: string,
  blob: Blob,
  filePath: string
): Promise<void> {
  const formData = new FormData()
  formData.append('file', blob)
  formData.append('path', filePath)

  const resp = await fetch(
    `${API_PREFIX}/api/v1/workspaces/${workspaceId}/files/upload`,
    { method: 'POST', credentials: 'include', body: formData }
  )
  if (!resp.ok) {
    throw new Error(`Upload failed: HTTP ${resp.status}`)
  }
}

// ============================================================
// 存档管理 API
// ============================================================

const ARCHIVES_DIR = 'data/archives'
const MANIFEST_FILE = 'data/archives/manifest.json'
export const SCORES_FILE = 'data/scores.json'

/** 列出当前访问者可见的工作空间（站点模式下的空间选择器） */
export async function listWorkspaces<T = any>(): Promise<T[]> {
  const data = await api<{ list?: T[] } | T[]>('/api/v1/workspaces')
  return Array.isArray(data) ? data : (data.list ?? [])
}

// ============================================================
// 插件自动接入
// 应用模板（app.yaml）不带插件绑定；AI 能力（智能导入/PDF 报告等）
// 来自 if-grades-simulation 插件。面板挂载时自动检测并绑定，
// 让用户「装完应用模板即用」，无需手动 UI 操作。
// ============================================================

const GRADES_PLUGIN_NAME = 'if-grades-simulation'
/** 按名字查不到时的兜底 ID（easyops 组织内的原始插件） */
const GRADES_PLUGIN_FALLBACK_ID = 'cmsiv5pwq00wo5bqmjqux0r38'

let ensurePluginInFlight: Promise<void> | null = null

/**
 * 首次挂载：曾把随 App 分发的 skills/脚本写入用户工作空间（v1.0.23-1.0.28）。
 * v1.1.0 起改为「插件直达」：技能与脚本全部内置在 if-grades-simulation
 * 插件里（/plugins/<name>/），不进用户空间，避免核心提示词/源码暴露。
 * 此函数保留为清理入口：删除历史版本写入的文件（幂等，404 忽略）。
 */
async function removeLegacyBundledAssets(workspaceId: string): Promise<void> {
  const assets = typeof __GPA_BROWSER_MODE__ !== 'undefined' && __GPA_BROWSER_MODE__
    ? null
    : await import('./bundled-assets')
  if (!assets) return
  const { BUNDLED_SKILLS, BUNDLED_SCRIPTS } = assets
  const all: Record<string, string> = { ...BUNDLED_SKILLS, ...BUNDLED_SCRIPTS }
  await Promise.all(
    Object.keys(all).map(path =>
      fetch(
        `${API_PREFIX}/api/v1/workspaces/${workspaceId}/files/delete?filePath=${encodeURIComponent(path)}`,
        { method: 'DELETE', credentials: 'include' }
      ).catch(() => {}) // 已删/不存在 → 忽略
    )
  )
}

/** 初始化状态（供面板引导横幅展示） */
export interface SetupStatus {
  /** 插件已绑定（AI 能力可用） */
  pluginBound: boolean
}

/** 初始化是否完成（横幅消失条件） */
export function isSetupDone(s: SetupStatus | null | undefined): boolean {
  return !!s && s.pluginBound
}

/**
 * 确保当前空间已绑定成绩插件（幂等）。
 * v1.1.0 架构：技能/脚本内置插件（/plugins/if-grades-simulation/），
 * 绑定后新对话即可用 /smart-import 等命令；用户空间零文件写入。
 * 同时清理历史版本（v1.0.23-28）写入用户空间的技能/脚本文件。
 * 记忆 key 带 v3 前缀：v2 记忆只覆盖「文件+插件」，本版只关心插件。
 */
export async function ensureGradesPlugin(workspaceId: string): Promise<SetupStatus> {
  if (IS_BROWSER_MODE) return { pluginBound: true }
  const cacheKey = `gpa_plugin_ok_v3_${workspaceId}`
  try {
    if (localStorage.getItem(cacheKey)) return { pluginBound: true }
  } catch { /* localStorage 不可用时跳过缓存 */ }

  if (ensurePluginInFlight) return ensurePluginInFlight as Promise<SetupStatus>
  ensurePluginInFlight = (async (): Promise<SetupStatus> => {
    let bound = false
    try {
      // 0. 清理历史版本写入的文件（不阻塞主流程）
      removeLegacyBundledAssets(workspaceId).catch(() => {})
      // 1. 已绑定？按插件名判断（跨组织拷贝后 ID 会变，名字不变）
      const list = await api<any[]>(`/api/v1/workspaces/${workspaceId}/plugins`)
      const boundList = Array.isArray(list) ? list : (list?.list ?? [])
      bound = boundList.some((b: any) => b?.plugin?.name === GRADES_PLUGIN_NAME)
      // 2. 未绑定 → 查插件 ID 并绑定
      if (!bound) {
        let pluginId = GRADES_PLUGIN_FALLBACK_ID
        try {
          const orgPlugins = await api<any[]>('/api/v1/plugins')
          const orgList = Array.isArray(orgPlugins) ? orgPlugins : (orgPlugins?.list ?? [])
          const found = orgList.find((p: any) => p?.name === GRADES_PLUGIN_NAME)
          if (found?.id) pluginId = found.id
        } catch { /* 查询失败用兜底 ID 直接尝试 */ }
        const resp = await fetch(
          `${API_PREFIX}/api/v1/workspaces/${workspaceId}/plugins`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluginId }),
          }
        )
        bound = resp.ok || resp.status === 409
      }
      if (bound) {
        try { localStorage.setItem(cacheKey, '1') } catch {}
      }
    } catch {
      /* 静默降级：横幅会给手动指引 */
    } finally {
      ensurePluginInFlight = null
    }
    return { pluginBound: bound }
  })()
  return ensurePluginInFlight as Promise<SetupStatus>
}

/** 删除文件 */
export async function deleteFile(workspaceId: string, filePath: string): Promise<void> {
  if (IS_BROWSER_MODE) {
    localStorage.removeItem(browserFileKey(workspaceId, filePath))
    return
  }
  const resp = await fetch(
    `${API_PREFIX}/api/v1/workspaces/${workspaceId}/files/delete?filePath=${encodeURIComponent(filePath)}`,
    { method: 'DELETE', credentials: 'include' }
  )
  if (!resp.ok) {
    throw new Error(`Delete failed: HTTP ${resp.status}`)
  }
}

/** 清理知识库文件夹（递归删除已知文件 + 尝试删目录） */
async function cleanKBFolder(workspaceId: string, folder: string, sourceFile?: string): Promise<void> {
  // 如果未提供 sourceFile，尝试从文件夹自身的 import_info.json 读取
  if (!sourceFile) {
    try {
      const info = await readJSON<{ sourceFile?: string }>(workspaceId, `${folder}/import_info.json`)
      sourceFile = info?.sourceFile || undefined
    } catch { /* import_info.json 可能不存在 */ }
  }

  // 删除已知子文件（逐个清理，确保目录可删）
  await deleteFile(workspaceId, `${folder}/import_info.json`).catch(() => {})
  await deleteFile(workspaceId, `${folder}/docs/import_preview.json`).catch(() => {})
  if (sourceFile) {
    await deleteFile(workspaceId, `${folder}/originals/${sourceFile}`).catch(() => {})
  }
  // 尝试删除子目录（platform API 可能支持空目录删除）
  await deleteFile(workspaceId, `${folder}/originals`).catch(() => {})
  await deleteFile(workspaceId, `${folder}/docs`).catch(() => {})
  await deleteFile(workspaceId, `${folder}/reports`).catch(() => {})
  // 最后尝试删除整个目录
  await deleteFile(workspaceId, folder).catch(() => {})
}

/** 读取或初始化存档清单 */
export async function ensureManifest(workspaceId: string): Promise<ArchiveManifest> {
  return ensureDataFile<ArchiveManifest>(workspaceId, MANIFEST_FILE, { archives: [] })
}

/** 生成存档文件名 slug */
export function archiveSlug(name: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const safe = name.replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 30)
  return `${ts}_${safe}`
}

/** 新建存档 */
export async function saveArchive(
  workspaceId: string,
  scores: ScoreRecord[],
  name: string
): Promise<ArchiveMeta> {
  const manifest = await ensureManifest(workspaceId)
  const slug = archiveSlug(name)
  const fileName = `${ARCHIVES_DIR}/${slug}.json`

  await writeJSON(workspaceId, fileName, scores)

  const semesters = new Set(scores.map(c => c.semester))
  // 读取当前知识库会话，关联KB文件夹
  let kbFolder: string | undefined
  let kbEntryId: string | undefined
  try {
    const session = await readJSON<{ activeFolder?: string; activeSessionId?: string }>(workspaceId, '成绩知识库/.kb_session.json')
    kbFolder = session?.activeFolder
    kbEntryId = session?.activeSessionId
  } catch {}

  const meta: ArchiveMeta = {
    id: `arch_${Date.now()}`,
    name,
    slug,
    fileName,
    createdAt: new Date().toISOString(),
    courseCount: scores.length,
    totalCredits: Math.round(scores.reduce((s, c) => s + c.credits, 0) * 100) / 100,
    semesterCount: semesters.size,
    kbFolder,
    kbEntryId,
  }

  manifest.archives.push(meta)
  await writeJSON(workspaceId, MANIFEST_FILE, manifest)
  return meta
}

/** 恢复存档（写入 scores.json 并返回数据） */
export async function restoreArchive(
  workspaceId: string,
  meta: ArchiveMeta
): Promise<ScoreRecord[]> {
  const data = await readJSON<ScoreRecord[]>(workspaceId, meta.fileName)
  await writeJSON(workspaceId, SCORES_FILE, data)
  return data
}

/** 删除存档 */
export async function deleteArchiveById(
  workspaceId: string,
  archiveId: string
): Promise<void> {
  const manifest = await ensureManifest(workspaceId)
  const entry = manifest.archives.find(a => a.id === archiveId)
  if (!entry) return

  // 尝试删除存档文件，失败则忽略（仅删 manifest 条目）
  try { await deleteFile(workspaceId, entry.fileName) } catch {}

  // 尝试删除关联的知识库文件夹
  // 优先用 kbFolder，若为空则用 kbEntryId 从 manifest 兜底查找当前路径
  let kbFolder = entry.kbFolder
  if (!kbFolder && entry.kbEntryId) {
    try {
      const kbManifest = await readJSON<{ entries?: Array<{ id: string; folder: string }> }>(workspaceId, '成绩知识库/manifest.json')
      kbFolder = kbManifest?.entries?.find(e => e.id === entry.kbEntryId)?.folder
    } catch {}
  }
  if (kbFolder) {
    await cleanKBFolder(workspaceId, kbFolder)
    // 同步更新知识库 manifest，移除对应条目
    try {
      const kbManifest = await readJSON<{ entries?: Array<{ id?: string; folder?: string }> }>(workspaceId, '成绩知识库/manifest.json')
      if (kbManifest?.entries) {
        kbManifest.entries = kbManifest.entries.filter(e =>
          e.folder !== kbFolder && e.id !== entry.kbEntryId
        )
        await writeJSON(workspaceId, '成绩知识库/manifest.json', kbManifest)
      }
    } catch {}
    // 如果删除的是当前活跃会话，清空 kb_session.json
    try {
      const session = await readJSON<{ activeFolder?: string; activeSessionId?: string }>(workspaceId, '成绩知识库/.kb_session.json')
      if (session?.activeFolder === kbFolder || session?.activeSessionId === entry.kbEntryId) {
        await writeJSON(workspaceId, '成绩知识库/.kb_session.json', {})
      }
    } catch {}
  }

  manifest.archives = manifest.archives.filter(a => a.id !== archiveId)
  await writeJSON(workspaceId, MANIFEST_FILE, manifest)
}

/** 覆盖存档数据 */
export async function overwriteArchive(
  workspaceId: string,
  archiveId: string,
  scores: ScoreRecord[]
): Promise<void> {
  const manifest = await ensureManifest(workspaceId)
  const entry = manifest.archives.find(a => a.id === archiveId)
  if (!entry) return

  await writeJSON(workspaceId, entry.fileName, scores)

  const semesters = new Set(scores.map(c => c.semester))
  entry.courseCount = scores.length
  entry.totalCredits = Math.round(scores.reduce((s, c) => s + c.credits, 0) * 100) / 100
  entry.semesterCount = semesters.size
  await writeJSON(workspaceId, MANIFEST_FILE, manifest)
}

/** 重命名存档（仅修改 manifest 中的 name 字段） */
export async function renameArchive(
  workspaceId: string,
  archiveId: string,
  newName: string
): Promise<void> {
  const manifest = await ensureManifest(workspaceId)
  const entry = manifest.archives.find(a => a.id === archiveId)
  if (!entry) throw new Error('存档不存在')
  entry.name = newName
  await writeJSON(workspaceId, MANIFEST_FILE, manifest)
}

// ============================================================
// 知识库 API — 导入成绩单时自动创建分析报告目录
// ============================================================

const KB_DIR = '成绩知识库'
const KB_MANIFEST = '成绩知识库/manifest.json'

export interface KBMeta {
  id: string
  name: string                     // 导入批次名称
  createdAt: string                // ISO 时间戳
  courseCount: number
  totalCredits: number
  semesterCount: number
  source: string                   // 导入来源（Excel/PDF/手动等）
  sourceFile: string | null        // 原始上传文件名（用于追溯）
  folder: string                   // 知识库子目录路径
  reportCount: number              // 已生成报告数
  lastReportAt: string | null      // 最近报告生成时间
}

export interface KBManifest {
  entries: KBMeta[]
}

/** 读取或初始化知识库清单 */
export async function ensureKBManifest(workspaceId: string): Promise<KBManifest> {
  return ensureDataFile<KBManifest>(workspaceId, KB_MANIFEST, { entries: [] })
}

// ============================================================
// KB 会话管理 — 上传文件时立即创建文件夹
// ============================================================

const KB_SESSION_FILE = '成绩知识库/.kb_session.json'

export interface KBSession {
  activeSessionId: string
  activeFolder: string
  createdAt: string
  sourceFile: string
  status: 'pending' | 'imported' | 'reported'
}

/** 读取当前 KB 会话 */
export async function readKBSession(workspaceId: string): Promise<KBSession | null> {
  try {
    return await readJSON<KBSession>(workspaceId, KB_SESSION_FILE)
  } catch {
    return null
  }
}

/** 创建 KB 会话 — 文件上传分析时立即调用，不等导入完成 */
export async function createKBSession(
  workspaceId: string,
  sourceFileName: string
): Promise<KBSession> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const safeName = sourceFileName.replace(/\.[^.]+$/, '').replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 20) || 'import'
  const folder = `${KB_DIR}/${safeName}_${ts}`
  const id = `kb_${Date.now()}`

  // 写入占位 import_info（课程数据待导入后更新）
  await writeJSON(workspaceId, `${folder}/import_info.json`, {
    id,
    name: safeName,
    createdAt: now.toISOString(),
    courseCount: 0,
    totalCredits: 0,
    semesterCount: 0,
    source: 'pending',
    sourceFile: sourceFileName,
  })

  const session: KBSession = {
    activeSessionId: id,
    activeFolder: folder,
    createdAt: now.toISOString(),
    sourceFile: sourceFileName,
    status: 'pending',
  }

  // 立即注册到 manifest（避免 AI skill 读不到条目）
  const manifest = await ensureKBManifest(workspaceId)
  const meta: KBMeta = {
    id, name: safeName,
    createdAt: now.toISOString(),
    courseCount: 0, totalCredits: 0, semesterCount: 0,
    source: 'pending', sourceFile: sourceFileName, folder,
    reportCount: 0, lastReportAt: null,
  }
  if (!manifest.entries.find(e => e.id === id)) {
    manifest.entries.push(meta)
  }
  await writeJSON(workspaceId, KB_MANIFEST, manifest)

  await writeJSON(workspaceId, KB_SESSION_FILE, session)
  return session
}

/** 导入完成后更新 KB 会话和清单 */
export async function finalizeKBSession(
  workspaceId: string,
  courseCount: number,
  totalCredits: number,
  semesterCount: number,
  source: string
): Promise<void> {
  const session = await readKBSession(workspaceId)
  if (!session) return

  // 更新 import_info.json
  const infoPath = `${session.activeFolder}/import_info.json`
  try {
    const info = await readJSON<any>(workspaceId, infoPath)
    if (info) {
      info.courseCount = courseCount
      info.totalCredits = Math.round(totalCredits * 100) / 100
      info.semesterCount = semesterCount
      info.source = source
      await writeJSON(workspaceId, infoPath, info)
    }
  } catch { /* ignore */ }

  // 更新 manifest
  const manifest = await ensureKBManifest(workspaceId)
  const existing = manifest.entries.find(e => e.id === session.activeSessionId)
  const meta: KBMeta = {
    id: session.activeSessionId,
    name: session.activeFolder.split('_').slice(1).join('_') || 'import',
    createdAt: session.createdAt,
    courseCount,
    totalCredits: Math.round(totalCredits * 100) / 100,
    semesterCount,
    source,
    sourceFile: session.sourceFile,
    folder: session.activeFolder,
    reportCount: existing?.reportCount ?? 0,
    lastReportAt: existing?.lastReportAt ?? null,
  }
  if (existing) {
    Object.assign(existing, meta)
  } else {
    manifest.entries.push(meta)
  }
  await writeJSON(workspaceId, KB_MANIFEST, manifest)

  // 更新会话状态
  session.status = 'imported'
  await writeJSON(workspaceId, KB_SESSION_FILE, session)
}

/** 存储文档到当前 KB 会话文件夹 */
export async function saveToKBSession(
  workspaceId: string,
  docName: string,
  data: unknown
): Promise<string> {
  const session = await readKBSession(workspaceId)
  if (!session) throw new Error('没有活跃的 KB 会话')

  const safeName = docName.replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 50) || 'document'
  const filePath = `${session.activeFolder}/docs/${safeName}.json`
  await writeJSON(workspaceId, filePath, data)
  return filePath
}

/** 创建知识库条目（导入成绩单时调用） */
export async function createKBEntry(
  workspaceId: string,
  name: string,
  courseCount: number,
  totalCredits: number,
  semesterCount: number,
  source: string,
  sourceFile?: string | null
): Promise<KBMeta> {
  const manifest = await ensureKBManifest(workspaceId)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const id = `kb_${Date.now()}`
  const folder = `${KB_DIR}/${name.replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 20) || 'import'}_${ts}`

  const meta: KBMeta = {
    id,
    name,
    createdAt: now.toISOString(),
    courseCount,
    totalCredits: Math.round(totalCredits * 100) / 100,
    semesterCount,
    source,
    sourceFile: sourceFile || null,
    folder,
    reportCount: 0,
    lastReportAt: null,
  }

  // 创建知识库目录下的 info 文件
  await writeJSON(workspaceId, `${folder}/import_info.json`, {
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    courseCount: meta.courseCount,
    totalCredits: meta.totalCredits,
    semesterCount: meta.semesterCount,
    source: meta.source,
    sourceFile: meta.sourceFile,
  })

  manifest.entries.push(meta)
  await writeJSON(workspaceId, KB_MANIFEST, manifest)
  return meta
}

/** 更新知识库条目的报告计数 */
export async function updateKBReportCount(
  workspaceId: string,
  entryId: string,
  reportCount: number
): Promise<void> {
  const manifest = await ensureKBManifest(workspaceId)
  const entry = manifest.entries.find(e => e.id === entryId)
  if (!entry) return
  entry.reportCount = reportCount
  entry.lastReportAt = new Date().toISOString()
  await writeJSON(workspaceId, KB_MANIFEST, manifest)
}

/** 向知识库条目写入分析报告 */
export async function saveKBReport(
  workspaceId: string,
  entryFolder: string,
  reportName: string,
  reportData: unknown
): Promise<string> {
  const safeName = reportName.replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 50) || 'report'
  const filePath = `${entryFolder}/reports/${safeName}.json`
  await writeJSON(workspaceId, filePath, reportData)
  return filePath
}

/** 获取知识库条目下的所有报告列表 */
export async function listKBReports(
  workspaceId: string,
  entryId: string
): Promise<string[]> {
  const manifest = await ensureKBManifest(workspaceId)
  const entry = manifest.entries.find(e => e.id === entryId)
  if (!entry) return []
  try {
    // 尝试读取报告目录，如果不存在则返回空
    const data = await readJSON<any[]>(workspaceId, `${entry.folder}/reports/manifest.json`)
    return data?.map((r: any) => r.name) || []
  } catch {
    return []
  }
}

/** 同步知识库清单：验证每个条目对应的文件夹是否存在，清除孤立和废弃条目 */
export async function syncKBManifest(workspaceId: string): Promise<KBManifest> {
  const manifest = await ensureKBManifest(workspaceId)
  const validEntries: KBMeta[] = []
  const now = Date.now()
  const ABANDON_THRESHOLD = 2 * 60 * 60 * 1000 // 2小时：pending 未完成导入视为废弃

  for (const entry of manifest.entries) {
    // 1. 清理废弃条目：pending + courseCount为0 + 超过24小时 = 上传后从未完成导入
    if (entry.source === 'pending' && entry.courseCount === 0) {
      const age = now - new Date(entry.createdAt).getTime()
      if (age > ABANDON_THRESHOLD) {
        continue // 跳过此条目（不保留）
      }
    }

    // 2. 验证文件夹是否仍然存在（通过读取 import_info.json）
    try {
      await readJSON(workspaceId, `${entry.folder}/import_info.json`)
      validEntries.push(entry)
    } catch {
      // 文件夹已被删除，跳过此条目
      continue
    }
  }

  // 如果有变化，写回清理后的清单
  if (validEntries.length !== manifest.entries.length) {
    manifest.entries = validEntries
    await writeJSON(workspaceId, KB_MANIFEST, manifest)
  }

  return manifest
}
