export const OCR_FILE = /\.(pdf|png|jpe?g|webp)$/i

export async function recognizeDocument(file: File, update: (message: string) => void): Promise<string> {
  update('正在加载中英文 OCR 字库…')
  const { default: tesseract } = await import('tesseract.js')
  const assets = new URL('./ocr/', document.baseURI)
  const worker = await tesseract.createWorker(['chi_sim', 'eng'], tesseract.OEM.LSTM_ONLY, {
    workerPath: new URL('worker.min.js', assets).href,
    corePath: assets.href,
    langPath: assets.href.replace(/\/$/, ''),
    workerBlobURL: false,
    // The worker reports errors independently from its rejected tasks.
    errorHandler: () => {},
  })

  try {
    if (!/\.pdf$/i.test(file.name)) {
      update('正在识别图片…')
      return (await worker.recognize(file)).data.text
    }

    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', assets).href
    const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false })
    try {
      const pdf = await task.promise
      const pages: string[] = []
      const canvas = document.createElement('canvas')
      for (let index = 1; index <= pdf.numPages; index += 1) {
        update(`正在识别 PDF 第 ${index} / ${pdf.numPages} 页…`)
        const page = await pdf.getPage(index)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(3, 2500 / Math.max(base.width, base.height)) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法渲染 PDF 页面。')
        await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise
        pages.push((await worker.recognize(canvas)).data.text)
        page.cleanup()
      }
      return pages.join('\n\n')
    } finally {
      await task.destroy()
    }
  } finally {
    await worker.terminate()
  }
}
