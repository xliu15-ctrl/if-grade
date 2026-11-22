import { readJSON, SCORES_FILE } from '../src/libs/api'
import { PRESET_ALGORITHMS, resolveAlgorithm, getSemesterStats, distribution, scoreRanges, summarize, displayMetric, courseScore, courseGPA, isModified, gpaImpacts, improvementData } from '../src/libs/gpa-engine'
import type { AlgorithmConfig, CustomAlgorithm, ScoreRecord, ReverseResult } from '../src/libs/types'
import { DISCLAIMER } from './Disclaimer'

export type ChartSpec = { kind: 'bar' | 'line' | 'impact'; labels: string[]; original: (number | null)[]; simulated: (number | null)[]; max: number }
export type ReportBlock = { type: 'heading'; text: string } | { type: 'text'; text: string } | { type: 'table'; headers: string[]; rows: string[][]; widths?: number[] } | { type: 'chart'; spec: ChartSpec }
export interface ReportModel { title: string; date: string; source: string; algorithm: string; blocks: ReportBlock[] }
const n = displayMetric
export async function createReport(workspaceId: string): Promise<ReportModel> {
  const [courses, config, plan] = await Promise.all([
    readJSON<ScoreRecord[]>(workspaceId, SCORES_FILE),
    readJSON<{ activeAlgorithm: string; customAlgorithms?: CustomAlgorithm[] }>(workspaceId, 'data/gpa_config.json'),
    readJSON<{ version?: number; activeRetake?: boolean; reverseMode?: string; useWES?: boolean; targetCardInput?: string; targetCardIndex?: number; retakeResult?: ReverseResult; predictResult?: ReverseResult }>(workspaceId, 'data/reverse_state.json').catch(() => null),
  ])
  if (!courses?.length) throw new Error('没有可导出的成绩，请先导入或添加课程。')
  const algo = resolveAlgorithm(config?.activeAlgorithm, config?.customAlgorithms)
  const real = courses.filter(c => !c.isPredicted)
  const predicted = courses.filter(c => c.isPredicted)
  const effective = (c: ScoreRecord) => courseScore(c, 'simulatedScore')
  const changed = real.filter(isModified)
  const credits = real.reduce((s,c) => s+c.credits,0)
  const source = workspaceId === 'preview' ? '示例数据 · 非个人成绩' : '当前浏览器中的个人成绩'
  const blocks: ReportBlock[] = []
  const heading = (text: string) => blocks.push({ type: 'heading', text })
  const text = (text: string) => blocks.push({ type: 'text', text })
  const table = (headers: string[], rows: string[][], widths?: number[]) => blocks.push({ type: 'table', headers, rows, widths })
  heading('成绩与模拟概览')
  text(`本报告记录导出时的成绩与模拟结果。数据来源：${source}。当前算法：${algo.name}（满分 ${algo.maxGPA}）。实修课程 ${real.length} 门，合计 ${String(credits)} 学分，调整了 ${changed.length} 门课程，未来预测课程 ${predicted.length} 门。`)
  text('模拟汇总仅包含实修课程；未调整课程沿用原始分数。未来预测单独列出。图表依据完整数据重新绘制，与网页当前是否展开组件无关。')
  const before = summarize(real, 'originalScore', algo), after = summarize(real, 'simulatedScore', algo)
  const row = (label: string, a: number | null, b: number | null) => [label,n(a),n(b),a == null || b == null ? '—' : n(b-a)]
  const wes = PRESET_ALGORITHMS.wes_4_0
  table(['指标','原始','模拟','变化'],[
    row('GPA', before.gpa, after.gpa), row('加权均分', before.weighted, after.weighted), row('算术均分', before.arithmetic, after.arithmetic),
    row('WES 估算', summarize(real, 'originalScore', wes).gpa, summarize(real, 'simulatedScore', wes).gpa),
  ],[.37,.21,.21,.21])
  heading('成绩分布')
  const origCounts = distribution(real, 'originalScore'), simCounts = distribution(real, 'simulatedScore')
  blocks.push({type:'chart',spec:{kind:'bar',labels:scoreRanges,original:origCounts,simulated:simCounts,max:Math.max(1,...origCounts,...simCounts)}})
  heading('学期 GPA 与均分趋势')
  const terms = getSemesterStats(real,algo).map(s => {
    const rows = real.filter(c => c.semester === s.semester)
    return { ...s, before: summarize(rows, 'originalScore', algo), after: summarize(rows, 'simulatedScore', algo) }
  })
  blocks.push({type:'chart',spec:{kind:'line',labels:terms.map(s=>s.semesterLabel),original:terms.map(s=>s.before.gpa),simulated:terms.map(s=>s.after.gpa),max:algo.maxGPA}})
  table(['学期','课程 / 学分','原始 GPA','模拟 GPA','原始均分','模拟均分'],terms.map(s=>[s.semesterLabel,s.courseCount+' / '+s.totalCredits,n(s.before.gpa),n(s.after.gpa),n(s.before.weighted),n(s.after.weighted)]),[.26,.18,.14,.14,.14,.14])
  heading('成绩模拟明细')
  table(['课程','学期','学分','原始分','模拟分','原始绩点','模拟绩点'],real.map(c=>[c.courseName,c.semesterTitle || '第 '+c.semester+' 学期',String(c.credits),n(c.originalScore),n(effective(c)),n(courseGPA(c,'originalScore',algo)),n(courseGPA(c,'simulatedScore',algo))]),[.25,.15,.08,.13,.13,.13,.13])
  heading('课程对 GPA 的影响')
  const impacts = gpaImpacts(real,algo).map(({course,delta})=>({name:course.courseName,delta}))
  if (!impacts.length) {
    text('尚无影响 GPA 的成绩变动。')
  } else {
    const sorted = [...impacts].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,12)
    blocks.push({type:'chart',spec:{kind:'impact',labels:sorted.map(c=>c.name),original:sorted.map(()=>0),simulated:sorted.map(c=>c.delta),max:Math.max(.001,...sorted.map(c=>Math.abs(c.delta)))}})
    text('图中展示绝对影响最大的前 12 门，完整变化列于下表。贡献为分段绩点变化按学分加权的结果，汇总 GPA 另按所选精度取整。')
    table(['课程','GPA 贡献'],impacts.map(c=>[c.name,(c.delta>=0?'+':'')+n(c.delta,4)]),[.75,.25])
  }
  heading('多算法 GPA 对比')
  table(['算法','满分','原始 GPA','模拟 GPA'],Object.values(PRESET_ALGORITHMS).map(a=>{
    return [a.name,String(a.maxGPA),n(summarize(real,'originalScore',a).gpa),n(summarize(real,'simulatedScore',a).gpa)]
  }),[.49,.13,.19,.19])
  if (algo.type !== 'grade') {
    heading('提分潜力')
    text('每门课程在原始分基础上单独提高 10 分，最高为 100 分。按 GPA 加权增量排序，展示前 8 门；不叠加当前模拟分。')
    const potential = improvementData(real,algo)
    table(['课程','原始分','提分后','GPA 增量'],potential.map(c=>[c.name,n(c.score),n(Math.min(100,c.score+10)),'+'+n(c['+10'],4)]),[.46,.18,.18,.18])
  }
  if (predicted.length) {
    heading('未来课程预测')
    const summary = summarize(courses,'simulatedScore',algo)
    text('加入已保存的未来课程后，整体模拟 GPA 为 '+n(summary.gpa)+'，加权均分为 '+n(summary.weighted)+'。')
    table(['课程','学期','学分','假设分数','假设绩点'],predicted.map(c=>[c.courseName,c.semester > 0 ? '第 '+c.semester+' 学期' : '未来学期',String(c.credits),n(effective(c)),n(courseGPA(c,'simulatedScore',algo))]),[.36,.19,.13,.16,.16])
  }
  const basis = JSON.stringify([courses, plan?.useWES ? wes : algo])
  const plans = [['上次保存的重修反推方案',plan?.reverseMode === 'retake' && !plan.activeRetake ? null : plan?.retakeResult],['上次保存的未来预测方案',plan?.predictResult]] as const
  for (const [title, result] of plans) {
    if (plan?.version !== 2 || !result?.targets?.length || result.basis !== basis) continue
    heading(title)
    text('以下为规划面板上次保存的方案快照，成绩或算法变化后可能失效；使用前请在规划面板重新计算。')
    if (result.hasTarget === false) text('依据已填的未来课程成绩直接预测。')
    else text(`目标类型：${{gpa:'GPA',weighted:'加权均分',arithmetic:'算术均分'}[result.targetType] || result.targetType}；目标值：${result.targetGPA}；可达性：${result.achievable?'按该方案可达':'当前条件下未达成'}。`)
    text('按该方案估算，GPA '+n(result.estimatedGPA)+'，加权均分 '+n(result.estimatedWeightedAvg)+'，算术均分 '+n(result.estimatedArithAvg)+'。')
    const unit = result.inputUnit === 'gpa' ? '绩点' : '分数'
    table(['课程','学分','当前'+unit,'建议'+unit],result.targets.map(t=>[t.courseName,String(t.credits),n(t.currentScore),n(t.suggestedScore)]),[.46,.18,.18,.18])
  }
  heading('免责声明与数据说明')
  text(DISCLAIMER)
  text('本报告在浏览器本地生成，不通过 AI 接口，不包含 API Key 或智能体访问令牌。PDF 保留排版；Word 文本与表格可编辑。图表为静态图片。请妥善保管导出的个人成绩。')
  return {title:'成绩分析与模拟报告',date:new Date().toLocaleString('zh-CN',{hour12:false}),source,algorithm:algo.name,blocks}
}

