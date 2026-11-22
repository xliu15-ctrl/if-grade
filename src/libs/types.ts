// ============================================================
// 均分绩点模拟器 — 类型定义
// ============================================================

/** 课程分类 */
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

/** 单条成绩记录 */
export interface ScoreRecord {
  id: string
  courseName: string
  credits: number
  originalScore: number | null
  simulatedScore: number | null
  simulatedGP?: number | null   // 模拟绩点
  semester: number
  category: string              // 性质标签（专必/公必/公选/...，原始成绩单标签）
  source: 'manual' | 'import' | 'auto'
  isCorrected: boolean
  isPredicted?: boolean          // 未来预测课程标记
  order: number
  gradePoint?: number | null   // 绩点（来自成绩单原始值）
  semesterTitle?: string        // 自定义学期标题（显示用，如 "2024秋"）
}

/** 学期统计 */
export interface SemesterStats {
  semester: number
  semesterLabel: string
  courseCount: number
  totalCredits: number
  originalAvg: number
  simulatedAvg: number
  originalArithAvg: number
  simulatedArithAvg: number
  originalGPA: number
  simulatedGPA: number
  hasModifications: boolean
  modifiedCount: number
  correctedCount: number
}

/** GPA 分数段映射 */
export interface ScoreGpaMapping {
  min: number
  max: number
  gpa: number
  grade?: string
}

/** 课程筛选规则 */
export interface CourseFilter {
  excludeTypes?: CourseCategory[]
  onlyTypes?: CourseCategory[]
  onlySemesters?: number[]
  minScore?: number
}

/** 加权配置 */
export interface WeightingConfig {
  type: 'standard' | 'categorical'
  categoryWeights?: Partial<Record<CourseCategory, number>>
}

/** GPA 算法配置 */
export interface AlgorithmConfig {
  id: string
  name: string
  description: string
  type: 'segmented' | 'linear' | 'grade' | 'continuous'
  mapping: ScoreGpaMapping[]
  courseFilters: CourseFilter
  weighting: WeightingConfig
  precision: number
  maxGPA: number
  /** 连续公式参数（仅 type='continuous' 时使用） */
  formula?: { a: number; b: number; c: number } // GPA = a - b*(c-score)²/d, 通用形式
}

/** WES 转换配置 */
export interface WESConfig {
  scoreConversion: { min: number; max: number; grade: string; gpa: number }[]
  creditCoefficients: Partial<Record<CourseCategory, number>>
  excludeCategories: CourseCategory[]
}

/** GPA 全局配置 */
export interface GPAConfig {
  activeAlgorithm: string
  algorithms: Record<string, AlgorithmConfig>
  wesConfig: WESConfig
}

/** 导入预览记录 */
export interface ImportPreviewRecord {
  id: string
  courseName: string
  credits: number
  score: number
  gradePoint?: number | null   // 绩点（每学分，BNBU/HKBU 等等级制成绩单用）
  semester: number
  category: CourseCategory
  duplicateGroup: string | null
}

/** 成绩单汇总元数据（AI 从成绩单中提取，用于自动匹配算法） */
export interface TranscriptMeta {
  reportedGPA?: number        // 成绩单上的总GPA
  reportedAvgScore?: number   // 成绩单上的算术平均分
  reportedWeightedAvg?: number // 成绩单上的加权平均分
  totalCredits?: number       // 总学分
  gpaScale?: number           // GPA 满分制（4.0 / 5.0 / 4.3 等）
}

/** 导入预览数据 */
export interface ImportPreview {
  records: ImportPreviewRecord[]
  duplicateGroups: Record<string, {
    type: 'exact' | 'fuzzy'
    similarity?: number
    recordIds: string[]
  }>
  source: string
  requestId?: string
  transcriptMeta?: TranscriptMeta
}

/** 目标反推 — 单科建议 */
export interface ReverseTarget {
  courseId: string
  courseName: string
  credits: number
  currentScore: number | null
  suggestedScore: number
  locked: boolean
  lockedValue: number | null
  gpaContribution: number
  difficultyStars: number
  boundaryGain: boolean
  overflow: boolean
}

/** 目标反推 — 完整结果 */
export interface ReverseResult {
  mode: 'retake' | 'predict'
  targetGPA: number
  currentGPA: number | null
  gap: number | null
  targetType: 'gpa' | 'weighted' | 'arithmetic'
  basis?: string
  inputs?: string
  selection?: string
  hasTarget?: boolean
  inputUnit?: 'score' | 'gpa'
  targets: ReverseTarget[]
  achievable: boolean
  estimatedGPA: number | null
  estimatedWeightedAvg: number | null
  estimatedArithAvg: number | null
  warningMessage: string | null
}

/** 拖拽状态 */
export interface DragState {
  /** 主拖拽课程（锚点） */
  draggedCourseId: string | null
  /** 所有被拖拽的课程ID（支持单选和批量） */
  draggedCourseIds: Set<string>
  /** 拖拽来源学期 */
  sourceSemester: number | null
  /** 当前悬停的目标学期 */
  targetSemester: number | null
  /** 目标学期内的插入位置索引 */
  dropIndex: number | null
}

export const COURSE_CATEGORIES: CourseCategory[] = [
  '专业必修', '专业选修', '通识数理',
  '大学英语', '思政类', '体育',
  '军事理论', '毕业设计', '其他',
]

export const SEMESTER_LABELS: Record<number, string> = {
  1: '第1学期 · 大一上',
  2: '第2学期 · 大一下',
  3: '第3学期 · 大二上',
  4: '第4学期 · 大二下',
  5: '第5学期 · 大三上',
  6: '第6学期 · 大三下',
  7: '第7学期 · 大四上',
  8: '第8学期 · 大四下',
}

// ============================================================
// 导入进度相关类型
// ============================================================

export type ImportTab = 'manual' | 'excel' | 'pdf' | 'screenshot'

export interface ProgressStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  startTime?: number
  endTime?: number
  estimatedDuration: number   // ms
}

export interface ImportProgress {
  tabId: ImportTab
  steps: ProgressStep[]
  currentStepIdx: number
  startedAt: number
  recordCount?: number
  message?: string
  errorMessage?: string
}

/** 本地预扫描结果 */
export interface DocumentAnalysis {
  detectedType: 'percentage' | 'gpa' | 'letter_grade' | 'mixed' | 'unknown'
  estimatedComplexity: 'simple' | 'moderate' | 'complex'
  estimatedCourses: number
  columnStructure?: string[]
  semesterMarkers: string[]
  confidence: number
}

// ============================================================
// 存档管理相关类型
// ============================================================

/** 存档元数据 */
export interface ArchiveMeta {
  id: string
  name: string
  slug: string
  fileName: string          // "data/archives/{slug}.json"
  createdAt: string         // ISO 8601
  courseCount: number
  totalCredits: number
  semesterCount: number
  kbFolder?: string         // 关联的成绩知识库文件夹路径
  kbEntryId?: string        // 关联的 KB manifest 条目 ID（用于兜底路径查找）
}

/** 存档清单 */
export interface ArchiveManifest {
  archives: ArchiveMeta[]
}

// ============================================================
// 智能导入 — 解析方法 & 对比结果
// ============================================================

/** 解析方法 */
export type ParsingMethod = 'local' | 'ai' | 'compare'

/** 对比结果 */
export interface CompareResult {
  localRecords: ImportPreviewRecord[]
  aiRecords: ImportPreviewRecord[]
  matched: Array<{
    local: ImportPreviewRecord | null
    ai: ImportPreviewRecord | null
    status: 'match' | 'local_only' | 'ai_only' | 'diff'
    diffs: string[]
  }>
  localCount: number
  aiCount: number
  matchCount: number
  precision: number
}

/** 用户自定义算法（序列化存储用） */
export interface CustomAlgorithm {
  id: string
  name: string
  description: string
  maxGPA: number
  precision: number
  type: 'grade' | 'segmented'
  mappings: Array<{ grade: string; min: number; max: number; gpa: number }>
}
