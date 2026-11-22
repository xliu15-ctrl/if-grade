// ============================================================
// 站点静态文件服务器（零依赖，Node 18+）
// 平台「HTTP 服务」类型站点需要常驻进程监听端口。
// 职责：
//   1. 托管 site-dist/ 静态产物（index.html + app.js）
//   2. /healthz 健康检查（站点发布配置用）
//   3. SPA 回退：未知路径回 index.html
// 平台 API 调用由浏览器直发站点域名下的
// /.well-known/knodo-site-auth/* （由平台网关处理，不经本服务）
// 启动: PORT=3000 node site/server.mjs
// ============================================================
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'site-dist')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.argv.includes('--local') ? '127.0.0.1' : '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

async function serveFile(res, filePath) {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    const data = await readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    })
    res.end(data)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = decodeURIComponent(url.pathname)

  // 健康检查
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }))
    return
  }

  // 平台站点授权前缀路径不该打到本服务（正常由平台网关拦截）；
  // 若到达这里说明网关未拦截，明确 404 便于排查
  if (pathname.startsWith('/.well-known/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'well-known paths are handled by the platform gateway' }))
    return
  }

  // 根路径 → index.html
  if (pathname === '/' || pathname === '/index.html') {
    if (await serveFile(res, path.join(DIST, 'index.html'))) return
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('site-dist/index.html missing — run: node scripts/build-site.mjs')
    return
  }

  // 静态资源（禁止路径逃逸）
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(DIST, safe)
  if (filePath.startsWith(DIST) && (await serveFile(res, filePath))) return

  // SPA 回退
  if (await serveFile(res, path.join(DIST, 'index.html'))) return
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
})

server.listen(PORT, HOST, () => {
  console.log(`[gpa-site] listening on http://${HOST}:${PORT} (dist: ${DIST})`)
})
