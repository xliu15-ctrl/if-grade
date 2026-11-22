import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const { outputFiles } = await build({
  stdin: { contents: "export * from './src/libs/gpa-engine';export * from './src/libs/forecast';export {createReport} from './site/reportModel';export {readJSON} from './src/libs/api'",
    resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm',
  define: { __GPA_BROWSER_MODE__: 'true' },
})
const G = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
const scales = G.PRESET_ALGORITHMS
const standard = scales.standard_4_0, grade = scales.bnbu_4_0, wes = scales.wes_4_0
const row = (id, credits, originalScore, other = {}) => ({
  id, courseName: id, semester: 1, category: '专业必修', order: 0, source: 'manual', isCorrected: false,
  credits, originalScore, simulatedScore: null, ...other,
})
const courses = [row('A', 3, 89.5), row('B', 1, 59)]
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-9, a+' ≠ '+b)
const solve = (selected, fixed, target, algo = standard, locks = [], type = 'gpa') =>
  G.calculateReverseTargets(selected, fixed, target, algo, new Map(locks), type)

const tables = {
  standard_4_0: [[0,0],[60,1],[64,1.5],[68,2],[72,2.3],[75,2.7],[78,3],[82,3.3],[85,3.7],[90,4]],
  tsinghua_4_0: [[0,0],[60,1],[63,1.3],[67,1.7],[70,2],[73,2.3],[77,2.7],[80,3],[85,3.3],[90,3.7],[95,4]],
  sjtu_4_3: [[0,0],[60,1],[62,1.7],[65,2],[67,2.3],[70,2.7],[75,3],[80,3.3],[85,3.7],[90,4],[95,4.3]],
  ustc_4_3: [[0,0],[60,1],[61,1.3],[64,1.5],[65,1.7],[68,2],[72,2.3],[75,2.7],[78,3],[82,3.3],[85,3.7],[90,4],[95,4.3]],
  zju_5_0: [[0,0],[60,1.5],[62,1.8],[65,2.1],[68,2.4],[71,2.7],[74,3],[77,3.3],[80,3.6],[83,3.9],[86,4.2],[89,4.5],[92,4.8],[95,5]],
  zju_4_3: [[0,0],[60,1.5],[62,1.8],[65,2.1],[68,2.4],[71,2.7],[74,3],[77,3.3],[80,3.6],[83,3.9],[86,4],[89,4.1],[92,4.2],[95,4.3]],
  wes_4_0: [[0,0],[60,2],[75,3],[85,4]],
}
for (const [id, bands] of Object.entries(tables)) {
  test(id + ' 百分制全区间与最小反算分数', () => {
    const scale = scales[id]
    for (let i=0; i<=10000; i++) {
      const score = i/100
      assert.equal(G.scoreToGPA(score,scale), bands.findLast(([min])=>min <= score)[1])
    }
    for (let i=0;i<=Math.round(scale.maxGPA*100);i++) {
      const gp = i/100, score = G.gpaToScore(gp,scale)
      assert.equal(score, bands.find(([,v])=>v>=gp)[0])
    }
  })
}
for (const [id, formula] of [
  ['pku_4_0', s=>s<60 ? 0 : 4-3*(100-s)**2/1600],
  ['five_point', s=>s<60 ? 0 : s/10-5],
]) test(id + ' 连续计算与反算精度', () => {
  const scale = scales[id]
  for (let i=0;i<=10000;i++) close(G.scoreToGPA(i/100,scale),formula(i/100))
  for (let i=1;i<=Math.round(scale.maxGPA*100);i++) {
    const v=i/100, s=G.gpaToScore(v,scale)
    assert.ok(formula(s) + 1e-12 >= v && formula(s-.01) < v)
  }
})
test('均分、百分制 GPA、不等学分与零学分',()=>{
  assert.deepEqual(G.summarize(courses,'originalScore',standard),{gpa:2.78,weighted:81.88,arithmetic:74.25})
  assert.deepEqual(G.summarize([...courses,row('附加',0,100)],'originalScore',standard),{gpa:2.78,weighted:81.88,arithmetic:82.83})
  assert.deepEqual(G.summarize([courses[0],{...courses[1],simulatedScore:85}],'simulatedScore',standard),{gpa:3.7,weighted:88.38,arithmetic:87.25})
  assert.equal(G.findNextBoundary(74.9,standard).min,75)
  assert.deepEqual(G.distribution([row('无',1,null),row('零',2,0),row('边界',1,89.99),row('满分',1,100)],'originalScore'),[1,0,0,1,1])
})
test('原始与模拟等级制，区分不及格、缺失、明确的模拟零分',()=>{
  const rows=[row('A-',3,null,{gradePoint:3.67}),row('F',1,null,{gradePoint:0}),row('S',8,null)]
  assert.deepEqual(G.summarize(rows,'originalScore',grade),{gpa:2.75,weighted:null,arithmetic:null})
  assert.equal(G.courseGPA({...rows[0],simulatedGP:0},'simulatedScore',grade),0)
  assert.equal(G.gradeToGPA('E',grade),0)
  assert.equal(G.courseScore(row('未来',2,0,{isPredicted:true}),'simulatedScore'),null)
  assert.equal(G.courseScore(row('未来',2,0,{isPredicted:true,simulatedScore:0}),'simulatedScore'),0)
  assert.deepEqual(G.summarize([],'originalScore',standard),{gpa:null,weighted:null,arithmetic:null})
  assert.equal(G.summarize([row('满绩',2,null,{gradePoint:4.8})],'originalScore',scales.transcript_gpa).gpa,4.8)
})
test('WES 逐科折算、分类排除、自定义权重和分档',()=>{
  const rows=[row('计算',3,85),row('英语',2,74.9,{category:'大学英语'}),row('体育（一）',4,100,{category:'公必'})]
  assert.equal(G.wesCourse(rows[2],'originalScore').excluded,true)
  assert.equal(G.calculateWESGPA(rows,'originalScore'),3.5)
  assert.equal(G.summarize(rows,'originalScore',wes).gpa,3.5)
  const cfg={creditCoefficients:{'专业必修':2,'大学英语':1}, excludeCategories:[], scoreConversion:[{min:80,max:100,grade:'A',gpa:3},{min:0,max:79,grade:'B',gpa:1}]}
  assert.equal(G.calculateWESGPA(rows.slice(0,2),'originalScore',cfg),2.5)
  assert.equal(G.wesCourse(row('体育经济学',2,90),'originalScore').excluded,false)
})
test('模拟贡献之和等于未舍入 GPA 的真实变化，包括缺失分母变化',()=>{
  const rows=[row('A',4,90),row('B',1,null,{simulatedScore:0})]
  const delta=G.gpaImpacts(rows,standard).reduce((a,x)=>a+x.delta,0)
  close(delta,G.rawGPA(rows,'simulatedScore',standard)-G.rawGPA(rows,'originalScore',standard))
  const wei=[row('A',3,84),row('B',2,74,{category:'大学英语'}),row('体育',3,90)]
  for (const candidate of G.improvementData(wei,wes)) {
    const after=wei.map(c=>c.id===candidate.id?{...c,simulatedScore:Math.min(100,c.originalScore+10)}:c)
    close(candidate['+10'],G.rawGPA(after,'simulatedScore',wes)-G.rawGPA(wei,'originalScore',wes))
  }
})
test('重修达标、不可达、锁定与已达标的高分',()=>{
  const result=solve([courses[1]],[courses[0]],3.7)
  assert.equal(result.targets[0].suggestedScore,85)
  assert.equal(result.achievable,true)
  assert.equal(result.estimatedGPA,3.7)
  assert.deepEqual(G.summarize(G.applyProposal(courses,result),'simulatedScore',standard).gpa,result.estimatedGPA)
  assert.equal(solve([row('已高分',1,97),courses[1]],[],3.7).targets[0].suggestedScore,97)
  assert.equal(solve([courses[1]],[courses[0]],3.7,standard,[['B',60]]).achievable,false)
  assert.equal(solve([row('满分',1,100)],[row('F',2,0)],1.334).achievable,false)
  assert.equal(solve([],courses,3).achievable,false)
  const weighted=solve([courses[1]],[courses[0]],85,standard,[],'weighted')
  const arithmetic=solve([courses[1]],[courses[0]],85,standard,[],'arithmetic')
  assert.equal(weighted.targets[0].suggestedScore,71.5)
  assert.equal(arithmetic.targets[0].suggestedScore,80.5)
})
test('等级制重修和 WES 反推使用各自单位及有效学分',()=>{
  const low=row('F',2,null,{gradePoint:0}), high=row('A',2,null,{gradePoint:4})
  const result=solve([low],[high],3.8,grade)
  assert.equal(result.inputUnit,'gpa')
  assert.equal(result.targets[0].suggestedScore,3.67)
  assert.equal(G.applyProposal([low],result)[0].simulatedScore,null)
  assert.equal(G.applyProposal([low],result)[0].simulatedGP,3.67)
  const skip=row('体育',1,88), other=row('英语',2,70,{category:'大学英语'})
  const w=solve([other,skip],[row('核心',3,90)],3.75,wes)
  assert.deepEqual(w.targets.map(t=>t.courseId),['英语'])
  assert.equal(w.targets[0].suggestedScore,75)
  assert.equal(w.estimatedGPA,3.75)
})
test('原始、模拟与重修预测基准；无目标时保留已填分数和 0',()=>{
  const real=[{...courses[0],simulatedScore:95},courses[1]]
  const drafts=[{id:'未来',courseName:'未来',credits:2,category:'专业必修',lockedScore:80,lockedGP:null}]
  const future=G.futureRecords(drafts,real)
  const base=G.forecastBase(real,'original',null)
  const p=G.forecast(base,future,standard,null,'gpa')
  assert.equal(p.targets[0].suggestedScore,80)
  assert.equal(p.estimatedGPA,2.85)
  assert.equal(p.estimatedWeightedAvg,81.25)
  assert.equal(G.forecast(G.forecastBase(real,'simulated',null),future,standard,null,'gpa').estimatedGPA,3)
  const retake=solve([real[1]],[real[0]],4)
  assert.equal(G.forecast(G.forecastBase(real,'reverse',retake),future,standard,null,'gpa').estimatedGPA,3.67)
  assert.throws(()=>G.forecast(base,[{...future[0],simulatedScore:null}],standard,null,'gpa'))
  assert.equal(G.forecast([], [{...future[0],simulatedScore:0}],standard,null,'gpa').estimatedGPA,0)
})
test('有目标预测保留已填分数，仅反推未填写的课程',()=>{
  const planned=[row('固定',2,null,{simulatedScore:80,isPredicted:true}),row('待定',2,null,{isPredicted:true})]
  const p=G.forecast([],planned,standard,3.5,'gpa')
  assert.equal(p.targets.find(c=>c.courseId==='固定').suggestedScore,80)
  assert.equal(p.targets.find(c=>c.courseId==='待定').suggestedScore,90)
  assert.equal(p.achievable,true)
  assert.equal(G.summarize(G.applyProposal(planned,p),'simulatedScore',standard).gpa,3.5)
})
test('有效自定义规则可解析，重叠、缺段、倒序、NaN 均被拒绝，模棱两可的录入不会误认算法',()=>{
  const bands=[{grade:'F',min:0,max:59,gpa:0},{grade:'P',min:60,max:100,gpa:4}]
  assert.equal(G.validateMappings('segmented',4,bands),null)
  for (const changes of [{min:61},{min:58},{gpa:NaN},{max:99},{grade:'F'}]) assert.ok(G.validateMappings('segmented',4,[bands[0],{...bands[1],...changes}]))
  const cfg={id:'local',name:'本校',maxGPA:4,type:'segmented',precision:2,mappings:bands}
  assert.equal(G.scoreToGPA(59.99,G.resolveAlgorithm('local',[cfg])),0)
  assert.equal(G.resolveAlgorithm('zju_4.3').id,scales.zju_4_3.id)
  assert.equal(G.detectAlgorithm([1,2,3].map(i=>row(String(i),2,90,{gradePoint:4}))),null)
})
test('网页导出与实修汇总一致，旧占位不计入，零分和旧预测记录妥善保留',async()=>{
  globalThis.window={location:{href:'http://localhost:3000/#scores'}}
  const files=new Map(), key=(f)=>'gpa-simulator:/:audit:data/'+f+'.json'
  globalThis.localStorage={getItem:k=>files.get(k)??null}
  const records=[...courses.map((c,i)=>i===1?{...c,simulatedScore:85}:c),row('未提供分数',2,null,{gradePoint:3.67}),row('未来',1,0,{isPredicted:true,simulatedScore:80,semester:-1}),
    row('sem_123',0,0,{courseName:'（示例课程，可编辑或删除）'})]
  files.set(key('scores'),JSON.stringify(records)); files.set(key('gpa_config'),JSON.stringify({activeAlgorithm:'standard_4_0'}))
  files.set(key('reverse_state'),JSON.stringify({retakeResult:{targets:[{}]}}))
  const report=await G.createReport('audit')
  const table=report.blocks.find(b=>b.type==='table')
  assert.deepEqual(table.rows[0],['GPA','2.78','3.70','0.92'])
  assert.deepEqual(table.rows[1].slice(0,3),['加权均分','81.88','88.38'])
  const dist=report.blocks.find(b=>b.type==='chart')
  assert.deepEqual(dist.spec.original,[1,0,0,1,0])
  assert.ok(!JSON.stringify(report).includes('第 -1 学期'))
  assert.ok(!JSON.stringify(report).includes('（示例课程，可编辑或删除）'))
  assert.ok(!JSON.stringify(report).includes('上次保存的重修反推方案'))
  files.set(key('gpa_config'),JSON.stringify({activeAlgorithm:'bnbu_4_0'}))
  const gradereport=await G.createReport('audit')
  assert.equal(gradereport.blocks.find(b=>b.type==='table').rows[0][1],'3.67')
})
