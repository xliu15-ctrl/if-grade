// ============================================================
// 均分绩点模拟器 — GPA 计算引擎（前端版）
// ============================================================

import type {
  ScoreRecord, AlgorithmConfig,
  CourseCategory, SemesterStats, ReverseResult,
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
  description: '本工具的通用百分制模拟分段：90+=4.0, 85+=3.7 ... 60+=1.0',
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
  description: '北大本科历史百分制公式，60 分起按 4 − 3 × (100 − 成绩)² / 1600 计算。适用年级请核对成绩单。',
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

// 清华 2015 版百分对照：https://qiyuan.tsinghua.edu.cn/ueditor/jsp/upload/20150910/79631441873140312.pdf
// 后续等级制规定单独使用等级，本预设只用于该历史百分表。
const TSINGHUA_4_0: AlgorithmConfig = {
  id: 'tsinghua_4.0', name: '清华 4.0（2015 版百分对照）',
  description: '按 2015 版《清华大学学生成绩记载规定》的百分表试算。其他版本的等级制请按成绩单记载的绩点计算。',
  type: 'segmented', maxGPA: 4, precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 4, grade: 'A+/A' },
    { min: 90, max: 94, gpa: 3.7, grade: 'A-' },
    { min: 85, max: 89, gpa: 3.3, grade: 'B+' },
    { min: 80, max: 84, gpa: 3, grade: 'B' },
    { min: 77, max: 79, gpa: 2.7, grade: 'B-' },
    { min: 73, max: 76, gpa: 2.3, grade: 'C+' },
    { min: 70, max: 72, gpa: 2, grade: 'C' },
    { min: 67, max: 69, gpa: 1.7, grade: 'C-' },
    { min: 63, max: 66, gpa: 1.3, grade: 'D+' },
    { min: 60, max: 62, gpa: 1, grade: 'D' },
    { min: 0, max: 59, gpa: 0, grade: 'F' },
  ],
  courseFilters: {}, weighting: { type: 'standard' },
}

// 上海交大本科：https://jwc.sjtu.edu.cn/info/1482/12870.htm
const SJTU_4_3: AlgorithmConfig = {
  id: 'sjtu_4.3', name: '上海交大 4.3',
  description: '上海交大本科百分制考试课程。95 分起为 4.3，85 分起为 3.7，60 分起为 1.0。',
  type: 'segmented', maxGPA: 4.3, precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 4.3, grade: 'A+' },
    { min: 90, max: 94, gpa: 4, grade: 'A' },
    { min: 85, max: 89, gpa: 3.7, grade: 'A-' },
    { min: 80, max: 84, gpa: 3.3, grade: 'B+' },
    { min: 75, max: 79, gpa: 3, grade: 'B' },
    { min: 70, max: 74, gpa: 2.7, grade: 'B-' },
    { min: 67, max: 69, gpa: 2.3, grade: 'C+' },
    { min: 65, max: 66, gpa: 2, grade: 'C' },
    { min: 62, max: 64, gpa: 1.7, grade: 'C-' },
    { min: 60, max: 61, gpa: 1, grade: 'D' },
    { min: 0, max: 59, gpa: 0, grade: 'F' },
  ],
  courseFilters: {}, weighting: { type: 'standard' },
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
  description: '浙大 2022 级起出国成绩单百分换算。同一课程号按最高一次成绩整理后再计入。',
  type: 'segmented',
  maxGPA: 4.3,
  precision: 2,
  mapping: [
    { min: 95, max: 100, gpa: 4.3 },
    { min: 92, max: 94, gpa: 4.2 },
    { min: 89, max: 91, gpa: 4.1 },
    { min: 86, max: 88, gpa: 4.0 },
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

/** 5.0 线性制（简单线性映射 GPA = 成绩/10 - 5） */
const FIVE_POINT_LINEAR: AlgorithmConfig = {
  id: 'five_point',
  name: '5.0 线性制',
  description: '本工具的五分制模型：60 分及以上为成绩 / 10 − 5，低于 60 分计 0。',
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
  name: 'WES 模拟（估算）',
  description: '本工具的情境估算，按类别折算学分：85+=A(4.0), 75-84=B(3.0), 60-74=C(2.0), <60=F(0)',
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
    { min: 0, max: 0, gpa: 0, grade: 'E' },
  ],
  courseFilters: {},
  weighting: { type: 'standard' },
}

const TRANSCRIPT_GPA: AlgorithmConfig = {
  id: 'transcript_gpa', name: '成绩单原始绩点（通用）', type: 'grade', maxGPA: 5, precision: 2,
  description: '直接按学分加权成绩单上已给出的绩点。本通用模型可输入 0–5，反推时请选用与学校满绩点相符的规则。',
  mapping: [], courseFilters: {}, weighting: { type: 'standard' },
}

export const PRESET_ALGORITHMS: Record<string, AlgorithmConfig> = {
  bnbu_4_0: BNBU_4_0,
  transcript_gpa: TRANSCRIPT_GPA,
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

export function validateMappings(type: 'grade' | 'segmented', max: number,
  rows: Array<{ grade: string; min: number; max: number; gpa: number }>): string | null {
  if (!Number.isFinite(max) || max <= 0 || !rows.length) return '请输入正数满绩点，并至少填写一行映射。'
  if (rows.some(r => !r.grade || !inRange(r.gpa, max)) || new Set(rows.map(r => r.grade)).size !== rows.length)
    return '等级名称必须唯一，绩点必须在 0 与满绩点之间。'
  if (type === 'grade') return null
  const sorted = [...rows].sort((a,b) => a.min - b.min)
  if (sorted[0].min !== 0 || sorted[sorted.length-1].max !== 100) return '分段须覆盖 0 至 100 分。'
  for (let i=0; i<sorted.length; i++) {
    const r = sorted[i], prev = sorted[i-1]
    if (!inRange(r.min) || !inRange(r.max) || r.min > r.max) return '请检查每一行的分数上下限。'
    if (prev && (r.min <= prev.min || prev.gpa > r.gpa || (r.min !== prev.max &&
        !(Number.isInteger(prev.max) && r.min > prev.max && r.min <= prev.max + 1))))
      return '分段须连续，不能重叠，分数递增时绩点不能下降。'
  }
  return null
}

export type ScoreKey = 'originalScore' | 'simulatedScore'

export function inRange(value: unknown, max = 100): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
}

export function courseScore(c: ScoreRecord, key: ScoreKey): number | null {
  // Future rows in older workspaces stored 0 in the unused original-score field.
  const value = c.isPredicted ? (key === 'simulatedScore' ? c.simulatedScore : null)
    : key === 'originalScore' ? c.originalScore : c.simulatedScore ?? c.originalScore
  return inRange(value) ? value : null
}

export function isModified(c: ScoreRecord): boolean {
  return (c.simulatedScore != null && c.simulatedScore !== c.originalScore) ||
    (c.simulatedGP != null && c.simulatedGP !== c.gradePoint)
}

function bandFor<T extends { min: number; max: number }>(score: number, rows: T[]) {
  // An integer band 85–89 includes 89.5. Explicit decimal bounds remain inclusive.
  let match: T | undefined
  for (const row of rows) {
    const within = score <= row.max || (Number.isInteger(row.max) && score < row.max + 1)
    if (within && score >= row.min && (!match || row.min > match.min)) match = row
  }
  return match
}

export function scoreToGPA(score: number, algo: AlgorithmConfig): number {
  if (!inRange(score, algo.type === 'grade' ? algo.maxGPA : 100)) return 0
  if (algo.type === 'grade') return score
  if (algo.type === 'continuous' && algo.formula) {
    const { a, b, c } = algo.formula
    return score < 60 ? 0 : a - b * (c - score) ** 2 / 1600
  }
  if (algo.type === 'linear') return score < 60 ? 0 : Math.min(algo.maxGPA, score / 10 - 5)
  return bandFor(score, algo.mapping)?.gpa ?? 0
}

/** Minimum input attaining the requested course GPA (to 0.01 for formula-based scales). */
export function gpaToScore(gpa: number, algo: AlgorithmConfig): number {
  if (!inRange(gpa, algo.maxGPA)) return NaN
  if (gpa === 0) return 0
  if (algo.type === 'grade') return gpa
  if (algo.type === 'linear') return Math.max(60, Math.ceil((gpa + 5) * 1000 - 1e-9) / 100)
  if (algo.type === 'continuous' && algo.formula) {
    const { a, b, c } = algo.formula
    return Math.max(60, Math.ceil((c - Math.sqrt((a - gpa) * 1600 / b)) * 100 - 1e-9) / 100)
  }
  const matches = algo.mapping.filter(m => m.gpa >= gpa)
  return matches.length ? Math.min(...matches.map(m => m.min)) : NaN
}

export function scoreToGrade(score: number, algo: AlgorithmConfig): string {
  if (algo.type === 'grade') return algo.mapping.find(m => Math.abs(score - m.gpa) < .00001)?.grade || '—'
  return inRange(score) ? bandFor(score, algo.mapping)?.grade || '-' : '-'
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
      return algo.type === 'grade' ? m.gpa : m.min
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
    result = result.filter(c => c.originalScore != null && c.originalScore >= filters.minScore!)
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
  return roundedMean(courses, c => courseScore(c, scoreKey), () => 1)
}

/** Percentage average weighted by course credits. */
export function weightedAvg(courses: ScoreRecord[], scoreKey: ScoreKey): number {
  return roundedMean(courses, c => courseScore(c, scoreKey), c => c.credits)
}

function mean(courses: ScoreRecord[], valueOf: (c: ScoreRecord) => number | null, weightOf: (c: ScoreRecord) => number) {
  let sum = 0, weight = 0
  for (const course of courses) {
    const value = valueOf(course), w = weightOf(course)
    if (value == null || !Number.isFinite(value) || !Number.isFinite(w) || w <= 0) continue
    sum += value * w
    weight += w
  }
  return weight ? sum / weight : null
}

function round(value: number, digits: number) {
  const scale = 10 ** digits
  return Math.round((value + Number.EPSILON) * scale) / scale
}

function roundedMean(courses: ScoreRecord[], valueOf: (c: ScoreRecord) => number | null, weightOf: (c: ScoreRecord) => number, digits = 2) {
  return round(mean(courses, valueOf, weightOf) ?? 0, digits)
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

export function courseGPA(c: ScoreRecord, key: ScoreKey, algo: AlgorithmConfig): number | null {
  if (algo.type === 'grade') {
    const gp = c.isPredicted ? (key === 'simulatedScore' ? c.simulatedGP : null) :
      key === 'originalScore' ? c.gradePoint : c.simulatedGP ?? c.gradePoint
    return inRange(gp, algo.maxGPA) ? gp : null
  }
  const score = courseScore(c, key)
  return score == null ? null : scoreToGPA(score, algo)
}

export function gpaWeight(c: ScoreRecord, algo: AlgorithmConfig): number {
  if (!Number.isFinite(c.credits) || c.credits <= 0) return 0
  if (algo.id === WES_4_0.id) return wesCourse(c, 'simulatedScore').credits
  const { excludeTypes, onlyTypes, onlySemesters, minScore } = algo.courseFilters
  if (excludeTypes?.includes(c.category as CourseCategory) ||
      (onlyTypes?.length && !onlyTypes.includes(c.category as CourseCategory)) ||
      (onlySemesters?.length && !onlySemesters.includes(c.semester)) ||
      (minScore != null && (c.originalScore == null || c.originalScore < minScore))) return 0
  const factor = algo.weighting.type === 'categorical' ? algo.weighting.categoryWeights?.[c.category as CourseCategory] ?? 1 : 1
  return Number.isFinite(factor) && factor > 0 ? c.credits * factor : 0
}

export function rawGPA(courses: ScoreRecord[], key: ScoreKey, algo: AlgorithmConfig): number | null {
  return mean(courses, c => courseGPA(c, key, algo), c => gpaWeight(c, algo))
}

export function calculateGPA(courses: ScoreRecord[], key: ScoreKey, algo: AlgorithmConfig): number {
  return round(rawGPA(courses, key, algo) ?? 0, algo.precision)
}

export function summarize(courses: ScoreRecord[], key: ScoreKey, algo: AlgorithmConfig) {
  const gpa = rawGPA(courses, key, algo)
  const weighted = mean(courses, c => courseScore(c, key), c => c.credits)
  const arithmetic = mean(courses, c => courseScore(c, key), () => 1)
  return {
    gpa: gpa == null ? null : round(gpa, algo.precision),
    weighted: weighted == null ? null : round(weighted, 2),
    arithmetic: arithmetic == null ? null : round(arithmetic, 2),
  }
}

export const displayMetric = (value: number | null | undefined, digits = 2) =>
  value != null && Number.isFinite(value) ? value.toFixed(digits) : '—'

export function gpaImpacts(courses: ScoreRecord[], algo: AlgorithmConfig) {
  const eligibleCredits = (key: ScoreKey) => courses.reduce((total, c) =>
    total + (courseGPA(c, key, algo) == null ? 0 : gpaWeight(c, algo)), 0)
  const original = eligibleCredits('originalScore'), simulated = eligibleCredits('simulatedScore')
  return courses.map(course => {
    const weight = gpaWeight(course, algo)
    const before = original ? (courseGPA(course, 'originalScore', algo) ?? 0) * weight / original : 0
    const after = simulated ? (courseGPA(course, 'simulatedScore', algo) ?? 0) * weight / simulated : 0
    return { course, delta: after - before }
  }).filter(item => Math.abs(item.delta) > 1e-12 || isModified(item.course))
}

export function improvementData(courses: ScoreRecord[], algo: AlgorithmConfig) {
  if (algo.type === 'grade') return []
  const valid = courses.filter(c => courseScore(c, 'originalScore') != null && gpaWeight(c, algo) > 0)
  const total = valid.reduce((sum, c) => sum + gpaWeight(c, algo), 0)
  return valid.map(c => {
    const score = c.originalScore!, gp = scoreToGPA(score, algo)
    const gain = (extra: number) => (scoreToGPA(Math.min(100, score + extra), algo) - gp) * gpaWeight(c, algo) / total
    return { id: c.id, name: c.courseName, score, credits: c.credits, '+5': gain(5), '+10': gain(10), '+15': gain(15), '+20': gain(20) }
  }).sort((a, b) => b['+10'] - a['+10']).slice(0, 8)
}

export const scoreRanges = ['<60', '60–<70', '70–<80', '80–<90', '90–100']
export function distribution(courses: ScoreRecord[], key: ScoreKey) {
  const counts = [0, 0, 0, 0, 0]
  for (const c of courses) {
    const value = courseScore(c, key)
    if (value != null) counts[value < 60 ? 0 : Math.min(4, Math.floor(value / 10) - 5)]++
  }
  return counts
}

export function resolveAlgorithm(id?: string, custom: import('./types').CustomAlgorithm[] = []): AlgorithmConfig {
  const own = custom.find(a => a.id === id)
  return own ? customToAlgoConfig(own) : PRESET_ALGORITHMS[id || ''] ??
    Object.values(PRESET_ALGORITHMS).find(a => a.id === id) ?? STANDARD_4_0
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

const wesAliases: Record<string, CourseCategory> = { '专必': '专业必修', '专选': '专业选修', '公选': '其他' }
const wesNames: [CourseCategory, RegExp][] = [
  ['体育', /^(大学)?体育(?:课|与健康)?[\sⅠⅡⅢⅣIVX一二三四五六七八0-9（）()]*$/u],
  ['军事理论', /^(军事理论|军事技能|军训)[\s一二0-9（）()]*$/u],
  ['思政类', /^(形势与政策|思想道德与法治|马克思主义基本原理|中国近现代史纲要|毛泽东思想和中国特色社会主义理论体系概论)[\s一二三四0-9（）()]*$/u],
]

/** The detailed table, planner and summary use exactly the same model weights. */
export function wesCourse(course: ScoreRecord, key: ScoreKey, config = DEFAULT_WES_CONFIG) {
  const category = wesAliases[course.category] ?? course.category as CourseCategory
  const excludedCategory = config.excludeCategories.includes(category) ||
    wesNames.some(([type, pattern]) => config.excludeCategories.includes(type) && pattern.test(course.courseName.trim()))
  const coeff = excludedCategory ? 0 : config.creditCoefficients[category] ?? config.creditCoefficients['其他'] ?? 1
  const credits = Number.isFinite(course.credits) && course.credits > 0 && Number.isFinite(coeff) && coeff > 0 ? course.credits * coeff : 0
  const score = courseScore(course, key)
  const band = score == null ? undefined : bandFor(score, config.scoreConversion)
  return { coefficient: coeff, credits, score, gpa: band?.gpa ?? null, grade: band?.grade ?? '—', excluded: credits === 0 || !band }
}

export function calculateWESGPA(courses: ScoreRecord[], key: ScoreKey, config = DEFAULT_WES_CONFIG): number {
  let points = 0, credits = 0
  for (const course of courses) {
    const row = wesCourse(course, key, config)
    if (row.excluded || row.gpa == null) continue
    points += row.credits * row.gpa
    credits += row.credits
  }
  return credits ? round(points / credits, 2) : 0
}

export function getWESExcludedCourses(courses: ScoreRecord[], config = DEFAULT_WES_CONFIG): ScoreRecord[] {
  return courses.filter(c => wesCourse(c, 'originalScore', config).excluded)
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
      hasModifications: list.some(isModified),
      modifiedCount: list.filter(isModified).length,
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
  const gpInputs = targetType === 'gpa' && algo.type === 'grade'
  const limit = targetType === 'gpa' ? algo.maxGPA : 100
  const baseline = (c: ScoreRecord) => gpInputs ? courseGPA(c, 'simulatedScore', algo) : courseScore(c, 'simulatedScore')
  const metric = (list: ScoreRecord[]) => targetType === 'gpa' ? rawGPA(list, 'simulatedScore', algo)
    : mean(list, c => courseScore(c, 'simulatedScore'), c => targetType === 'weighted' ? c.credits : 1)
  const change = (c: ScoreRecord, value: number): ScoreRecord => gpInputs ? { ...c, simulatedGP: value } : { ...c, simulatedScore: value }
  const inputMax = gpInputs ? algo.maxGPA : 100
  const eligible = selectedCourses.filter(c => targetType === 'arithmetic' ||
    (targetType === 'weighted' ? c.credits > 0 : gpaWeight(c, algo) > 0))
  const ids = new Set(eligible.map(c => c.id))
  const fixed = [...fixedCourses, ...selectedCourses.filter(c => !ids.has(c.id))]
  const all = [...fixed, ...eligible]
  const current = metric(all)
  const currentGPA = summarize(all, 'simulatedScore', algo).gpa
  const invalidLock = eligible.some(c => lockedScores.has(c.id) && !inRange(lockedScores.get(c.id), inputMax))
  const valueAt = (c: ScoreRecord, threshold: number) => {
    const lock = lockedScores.get(c.id)
    return inRange(lock, inputMax) ? lock : Math.max(baseline(c) ?? 0, threshold)
  }
  const project = (threshold: number) => [...fixed, ...eligible.map(c => change(c, valueAt(c, threshold)))]
  // Keep higher existing grades, then find the lowest shared floor that actually reaches the
  // target. Compare the unrounded result, including locked courses and model-specific credits.
  const discrete = gpInputs && algo.mapping.length ? algo.mapping.map(m => m.gpa)
    : !gpInputs && targetType === 'gpa' && algo.type === 'segmented' ? algo.mapping.map(m => m.min) : null
  const choices = discrete ? [...new Set([0, ...discrete])].filter(v => inRange(v, inputMax)).sort((a,b) => a-b) : null
  const floorAt = (index: number) => choices ? choices[index] : index / 100
  // Check discrete breakpoints or hundredths of a point against the unrounded target.
  let low = 0, high = choices ? choices.length - 1 : Math.round(inputMax * 100)
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const value = metric(project(floorAt(mid)))
    if (value != null && value + 1e-10 >= targetValue) high = mid
    else low = mid + 1
  }
  const threshold = floorAt(low), projected = project(threshold)
  const finalValue = metric(projected)
  const achieved = finalValue != null && finalValue + 1e-10 >= targetValue

  const weights = projected.reduce((sum, c) => sum + (courseGPA(c, 'simulatedScore', algo) == null ? 0 : gpaWeight(c, algo)), 0)
  const attainable = finalValue
  let warningMessage: string | null = null
  if (!inRange(targetValue, limit)) warningMessage = '目标值须在 0 到 ' + limit + ' 之间。'
  else if (invalidLock) warningMessage = '锁定值超出范围，请重新填写。'
  else if (!eligible.length || attainable == null) warningMessage = '请选择至少一门参与该指标计算的课程。'
  else if (!achieved) warningMessage = '在当前选课与锁定条件下，最高可达 ' + round(attainable, 4) + '。'

  const targets = eligible.map(c => {
    const value = valueAt(c, threshold), prior = baseline(c) ?? 0
    const gp = courseGPA(change(c, value), 'simulatedScore', algo) ?? 0
    return {
      courseId: c.id, courseName: c.courseName, credits: c.credits, currentScore: baseline(c),
      suggestedScore: value, locked: lockedScores.has(c.id), lockedValue: lockedScores.get(c.id) ?? null,
      gpaContribution: weights ? gp * gpaWeight(c, algo) / weights : 0,
      difficultyStars: Math.max(1, Math.min(3, Math.ceil((value-prior) / (gpInputs ? .4 : 10)))),
      boundaryGain: !gpInputs && value-prior <= 5 && gp > (courseGPA(c, 'simulatedScore', algo) ?? 0),
      overflow: false,
    }
  })
  const estimates = summarize(projected, 'simulatedScore', algo)
  return {
    mode: 'retake', targetGPA: targetValue, currentGPA, gap: current == null ? null : targetValue - current, targetType,
    inputUnit: gpInputs ? 'gpa' : 'score', targets, achievable: warningMessage == null,
    estimatedGPA: estimates.gpa, estimatedWeightedAvg: estimates.weighted,
    estimatedArithAvg: estimates.arithmetic, warningMessage,
  }
}

// ============================================================
// 辅助工具
// ============================================================

export function getEffectiveScore(record: ScoreRecord, useSimulated: boolean): number | null {
  return courseScore(record, useSimulated ? 'simulatedScore' : 'originalScore')
}

export function findNextBoundary(score: number, algo: AlgorithmConfig): { min: number; gpa: number } | null {
  if (algo.type === 'linear' || algo.type === 'continuous' || !inRange(score, algo.type === 'grade' ? algo.maxGPA : 100)) return null

  const current = scoreToGPA(score, algo)
  const mapping = [...algo.mapping].sort((a, b) => a.min - b.min)

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
 * 只选择有唯一证据的预设算法。
 */
export function detectAlgorithm(courses: ScoreRecord[]): AlgorithmDetectionResult | null {
  // 只用有绩点数据的课程
  const withGP = courses.filter((c): c is ScoreRecord & {originalScore: number; gradePoint: number} => !c.isPredicted && inRange(c.originalScore) && inRange(c.gradePoint, 5))
  if (withGP.length < 3) return null  // 数据不足

  const results: AlgorithmDetectionResult[] = []

  // 1. 逐个预设算法测试
  for (const [id, algo] of Object.entries(PRESET_ALGORITHMS)) {
    if (algo.type === 'grade' || algo.id === WES_4_0.id) continue
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

  results.sort((a,b) => a.mae - b.mae)
  const best = results[0]
  // With equally good fits these course pairs cannot identify the institution's scale.
  if (!best || best.confidence < 1 || results.slice(1).some(r => r.mae <= best.mae + .005)) return null
  return best
}
