import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDown, ArrowUpRight, Database } from 'lucide-react'
import { ensureDataFile, readJSON, SCORES_FILE } from '../src/libs/api'
import type { ScoreRecord } from '../src/libs/types'
import BrowserImport from './BrowserImport'
import { DEMO_COURSES, DEMO_WORKSPACE, USER_WORKSPACE } from './demo'
import { useSectionMotion } from './useSectionMotion'
import Advisor from './Advisor'
import JourneyScene from './JourneyScene'
import Disclaimer from './Disclaimer'
import { initialAgentConnection } from './agent'

const ScoresPanel = lazy(() => import('../src/panels/scores'))
const AnalyzePanel = lazy(() => import('../src/panels/analyze'))
const navigation = [
  { id: 'home', title: '主页' },
  { id: 'import', title: '导入成绩' },
  { id: 'scores', title: '成绩模拟' },
  { id: 'analyze', title: '图表分析' },
  { id: 'wes', title: 'WES 模拟' },
  { id: 'advisor', title: 'AI 分析与选校' },
]

function App() {
  const [aiConnection, setAIConnection] = useState({ base: 'https://api.openai.com/v1', model: '', apiKey: '' })
  const [agentConnection, setAgentConnection] = useState(initialAgentConnection)
  useSectionMotion()
  const [workspaceId, setWorkspaceId] = useState('')
  const [active, setActive] = useState('home')
  const [courses, setCourses] = useState<ScoreRecord[]>(DEMO_COURSES)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [importVersion, setImportVersion] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const userCourses = await ensureDataFile<ScoreRecord[]>(USER_WORKSPACE, SCORES_FILE, [])
      const id = userCourses.length ? USER_WORKSPACE : DEMO_WORKSPACE
      const records = id === USER_WORKSPACE ? userCourses : await ensureDataFile(id, SCORES_FILE, DEMO_COURSES)
      await ensureDataFile(id, 'data/gpa_config.json', { activeAlgorithm: 'standard_4_0' })
      if (alive) {
        setCourses(records)
        setWorkspaceId(id)
      }
    })().catch(() => setError('无法读取浏览器存储，请允许此网站存储数据后刷新。'))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail.workspaceId === workspaceId && detail.filePath === SCORES_FILE) {
        readJSON<ScoreRecord[]>(workspaceId, SCORES_FILE).then(setCourses).catch(() => {})
      }
    }
    window.addEventListener('gpa-data-change', sync)
    return () => window.removeEventListener('gpa-data-change', sync)
  }, [workspaceId])

  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>('main > section[id]')]
    const header = document.querySelector<HTMLElement>('.site-header')
    let frame = 0
    const update = () => {
      frame = 0
      const marker = (header?.offsetHeight || 80) + 72
      let current = sections[0]?.id || 'home'
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= marker) current = section.id
      }
      setActive(current)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    sections.forEach(section => observer.observe(section))
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  const demo = workspaceId !== USER_WORKSPACE

  return (
    <>
      <header className="site-header">
        <div className="site-width header-content">
          <a className="wordmark" href="#home" aria-label="If Grade 主页">If Grade<span>.</span></a>
          <nav aria-label="主导航">
            {navigation.map(item => (
              <a key={item.id} href={`#${item.id}`} aria-current={active === item.id ? 'location' : undefined}
                onClick={() => setActive(item.id)}>{item.title}</a>
            ))}
          </nav>
        </div>
      </header>

      <main className="site-width site-main">
        <section id="home" className="hero">
          <div className="hero-copy">
            <h1>下一分努力，<br />能让 GPA <em>走多远？</em></h1>
            <p>导入成绩，试着改一门分数。<br />从均分到绩点，看清每一步提升。</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#scores">开始模拟 <ArrowUpRight size={17} aria-hidden="true" /></a>
              <a className="hero-link" href="#import">导入我的成绩 <ArrowDown size={15} aria-hidden="true" /></a>
            </div>
            <span className="hero-note"><Database size={13} aria-hidden="true" /> 成绩保存在当前浏览器</span>
          </div>

          <JourneyScene />
          <a href="#import" className="scroll-cue" aria-label="向下浏览"><ArrowDown size={19} aria-hidden="true" /></a>
        </section>

        {error && <p className="import-error" role="alert">{error}</p>}

        <section id="import" className="page-section">
          <div className="section-heading"><h2>从一张成绩单开始。</h2><p>本地识别，或选择 AI 帮你整理。</p></div>
          <BrowserImport key={importVersion} workspaceId={USER_WORKSPACE} agentConnection={agentConnection} onAgentConnectionChange={setAgentConnection} onConfirm={(added, skipped) => {
            setWorkspaceId(USER_WORKSPACE)
            setImportVersion(version => version + 1)
            setMessage(`已导入 ${added} 门课程${skipped ? `，跳过 ${skipped} 门重复课程` : ''}。`)
            readJSON<ScoreRecord[]>(USER_WORKSPACE, SCORES_FILE).then(setCourses).catch(() => {})
            requestAnimationFrame(() => document.getElementById('scores')?.scrollIntoView({ block: 'start' }))
          }} />
        </section>

        <section id="scores" className="page-section">
          <div className="section-heading"><h2>把「如果」变成数字。</h2><p>调整课程分数，比较变化，也为未来设一个目标。</p></div>
          {demo && <p className="demo-note">当前为可编辑的示例成绩，导入你的成绩后会自动替换。</p>}
          {message && <p className="saved-message" role="status">{message}</p>}
          <Suspense fallback={<p className="panel-loading">正在加载成绩…</p>}>
            {workspaceId && <div className="feature-panel scores-panel"><ScoresPanel key={`scores-${workspaceId}-${importVersion}`} workspaceId={workspaceId} /></div>}
          </Suspense>
        </section>

        <section id="analyze" className="page-section">
          <div className="section-heading"><h2>看见成绩背后的轨迹。</h2><p>独立查看分布、趋势和提分空间。</p></div>
          <Suspense fallback={<p className="panel-loading">正在加载分析…</p>}>
            {workspaceId && <div className="feature-panel analysis-panel"><AnalyzePanel key={workspaceId} workspaceId={workspaceId} view="charts" /></div>}
          </Suspense>
        </section>
        <section id="wes" className="page-section wes-page">
          <div className="section-heading"><h2>换一个刻度，认识你的成绩。</h2><p>单独查看 WES 换算、排除课程与分数映射。</p></div>
          <Suspense fallback={<p>正在加载 WES 模拟…</p>}>
            {workspaceId && <div className="feature-panel wes-panel"><AnalyzePanel workspaceId={workspaceId} view="wes" /></div>}
          </Suspense>
        </section>
        <section id="advisor" className="page-section advisor-page">
          <div className="section-heading"><h2>下一步，也可以更有方向。</h2><p>使用自己的模型，生成学业分析和选校建议。</p></div>
          {workspaceId && <Advisor key={workspaceId} workspaceId={workspaceId} courses={courses} connection={aiConnection} onConnectionChange={setAIConnection} />}
        </section>
      </main>
      <div className="site-width"><Disclaimer /></div>
      <footer className="site-width site-footer"><span className="footer-wordmark">If Grade.</span><p>下一分努力，有迹可循。<small>仅供学业规划与模拟参考</small></p><a href="#home">回到顶部 ↑</a></footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
