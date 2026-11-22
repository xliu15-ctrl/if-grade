import { useState } from 'react'
import { Download } from 'lucide-react'
export default function ReportExport({ workspaceId }: { workspaceId: string }) {
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const run = async (format: 'docx' | 'pdf') => {
    if (busy) return
    setBusy(format); setStatus('正在整理当前成绩与模拟结果…'); setError(false)
    try {
      const { exportReport } = await import('./exportReport')
      const filename = await exportReport(workspaceId, format)
      setStatus(`已生成 ${filename}。请在浏览器下载列表查看。`)
    } catch (e) { setError(true); setStatus(e instanceof Error ? e.message : '导出失败，请重试。') } finally { setBusy(null) }
  }
  return <div className="report-export">
    <div><strong>把这段进步，留在纸上。</strong><p>导出图表、原始与模拟成绩，以及已保存的预测方案。文件在本地生成。</p></div>
    <div className="report-export-actions">
      <button type="button" className="button" disabled={Boolean(busy)} onClick={() => void run('docx')}><Download size={14} aria-hidden="true"/>{busy === 'docx' ? '生成 Word…' : '导出 Word'}</button>
      <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void run('pdf')}><Download size={14} aria-hidden="true"/>{busy === 'pdf' ? '生成 PDF…' : '导出 PDF'}</button>
    </div>
    {status && <p className={error ? 'import-error' : 'report-export-status'} role="status">{status}</p>}
  </div>
}

