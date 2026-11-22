import { useEffect, useRef, useState } from 'react'
import { readJSON, writeJSON } from '../src/libs/api'
import { summarize } from '../src/libs/gpa-engine'
import type { ScoreRecord } from '../src/libs/types'

type School = { name: string; level: string; reason: string; sourceUrl?: string }
type Report = { report: string; schools: School[]; fingerprint: string; createdAt: string }
const directions = [['abroad', '留学申请'], ['domestic', '国内升学'], ['graduate', '毕业达标']] as const

function completionURL(base: string) {
  const url = new URL(base)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error('请填写 HTTPS 接口地址，本机调试可使用 HTTP。')
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions'
  return url.href
}

function publicLink(value?: string) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' ? url.href : undefined } catch { return undefined }
}

export default function Advisor({ workspaceId, courses, algorithm, connection, onConnectionChange }: {
  workspaceId: string; courses: ScoreRecord[]; algorithm: import('../src/libs/types').AlgorithmConfig
  connection: { base: string; model: string; apiKey: string }
  onConnectionChange: (value: { base: string; model: string; apiKey: string }) => void
}) {
  const { base, model, apiKey } = connection
  const [direction, setDirection] = useState('abroad')
  const [goals, setGoals] = useState('')
  const [result, setResult] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const real = courses.filter(c => !c.isPredicted)
  const fingerprint = JSON.stringify([real, algorithm, direction, goals])

  useEffect(() => {
    let alive = true
    readJSON<Report>(workspaceId, 'data/ai_advisor.json').then(saved => {
      if (alive && typeof saved?.report === 'string' && Array.isArray(saved.schools)) setResult(saved)
    }).catch(() => {})
    return () => { alive = false; controller.current?.abort() }
  }, [workspaceId])

  async function analyze() {
    if (busy) return
    setError('')
    let url: string
    try { url = completionURL(base.trim()) } catch (err) {
      setError(err instanceof Error ? err.message : '接口地址格式有误。')
      return
    }
    const current = new AbortController()
    controller.current = current
    const timeout = setTimeout(() => current.abort('timeout'), 120_000)
    setBusy(true)
    try {
      const response = await fetch(url, {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: current.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: model.trim(),
          messages: [
            { role: 'system', content: '你是学业规划助手。分析用户提供的真实课程与目标，区分原始与模拟成绩。给出优势、薄弱科目、具体可执行的提分计划。方向为留学或国内升学时给出选校候选与理由，毕业达标时给出缺口与改善计划。缺少专业、语言或地区等信息时明确哪些结论还需补充信息。你没有实时联网结果，不得编造最新录取分数、录取概率、官方认证或已核验的引用。学校仅作为待核实的候选，来源链接仅在确知时提供。只输出 JSON，格式为 {"report":"中文分析正文","schools":[{"name":"学校名","level":"冲刺/匹配/稳妥/待核实","reason":"匹配理由及待核实条件","sourceUrl":"可选的学校官方HTTPS链接"}]}。' },
            { role: 'user', content: JSON.stringify({
              direction, goals, courses: real,
              metrics: {
                algorithm: algorithm.name,
                original: summarize(real, 'originalScore', algorithm),
                simulated: summarize(real, 'simulatedScore', algorithm),
              },
            }) },
          ],
        }),
      })
      if (!response.ok) throw new Error(`调用失败（HTTP ${response.status}），请检查 Key、模型权限和接口额度。`)
      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回为空，请检查模型是否支持 Chat Completions。')
      let parsed: { report?: unknown; schools?: unknown }
      try { parsed = JSON.parse(content.trim().replace(/^\x60\x60\x60(?:json)?\s*|\x60\x60\x60$/g, '')) } catch { parsed = { report: content } }
      if (typeof parsed?.report !== 'string' || !parsed.report.trim()) throw new Error('分析结果格式无法读取，请重试。')
      const schools = Array.isArray(parsed.schools) ? parsed.schools.filter((school): school is School =>
        school && typeof school.name === 'string' && typeof school.level === 'string' && typeof school.reason === 'string'
      ) : []
      const saved: Report = { report: parsed.report, schools, fingerprint, createdAt: new Date().toISOString() }
      if (current.signal.aborted) return
      await writeJSON(workspaceId, 'data/ai_advisor.json', saved)
      setResult(saved)
    } catch (err) {
      if (current.signal.aborted) {
        if (current.signal.reason === 'timeout') setError('请求超时，请稍后重试。')
      } else if (err instanceof TypeError) {
        setError('无法连接模型接口，请确认地址可访问，并允许浏览器跨域请求。')
      } else setError(err instanceof Error ? err.message : '分析失败，请重试。')
    } finally { clearTimeout(timeout); controller.current = null; setBusy(false) }
  }

  return (
    <div className="advisor-layout">
      <form className="advisor-settings" onSubmit={event => { event.preventDefault(); void analyze() }}>
        <h3>连接你的模型</h3>
        <p className="report-footnote">使用兼容 OpenAI Chat Completions 的接口。Key 仅在本次打开期间保留，调用费用由你的服务商账号承担。</p>
        <label>接口地址<input type="url" value={base} disabled={busy} onChange={event => onConnectionChange({ ...connection, base: event.target.value })} required /></label>
        <label>模型名称<input value={model} disabled={busy} placeholder="填写服务商提供的模型名称" onChange={event => onConnectionChange({ ...connection, model: event.target.value })} required /></label>
        <label>API Key<input type="password" autoComplete="off" value={apiKey} disabled={busy} onChange={event => onConnectionChange({ ...connection, apiKey: event.target.value })} required /></label>
        <label>分析方向<select value={direction} disabled={busy} onChange={event => setDirection(event.target.value)}>
          {directions.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select></label>
        <label>你的目标<textarea rows={4} value={goals} disabled={busy} placeholder="目标地区、专业、申请阶段、语言成绩或毕业要求…" onChange={event => setGoals(event.target.value)} /></label>
        <p className="report-footnote">生成时会将当前课程、成绩和目标发送到上方接口。</p>
        <button className="button button-primary" disabled={busy || !apiKey.trim() || !model.trim() || !real.length}>{busy ? '正在分析…' : '生成分析与建议'}</button>
        {busy && <button type="button" className="button" onClick={() => controller.current?.abort()}>停止生成</button>}
        {error && <p className="import-error" role="alert">{error}</p>}
      </form>
      <div className="advisor-results" aria-live="polite">
        {result ? <>
          <h3>AI 成绩分析</h3>
          {result.fingerprint !== fingerprint && <p className="saved-message">成绩、算法或目标已更新，可以重新生成分析。</p>}
          <div className="advisor-report">{result.report}</div>
          {result.schools.length > 0 && <section className="school-suggestions"><h3>选校候选</h3><p className="report-footnote">候选建议由模型生成，请核实学校官网的专业要求与最新申请条件。</p>
            {result.schools.map((school, index) => <article key={index}><div><h4>{school.name}</h4><span>{school.level}</span></div><p>{school.reason}</p>
              {publicLink(school.sourceUrl) && <a href={publicLink(school.sourceUrl)} target="_blank" rel="noreferrer">查看来源 ↗</a>}
            </article>)}
          </section>}
        </> : <div className="advisor-empty"><h3>让成绩，成为下一步的线索。</h3><p>填入模型连接信息和你的目标，获取成绩分析、提分计划与选校候选。</p></div>}
      </div>
    </div>
  )
}
