import { readJSON, SCORES_FILE } from '../src/libs/api'
import { PRESET_ALGORITHMS, customToAlgoConfig, calculateGPA, weightedAvg, arithmeticAvg, calculateWESGPA, getSemesterStats, scoreToGPA } from '../src/libs/gpa-engine'
import type { AlgorithmConfig, CustomAlgorithm, ScoreRecord, ReverseResult } from '../src/libs/types'
import { DISCLAIMER } from './Disclaimer'

export type ChartSpec = { kind: 'bar' | 'line' | 'impact'; labels: string[]; original: number[]; simulated: number[]; max: number }
export type ReportBlock = { type: 'heading'; text: string } | { type: 'text'; text: string } | { type: 'table'; headers: string[]; rows: string[][]; widths?: number[] } | { type: 'chart'; spec: ChartSpec }
export interface ReportModel { title: string; date: string; source: string; algorithm: string; blocks: ReportBlock[] }
const n = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—'
export async function createReport(workspaceId: string): Promise<ReportModel> {
  const [courses, config, plan] = await Promise.all([
    readJSON<ScoreRecord[]>(workspaceId, SCORES_FILE),
    readJSON<{ activeAlgorithm: string; customAlgorithms?: CustomAlgorithm[] }>(workspaceId, 'data/gpa_config.json'),
    readJSON<{ targetCardInput?: string; targetCardIndex?: number; retakeResult?: ReverseResult; predictResult?: ReverseResult }>(workspaceId, 'data/reverse_state.json').catch(() => null),
  ])
  if (!courses?.length) throw new Error('没有可导出的成绩，请先导入或添加课程。')
  const custom = config?.customAlgorithms?.find(a => a.id === config.activeAlgorithm)
  const algo: AlgorithmConfig | undefined = custom ? customToAlgoConfig(custom) : Object.entries(PRESET_ALGORITHMS).find(([key, a]) => key === config?.activeAlgorithm || a.id === config?.activeAlgorithm)?.[1]
  if (!algo) throw new Error('当前 GPA 算法无法读取，请重新选择算法后导出。')
  const real = courses.filter(c => !c.isPredicted)
  const predicted = courses.filter(c => c.isPredicted)
  const effective = (c: ScoreRecord) => c.simulatedScore ?? c.originalScore
  const changed = real.filter(c => c.simulatedScore != null && c.simulatedScore !== c.originalScore)
  const credits = real.reduce((s,c) => s+c.credits,0)
  const source = workspaceId === 'preview' ? '示例数据 · 非个人成绩' : '当前浏览器中的个人成绩'
  const blocks: ReportBlock[] = []
  const heading = (text: string) => blocks.push({ type: 'heading', text })
  const text = (text: string) => blocks.push({ type: 'text', text })
  const table = (headers: string[], rows: string[][], widths?: number[]) => blocks.push({ type: 'table', headers, rows, widths })
  heading('成绩与模拟概览')
  text(`本报告记录导出时的成绩与模拟结果。数据来源：${source}。当前算法：${algo.name}（满分 ${algo.maxGPA}）。实修课程 ${real.length} 门，合计 ${n(credits,1)} 学分，调整了 ${changed.length} 门课程，未来预测课程 ${predicted.length} 门。`)
  text('模拟汇总仅包含实修课程；未调整课程沿用原始分数。未来预测单独列出。图表依据完整数据重新绘制，与网页当前是否展开组件无关。')
  table(['指标','原始','模拟','变化'], [
    ['GPA', n(calculateGPA(real,'originalScore',algo)),n(calculateGPA(real,'simulatedScore',algo)), n(calculateGPA(real,'simulatedScore',algo)-calculateGPA(real,'originalScore',algo))],
    ['加权均分', n(weightedAvg(real,'originalScore')),n(weightedAvg(real,'simulatedScore')), n(weightedAvg(real,'simulatedScore')-weightedAvg(real,'originalScore'))],
    ['算术均分', n(arithmeticAvg(real,'originalScore')),n(arithmeticAvg(real,'simulatedScore')), n(arithmeticAvg(real,'simulatedScore')-arithmeticAvg(real,'originalScore'))],
    ['WES 估算', n(calculateWESGPA(real,'originalScore')),n(calculateWESGPA(real,'simulatedScore')), n(calculateWESGPA(real,'simulatedScore')-calculateWESGPA(real,'originalScore'))],
  ],[.37,.21,.21,.21])
  heading('成绩分布')
  const buckets = [[0,60],[60,70],[70,80],[80,90],[90,101]]
  const origCounts = buckets.map(([lo,hi]) => real.filter(c=>c.originalScore>=lo && c.originalScore<hi).length)
  const simCounts = buckets.map(([lo,hi]) => real.filter(c=>effective(c)>=lo && effective(c)<hi).length)
  blocks.push({type:'chart',spec:{kind:'bar',labels:['0–59','60–69','70–79','80–89','90–100'],original:origCounts,simulated:simCounts,max:Math.max(1,...origCounts,...simCounts)}})
  heading('学期 GPA 与均分趋势')
  const terms = getSemesterStats(real,algo)
  blocks.push({type:'chart',spec:{kind:'line',labels:terms.map(s=>s.semesterLabel),original:terms.map(s=>s.originalGPA),simulated:terms.map(s=>s.simulatedGPA),max:algo.maxGPA}})
  table(['学期','课程 / 学分','原始 GPA','模拟 GPA','原始均分','模拟均分'],terms.map(s=>[s.semesterLabel,`${s.courseCount} / ${n(s.totalCredits,1)}`,n(s.originalGPA),n(s.simulatedGPA),n(s.originalAvg),n(s.simulatedAvg)]),[.26,.18,.14,.14,.14,.14])
  heading('成绩模拟明细')
  table(['课程','学期','学分','原始分','模拟分','分差'],real.map(c=>[c.courseName,c.semesterTitle || `第 ${c.semester} 学期`,n(c.credits,1),n(c.originalScore,1),n(effective(c),1),n(effective(c)-c.originalScore,1)]),[.31,.19,.1,.14,.14,.12])
  heading('课程对 GPA 的影响')
  if (algo.type === 'grade') {
    text('当前为原始绩点算法。百分制模拟分不会改变已录入的原始绩点，因此不生成百分制提分贡献图。')
  } else if (!changed.length || !credits) {
    text('尚无分数变动。调整模拟分后可查看每门课程对 GPA 的加权贡献。')
  } else {
    const impacts = changed.map(c=>({name:c.courseName,delta:(scoreToGPA(effective(c),algo)-scoreToGPA(c.originalScore,algo))*c.credits/credits}))
    const sorted = [...impacts].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,12)
    blocks.push({type:'chart',spec:{kind:'impact',labels:sorted.map(c=>c.name),original:sorted.map(()=>0),simulated:sorted.map(c=>c.delta),max:Math.max(.001,...sorted.map(c=>Math.abs(c.delta)))}})
    text('图中展示绝对影响最大的前 12 门，完整变化列于下表。贡献为分段绩点变化按学分加权的结果，汇总 GPA 另按所选精度取整。')
    table(['课程','GPA 贡献'],impacts.map(c=>[c.name,(c.delta>=0?'+':'')+n(c.delta,4)]),[.75,.25])
  }
  heading('多算法 GPA 对比')
  table(['算法','满分','原始 GPA','模拟 GPA'],Object.values(PRESET_ALGORITHMS).map(a=>{
    const available = a.type !== 'grade' || real.some(c=>c.gradePoint!=null)
    return [a.name,n(a.maxGPA,1),available?n(calculateGPA(real,'originalScore',a)):'无原始绩点',available?n(calculateGPA(real,'simulatedScore',a)):'无原始绩点']
  }),[.49,.13,.19,.19])
  if (algo.type !== 'grade') {
    heading('提分潜力')
    text('每门课程在原始分基础上单独提高 10 分，最高为 100 分。按 GPA 加权增量排序，展示前 8 门；不叠加当前模拟分。')
    const potential = real.map(c=>({c,gain:(scoreToGPA(Math.min(100,c.originalScore+10),algo)-scoreToGPA(c.originalScore,algo))*c.credits/(credits||1)})).sort((a,b)=>b.gain-a.gain).slice(0,8)
    table(['课程','原始分','提分后','GPA 增量'],potential.map(({c,gain})=>[c.courseName,n(c.originalScore,1),n(Math.min(100,c.originalScore+10),1),'+'+n(gain,4)]),[.46,.18,.18,.18])
  }
  if (predicted.length) {
    heading('未来课程预测')
    text(`预测课程加入后，整体 GPA 预估为 ${n(calculateGPA(courses,'simulatedScore',algo))}，加权均分 ${n(weightedAvg(courses,'simulatedScore'))}。这是情境假设，不属于已取得的成绩。`)
    table(['课程','学期','学分','假设分数'],predicted.map(c=>[c.courseName,`第 ${c.semester} 学期`,n(c.credits,1),n(effective(c),1)]),[.45,.2,.15,.2])
  }
  const plans = [['上次保存的重修反推方案',plan?.retakeResult],['上次保存的未来预测方案',plan?.predictResult]] as const
  for (const [title, result] of plans) {
    if (!result?.targets?.length) continue
    heading(title)
    text('以下为规划面板上次保存的方案快照，成绩或算法变化后可能失效；使用前请在规划面板重新计算。')
    text(`目标类型：${{gpa:'GPA',weighted:'加权均分',arithmetic:'算术均分'}[result.targetType] || result.targetType}；目标值：${result.targetGPA}；可达性：${result.achievable?'按该方案可达':'当前条件下未达成'}。`)
    table(['课程','学分','当前分','建议分'],result.targets.map(t=>[t.courseName,n(t.credits,1),n(t.currentScore,1),n(t.suggestedScore,1)]),[.46,.18,.18,.18])
  }
  heading('免责声明与数据说明')
  text(DISCLAIMER)
  text('本报告在浏览器本地生成，不通过 AI 接口，不包含 API Key 或智能体访问令牌。PDF 保留排版；Word 文本与表格可编辑。图表为静态图片。请妥善保管导出的个人成绩。')
  return {title:'成绩分析与模拟报告',date:new Date().toLocaleString('zh-CN',{hour12:false}),source,algorithm:algo.name,blocks}
}

