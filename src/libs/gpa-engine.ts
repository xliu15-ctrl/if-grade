// ============================================================
// 均分绩点模拟器 — GPA 计算引擎（前端版）
// ============================================================

import type {
  ScoreRecord, AlgorithmConfig, ScoreGpaMapping,
  CourseCategory, SemesterStats, ReverseTarget, ReverseResult,
  WESConfig,
} from './types'
import { SEMESTER_LABELS } from './types'

// ============================================================
// 预设算法库
// ============================================================

// ============================================================
// 预设算法库
// ============================================================

/** 标准 4.0（美国标准分段制，ChaseDream 常用对照表） */
const STANDARD_4_0: AlgorithmConfig = {
  id: 'standard_4.0',
  name: '标准 4.0',
  description: '美国/ChaseDream 常用分段对照表：90+=4.0, 85+=3.7 ... 60+=1.0',
  type: 'segmented',
  maxGPA: 4.0,
  precision: 2,
  mapping: [
    { min: 90, max: 100, gpa: 4.0, grade: 'A' },
    { min: 85, max: 89, gpa: 3.7, grade: 'A-' },
    { min: 82, max: 84, gpa: 3.3, grade: 'B+' },
    { min: 78, max: 81, gpa: 3.0, grade: 'B' },
    { min: 75, max: 77, gpa: 2.7, grade: 'B-' },
    { min: 72, max: 74, gpa: 2.3, grade: 'C+' },
    { min: 68, max: 71, gpa: 2.0, grade: 'C' },
    { min: 64, max: 67, gpa: 1.5, grade: 'C-' },
    { min: 60, max: 63, gpa: 1.0, grade: 'D' },
    { min: 0, max: 59, gpa: 0, grade: 'F' },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** 北京大学 4.0 — 连续公式法（学信网标准算法二） */
const PKU_4_0: AlgorithmConfig = {
  id: 'pku_4.0',
  name: '北大 4.0（连续公式）',
  description: '北京大学：GPA = 4 - 3×(100-成绩)²/1600，60≤成绩≤100；<60=0。注：2025级起新生已废除GPA改用等级制',
  type: 'continuous',
  maxGPA: 4.0,
  precision: 2,
  mapping: [
    { min: 0, max: 100, gpa: 0 },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
  formula: { a: 4, b: 3, c: 100 },
}

/** 清华大学 4.0 — 12级字母等级制（2015级起） */
const TSINGHUA_4_0: AlgorithmConfig = {
  id: 'tsinghua_4.0',
  name: '清华 4.0（12级等级制）',
  description: '清华大学2015级起：12级字母等级 A+=4.0, A=4.0, A-=3.7, B+=3.6, B=3.3, B-=3.0, C+=2.6, C=2.3, C-=2.0, D+=1.6, D=1.3, F=0',
  type: 'segmented',
  maxGPA: 4.0,
  precision: 2,
  mapping: [
    { min: 100, max: 100, gpa: 4.0, grade: 'A+' },  // 对等百分 100
    { min: 93, max: 99, gpa: 4.0, grade: 'A' },      // 对等百分 98
    { min: 88, max: 92, gpa: 3.7, grade: 'A-' },     // 对等百分 92
    { min: 84, max: 87, gpa: 3.6, grade: 'B+' },     // 对等百分 87
    { min: 80, max: 83, gpa: 3.3, grade: 'B' },      // 对等百分 82
    { min: 76, max: 79, gpa: 3.0, grade: 'B-' },     // 对等百分 78
    { min: 73, max: 75, gpa: 2.6, grade: 'C+' },     // 对等百分 75
    { min: 70, max: 72, gpa: 2.3, grade: 'C' },      // 对等百分 71
    { min: 67, max: 69, gpa: 2.0, grade: 'C-' },     // 对等百分 68
    { min: 64, max: 66, gpa: 1.6, grade: 'D+' },     // 对等百分 65
    { min: 61, max: 63, gpa: 1.3, grade: 'D' },      // 对等百分 61
    { min: 0, max: 60, gpa: 0, grade: 'F' },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** 上海交通大学 4.3 — 10段分段制 */
const SJTU_4_3: AlgorithmConfig = {
  id: 'sjtu_4.3',
  name: '上海交大 4.3',
  description: '上海交通大学本科生：A+ 95-100=4.3, A 90-94=4.0, B+ 85-89=3.7 ... D 60-64=1.3, F=0',
  type: 'segmented',
  maxGPA: 4.3,
  precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 4.3, grade: 'A+' },
    { min: 90, max: 94, gpa: 4.0, grade: 'A' },
    { min: 85, max: 89, gpa: 3.7, grade: 'B+' },
    { min: 82, max: 84, gpa: 3.3, grade: 'B' },
    { min: 78, max: 81, gpa: 3.0, grade: 'B-' },
    { min: 75, max: 77, gpa: 2.7, grade: 'C+' },
    { min: 72, max: 74, gpa: 2.3, grade: 'C' },
    { min: 68, max: 71, gpa: 2.0, grade: 'C-' },
    { min: 65, max: 67, gpa: 1.7, grade: 'D' },
    { min: 60, max: 64, gpa: 1.3, grade: 'D-' },
    { min: 0, max: 59, gpa: 0, grade: 'F' },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** 中科大 4.3 — 13段分段制（国内最细） */
const USTC_4_3: AlgorithmConfig = {
  id: 'ustc_4.3',
  name: '中科大 4.3（13段）',
  description: '中国科学技术大学：100-95=4.3, 94-90=4.0, 89-85=3.7 ... 60=1.0, <60=0',
  type: 'segmented',
  maxGPA: 4.3,
  precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 4.3 },
    { min: 90, max: 94, gpa: 4.0 },
    { min: 85, max: 89, gpa: 3.7 },
    { min: 82, max: 84, gpa: 3.3 },
    { min: 78, max: 81, gpa: 3.0 },
    { min: 75, max: 77, gpa: 2.7 },
    { min: 72, max: 74, gpa: 2.3 },
    { min: 68, max: 71, gpa: 2.0 },
    { min: 65, max: 67, gpa: 1.7 },
    { min: 64, max: 64, gpa: 1.5 },
    { min: 61, max: 63, gpa: 1.3 },
    { min: 60, max: 60, gpa: 1.0 },
    { min: 0, max: 59, gpa: 0 },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** 浙江大学 5.0 — 国内成绩单分段制 */
const ZJU_5_0: AlgorithmConfig = {
  id: 'zju_5.0',
  name: '浙大 5.0（国内）',
  description: '浙江大学国内成绩单：95-100=5.0, 92-94=4.8, 89-91=4.5, 86-88=4.2, 83-85=3.9, 80-82=3.6, 77-79=3.3, 74-76=3.0, 71-73=2.7, 68-70=2.4, 65-67=2.1, 62-64=1.8, 60-61=1.5, <60=0',
  type: 'segmented',
  maxGPA: 5.0,
  precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 5.0 },
    { min: 92, max: 94, gpa: 4.8 },
    { min: 89, max: 91, gpa: 4.5 },
    { min: 86, max: 88, gpa: 4.2 },
    { min: 83, max: 85, gpa: 3.9 },
    { min: 80, max: 82, gpa: 3.6 },
    { min: 77, max: 79, gpa: 3.3 },
    { min: 74, max: 76, gpa: 3.0 },
    { min: 71, max: 73, gpa: 2.7 },
    { min: 68, max: 70, gpa: 2.4 },
    { min: 65, max: 67, gpa: 2.1 },
    { min: 62, max: 64, gpa: 1.8 },
    { min: 60, max: 61, gpa: 1.5 },
    { min: 0, max: 59, gpa: 0 },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** 浙江大学 4.3 — 出国成绩单（2022级起） */
const ZJU_4_3: AlgorithmConfig = {
  id: 'zju_4.3',
  name: '浙大 4.3（出国）',
  description: '浙江大学出国成绩单（2022级起）：95-100=4.3, 92-94=4.2, 89-91=4.1 ... <60=0',
  type: 'segmented',
  maxGPA: 4.3,
  precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 4.3 },
    { min: 92, max: 94, gpa: 4.2 },
    { min: 89, max: 91, gpa: 4.1 },
    { min: 86, max: 88, gpa: 4.0 },
    { min: 83, max: 85, gpa: 3.9 },
    { min: 80, max: 82, gpa: 3.8 },
    { min: 77, max: 79, gpa: 3.7 },
    { min: 74, max: 76, gpa: 3.6 },
    { min: 71, max: 73, gpa: 3.5 },
    { min: 68, max: 70, gpa: 3.4 },
    { min: 65, max: 67, gpa: 3.3 },
    { min: 62, max: 64, gpa: 3.2 },
    { min: 60, max: 61, gpa: 3.0 },
    { min: 0, max: 59, gpa: 0 },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** 5.0 线性制（简单线性映射 GPA = 成绩/10 - 5） */
const FIVE_POINT_LINEAR: AlgorithmConfig = {
  id: 'five_point',
  name: '5.0 线性制',
  description: '简单五分制线性映射：GPA = 成绩/10 - 5，100=5.0, 60=1.0',
  type: 'linear',
  maxGPA: 5.0,
  precision: 2,
  mapping: [
    { min: 0, max: 100, gpa: 0 },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** WES 4.0 — 留学认证标准 */
const WES_4_0: AlgorithmConfig = {
  id: 'wes_4.0',
  name: 'WES 标准',
  description: 'WES 留学认证标准：85+=A(4.0), 75-84=B(3.0), 60-74=C(2.0), <60=F(0)',
  type: 'segmented',
  maxGPA: 4.0,
  precision: 2,
  mapping: [
    { min: 85, max: 100, gpa: 4.0, grade: 'A' },
    { min: 75, max: 84, gpa: 3.0, grade: 'B' },
    { min: 60, max: 74, gpa: 2.0, grade: 'C' },
    { min: 0, max: 59, gpa: 0, grade: 'F' },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

/** BNBU/HKBU 4.0 — 等级制 */
const BNBU_4_0: AlgorithmConfig = {
  id: 'bnbu_4.0',
  name: 'BNBU/HKBU 4.0',
  description: '北师港浸大/HKBU 等级制：A=4.00, A-=3.67, B+=3.33 ... D=1.00, F=0；S/U不计入GPA',
  type: 'grade',
  maxGPA: 4.0,
  precision: 2,
  mapping: [
    { min: 4.00, max: 4.00, gpa: 4.00, grade: 'A' },
    { min: 3.67, max: 3.67, gpa: 3.67, grade: 'A-' },
    { min: 3.33, max: 3.33, gpa: 3.33, grade: 'B+' },
    { min: 3.00, max: 3.00, gpa: 3.00, grade: 'B' },
    { min: 2.67, max: 2.67, gpa: 2.67, grade: 'B-' },
    { min: 2.33, max: 2.33, gpa: 2.33, grade: 'C+' },
    { min: 2.00, max: 2.00, gpa: 2.00, grade: 'C' },
    { min: 1.67, max: 1.67, gpa: 1.67, grade: 'C-' },
    { min: 1.00, max: 1.00, gpa: 1.00, grade: 'D' },
    { min: 0.00, max: 0.00, gpa: 0.00, grade: 'F' },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

export const PRESET_ALGORITHMS: Record<string, AlgorithmConfig> = {
  bnbu_4_0: BNBU_4_0,
  standard_4_0: STANDARD_4_0,
  pku_4_0: PKU_4_0,
  tsinghua_4_0: TSINGHUA_4_0,
  sjtu_4_3: SJTU_4_3,
  ustc_4_3: USTC_4_3,
  zju_5_0: ZJU_5_0,
  zju_4_3: ZJU_4_3,
  five_point: FIVE_POINT_LINEAR,
  wes_4_0: WES_4_0,
}

/** 将用户自定义算法转换为 AlgorithmConfig */
export function customToAlgoConfig(custom: import('./types').CustomAlgorithm): AlgorithmConfig {
  return {
    id: custom.id,
    name: custom.name,
    description: custom.description,
    type: custom.type,
    maxGPA: custom.maxGPA,
    precision: custom.precision,
    mapping: custom.mappings.map(m => ({ min: m.min, max: m.max, gpa: m.gpa, grade: m.grade })),
    courseFilters: { excludeTypes: [] },
    weighting: { type: 'standard' },
  }
}

// ============================================================
// 分数 → GPA 映射
// ============================================================

export function scoreToGPA(score: number, algo: AlgorithmConfig): number {
  if (algo.type === 'grade') {
    // 等级制：score 即为每学分绩点（如 BNBU/HKBU），直接返回
    return score
  }

  if (algo.type === 'continuous') {
    // 连续公式法（如北大）：GPA = a - b*(c-score)²/1600，60≤score≤100
    if (score >= 60 && score <= 100 && algo.formula) {
      const { a, b, c } = algo.formula
      const gpa = a - b * (c - score) * (c - score) / 1600
      return Math.round(gpa * 100) / 100
    }
    return 0
  }

  if (algo.type === 'linear') {
    const gpa = score / 10 - 5
    return Math.max(0, Math.min(algo.maxGPA, Math.round(gpa * 100) / 100))
  }

  const mapping = algo.mapping
  for (const m of mapping) {
    if (score >= m.min && score <= m.max) {
      return m.gpa
    }
  }
  return 0
}

/** 反推：绩点 → 分数（逆映射） */
export function gpaToScore(gpa: number, algo: AlgorithmConfig): number {
  if (algo.type === 'continuous' && algo.formula) {
    // 逆公式：score = c - sqrt((a - gpa) * 1600 / b)
    const { a, b, c } = algo.formula
    if (gpa <= 0) return 0
    if (gpa >= a) return 100
    const diff = (a - gpa) * 1600 / b
    if (diff < 0) return 0
    const score = c - Math.sqrt(diff)
    return Math.round(Math.max(0, Math.min(100, score)))
  }

  if (algo.type === 'linear') {
    const score = (gpa + 5) * 10
    return Math.round(Math.max(0, Math.min(100, score)))
  }

  // 分段映射：找目标绩点对应的分数段中位数
  const sorted = [...algo.mapping].sort((a, b) => a.min - b.min)
  for (const m of sorted) {
    if (gpa >= m.gpa) {
      // 找到绩点匹配的最低分段
      continue
    }
    // gpa < 当前分段的 GPA，返回上一分段的中位数
    return m.min
  }
  // 没找到更大的分段，返回最高分段的最低分
  const highest = sorted[sorted.length - 1]
  return highest ? highest.min : 60
}

export function scoreToGrade(score: number, algo: AlgorithmConfig): string {
  if (algo.type === 'grade') {
    // 等级制：score 是绩点值，反查等级
    const mapping = algo.mapping
    for (const m of mapping) {
      if (m.grade && Math.abs(score - m.gpa) < 0.01) {
        return m.grade
      }
    }
    return score.toFixed(2)
  }

  const mapping = algo.mapping
  for (const m of mapping) {
    if (m.grade && score >= m.min && score <= m.max) {
      return m.grade
    }
  }
  return '-'
}

/** 从等级字符串反查 GPA 值（如 "A-" → 3.67） */
export function gradeToGPA(grade: string, algo: AlgorithmConfig): number | null {
  const trimmed = grade.trim()
  for (const m of algo.mapping) {
    if (m.grade === trimmed) {
      return m.gpa
    }
  }
  return null
}

/** 从等级字符串反查代表分数（分段制的取 min 值） */
export function gradeToScore(grade: string, algo: AlgorithmConfig): number | null {
  const trimmed = grade.trim()
  for (const m of algo.mapping) {
    if (m.grade === trimmed) {
      return m.min
    }
  }
  return null
}

/** 获取当前算法所有可用的等级标签 */
export function getAvailableGrades(algo: AlgorithmConfig): string[] {
  return algo.mapping.filter(m => m.grade).map(m => m.grade!).sort((a, b) => {
    // 按等级高低排序（A+ 最高）
    const aGpa = gradeToGPA(a, algo) ?? 0
    const bGpa = gradeToGPA(b, algo) ?? 0
    return bGpa - aGpa
  })
}

// ============================================================
// 课程筛选
// ============================================================

export function filterCourses(
  courses: ScoreRecord[],
  filters: AlgorithmConfig['courseFilters']
): ScoreRecord[] {
  let result = [...courses]

  if (filters.excludeTypes && filters.excludeTypes.length > 0) {
    result = result.filter(c => !filters.excludeTypes!.includes(c.category))
  }
  if (filters.onlyTypes && filters.onlyTypes.length > 0) {
    result = result.filter(c => filters.onlyTypes!.includes(c.category))
  }
  if (filters.onlySemesters && filters.onlySemesters.length > 0) {
    result = result.filter(c => filters.onlySemesters!.includes(c.semester))
  }
  if (filters.minScore !== undefined) {
    result = result.filter(c => c.originalScore >= filters.minScore!)
  }

  return result
}

// ============================================================
// 均分计算
// ============================================================

/** 算术平均分（不加权） */
export function arithmeticAvg(
  courses: ScoreRecord[],
  scoreKey: 'originalScore' | 'simulatedScore'
): number {
  const valid = courses.filter(c => {
    const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
    return score != null
  })
  if (valid.length === 0) return 0

  const total = valid.reduce((sum, c) => {
    const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
    return sum + score
  }, 0)
  return Math.round((total / valid.length) * 100) / 100
}

/** 加权平均分（学分加权） */
export function weightedAvg(
  courses: ScoreRecord[],
  scoreKey: 'originalScore' | 'simulatedScore'
): number {
  // 优先使用百分制成绩；只有全部课程都没有百分制分数时才用 gradePoint（纯等级制数据兜底）
  const hasPercentScores = courses.some(c => {
    const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
    return score != null
  })

  if (hasPercentScores) {
    const valid = courses.filter(c => {
      const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
      return score != null
    })
    if (valid.length === 0) return 0

    const totalWeighted = valid.reduce((sum, c) => {
      const score = scoreKey === 'originalScore' ? c.originalScore! : (c.simulatedScore ?? c.originalScore)!
      return sum + score * c.credits
    }, 0)
    const totalCredits = valid.reduce((sum, c) => sum + c.credits, 0)
    return totalCredits === 0 ? 0 : Math.round((totalWeighted / totalCredits) * 100) / 100
  }

  // 纯等级制数据兜底：使用 gradePoint 字段，自动排除 S/U
  const valid = courses.filter(c => c.gradePoint != null && c.gradePoint > 0)
  if (valid.length === 0) return 0
  const totalWeighted = valid.reduce((sum, c) => sum + c.gradePoint! * c.credits, 0)
  const totalCredits = valid.reduce((sum, c) => sum + c.credits, 0)
  return totalCredits === 0 ? 0 : Math.round((totalWeighted / totalCredits) * 100) / 100
}

/** GPA → 等级（根据算法 mapping 找最接近的等级，不硬编码） */
export function gpaToLetter(gpa: number, algo: AlgorithmConfig): string {
  if (!algo?.mapping) return ''
  let best: string | null = null
  let bestDist = Infinity
  for (const m of algo.mapping) {
    if (m.grade) {
      const dist = Math.abs(gpa - m.gpa)
      if (dist < bestDist) { bestDist = dist; best = m.grade }
    }
  }
  return best || ''
}

/** 均分格式化：非 grade 类型直接显示数值，grade 类型追加最近等级 */
export function formatGradeAvg(avg: number, algo: AlgorithmConfig): string {
  if (algo?.type !== 'grade') return avg.toFixed(1)
  const letter = gpaToLetter(avg, algo)
  return letter ? `${avg.toFixed(2)} (${letter})` : avg.toFixed(2)
}

// ============================================================
// GPA 计算
// ============================================================

export function calculateGPA(
  courses: ScoreRecord[],
  scoreKey: 'originalScore' | 'simulatedScore',
  algo: AlgorithmConfig
): number {
  const filtered = filterCourses(courses, algo.courseFilters)

  if (algo.type === 'grade') {
    // 等级制算法（如 BNBU/HKBU）：优先使用 gradePoint 字段
    // S/U 课程 gradePoint 为 null，自动排除
    const valid = filtered.filter(c => {
      const gp = c.gradePoint
      return gp != null && gp > 0
    })
    if (valid.length === 0) return 0

    const totalWeighted = valid.reduce((sum, c) => {
      return sum + c.gradePoint! * c.credits
    }, 0)
    const totalCredits = valid.reduce((sum, c) => sum + c.credits, 0)
    const raw = totalCredits === 0 ? 0 : totalWeighted / totalCredits
    return Math.round(raw * Math.pow(10, algo.precision)) / Math.pow(10, algo.precision)
  }

  const valid = filtered.filter(c => {
    const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
    return score != null
  })
  if (valid.length === 0) return 0

  const totalWeighted = valid.reduce((sum, c) => {
    const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
    const gpa = scoreToGPA(score, algo)
    return sum + gpa * c.credits
  }, 0)

  const totalCredits = valid.reduce((sum, c) => sum + c.credits, 0)
  const raw = totalCredits === 0 ? 0 : totalWeighted / totalCredits
  return Math.round(raw * Math.pow(10, algo.precision)) / Math.pow(10, algo.precision)
}

// ============================================================
// WES 配置
// ============================================================

export const DEFAULT_WES_CONFIG: WESConfig = {
  scoreConversion: [
    { min: 85, max: 100, grade: 'A', gpa: 4.0 },
    { min: 75, max: 84, grade: 'B', gpa: 3.0 },
    { min: 60, max: 74, grade: 'C', gpa: 2.0 },
    { min: 0, max: 59, grade: 'F', gpa: 0 },
  ],
  creditCoefficients: {
    '专业必修': 1.0,
    '专业选修': 1.0,
    '通识数理': 0.85,
    '大学英语': 0.5,
    '思政类': 0,
    '体育': 0,
    '军事理论': 0,
    '毕业设计': 1.0,
    '其他': 0.75,
  },
  excludeCategories: ['体育', '军事理论', '思政类'],
}

/** 判断课程类别名是否匹配 WES 排除列表（支持模糊匹配） */
const WES_EXCLUDE_PATTERNS = [
  /体育/,
  /军事/,
  /思政/,
  /形势与政策/,
  /毛泽东/,
  /马克思/,
  /思想.*道德/,
  /近代史/,
  /党史/,
  /国家安全/,
  /劳动教育/,
  /心理健康/,
  /职业规划/,
  /就业指导/,
  /创业/,
  /大学生.*指导/,
]

function isWESExcluded(category: string): boolean {
  if (!category) return false
  for (const pattern of WES_EXCLUDE_PATTERNS) {
    if (pattern.test(category)) return true
  }
  return false
}

/** 判断课程是否应被 WES 排除（检查类别名 + 课程名 + 0 学分课程） */
function shouldWESExclude(course: ScoreRecord, config: WESConfig = DEFAULT_WES_CONFIG): boolean {
  // 0 学分课程（如形势与政策）自动排除
  if (course.credits <= 0) return true
  // 按配置的排除列表模糊匹配
  if (isWESExcluded(course.category)) return true
  // 按课程名模糊匹配（防止类别标签不准）
  if (isWESExcluded(course.courseName)) return true
  return false
}

export function calculateWESGPA(
  courses: ScoreRecord[],
  scoreKey: 'originalScore' | 'simulatedScore',
  config: WESConfig = DEFAULT_WES_CONFIG
): number {
  const included = courses.filter(c => !shouldWESExclude(c, config))

  // 调试信息：输出排除的课程
  const excluded = courses.filter(c => shouldWESExclude(c, config))

  let totalWeighted = 0
  let totalCredits = 0

  for (const c of included) {
    const score = scoreKey === 'originalScore' ? c.originalScore : (c.simulatedScore ?? c.originalScore)
    const gpa = scoreToGPA(score, WES_4_0)
    const coeff = config.creditCoefficients[c.category] ?? 0.75
    const usCredits = c.credits * coeff

    if (usCredits > 0) {
      totalWeighted += gpa * usCredits
      totalCredits += usCredits
    }
  }

  return totalCredits === 0 ? 0 : Math.round((totalWeighted / totalCredits) * 100) / 100
}

/** 补齐 — 导入（给 import.ts 用的） */
export function getWESExcludedCourses(courses: ScoreRecord[], config: WESConfig = DEFAULT_WES_CONFIG): ScoreRecord[] {
  return courses.filter(c => shouldWESExclude(c, config))
}

// ============================================================
// 学期统计
// ============================================================

export function getSemesterStats(
  courses: ScoreRecord[],
  algo: AlgorithmConfig
): SemesterStats[] {
  const bySemester = new Map<number, ScoreRecord[]>()
  for (const c of courses) {
    const list = bySemester.get(c.semester) || []
    list.push(c)
    bySemester.set(c.semester, list)
  }

  const stats: SemesterStats[] = []
  for (const [sem, list] of bySemester) {
    // 优先使用课程记录中的自定义学期标题，否则使用默认标签
    const customTitle = list.find(c => c.semesterTitle)?.semesterTitle
    stats.push({
      semester: sem,
      semesterLabel: customTitle || SEMESTER_LABELS[sem] || `第${sem}学期`,
      courseCount: list.length,
      totalCredits: list.reduce((s, c) => s + c.credits, 0),
      originalAvg: weightedAvg(list, 'originalScore'),
      simulatedAvg: weightedAvg(list, 'simulatedScore'),
      originalArithAvg: arithmeticAvg(list, 'originalScore'),
      simulatedArithAvg: arithmeticAvg(list, 'simulatedScore'),
      originalGPA: calculateGPA(list, 'originalScore', algo),
      simulatedGPA: calculateGPA(list, 'simulatedScore', algo),
      hasModifications: list.some(c => c.simulatedScore !== null),
      modifiedCount: list.filter(c => c.simulatedScore !== null).length,
      correctedCount: list.filter(c => c.isCorrected).length,
    })
  }

  stats.sort((a, b) => a.semester - b.semester)
  return stats
}

// ============================================================
// 目标反推引擎
// ============================================================

export function calculateReverseTargets(
  selectedCourses: ScoreRecord[],
  fixedCourses: ScoreRecord[],
  targetValue: number,
  algo: AlgorithmConfig,
  lockedScores: Map<string, number>,
  targetType: 'gpa' | 'weighted' | 'arithmetic' = 'gpa'
): ReverseResult {
  const fixedTotalCredits = fixedCourses.reduce((s, c) => s + c.credits, 0)
  const selectedTotalCredits = selectedCourses.reduce((s, c) => s + c.credits, 0)
  const totalCredits = fixedTotalCredits + selectedTotalCredits
  const totalCount = fixedCourses.length + selectedCourses.length

  if (totalCredits === 0 || totalCount === 0) {
    return {
      mode: 'retake', targetGPA: targetValue, currentGPA: 0, gap: 0, targetType,
      targets: [], achievable: false, estimatedGPA: 0, estimatedWeightedAvg: 0, estimatedArithAvg: 0,
      warningMessage: '没有可用的课程数据',
    }
  }

  // currentGPA 始终为真实 GPA（用于参考），gap 按目标度量空间计算
  const currentGPA = calculateGPA([...fixedCourses, ...selectedCourses], 'originalScore', algo)

  // 计算当前在目标度量空间中的值
  let currentInTargetMetric: number
  if (targetType === 'gpa') {
    currentInTargetMetric = currentGPA
  } else if (targetType === 'weighted') {
    const totalW = [...fixedCourses, ...selectedCourses].reduce((s, c) => s + (c.simulatedScore ?? c.originalScore) * c.credits, 0)
    currentInTargetMetric = totalCredits > 0 ? totalW / totalCredits : 0
  } else {
    const totalA = [...fixedCourses, ...selectedCourses].reduce((s, c) => s + (c.simulatedScore ?? c.originalScore), 0)
    currentInTargetMetric = totalCount > 0 ? totalA / totalCount : 0
  }
  const gap = targetValue - currentInTargetMetric

  // 分离已锁定 / 未锁定课程
  const lockedCourses: ScoreRecord[] = []
  const unlockedCourses: ScoreRecord[] = []
  for (const c of selectedCourses) {
    if (lockedScores.has(c.id)) lockedCourses.push(c)
    else unlockedCourses.push(c)
  }

  const unlockedTotalCredits = unlockedCourses.reduce((s, c) => s + c.credits, 0)
  const unlockedCount = unlockedCourses.length

  // 计算固定课程和锁定课程在目标度量空间中的贡献
  let fixedContribution = 0
  for (const c of fixedCourses) {
    const score = c.simulatedScore ?? c.originalScore
    if (targetType === 'gpa') fixedContribution += scoreToGPA(score, algo) * c.credits
    else if (targetType === 'weighted') fixedContribution += score * c.credits
    else fixedContribution += score
  }

  let lockedContribution = 0
  for (const c of lockedCourses) {
    const score = lockedScores.get(c.id)!
    if (targetType === 'gpa') lockedContribution += scoreToGPA(score, algo) * c.credits
    else if (targetType === 'weighted') lockedContribution += score * c.credits
    else lockedContribution += score
  }

  // 目标总量
  const targetTotal = (targetType === 'arithmetic')
    ? targetValue * totalCount
    : targetValue * totalCredits

  const remaining = targetTotal - fixedContribution - lockedContribution
  const divisor = targetType === 'arithmetic' ? unlockedCount : unlockedTotalCredits

  // 每门未锁定课程需要的度量值
  const neededValue = divisor > 0 ? remaining / divisor : 0

  // 生成 targets
  const targets: ReverseTarget[] = []

  for (const c of unlockedCourses) {
    let suggestedScore: number
    if (targetType === 'gpa') {
      suggestedScore = reverseScoreFromGPA(neededValue, algo, c.credits)
    } else {
      suggestedScore = neededValue
    }
    const rounded = Math.max(0, Math.min(100, Math.round(suggestedScore)))

    targets.push({
      courseId: c.id,
      courseName: c.courseName,
      credits: c.credits,
      currentScore: c.originalScore,
      suggestedScore: rounded,
      locked: false,
      lockedValue: null,
      gpaContribution: scoreToGPA(rounded, algo) * c.credits / totalCredits,
      difficultyStars: Math.max(1, Math.min(3, Math.ceil((rounded - c.originalScore) / 10))),
      boundaryGain: checkBoundaryGain(c.originalScore, rounded, algo),
      overflow: suggestedScore > 100,
    })
  }

  for (const c of lockedCourses) {
    const score = lockedScores.get(c.id)!
    targets.push({
      courseId: c.id,
      courseName: c.courseName,
      credits: c.credits,
      currentScore: c.originalScore,
      suggestedScore: score,
      locked: true,
      lockedValue: score,
      gpaContribution: scoreToGPA(score, algo) * c.credits / totalCredits,
      difficultyStars: Math.max(1, Math.min(3, Math.ceil((score - c.originalScore) / 10))),
      boundaryGain: checkBoundaryGain(c.originalScore, score, algo),
      overflow: false,
    })
  }

  // 从最终分数计算三种预估指标
  const scoreMap = new Map(targets.map(t => [t.courseId, t.suggestedScore]))
  let totalGPASum = 0, totalWeightedSum = 0, totalArithSum = 0
  for (const c of [...fixedCourses, ...selectedCourses]) {
    const score = scoreMap.get(c.id) ?? (c.simulatedScore ?? c.originalScore)
    totalGPASum += scoreToGPA(score, algo) * c.credits
    totalWeightedSum += score * c.credits
    totalArithSum += score
  }

  const estimatedGPA = Math.round(totalGPASum / totalCredits * 100) / 100
  const estimatedWeightedAvg = Math.round(totalWeightedSum / totalCredits * 10) / 10
  const estimatedArithAvg = totalCount > 0 ? Math.round(totalArithSum / totalCount * 10) / 10 : 0

  // achievable 基于目标类型判断
  const tolerance = targetType === 'gpa' ? 0.01 : 0.1
  let estimated: number
  if (targetType === 'gpa') estimated = estimatedGPA
  else if (targetType === 'weighted') estimated = estimatedWeightedAvg
  else estimated = estimatedArithAvg

  const achievable = estimated >= targetValue - tolerance && !targets.some(t => t.overflow)

  let warningMessage: string | null = null
  if (!achievable) {
    if (targets.some(t => t.overflow)) {
      warningMessage = '部分课程建议分数超出100分上限，请解锁或增加重修科目'
    } else {
      const label = targetType === 'gpa' ? 'GPA' : targetType === 'weighted' ? '加权均分' : '算术均分'
      warningMessage = `当前锁定条件下无法达到目标${label} ${targetValue}，预估最高 ${estimated}`
    }
  }

  return {
    mode: 'retake',
    targetGPA: targetValue,
    currentGPA,
    gap,
    targetType,
    targets,
    achievable,
    estimatedGPA,
    estimatedWeightedAvg,
    estimatedArithAvg,
    warningMessage,
  }
}

function reverseScoreFromGPA(targetGPA: number, algo: AlgorithmConfig, _credits: number): number {
  if (algo.type === 'linear') {
    return Math.min(100, (targetGPA + 5) * 10)
  }

  // 分段映射：找目标 GPA 对应的最低分数
  const mapping = [...algo.mapping].sort((a, b) => b.gpa - a.gpa)
  for (const m of mapping) {
    if (m.gpa <= targetGPA) {
      return m.min
    }
  }
  return 60
}

function checkBoundaryGain(current: number, target: number, algo: AlgorithmConfig): boolean {
  const currentGPA = scoreToGPA(current, algo)
  const targetGPA = scoreToGPA(target, algo)
  if (targetGPA <= currentGPA) return false
  return (target - current) <= 5
}

// ============================================================
// 辅助工具
// ============================================================

export function getEffectiveScore(record: ScoreRecord, useSimulated: boolean): number {
  if (useSimulated && record.simulatedScore !== null) {
    return record.simulatedScore
  }
  return record.originalScore
}

export function findNextBoundary(score: number, algo: AlgorithmConfig): { min: number; gpa: number } | null {
  if (algo.type === 'linear') return null

  const current = scoreToGPA(score, algo)
  const mapping = [...algo.mapping].sort((a, b) => b.gpa - a.gpa)

  for (const m of mapping) {
    if (m.gpa > current && m.min > score) {
      return { min: m.min, gpa: m.gpa }
    }
  }
  return null
}

// ============================================================
// 算法自动检测
// ============================================================

export interface AlgorithmDetectionResult {
  algorithmId: string
  algorithmName: string
  confidence: number       // 0-1，越高越可信
  matchedCount: number     // 参与检测的课程数
  mae: number              // 平均绝对误差
}

/**
 * 通过已导入课程的成绩-绩点对，自动检测学校使用的 GPA 算法。
 * 逐个预设算法拟合，选误差最小的；同时检测自定义线性映射。
 */
export function detectAlgorithm(courses: ScoreRecord[]): AlgorithmDetectionResult | null {
  // 只用有绩点数据的课程
  const withGP = courses.filter(c => c.gradePoint != null && c.gradePoint > 0)
  if (withGP.length < 3) return null  // 数据不足

  const results: AlgorithmDetectionResult[] = []

  // 1. 逐个预设算法测试
  for (const [id, algo] of Object.entries(PRESET_ALGORITHMS)) {
    let totalError = 0
    let exactMatch = 0

    for (const c of withGP) {
      const predicted = scoreToGPA(c.originalScore, algo)
      const actual = c.gradePoint!
      const error = Math.abs(predicted - actual)
      totalError += error
      if (error < 0.05) exactMatch++
    }

    const mae = totalError / withGP.length
    const exactRatio = exactMatch / withGP.length

    results.push({
      algorithmId: id,
      algorithmName: algo.name,
      confidence: exactRatio,
      matchedCount: withGP.length,
      mae,
    })
  }

  // 2. 检测自定义线性映射: GPA = a * score + b
  //    用最小二乘法拟合
  const scores = withGP.map(c => c.originalScore)
  const gps = withGP.map(c => c.gradePoint!)
  const n = scores.length
  const sumX = scores.reduce((a, b) => a + b, 0)
  const sumY = gps.reduce((a, b) => a + b, 0)
  const sumXY = scores.reduce((a, _, i) => a + scores[i] * gps[i], 0)
  const sumX2 = scores.reduce((a, b) => a + b * b, 0)

  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) > 0.001) {
    const slope = (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / n

    // 检查是否接近已知公式
    // 常见: GPA = score/10 - 5 (slope=0.1, intercept=-5)
    //       GPA = score/25 (slope=0.04, intercept=0)

    let totalError = 0
    let exactMatch = 0
    for (const c of withGP) {
      const predicted = Math.max(0, Math.min(5, slope * c.originalScore + intercept))
      const actual = c.gradePoint!
      const error = Math.abs(predicted - actual)
      totalError += error
      if (error < 0.05) exactMatch++
    }

    const mae = totalError / withGP.length
    const exactRatio = exactMatch / withGP.length

    // 只有当线性拟合明显好于预设算法时才用自定义
    const bestPreset = results.reduce((best, r) => r.mae < best.mae ? r : best, results[0])
    if (mae < bestPreset.mae - 0.02 && exactRatio > 0.7) {
      // 判断是否是已知公式
      let name = `自定义线性 (${slope.toFixed(3)}×分数${intercept >= 0 ? '+' : ''}${intercept.toFixed(2)})`
      if (Math.abs(slope - 0.1) < 0.005 && Math.abs(intercept - (-5)) < 0.1) {
        name = '5.0制线性 (分数/10-5)'
      }

      results.push({
        algorithmId: 'custom_linear',
        algorithmName: name,
        confidence: exactRatio,
        matchedCount: withGP.length,
        mae,
      })
    }
  }

  // 3. 选最佳结果
  if (results.length === 0) return null

  // 按 MAE 升序，相同 MAE 取 confidence 高的
  results.sort((a, b) => {
    if (Math.abs(a.mae - b.mae) > 0.01) return a.mae - b.mae
    return b.confidence - a.confidence
  })

  const best = results[0]

  // 至少要有一定置信度才自动切换
  if (best.confidence < 0.5 && best.mae > 0.3) return null

  return best
}
