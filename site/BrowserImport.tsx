import { useState } from 'react'
import { Check, FileUp, Plus, ScanLine, Sparkles, Upload } from 'lucide-react'
import { ensureDataFile, SCORES_FILE, writeJSON } from '../src/libs/api'
import { detectAlgorithm, PRESET_ALGORITHMS } from '../src/libs/gpa-engine'
import { COURSE_CATEGORIES, type ScoreRecord } from '../src/libs/types'
import { parseWithAgent, type AgentConnection } from './agent'
import AgentSettings from './AgentSettings'
import { OCR_FILE, recognizeDocument } from './ocr'

const fields = [
  { key: 'courseName', label: '课程名称', headers: ['课程名称', '课程名', '课程', '科目', 'course', 'coursename'] },
  { key: 'credits', label: '学分', headers: ['学分', '课程学分', 'credit', 'credits'] },
  { key: 'score', label: '成绩', headers: ['成绩', '分数', '百分制成绩', '成绩分数', '总评成绩', 'score', 'grade'] },
  { key: 'semester', label: '学期', headers: ['学期', '学期序号', 'semester', 'term'] },
  { key: 'category', label: '课程类型', headers: ['课程类型', '课程性质', '课程类别', '类别', 'category'] },
  { key: 'gradePoint', label: '原始绩点（选填）', headers: ['原始绩点', '绩点', '课程绩点', 'gradepoint', 'gp'] },
] as const

type FieldKey = typeof fields[number]['key']
type Draft = Record<FieldKey, string> & { id: string }

function newDraft(values: Partial<Draft> = {}): Draft {
  return { id: crypto.randomUUID(), courseName: '', credits: '', score: '', gradePoint: '', semester: '1', category: '其他', ...values }
}

function agentDraft(record: Record<string, unknown>): Draft {
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  return newDraft({
    courseName: text(record.courseName),
    credits: text(record.credits),
    score: text(record.score),
    gradePoint: text(record.gradePoint),
    semester: text(record.semester),
    category: text(record.category) || '其他',
  })
}

function validRow(row: Draft) {
  const credits = Number(row.credits)
  const score = Number(row.score)
  const semester = Number(row.semester)
  return Boolean(row.courseName.trim() && row.credits.trim() && (row.score.trim() || row.gradePoint.trim())) &&
    (!row.gradePoint.trim() || (Number.isFinite(Number(row.gradePoint)) && Number(row.gradePoint) >= 0 && Number(row.gradePoint) <= 5)) &&
    Number.isFinite(credits) && credits >= 0 &&
    Number.isFinite(score) && score >= 0 && score <= 100 &&
    Number.isSafeInteger(semester) && semester >= 1
}

function parseRecognizedText(text: string): Draft[] {
  const rows: Draft[] = []
  let semester = '1'
  for (const raw of text.normalize('NFKC').split('\n')) {
    const line = raw.trim().replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    const term = /^第\s*(\d+)\s*学期$/.exec(line)
    if (term) {
      semester = term[1]
      continue
    }
    if (/^(合计|总计|平均|加权|姓名|学号|学年|课程(?:名称|名)?[\s,|])/u.test(line)) continue
    const match = /^(.*?)[\s,|]+(\d+(?:\.\d+)?)[\s,|]+(\d+(?:\.\d+)?)%?$/.exec(line)
    if (!match || !/\p{L}/u.test(match[1])) continue
    const [, courseName, first, second] = match
    const [credits, score] = Number(first) > 20 && Number(second) <= 20 ? [second, first] : [first, second]
    if (Number(credits) > 20 || Number(score) > 100) continue
    rows.push(newDraft({ courseName, credits, score, semester }))
  }
  return rows
}

async function parseFile(file: File): Promise<Draft[]> {
  let rows: unknown[][]
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readExcelFile } = await import('read-excel-file')
    rows = await readExcelFile(file)
  } else if (/\.csv$/i.test(file.name)) {
    const { default: Papa } = await import('papaparse')
    const result = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy', delimiter: ',' })
    if (result.errors.length) throw new Error('CSV 格式有误，请检查引号，或另存为 UTF-8 CSV 后重试。')
    rows = result.data
  } else {
    throw new Error('请选择 .xlsx 或 .csv 文件。')
  }

  const cellText = (cell: unknown) => String(cell ?? '').trim()
  const findColumns = (row: unknown[]) => {
    const cells = row.map(cell => cellText(cell).toLowerCase().replace(/\s+/g, ''))
    return fields.map(field => cells.findIndex(cell => field.headers.some(header => header === cell)))
  }

  const headerIndex = rows.findIndex(row => {
    const [name, credits, score, , , gp] = findColumns(row)
    return name >= 0 && credits >= 0 && (score >= 0 || gp >= 0)
  })
  if (headerIndex < 0) throw new Error('表头需要课程名称、学分，以及成绩或原始绩点。可下载模板后粘贴数据。')

  const [name, credits, score, semester, category, gp] = findColumns(rows[headerIndex])
  const drafts = rows.slice(headerIndex + 1)
    .filter(row => row.some(cell => cellText(cell) !== ''))
    .map(row => newDraft({
      courseName: cellText(row[name]),
      credits: cellText(row[credits]),
      score: cellText(row[score]),
      gradePoint: cellText(row[gp]),
      semester: cellText(row[semester]) || '1',
      category: cellText(row[category]) || '其他',
    }))
  if (!drafts.length) throw new Error('表头下没有课程数据。')
  return drafts
}

function courseKey(course: ScoreRecord) {
  return JSON.stringify([course.courseName.trim().toLowerCase(), course.semester, course.credits, course.originalScore, course.gradePoint ?? null, course.category.trim()])
}

export default function BrowserImport({ workspaceId, onConfirm, agentConnection, onAgentConnectionChange }: {
  workspaceId: string
  agentConnection: AgentConnection
  onAgentConnectionChange: (next: AgentConnection) => void
  onConfirm: (added: number, skipped: number) => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [mode, setMode] = useState<'local' | 'agent'>('local')
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [ocrDraftIds, setOcrDraftIds] = useState<string[]>([])
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [operation, setOperation] = useState<'local' | 'agent' | 'save' | null>(null)
  const busy = operation !== null
  const agentConfigured = Boolean(agentConnection.endpoint.trim())
  const invalidCount = drafts.filter(row => !validRow(row)).length

  async function selectFile(file: File, mode: 'local' | 'agent') {
    if (busy || (mode === 'agent' && !agentConfigured)) return
    setOperation(mode)
    setError('')
    setProgress('')
    try {
      let parsed: Draft[]
      if (mode === 'agent') {
        parsed = (await parseWithAgent(file, agentConnection)).map(agentDraft)
      } else if (OCR_FILE.test(file.name)) {
        const recognized = await recognizeDocument(file, setProgress)
        setOcrText(recognized)
        parsed = parseRecognizedText(recognized)
        setOcrDraftIds(parsed.map(row => row.id))
        if (!parsed.length) setError('未提取到完整课程行。可查看下方原文、调整格式后再提取。')
      } else {
        parsed = await parseFile(file)
      }
      setDrafts(current => [...current, ...parsed])
    } catch (err) {
      setError(mode === 'local' && OCR_FILE.test(file.name)
        ? '本地 OCR 读取失败，请检查文件能否正常打开，或换一份清晰的图片重试。'
        : err instanceof Error ? err.message : '读取文件失败，请检查文件格式。')
    } finally {
      setOperation(null)
    }
  }

  async function confirmDrafts() {
    if (busy || !drafts.length || invalidCount) return
    setOperation('save')
    setError('')
    try {
      const existing = await ensureDataFile<ScoreRecord[]>(workspaceId, SCORES_FILE, [])
      let nextOrder = existing.reduce((max, course) => Math.max(max, course.order), -1) + 1
      const seen = new Set(existing.filter(c => !c.isPredicted).map(courseKey))
      const added: ScoreRecord[] = []
      for (const row of drafts) {
        const course: ScoreRecord = {
          id: row.id,
          courseName: row.courseName.trim(),
          credits: Number(row.credits),
          originalScore: row.score.trim() ? Number(row.score) : null,
          gradePoint: row.gradePoint.trim() ? Number(row.gradePoint) : null,
          semester: Number(row.semester),
          category: row.category.trim() || '其他',
          simulatedScore: null,
          simulatedGP: null,
          isCorrected: false,
          source: 'import',
          order: nextOrder,
        }
        const key = courseKey(course)
        if (seen.has(key)) continue
        seen.add(key)
        nextOrder += 1
        added.push(course)
      }
      const detected = !existing.length ? detectAlgorithm(added) : null
      const initialAlgorithm = detected?.confidence === 1 && PRESET_ALGORITHMS[detected.algorithmId]
        ? detected.algorithmId : added.length && added.every(c => c.gradePoint != null) ? 'transcript_gpa' : 'standard_4_0'
      await ensureDataFile(workspaceId, 'data/gpa_config.json', { activeAlgorithm: initialAlgorithm })
      if (added.length) await writeJSON(workspaceId, SCORES_FILE, [...existing, ...added])
      onConfirm(added.length, drafts.length - added.length)
    } catch {
      setError('无法保存成绩。请检查浏览器是否允许网站存储，或是否还有可用空间。')
    } finally {
      setOperation(null)
    }
  }

  function updateRow(id: string, key: FieldKey, value: string) {
    setDrafts(current => current.map(row => row.id === id ? { ...row, [key]: value } : row))
  }

  return (
    <section className="import-card" aria-labelledby="import-title">
      <div className="import-head">
        <h2 id="import-title">导入成绩</h2>
        <p>选择解析方式，再核对课程、学分和成绩。</p>
      </div>
      <fieldset className="parse-modes" disabled={busy}>
        <legend className="sr-only">解析方式</legend>
        <label className="parse-mode">
          <input type="radio" name="parse-mode" checked={mode === 'local'} onChange={() => setMode('local')} />
          <span className="mode-icon"><ScanLine size={21} aria-hidden="true" /></span>
          <span><strong>本地解析</strong><small>文件留在浏览器，支持 OCR 识别</small></span>
          {mode === 'local' && <Check className="mode-check" size={17} aria-hidden="true" />}
        </label>
        <label className="parse-mode">
          <input type="radio" name="parse-mode" checked={mode === 'agent'} onChange={() => setMode('agent')} />
          <span className="mode-icon"><Sparkles size={21} aria-hidden="true" /></span>
          <span><strong>AI 解析</strong><small>{agentConfigured ? '发送文件至自部署智能体' : '需配置自部署智能体'}</small></span>
          {mode === 'agent' && <Check className="mode-check" size={17} aria-hidden="true" />}
        </label>
      </fieldset>
      {mode === 'agent' && <AgentSettings connection={agentConnection} onChange={onAgentConnectionChange} disabled={busy} />}
      <div className="drop-zone" onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) void selectFile(file, mode)
        }}>
        <div className="upload-icon"><FileUp size={24} aria-hidden="true" /></div>
        <div className="drop-copy">
          <strong>选择或拖放成绩单</strong>
          <p>Excel（.xlsx）、CSV、PDF、PNG、JPG、WebP</p>
        </div>
        <label className={`button button-primary file-button ${busy || (mode === 'agent' && !agentConfigured) ? 'button-disabled' : ''}`}>
          <Upload size={17} aria-hidden="true" /> {mode === 'local' ? '选择成绩表' : '选择文件并用 AI 解析'}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv"
            disabled={busy || (mode === 'agent' && !agentConfigured)}
            aria-label={mode === 'local' ? '选择成绩表' : '智能体解析'}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void selectFile(file, mode)
            }} />
        </label>
      </div>
      <div className="import-actions">
        <button type="button" className="button" disabled={busy}
          onClick={() => setDrafts(current => [...current, newDraft()])}>
          <Plus size={17} aria-hidden="true" /> 手动添加
        </button>
        <a className="template-link" href="./成绩导入模板.csv" download>下载 CSV 模板</a>
      </div>

      {error && <p className="import-error" role="alert">{error}</p>}
      {busy && <p className="import-progress" role="status">{operation === 'agent' ? '智能体正在解析…' : operation === 'save' ? '正在保存成绩…' : progress || '正在读取文件…'}</p>}
      {ocrText !== null && (
        <details className="ocr-text" open={drafts.length === 0 ? true : undefined}>
          <summary>查看 OCR 识别原文</summary>
          <p>可按「课程名 学分 成绩」整理，每门课程占一行，再提取到核对表。</p>
          <textarea aria-label="OCR 识别原文" rows={6} value={ocrText} disabled={busy}
            onChange={event => setOcrText(event.target.value)} />
          <button className="button" type="button" disabled={busy} onClick={() => {
            const parsed = parseRecognizedText(ocrText)
            if (!parsed.length) { setError('未找到符合格式的课程。'); return }
            setError('')
            const previous = new Set(ocrDraftIds)
            setDrafts(current => [...current.filter(row => !previous.has(row.id)), ...parsed])
            setOcrDraftIds(parsed.map(row => row.id))
          }}>提取到核对表</button>
        </details>
      )}
      {drafts.length > 0 && (
        <div className="review-area">
          <div className="review-heading">
            <div>
              <h3>核对课程 <span>{drafts.length} 门</span></h3>
              <p>百分成绩（0–100）和原始绩点至少填写一项，学分可为 0，学期填写从 1 开始的序号。完全重复的课程会跳过。</p>
            </div>
          </div>
          <div className="review-scroll">
            <table className="review-table">
              <thead><tr>
                {fields.map(field => <th key={field.key} scope="col">{field.label}</th>)}
                <th scope="col">操作</th>
              </tr></thead>
              <tbody>
                {drafts.map((row, index) => (
                  <tr key={row.id} className={validRow(row) ? '' : 'needs-review'}>
                    {fields.map(({ key, label }) => (
                      <td key={key} data-label={label}>
                        <input aria-label={`第 ${index + 1} 行${label}`}
                          className={key === 'courseName' ? 'course-input' : ''}
                          inputMode={key === 'semester' ? 'numeric' : key === 'credits' || key === 'score' || key === 'gradePoint' ? 'decimal' : 'text'}
                          list={key === 'category' ? 'course-categories' : undefined}
                          value={row[key]} disabled={busy}
                          onChange={event => updateRow(row.id, key, event.target.value)} />
                      </td>
                    ))}
                    <td><button type="button" className="remove-row" aria-label={`删除第 ${index + 1} 行`} disabled={busy}
                      onClick={() => setDrafts(current => current.filter(item => item.id !== row.id))}>删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="course-categories">
              {COURSE_CATEGORIES.map(category => <option value={category} key={category} />)}
            </datalist>
          </div>
          <div className="review-submit">
            {invalidCount > 0 && <p role="status">请检查 {invalidCount} 行标记的课程。</p>}
            <button type="button" className="button button-primary" disabled={busy || invalidCount > 0}
              onClick={() => void confirmDrafts()}>确认导入并查看成绩</button>
          </div>
        </div>
      )}
    </section>
  )
}
