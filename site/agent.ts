declare const __GPA_AGENT_URL__: string
export interface AgentConnection { endpoint: string; token: string }
export function initialAgentConnection(): AgentConnection {
  let endpoint = __GPA_AGENT_URL__ || ''
  try { endpoint = localStorage.getItem('ifgrade-agent-endpoint') || endpoint } catch {}
  return { endpoint, token: '' }
}
export function agentURL(endpoint: string) {
  let url: URL
  try { url = new URL(endpoint.trim()) } catch { throw new Error('请填写完整的智能体解析接口地址。') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('接口需使用 HTTPS；本机调试可用 HTTP。请勿在地址中填写密钥、查询参数或锚点。')
  }
  return url
}
const auth = (connection: AgentConnection) => connection.token.trim() ? { Authorization: `Bearer ${connection.token.trim()}` } : {}
export async function checkAgent(connection: AgentConnection) {
  const url = agentURL(connection.endpoint)
  url.pathname = url.pathname.replace(/\/parse\/?$/, '') + '/health'
  let response: Response
  try {
    response = await fetch(url, { headers: auth(connection), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12_000) })
  } catch { throw new Error('无法连接健康检查接口，请检查服务是否启动、HTTPS 和跨域设置。已有智能体可直接尝试解析。') }
  if (!response.ok) throw new Error(response.status === 401 ? '访问令牌不正确。' : `连接检查失败（HTTP ${response.status}）。`)
  const body = await response.json()
  if (body.ok !== true) throw new Error('健康检查未返回 ok: true。已有智能体可直接尝试解析。')
  if (body.configured === false) throw new Error('服务已启动，但尚未配置模型地址、名称或服务端 API Key。')
}
export async function parseWithAgent(file: File, connection: AgentConnection): Promise<Record<string, unknown>[]> {
  const endpoint = agentURL(connection.endpoint)
  if (!/\.(pdf|png|jpe?g|webp|xlsx|csv)$/i.test(file.name)) throw new Error('请选择 PDF、PNG、JPG、WebP、Excel（.xlsx）或 CSV 文件。')
  if (file.size > 16 * 1024 * 1024) throw new Error('文件超过 16 MB，请压缩或拆分后再试。')
  const form = new FormData()
  form.set('file', file)
  let response: Response
  try {
    response = await fetch(endpoint, { method: 'POST', headers: auth(connection), body: form, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw new Error('智能体解析超时，请稍后重试。')
    throw new Error('无法连接智能体，请检查服务地址和跨域设置。')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('智能体访问令牌不正确，请重新填写。')
    if (response.status === 413) throw new Error('文件过大或 PDF 页数过多，请拆分后重试。')
    if (response.status === 429) throw new Error('智能体当前繁忙，请稍后重试。')
    throw new Error(`智能体解析失败（HTTP ${response.status}），请查看自部署服务的配置与日志。`)
  }
  let result: { records?: unknown } | null
  try { result = await response.json() } catch { throw new Error('智能体返回的内容无法读取，解析接口应返回 JSON。') }
  const records = result?.records
  if (!Array.isArray(records) || records.length > 5000 || records.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('智能体返回格式不符合约定，请检查 records 字段。')
  if (!records.length) throw new Error('智能体未识别到课程，请检查文件内容。')
  return records
}

