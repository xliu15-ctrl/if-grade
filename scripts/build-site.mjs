// ============================================================
// 站点构建脚本：打包 site/main.tsx → site-dist/app.js
// 与平台面板构建的差异：
//   - react/react-dom 不再 external（站点环境平台不提供），需打进 bundle
//   - @knodo/api 用站点 shim 替换（无平台对话桥）
//   - xlsx/tesseract.js 等浏览器端依赖照常打入
// 用法: node scripts/build-site.mjs
// ============================================================
import { build } from 'esbuild'
import { copyFile, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outdir = path.join(root, 'site-dist')
const browser = process.argv.includes('--browser')
const entry = browser ? 'site/browser.tsx' : 'site/main.tsx'
const agentUrl = browser ? process.env.GPA_AGENT_URL?.trim() || '' : ''

if (agentUrl) {
  const url = new URL(agentUrl)
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))) {
    throw new Error('GPA_AGENT_URL must use HTTPS (HTTP is allowed for local development) without embedded credentials.')
  }
}

await rm(outdir, { recursive: true, force: true })

const result = await build({
  absWorkingDir: root,
  entryPoints: { app: entry },
  bundle: true,
  format: browser ? 'esm' : 'iife',
  splitting: browser,
  chunkNames: 'chunks/[name]-[hash]',
  target: ['es2020'],
  outdir,
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  alias: { '@knodo/api': path.join(root, 'site/shims/knodo-api.ts') },
  define: {
    'process.env.NODE_ENV': '"production"',
    __GPA_BROWSER_MODE__: String(browser),
    __GPA_AGENT_URL__: JSON.stringify(agentUrl),
  },
  logLevel: 'info',
  metafile: true,
})

await copyFile(path.join(root, browser ? 'site/browser.html' : 'site/index.html'), path.join(outdir, 'index.html'))
if (browser) {
  await copyFile(path.join(root, 'site/ink.css'), path.join(outdir, 'ink.css'))
  await copyFile(path.join(root, 'site/report.css'), path.join(outdir, 'report.css'))
  await copyFile(path.join(root, 'site/scroll.css'), path.join(outdir, 'scroll.css'))
  await copyFile(path.join(root, 'site/pages.css'), path.join(outdir, 'pages.css'))
  await copyFile(path.join(root, 'site/journey.css'), path.join(outdir, 'journey.css'))
  const agentFiles = ['app.py', 'requirements.txt', 'Dockerfile', 'compose.yaml', '.env.example', '.dockerignore', 'README.md']
  const agentArchive = Object.fromEntries(await Promise.all(agentFiles.map(async name => [name, new Uint8Array(await readFile(path.join(root, 'agent', name)))])))
  await writeFile(path.join(outdir, 'ifgrade-agent.zip'), zipSync(agentArchive))
  await copyFile(path.join(root, 'site/成绩导入模板.csv'), path.join(outdir, '成绩导入模板.csv'))
  const assets = path.join(outdir, 'ocr')
  const dependencies = path.join(root, 'node_modules')
  const files = {
    'worker.min.js': 'tesseract.js/dist/worker.min.js',
    'worker.min.js.LICENSE.txt': 'tesseract.js/dist/worker.min.js.LICENSE.txt',
    'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-LICENSE.txt': 'tesseract.js-core/LICENSE',
    'pdf.worker.min.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
    'pdfjs-LICENSE.txt': 'pdfjs-dist/LICENSE',
    'chi_sim.traineddata.gz': '@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz',
    'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  }
  await mkdir(assets, { recursive: true })
  await Promise.all(Object.entries(files).map(([name, source]) =>
    copyFile(path.join(dependencies, source), path.join(assets, name))
  ))
}

const text = await esbuild_analyze(result)
if (text) console.log(text)

async function esbuild_analyze(res) {
  // esbuild metafile 分析：输出 bundle 体积前几名，便于排查体积问题
  try {
    const meta = res.metafile
    const rows = Object.entries(meta.outputs)
      .map(([k, v]) => ({ file: k, bytes: v.bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
    return '\n产物体积 Top5:\n' + rows.map(r => `  ${r.file}  ${(r.bytes / 1024).toFixed(1)} KB`).join('\n')
  } catch { return '' }
}
