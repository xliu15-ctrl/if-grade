/**
 * 智能导入标准模板
 * 定义所有类型映射、路径规则和转换函数
 * AI 解析时只需参考此文件，无需读取其他代码
 */

// ============================================================
// 1. 文件路径规则
// ============================================================

export const IMPORT_PATHS = {
  /** 导入预览文件（AI 解析结果） */
  preview: 'data/import_preview.json',

  /** 成绩管理文件（最终存储） */
  scores: 'data/scores.json',

  /** 知识库会话文件 */
  kbSession: '成绩知识库/.kb_session.json',

  /** 知识库文件夹模板 */
  kbFolder: (sessionId: string) => `成绩知识库/${sessionId}`,

  /** KB 文档副本路径 */
  kbPreview: (folder: string) => `${folder}/docs/import_preview.json`,

  /** KB 导入信息 */
  kbImportInfo: (folder: string) => `${folder}/import_info.json`,
} as const

// ============================================================
// 2. 类型定义（简化版，AI 解析时使用）
// ============================================================

/** 课程分类（合法值） */
export type CourseCategory =
  | '专业必修'
  | '专业选修'
  | '通识数理'
  | '大学英语'
  | '思政类'
  | '体育'
  | '军事理论'
  | '毕业设计'
  | '其他'

/** AI 解析输出格式（写入 import_preview.json） */
export interface ImportPreviewRecord {
  id: string                    // 唯一标识，格式：{prefix}-{序号}，如 bnbu-001
  courseName: string            // 课程名称，中英文用空格分隔
  credits: number               // 学分
  score: number                 // 数字成绩（百分制），S/U 等用 90 占位
  gradePoint?: number | null    // 绩点（每学分），S/U 等不计入 GPA 的课程为 null
  semester: number              // 学期，格式：YYYY-S，如 2025-2026-1
  category: CourseCategory      // 课程分类
  duplicateGroup: string | null // 重复课程组（用于去重），无重复为 null
}

/** 导入预览文件格式（import_preview.json） */
export interface ImportPreview {
  records: ImportPreviewRecord[]
  duplicateGroups: Record<string, {
    type: 'exact' | 'fuzzy'
    similarity?: number
    recordIds: string[]
  }>
  source: string                // 来源描述，如 "AI解析: 成绩单.pdf"
  requestId: string             // 请求 ID，用于匹配解析任务
}

/** 成绩管理记录格式（写入 scores.json） */
export interface ScoreRecord {
  id: string                    // 唯一标识，格式：import_{timestamp}_{index}
  courseName: string            // 课程名称
  credits: number               // 学分
  originalScore: number         // 原始成绩（从 ImportPreviewRecord.score 映射）
  simulatedScore: number | null // 模拟成绩（初始为 null）
  simulatedGP: number | null    // 模拟绩点（初始为 null）
  semester: number              // 学期
  category: string              // 课程分类
  source: 'manual' | 'import' | 'auto' // 来源，固定为 'import'
  isCorrected: boolean          // 是否已修正（初始为 false）
  order: number                 // 排序序号
  gradePoint?: number | null    // 绩点（从 ImportPreviewRecord.gradePoint 映射）
}

// ============================================================
// 3. 映射函数
// ============================================================

/**
 * 将 ImportPreviewRecord 转换为 ScoreRecord
 * @param preview - AI 解析结果
 * @param index - 记录索引
 * @param existingCount - 已有课程数量（用于计算 order）
 */
export function previewToScoreRecord(
  preview: ImportPreviewRecord,
  index: number,
  existingCount: number
): ScoreRecord {
  return {
    id: `import_${Date.now()}_${index}`,
    courseName: preview.courseName,
    credits: preview.credits,
    originalScore: preview.score,
    simulatedScore: null,
    simulatedGP: null,
    semester: preview.semester,
    category: preview.category,
    source: 'import',
    isCorrected: false,
    order: existingCount + index,
    gradePoint: preview.gradePoint ?? null,
  }
}

/**
 * 批量转换 ImportPreviewRecord 为 ScoreRecord
 * @param records - AI 解析结果数组
 * @param existingCount - 已有课程数量
 */
export function batchConvertToScoreRecords(
  records: ImportPreviewRecord[],
  existingCount: number
): ScoreRecord[] {
  return records.map((r, i) => previewToScoreRecord(r, i, existingCount))
}

// ============================================================
// 4. 成绩映射规则（字母 → 数字）
// ============================================================

/**
 * 绩点体系类型
 * - 'linear': 严格线性关系，公式 score = slope × gpa + intercept
 * - 'lookup': 非严格线性，需查 GRADE_TO_SCORE 表（如标准美制 4.0）
 * - 'unknown': 数据不足，无法判定
 */
export type GradingSystemType = 'linear' | 'lookup' | 'unknown'

export interface GradingSystem {
  type: GradingSystemType
  /** 线性公式: score = slope × gpa + intercept（仅 linear 类型有效） */
  slope: number | null
  intercept: number | null
  /** 观察到的最大 GPA（用于估算满分制） */
  gpaScale: number
  /** 拟合优度 R²（仅 linear 类型有效，越接近1越线性） */
  rSquared: number | null
}

/**
 * 从已有课程数据自动拟合绩点体系（线性回归）
 *
 * 策略：
 * 1. 收集所有「既有百分制分数又有绩点」的课程
 * 2. 用最小二乘法拟合 score = slope × gpa + intercept
 * 3. 若 R² > 0.995 → 判定为线性制，使用拟合公式
 * 4. 否则 → 回退查表模式
 *
 * @param pairs - {score, gradePoint} 数组，来自同时有分数和绩点的课程
 * @returns 检测到的绩点体系
 */
export function detectGradingSystem(
  pairs: Array<{ score: number; gradePoint: number }>
): GradingSystem {
  if (pairs.length < 5) {
    return { type: 'unknown', slope: null, intercept: null, gpaScale: 5.0, rSquared: null }
  }

  const n = pairs.length

  // 最小二乘线性回归: score = slope × gpa + intercept
  const sumX = pairs.reduce((s, p) => s + p.gradePoint, 0)
  const sumY = pairs.reduce((s, p) => s + p.score, 0)
  const sumXY = pairs.reduce((s, p) => s + p.gradePoint * p.score, 0)
  const sumX2 = pairs.reduce((s, p) => s + p.gradePoint * p.gradePoint, 0)
  const sumY2 = pairs.reduce((s, p) => s + p.score * p.score, 0)

  const denominator = n * sumX2 - sumX * sumX
  if (Math.abs(denominator) < 0.0001) {
    return { type: 'unknown', slope: null, intercept: null, gpaScale: 5.0, rSquared: null }
  }

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n

  // 计算 R²（决定系数）
  const meanY = sumY / n
  const ssRes = pairs.reduce((s, p) => {
    const predicted = slope * p.gradePoint + intercept
    return s + (p.score - predicted) ** 2
  }, 0)
  const ssTot = pairs.reduce((s, p) => s + (p.score - meanY) ** 2, 0)

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0

  // 估算满分制：取观察到的最大 GPA 向上取整到 0.5
  const maxGPA = Math.max(...pairs.map(p => p.gradePoint))
  const gpaScale = Math.ceil(maxGPA * 2) / 2 // 4.0, 4.5, 5.0, ...

  if (rSquared > 0.995) {
    return { type: 'linear', slope, intercept, gpaScale, rSquared }
  }

  // 非线性 → 回退查表模式
  return { type: 'lookup', slope: null, intercept: null, gpaScale, rSquared: null }
}

/**
 * 从绩点推导百分制分数（使用检测到的绩点体系）
 *
 * 优先级：
 * 1. 如果检测到线性公式 → 使用公式计算
 * 2. 否则回退到 GRADE_TO_SCORE 查表
 *
 * @param gradePoint - 绩点值
 * @param system - 检测到的绩点体系
 * @param letterGrade - 字母等级（回退查表时使用）
 * @returns 百分制分数
 */
export function deriveScoreFromGPA(
  gradePoint: number,
  system: GradingSystem,
  letterGrade?: string
): number {
  // 优先使用检测到的线性公式
  if (system.slope !== null && system.intercept !== null) {
    const score = Math.round(system.slope * gradePoint + system.intercept)
    return Math.min(100, Math.max(0, score))
  }

  // 回退到硬编码查表
  if (letterGrade && letterGrade in GRADE_TO_SCORE) {
    return GRADE_TO_SCORE[letterGrade]
  }

  // 最后兜底
  return Math.round(gradePoint * 20) // 粗略 5.0→100 估算
}

/** 字母成绩到百分制的映射（仅作兜底，优先使用 detectGradingSystem + deriveScoreFromGPA） */
export const GRADE_TO_SCORE: Record<string, number> = {
  'A': 95,
  'A-': 85,
  'B+': 82,
  'B': 75,
  'B-': 72,
  'C+': 68,
  'C': 65,
  'C-': 62,
  'D': 60,
  'F': 40,
  'S': 90,  // Satisfactory
  'U': 50,  // Unsatisfactory
  'W': 0,   // Withdraw
  'YR': 0,
  'NR': 0,
  'PR': 0,
}

/** 字母成绩到绩点的映射（每学分） */
export const GRADE_TO_GPA: Record<string, number | null> = {
  'A': 4.00,
  'A-': 3.70,
  'B+': 3.30,
  'B': 3.00,
  'B-': 2.70,
  'C+': 2.30,
  'C': 2.00,
  'C-': 1.70,
  'D': 1.00,
  'F': 0.00,
  'S': null,  // 不计入 GPA
  'U': null,
  'W': null,
  'YR': null,
  'NR': null,
  'PR': null,
}

// ============================================================
// 5. 请求 ID 生成规则
// ============================================================

/**
 * 生成请求 ID
 * 格式：{timestamp_base36}_{random_6chars}
 * 示例：msmkb8tl_303zb7
 */
export function generateRequestId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================
// 6. 知识库会话类型
// ============================================================

/** 知识库会话状态 */
export interface KBSession {
  activeSessionId: string
  activeFolder: string
  createdAt: string
  sourceFile: string
  status: 'pending' | 'completed' | 'error'
}

/** 知识库导入信息 */
export interface KBImportInfo {
  id: string
  name: string
  createdAt: string
  courseCount: number
  totalCredits: number
  semesterCount: number
  source: string
  sourceFile: string
}

// ============================================================
// 7. 使用示例（AI 解析时参考）
// ============================================================

/*
示例：解析含等级制课程的成绩单（自适应绩点体系）

1. 生成请求 ID
   const requestId = generateRequestId()

2. 解析 PDF，提取所有课程信息后，先检测绩点体系
   const numericPairs = records
     .filter(r => typeof r.score === 'number' && r.gradePoint != null)
     .map(r => ({ score: r.score, gradePoint: r.gradePoint! }))
   const system = detectGradingSystem(numericPairs)
   // R² > 0.995 → { type: 'linear', slope: 10, intercept: 50, gpaScale: 5.0 }
   // R² ≤ 0.995 → { type: 'lookup', ... } 回退查表

3. 对等级制课程，用 deriveScoreFromGPA 自动计算分数
   // 若 type='linear' → 用拟合公式（如 3.8×10+50=88）
   // 若 type='lookup' → 回退查 GRADE_TO_SCORE
   const score = deriveScoreFromGPA(3.8, system, 'B')

4. 构建 ImportPreviewRecord 数组
   const records: ImportPreviewRecord[] = [
     {
       id: 'course-001',
       courseName: '*CEET 200 Circuit Analysis I',
       credits: 3,
       score: deriveScoreFromGPA(3.8, system, 'B'),
       gradePoint: 3.8,
       semester: 2024-2025-2,
       category: '专业必修',
       duplicateGroup: null
     },
   ]

5. 写入 import_preview.json（后续步骤同前）
*/

// ============================================================
// 8. 常见问题
// ============================================================

/*
Q: score 和 gradePoint 的区别？
A: score 是百分制成绩（0-100），gradePoint 是绩点（0-4.0 或 null）
   - S/U 等课程：score=90, gradePoint=null
   - 普通课程：score=对应百分制, gradePoint=对应绩点

Q: semester 格式是什么？
A: YYYY-S，如 2025-2026-1 表示 2025-2026 学年第一学期

Q: category 有哪些合法值？
A: 专业必修、专业选修、通识数理、大学英语、思政类、体育、军事理论、毕业设计、其他

Q: 为什么需要 requestId？
A: 用于匹配解析任务，避免旧数据干扰新任务

Q: duplicateGroup 什么时候用？
A: 当同一门课程出现多次时（如重修），用 duplicateGroup 标记
*/
