# If Grade 部署指南

此仓库发布浏览器版本。成绩、OCR、GPA 计算和报告导出均在浏览器进行；自部署 Python 智能体可选，客户留资后台尚未实现。旧平台专用技能、真实成绩、密钥和本机运行数据不在本发布包内。

## 推荐先用 Cloudflare 静态托管

无需购买 VPS 就能发布现有前端。按平台额度使用；模型接口费用另计。自有域名需要另购。大陆与海外的实际访问体验需要测试，免费平台不保证所有网络可达。

### Cloudflare Workers 静态资源

1. 在 Cloudflare 控制台创建 Worker，选择导入 Git 仓库，授权访问 xliu15-ctrl/if-grade。
2. 生产分支 main；项目根目录 /；Node.js 24。
3. 构建命令：npm run build。
4. 部署命令：npx wrangler deploy。
5. 仓库中的 wrangler.jsonc 将静态资源目录指向 site-dist。
6. 首次部署后，在项目的域名设置绑定自有域名并启用 HTTPS。
7. 后续推送 main 后由平台自动构建部署，不需要把 Cloudflare 密钥写入仓库。

也可以使用 Cloudflare Pages：框架 None；构建命令 npm run build；输出目录 site-dist；Node.js 24。不需要 Wrangler 部署命令。两种方式选一种即可。

Python 智能体不能作为普通静态资源在这里运行；需要它时另行部署 agent/。

官方文档：
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## 香港或新加坡 VPS

适用于需要运行自部署智能体或后续后台的情况。建议至少 2 GB 内存（包含构建与文件解析时更稳妥），使用带公网 IPv4 的 Linux 套餐。无需 GPU：当前服务调用外部模型，不在服务器上运行模型权重。

安装 Node.js 24、Git，拉取项目：

```sh
git clone https://github.com/xliu15-ctrl/if-grade.git
cd if-grade
npm ci
npm run build
```

用 Nginx 或 Caddy 托管 site-dist，并配置域名与 HTTPS。保持源码、node_modules、agent/.env 和数据备份位于 Web 根目录之外。模型代理按 agent/README.md 用 Docker 部署，通过独立 HTTPS 子域名反向代理，不公开容器内部端口。

更新时拉取 main 并重新构建；正式部署建议构建到新目录，成功后切换目录，避免用户访问到一半更新的文件。首次部署可使用托管静态方案，减少维护工作。

## 域名

注册商与服务器可分开购买。优先比较 .com 的常规续费价，不仅看首年促销。候选如 ifgrade.com、if-grade.com、getifgrade.com 只是命名建议，未检查可注册状态。无内地备案需求应选择非内地托管节点；使用内地 CDN/接入服务时需另外核实备案要求。

## GitHub 构建检查

仓库中的 Build browser site 工作流执行 npm ci 与 npm run build，并保留网站产物用于检查，不自动发布到 GitHub Pages。商业站点应使用允许相应业务的托管方案。

## 上线验收

- 用自己的域名在大陆移动、联通、电信及海外网络实际测试。
- 手机和桌面检查导入、修改模拟分、图表、Word/PDF 下载。
- 测试图片与 PDF 本地 OCR（首次会加载同站字库）。
- AI 测试需填写真实的自部署接口或兼容模型接口；未配置时仍能使用本地功能。
- 设置域名/服务器续费提醒；新增后台后另配备份、权限与隐私授权流程。

