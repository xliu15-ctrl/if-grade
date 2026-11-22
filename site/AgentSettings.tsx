import { useState } from 'react'
import { agentURL, checkAgent, type AgentConnection } from './agent'
export default function AgentSettings({ connection, onChange, disabled }: { connection: AgentConnection; onChange: (next: AgentConnection) => void; disabled: boolean }) {
  const [status, setStatus] = useState('')
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const [remembered, setRemembered] = useState(() => { try { return localStorage.getItem('ifgrade-agent-endpoint') || '' } catch { return '' } })
  const change = (next: AgentConnection) => { onChange(next); setStatus('') }
  return <div className="agent-settings">
    <h3>连接你的解析智能体</h3>
    <p>文件仅发送到下方接口。模型 API Key 在自部署服务端配置，网页只需要接口地址与访问令牌。</p>
    <div className="agent-fields">
      <label>智能体解析接口<input type="url" placeholder="http://localhost:8787/parse" value={connection.endpoint} disabled={disabled || checking} onChange={e => change({ ...connection, endpoint: e.target.value })} /></label>
      <label>访问令牌（如接口需要）<input type="password" autoComplete="off" placeholder="仅保留在本次页面中" value={connection.token} disabled={disabled || checking} onChange={e => change({ ...connection, token: e.target.value })} /></label>
      <button type="button" className="button" disabled={disabled || checking || !connection.endpoint.trim()} onClick={async () => {
        setChecking(true); setStatus(''); setFailed(false)
        try { await checkAgent(connection); setStatus('连接成功，可以选择成绩单进行解析。') } catch (e) { setFailed(true); setStatus(e instanceof Error ? e.message : '连接失败') } finally { setChecking(false) }
      }}>{checking ? '连接中…' : '测试连接'}</button>
    </div>
    <label className="agent-remember"><input type="checkbox" disabled={disabled} checked={Boolean(remembered && remembered === connection.endpoint)} onChange={e => {
      try {
        if (e.target.checked) { const endpoint = agentURL(connection.endpoint).href; localStorage.setItem('ifgrade-agent-endpoint', endpoint); setRemembered(endpoint); onChange({ ...connection, endpoint }) }
        else { localStorage.removeItem('ifgrade-agent-endpoint'); setRemembered('') }
        setFailed(false); setStatus(e.target.checked ? '已记住接口地址。访问令牌不会保存。' : '已移除保存的接口地址。')
      } catch (err) { setFailed(true); setStatus(err instanceof Error ? err.message : '无法保存地址。') }
    }} />记住接口地址（不保存访问令牌）</label>
    {status && <p className={failed ? 'import-error' : 'agent-status'} role="status">{status}</p>}
    <details className="agent-deploy">
      <summary>还没有智能体？部署与接口说明</summary>
      <ol>
        <li><a href="./ifgrade-agent.zip" download>下载自部署智能体服务包</a>，解压后复制 <code>.env.example</code> 为 <code>.env</code>。</li>
        <li>在 <code>.env</code> 填写模型地址、模型名称、模型 API Key、自己设置的访问令牌，以及本站域名。图片和扫描 PDF 需要支持图像的模型。</li>
        <li>安装 Docker 后，在解压目录运行：<pre>docker compose up -d --build</pre></li>
        <li>本机填 <code>http://localhost:8787/parse</code>；服务器部署需绑定 HTTPS 域名，再填入解析地址。令牌填你设置的 <code>AGENT_ACCESS_TOKEN</code>。</li>
      </ol>
      <p>也可以连接已有智能体：接收 <code>POST multipart/form-data</code> 的 <code>file</code> 字段，返回：</p>
      <pre>{JSON.stringify({ records: [{ courseName: '高等数学', credits: 4, score: 88, semester: 1, category: '专业必修' }] }, null, 2)}</pre>
      <p>接口需要允许本站跨域访问及 Authorization 请求头；“测试连接”调用同目录的 <code>/health</code>，约定返回 <code>{'{"ok":true}'}</code>，无健康检查接口也可直接解析。详细说明见下载包中的 README。</p>
    </details>
    <p className="agent-disclosure">上传前建议遮盖姓名、学号等个人信息。智能体解析可能有误，请在核对表中确认后再导入。</p>
  </div>
}

