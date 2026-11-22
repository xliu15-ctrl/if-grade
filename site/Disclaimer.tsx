export const DISCLAIMER = '本工具仅用于学业规划与模拟，不属于学校官方成绩证明，也不提供 WES 官方认证。均分、GPA、预测与反推结果取决于输入数据和所选算法，请以学校及认证机构的正式规则为准。OCR 和 AI 结果可能存在错误，导入前请逐项核对。AI 选校建议仅供参考，不构成录取承诺，请自行核实学校官网信息。'
export default function Disclaimer() {
  return <details className="disclaimer" id="disclaimer">
    <summary>免责声明与数据说明</summary>
    <p>{DISCLAIMER}</p>
    <p>成绩与存档保存在当前浏览器，清理网站数据或更换设备可能导致丢失，请及时导出。本地解析不会上传成绩文件；主动使用 AI 解析或 AI 分析时，文件或成绩将发送至你配置的服务，相关费用和数据处理规则由该服务提供方决定。</p>
  </details>
}

