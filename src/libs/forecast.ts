import type { AlgorithmConfig, ReverseResult, ScoreRecord } from './types'
import { calculateReverseTargets, inRange, summarize } from './gpa-engine'

export type FutureCourse = {
  id: string
  courseName: string
  credits: number
  category: string
  lockedScore: number | null
  lockedGP: number | null
}

export function applyProposal(courses: ScoreRecord[], result: ReverseResult) {
  const values = new Map(result.targets.map(t => [t.courseId, t.lockedValue ?? t.suggestedScore]))
  const field = result.inputUnit === 'gpa' ? 'simulatedGP' : 'simulatedScore'
  return courses.map(c => values.has(c.id) ? { ...c, [field]: values.get(c.id)! } : c)
}

export function forecastBase(courses: ScoreRecord[], base: 'original' | 'simulated' | 'reverse', retake: ReverseResult | null) {
  if (base === 'reverse' && retake) return applyProposal(courses, retake)
  if (base === 'simulated') return courses
  return courses.map(c => c.isPredicted ? c : { ...c, simulatedScore: null, simulatedGP: null })
}

export function futureRecords(drafts: FutureCourse[], base: ScoreRecord[]): ScoreRecord[] {
  const semester = Math.max(0, ...base.map(c => c.semester)) + 1
  return drafts.map((c, order) => ({
    id: c.id, courseName: c.courseName, credits: c.credits, category: c.category, order, semester,
    originalScore: null, gradePoint: null, simulatedScore: c.lockedScore, simulatedGP: c.lockedGP,
    isPredicted: true, isCorrected: false, source: 'manual',
  }))
}

export function forecast(base: ScoreRecord[], future: ScoreRecord[], algo: AlgorithmConfig,
  target: number | null, type: ReverseResult['targetType']): ReverseResult {
  const gradeInputs = algo.type === 'grade' && (target == null || type === 'gpa')
  const values = new Map<string, number>()
  for (const c of future) {
    const v = gradeInputs ? c.simulatedGP : c.simulatedScore
    if (v != null && !inRange(v, gradeInputs ? algo.maxGPA : 100)) throw Error('请核对未来课程的预期成绩和绩点范围。')
    if (v != null) values.set(c.id, v)
  }
  if (!future.length) throw Error('请先添加未来课程。')
  if (target != null) {
    const r = calculateReverseTargets(future, base, target, algo, values, type)
    const start = summarize(base, 'simulatedScore', algo)[type]
    return { ...r, hasTarget: true, mode: 'predict', currentGPA: summarize(base, 'simulatedScore', algo).gpa, gap: start == null ? null : target - start }
  }
  if (values.size !== future.length) throw Error(gradeInputs ? '目标留空时，请填写每门未来课程的预期绩点。' : '目标留空时，请填写每门未来课程的预期分数。')
  const estimate = summarize([...base, ...future], 'simulatedScore', algo)
  const before = summarize(base, 'simulatedScore', algo)
  const targets = future.map(c => {
    const v = values.get(c.id)!
    return { courseId: c.id, courseName: c.courseName, credits: c.credits, currentScore: v, suggestedScore: v,
      locked: true, lockedValue: v, gpaContribution: 0, difficultyStars: 0, boundaryGain: false, overflow: false }
  })
  return { mode: 'predict', hasTarget: false, inputUnit: gradeInputs ? 'gpa' : 'score', targetGPA: 0, currentGPA: before.gpa,
    gap: 0, targetType: 'gpa', targets, achievable: true, estimatedGPA: estimate.gpa, estimatedWeightedAvg: estimate.weighted,
    estimatedArithAvg: estimate.arithmetic, warningMessage: estimate.gpa == null ? '当前规则下没有可计入 GPA 的课程。' : null }
}
