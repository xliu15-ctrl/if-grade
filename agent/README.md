# If Grade 自部署解析智能体

网页的本地 OCR 可独立使用。此服务用于自愿选择的 AI 解析：接收成绩单，调用你配置的模型，向网页返回待核对的课程。它不是网站托管服务，也不是选校建议服务。

## Docker 启动

1. 安装 Docker 和 Compose，把本目录放到本机或服务器。
2. 复制 `.env.example` 为 `.env`，填写：
   - `MODEL_BASE_URL`：兼容 Chat Completions 的模型基础地址或完整接口。
   - `MODEL_NAME`：模型名称，图片和扫描 PDF 需要支持图像输入。
   - `MODEL_API_KEY`：模型密钥，仅存服务端，不要提交 GitHub。
   - `AGENT_ACCESS_TOKEN`：自己设置的足够长的随机访问令牌，用于保护解析接口。
   - `ALLOWED_ORIGINS`：允许的网页 origin，逗号分隔；GitHub Pages 填 `https://用户名.github.io`，不带仓库路径。
3. 在本目录执行：

```sh
docker compose up -d --build
```

本机使用：在网页「导入成绩 → AI 解析」填 `http://localhost:8787/parse`，填写你设置的访问令牌，测试连接后上传。访问令牌只留在网页内存，刷新后需重填。

云端使用：在服务器通过 Nginx/Caddy 等反向代理将 HTTPS 域名转到 `127.0.0.1:8787`，设置请求体上限 17 MB、代理超时至少 125 秒。网页填 `https://你的智能体域名/parse`。默认 Compose 只监听服务器本机；无需把 8787 端口公开。网站与服务在不同设备时，网页中的 localhost 指的是使用者自己的电脑。

HTTPS 网页访问本机 HTTP 的行为取决于浏览器的本地网络访问权限；不兼容时请为智能体配置 HTTPS。没有任何服务会自动上传到云端。

## 不使用 Docker

需要 Python 3.10+，在虚拟环境安装 `pip install -r requirements.txt`。把 `.env.example` 中的变量设置为环境变量后运行 `uvicorn app:app --host 127.0.0.1 --port 8787`。此方式不会自动读取 .env。

## 接口协议

- `GET /health`：带 `Authorization: Bearer 你的令牌`，返回 `{"ok":true,"configured":true}`。该检查只验证服务及必要配置存在，不会消耗模型额度，也不验证模型密钥有效性。
- `POST /parse`：同样携带令牌，以 multipart/form-data 的 `file` 字段上传文件。
- 返回 HTTP 200：

```json
{"records":[{"courseName":"高等数学","credits":4,"score":88,"semester":1,"category":"专业必修"}]}
```

成绩为百分制，学期从 1 起。无法识别的字段返回 null，由用户在核对表补齐。仅支持 JSON 结果，不是流式接口。对接已有智能体时可自行实现此协议；无 /health 接口也能直接使用解析。

## 文件与费用

每文件最多 16 MB；PDF 最多 10 页；表格最多 5000 行。CSV 和 Excel 转为文本；有文字层的 PDF 提取文字，扫描页转为图片；图片缩放后发送给模型。复杂 PDF 混合图文布局可能遗漏信息，必须人工核对。服务不主动保存成绩，模型服务可能按其政策保留输入，建议先遮盖姓名、学号等个人信息。

模型调用费用由配置该模型账户的人承担。访问令牌保护接口，但知晓令牌的人仍可消耗额度；多人公开使用时请自行配置网关限流、账号权限和预算上限。服务默认最多同时处理两个模型任务。网页导出的 Word 与 PDF 不经过此服务。

实现参考：[FastAPI 文件上传](https://fastapi.tiangolo.com/tutorial/request-files/)、[PyMuPDF 页面转图片](https://pymupdf.readthedocs.io/en/latest/recipes-images.html)。

