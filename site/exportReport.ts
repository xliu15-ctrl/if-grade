import { strToU8, zipSync } from 'fflate'
import { createReport, type ReportModel, type ChartSpec } from './reportModel'

const ink = '#263e33', green = '#52735e', amber = '#ae8563', muted = '#718071'
const font = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
const waitFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const dataBytes = (url: string) => Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0))
function canvas(width: number, height: number) {
  const el = document.createElement('canvas'); el.width = width; el.height = height
  const ctx = el.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持报告绘制，请使用较新的浏览器。')
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height)
  return {el,ctx}
}
function fit(ctx: CanvasRenderingContext2D, value: string, width: number) {
  if (ctx.measureText(value).width <= width) return value
  let text = value
  while (text.length && ctx.measureText(text + '…').width > width) text = text.slice(0,-1)
  return text + '…'
}
export function chartCanvas(spec: ChartSpec) {
  const {el,ctx} = canvas(1000,360)
  ctx.font = `16px ${font}`; ctx.fillStyle = green
  ctx.fillRect(58,12,15,8); ctx.fillText(spec.kind === 'impact' ? 'GPA 加权变化量' : '原始',81,23)
  if (spec.kind !== 'impact') { ctx.fillStyle = amber; ctx.fillRect(150,12,15,8); ctx.fillText('模拟',173,23) }
  const left = spec.kind === 'impact' ? 235 : 58, top = 48, bottom = 305, right = 950
  if (spec.kind === 'impact') {
    const mid = left + (right-left)*.45
    ctx.strokeStyle = '#dce3da'; ctx.beginPath(); ctx.moveTo(mid,top); ctx.lineTo(mid,bottom+12); ctx.stroke()
    const row = (bottom-top) / Math.max(1,spec.labels.length)
    spec.labels.forEach((label,i)=>{
      const y = top + (i+.5)*row, amount=spec.simulated[i], width=Math.abs(amount)/spec.max*(right-left)*.4
      ctx.fillStyle=ink; ctx.textAlign='right';ctx.fillText(fit(ctx,label,210),left-18,y+5)
      ctx.fillStyle=amount>=0?green:amber
      ctx.fillRect(amount>=0?mid:mid-width,y-5,width,10)
      ctx.textAlign=amount>=0?'left':'right'
      ctx.fillText((amount>=0?'+':'')+amount.toFixed(4),amount>=0?mid+width+8:mid-width-8,y+5)
    })
  } else {
    const axisMax = spec.kind === 'bar' ? Math.ceil(spec.max / 4) * 4 : spec.max
    for(let i=0;i<=4;i++) {
      const y=bottom-(bottom-top)*i/4
      ctx.strokeStyle='#e8ece5';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke()
      ctx.fillStyle=muted;ctx.textAlign='right';ctx.fillText((axisMax*i/4).toFixed(spec.kind==='bar'?0:1),left-10,y+5)
    }
    const slot=(right-left)/Math.max(1,spec.labels.length)
    const x=(i:number)=>left+slot*(i+.5)
    const y=(value:number)=>bottom-value/axisMax*(bottom-top)
    spec.labels.forEach((label,i)=>{
      ctx.textAlign='center';ctx.fillStyle=muted
      ctx.fillText(fit(ctx,label,Math.max(25,slot-10)),x(i),bottom+28)
    })
    for(const [values,color,j] of [[spec.original,green,0],[spec.simulated,amber,1]] as const) {
      ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=3
      if(spec.kind==='bar') {
        const width=Math.min(40,slot*.27)
        values.forEach((value,i)=>{ctx.fillRect(x(i)+(j===0?-width-2:2),y(value),width,bottom-y(value));ctx.textAlign='center';ctx.fillText(String(value),x(i)+(j===0?-width/2-2:width/2+2),y(value)-9)})
      } else {
        ctx.beginPath();values.forEach((value,i)=>i?ctx.lineTo(x(i),y(value)):ctx.moveTo(x(i),y(value)));ctx.stroke()
        values.forEach((value,i)=>{ctx.beginPath();ctx.arc(x(i),y(value),4.5,0,Math.PI*2);ctx.fill();ctx.textAlign='center';const above=j===0?value>=spec.simulated[i]:value>spec.original[i];ctx.fillText(value.toFixed(2),x(i),y(value)+(above?-12:23))})
      }
    }
  }
  ctx.textAlign='left'
  return el
}
const xml = (text: unknown) => String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
function paragraph(text: string, style='Normal') {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`
}
export async function docxBlob(report: ReportModel): Promise<Blob> {
  const files: Record<string,Uint8Array> = {}
  let body = paragraph(report.title,'Title') + paragraph(`If Grade   ·   ${report.date}`,'Subtitle') + paragraph(report.source,'Subtitle')
  const rels = [`<Relationship Id="styles" Type="${relType}styles" Target="styles.xml"/>`]
  let imageId = 0
  for(const block of report.blocks) {
    if(block.type==='heading') body += paragraph(block.text,'Heading1')
    if(block.type==='text') body += paragraph(block.text)
    if(block.type==='table') {
      const widths=(block.widths || block.headers.map(()=>1/block.headers.length)).map(w=>Math.round(w*9360))
      const borders=['top','left','bottom','right','insideH','insideV'].map(s=>`<w:${s} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')
      const rows=[block.headers,...block.rows].map((row,i)=>`<w:tr><w:trPr>${i===0?'<w:tblHeader/>':''}</w:trPr>${row.map((cell,j)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[j]}" w:type="dxa"/><w:vAlign w:val="center"/>${i===0?'<w:shd w:fill="E9EFE7"/>':i%2===0?'<w:shd w:fill="F8FAF6"/>':''}</w:tcPr><w:p><w:pPr><w:spacing w:after="30" w:before="30"/></w:pPr><w:r><w:rPr>${i===0?'<w:b/>':''}<w:sz w:val="19"/><w:color w:val="263E33"/></w:rPr><w:t xml:space="preserve">${xml(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')
      body += `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>` + paragraph('')
    }
    if(block.type==='chart') {
      imageId++
      const el=chartCanvas(block.spec)
      const name=`figure${imageId}.png`, id=`img${imageId}`, cx=5943600, cy=2139696
      files[`word/media/${name}`]=dataBytes(el.toDataURL('image/png'))
      rels.push(`<Relationship Id="${id}" Type="${relType}image" Target="media/${name}"/>`)
      body += `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="图表 ${imageId}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
      el.width=el.height=0
    }
    await waitFrame()
  }
  body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440"/></w:sectPr>'
  files['word/document.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${relType.slice(0,-1)}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`)
  files['word/styles.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:color w:val="222222"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="220"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:sz w:val="20"/><w:color w:val="718071"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="000000"/></w:rPr></w:style></w:styles>`)
  files['word/_rels/document.xml.rels']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`)
  files['_rels/.rels']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${relType}officeDocument" Target="word/document.xml"/></Relationships>`)
  files['[Content_Types].xml']=strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
  return new Blob([zipSync(files)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})
}
function wrap(ctx: CanvasRenderingContext2D, value: string, width: number) {
  const lines: string[]=[]
  for(const raw of value.split('\n')) {
    let line=''
    for(const char of raw) {
      if(line && ctx.measureText(line+char).width>width) {lines.push(line);line=''}
      line+=char
    }
    lines.push(line)
  }
  return lines
}
export async function pdfBlob(report: ReportModel): Promise<Blob> {
  const pages: Uint8Array[]=[]
  const W=816,H=1056,margin=60,bottom=975,scale=1.5
  let el: HTMLCanvasElement,ctx: CanvasRenderingContext2D,y=70
  const finish = () => {
    ctx.font=`10px ${font}`;ctx.fillStyle=muted
    ctx.fillText(`${report.source} · 仅供模拟参考`,margin,1010)
    ctx.textAlign='right';ctx.fillText(String(pages.length+1),W-margin,1010);ctx.textAlign='left'
    pages.push(dataBytes(el.toDataURL('image/jpeg',.94)));el.width=el.height=0
  }
  const start = () => {
    ({el,ctx}=canvas(W*scale,H*scale));ctx.scale(scale,scale);y=70
    ctx.fillStyle=muted;ctx.font=`11px ${font}`;ctx.fillText('IF GRADE / 成绩分析与模拟',margin,32)
    ctx.strokeStyle='#dfe5dc';ctx.beginPath();ctx.moveTo(margin,43);ctx.lineTo(W-margin,43);ctx.stroke()
  }
  const ensure=(height:number)=>{if(y+height>bottom){finish();start()}}
  const text=(value:string,size=14,lineHeight=24,bold=false)=>{
    ctx.font=`${bold?'600 ':''}${size}px ${font}`
    const lines=wrap(ctx,value,W-margin*2)
    for(const line of lines){ensure(lineHeight);ctx.font=`${bold?'600 ':''}${size}px ${font}`;ctx.fillStyle=ink;ctx.fillText(line,margin,y+size);y+=lineHeight}
    y+=10
  }
  start()
  text(report.title,28,42,true)
  text(`${report.date}  ·  ${report.source}`,12,21)
  for(const [blockIndex, block] of report.blocks.entries()) {
    if(block.type==='heading'){
      const next=report.blocks[blockIndex+1]
      ensure(next?.type==='chart' ? 54+(W-margin*2)*.36 : 125)
      y+=8;text(block.text,19,30,true)
    }
    if(block.type==='text')text(block.text)
    if(block.type==='chart'){
      const chart=chartCanvas(block.spec),height=(W-margin*2)*chart.height/chart.width
      ensure(height+16);ctx.drawImage(chart,margin,y,W-margin*2,height);y+=height+16;chart.width=chart.height=0
    }
    if(block.type==='table'){
      const widths=(block.widths || block.headers.map(()=>1/block.headers.length)).map(v=>v*(W-margin*2))
      const prepare=(cells:string[])=>{ctx.font=`12px ${font}`;return cells.map((value,i)=>wrap(ctx,value,widths[i]-16))}
      const drawRow=(lines:string[][],offset:number,count:number,header:boolean,stripe:boolean)=>{
        const height=count*19+14
        ctx.fillStyle=header?'#e9efe7':stripe?'#f8faf6':'#fff';ctx.fillRect(margin,y,W-margin*2,height)
        ctx.font=`${header?'600 ':''}12px ${font}`;ctx.fillStyle=ink;ctx.strokeStyle='#d9dfd5';ctx.lineWidth=.5
        let x=margin
        lines.forEach((cell,i)=>{ctx.strokeRect(x,y,widths[i],height);cell.slice(offset,offset+count).forEach((line,k)=>ctx.fillText(line,x+8,y+18+k*19));x+=widths[i]})
        y+=height
      }
      const heads=prepare(block.headers),headCount=Math.max(...heads.map(l=>l.length)),headHeight=headCount*19+14
      ensure(headHeight+52);drawRow(heads,0,headCount,true,false)
      for(let i=0;i<block.rows.length;i++){
        const lines=prepare(block.rows[i]),total=Math.max(...lines.map(l=>l.length))
        let offset=0
        while(offset<total){
          if(bottom-y<34){finish();start();drawRow(heads,0,headCount,true,false)}
          const count=Math.min(total-offset,Math.floor((bottom-y-14)/19))
          drawRow(lines,offset,count,false,i%2===1);offset+=count
        }
        if(i%30===0)await waitFrame()
      }
      y+=18
    }
    await waitFrame()
  }
  finish()
  return imagePDF(pages,Math.round(W*scale),Math.round(H*scale))
}
/** PDF pages use embedded JPEGs to keep CJK rendering offline and consistent. */
function imagePDF(pages:Uint8Array[],width:number,height:number){
  const chunks:Uint8Array[]=[],offsets=[0];let length=0
  const put=(data:string|Uint8Array)=>{const bytes=typeof data==='string'?strToU8(data):data;chunks.push(bytes);length+=bytes.length}
  const object=(id:number,body:string|(()=>void))=>{offsets[id]=length;put(`${id} 0 obj\n`);typeof body==='string'?put(body):body();put('\nendobj\n')}
  put('%PDF-1.4\n%IfGrade\n')
  object(1,'<< /Type /Catalog /Pages 2 0 R >>')
  object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`)
  pages.forEach((bytes,i)=>{
    const id=3+i*3,commands='q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ\n'
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${id+2} 0 R >> >> /Contents ${id+1} 0 R >>`)
    object(id+1,`<< /Length ${strToU8(commands).length} >>\nstream\n${commands}endstream`)
    object(id+2,()=>{put(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);put(bytes);put('\nendstream')})
  })
  const xref=length
  put(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  offsets.slice(1).forEach(offset=>put(String(offset).padStart(10,'0')+' 00000 n \n'))
  put(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks,{type:'application/pdf'})
}
export async function exportReport(workspaceId:string,format:'docx'|'pdf') {
  const report=await createReport(workspaceId)
  await document.fonts.ready
  const blob=format==='docx'?await docxBlob(report):await pdfBlob(report)
  const filename=`IfGrade-${workspaceId==='preview'?'示例-':''}成绩分析与模拟-${new Date().toISOString().slice(0,10)}.${format}`
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove()
  setTimeout(()=>URL.revokeObjectURL(url),60000)
  return filename
}

