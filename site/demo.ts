import type { ScoreRecord } from '../src/libs/types'

export const DEMO_WORKSPACE = 'preview'
export const USER_WORKSPACE = 'browser'

export const DEMO_COURSES: ScoreRecord[] = [
  ['高等数学', 4, 78, 1],
  ['大学英语', 3, 88, 1],
  ['程序设计基础', 4, 91, 1],
  ['线性代数', 3, 82, 2],
  ['概率论与数理统计', 3, 85, 2],
  ['数据结构', 4, 89, 2],
].map(([name, credits, score, semester], index) => ({
  id: `demo_${index}`,
  courseName: String(name),
  credits: Number(credits),
  originalScore: Number(score),
  simulatedScore: index === 0 ? 90 : null,
  simulatedGP: null,
  semester: Number(semester),
  category: '专业必修',
  source: 'manual',
  isCorrected: false,
  order: index,
}))
