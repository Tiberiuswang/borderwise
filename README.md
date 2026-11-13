# Borderwise · 跨境合规 Agent

一个可放进 GitHub 仓库的中文跨境资料复核工作台。页面无需构建、无需数据库和 API 密钥，即可运行本地检查、问题提示与复核清单导出。你也可以另行部署本项目提供的 Cloudflare Worker，接入自己的大模型服务。

> **请先了解：这是可运行的辅助原型，不是自动报关或合规认证系统。** 默认对话和检查基于代码中的固定规则，不是大模型，不会联网查询或自动更新法规、制裁名单、HS 编码、税率、碳排放或港口状态，也不会提交报关、申请退税或自动订舱。AI 模式才调用外部模型，但模型同样可能出错，不能冒充已查询官方资料。所有业务决策和正式申报均须由专业人员核实。

## 能做什么

1. 点击“填写货物资料”，录入商品、编码、原产地、目的地、价格、贸易术语、单证等信息，也可填入演示数据。
2. 点击“生成复核清单”。系统根据已填资料提示缺项及需要复核的事项，右侧展示摘要，可导出 Markdown 文件。
3. 在对话框提问，默认获得本地规则生成的待办提示。点击“官方资料库”可打开有关机构的网站自行核查。
4. 在“设置与数据”中清除本机数据。也可选填 AI 代理地址与访问口令，主动启用模型对话。

页面默认把货物资料和最近一次检查结果保存在**当前浏览器的本地存储**中，不会自动传给网站作者；可能被使用同一设备/浏览器的人看到。启用 AI 后，你发送的问题、货物资料和检查报告会传到你配置的 Worker 及其模型服务商，可能产生费用和跨境数据处理。请勿提交真实客户机密、敏感个人信息或未经授权的业务资料；公共设备使用后请清除本地数据。系统没有企业级用户登录、隔离、权限和审计。

## 项目目录

```text
borderwise/
├── docs/                 # 前端静态网站，GitHub Pages 发布目录
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── engine.js         # 本地规则和演示数据
│   ├── favicon.svg
│   ├── manus-routes.json
│   └── .nojekyll
├── worker/               # 可选 AI 代理和单独教程
│   ├── src/index.mjs
│   ├── wrangler.toml
│   └── README.md
├── tests/                # 本地规则测试
├── package.json
├── README.md             # 本教程
└── LICENSE
```

## 零基础部署：GitHub Pages（静态版）

**费用和公开性先看这里：**截至编写时，GitHub Free 通常可为**公开仓库**启用 Pages，站点和公开仓库的源代码对互联网可见，不要上传 API 密钥、客户数据或真实报关资料。GitHub Pages 对商业服务和用途也有限制，本项目更适合个人演示或学习，实际商用前请阅读 [GitHub Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。服务规则、可用性和配额会变化，请以官方页面为准。

GitHub 明确表示 Pages 不应被用于发送密码等敏感交易。因此 **GitHub Pages 版本只用于本地演示，不要在上面填写 AI 访问口令**。如果需要启用 AI 模式，请使用下一节的 Cloudflare Pages 等允许此用途的托管服务，并自行核对其条款。

### 第一步：准备文件和账号

1. 注册并登录 [GitHub](https://github.com/)。
2. 下载本项目的源码 ZIP 并**解压**。不要直接把 ZIP 上传成网站，GitHub Pages 需要仓库里的原始文件。
3. 解压后确认能找到 `docs/index.html`、`docs/app.js` 和 `docs/engine.js`。如果多了一层总文件夹，请进入该文件夹，再上传其中内容。

### 第二步：建立 GitHub 仓库

1. 访问 GitHub 首页，点击右上角 **+ → New repository**。
2. Repository name 可以填写 `borderwise-agent`；选择 **Public（公开）**。
3. 点击 **Create repository**。如 GitHub 建议先创建 README，可选择创建，也可直接上传本项目 README；若有同名冲突，以项目文件为准。
4. 进入仓库，选择 **Add file → Upload files**，把解压后项目目录中的文件和文件夹上传。保留目录结构，尤其要确保仓库中可看到 `docs/index.html`，而不是 `某个额外目录/docs/index.html`。
5. 点击 **Commit changes** 保存。部分浏览器或移动设备对拖放文件夹支持有限：建议用电脑浏览器；如果只用 iPhone，可先在“文件”App 中解压 ZIP，在 Safari 切换为桌面网站，再逐个上传文件并保留路径，或使用电脑/Git 工具上传。GitHub 网页不能将上传的 ZIP 自动展开成仓库文件。

**会用 Git 的用户**也可在解压后的项目目录运行（替换自己的用户名与仓库名）：

```bash
git init
git add .
git commit -m "Add Borderwise compliance workspace"
git branch -M main
git remote add origin https://github.com/你的用户名/borderwise-agent.git
git push -u origin main
```

若你已经通过 Git 克隆了仓库，不要重复 `git init` 或添加已有的 `origin`；将项目文件复制到克隆目录后 `git add`、`git commit`、`git push` 即可。

### 第三步：启用免费静态网站

1. 打开仓库顶部 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **Deploy from a branch**。
3. 在 **Branch** 选择 `main`；目录选择 **`/docs`**；点击 **Save**。必须选择 `/docs`，不是 `/(root)`。
4. 等待 GitHub 发布，刷新 Pages 页面；出现 **Visit site** 按钮后点击。普通项目仓库的地址一般是：

   ```text
   https://你的用户名.github.io/borderwise-agent/
   ```

   如果仓库名是 `你的用户名.github.io`，用户站地址则是 `https://你的用户名.github.io/`。部署可能需要几分钟，详情可查看仓库的 **Actions** 页面。源码使用相对路径，支持上述仓库子路径。
5. 在网站中先点击“填写货物资料 → 填入演示数据 → 生成复核清单”，再尝试提问及导出，即可验证基本功能。

之后修改 `docs/` 里的内容并提交到 `main`，GitHub 会重新发布。官方参考：[创建 Pages 网站](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) · [设置发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

### 仍打不开？

- **Settings 没有 Pages 或无法选择分支**：确认自己对仓库有管理权限、仓库为公开、`main` 分支已经包含提交。组织账号可能有额外策略。
- **404**：确认 Pages 来源为 `main /docs`，且仓库内存在 `docs/index.html`，网址中的用户名、仓库名与大小写正确；等待构建完成。
- **页面出现但按钮不工作**：确认 `docs/app.js`、`docs/engine.js`、`docs/styles.css` 和 `index.html` 同级；查看浏览器开发者工具的网络和控制台错误。
- **修改后仍是旧内容**：查看 Actions 是否成功，刷新页面或稍后再试。
- **原产地或制裁查询没有实时结果**：这是当前版本的设计边界，不是网站部署故障。请使用官方入口自行查询。

## 另一种免费静态托管：Cloudflare Pages

这适合希望在学习演示中进一步尝试可选 AI 模式的用户。Cloudflare 提供免费层，额度和服务条款可能变化，商业或敏感数据场景应另做合规、安全和隐私评估。GitHub 上的源码仓库可以继续使用。

1. 先按照上文“第一步”和“第二步”把完整源码上传到 GitHub 仓库；可以不用开启 GitHub Pages。
2. 注册并登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages → Create application → Pages → Import an existing Git repository**。按提示连接 GitHub 并选择 `borderwise-agent` 仓库。
3. 设置 Production branch 为 `main`，Build command 填写 `exit 0`，Build output directory 填写 `docs`。本项目没有构建步骤，输出目录就是已有的静态文件夹。
4. 点击 **Save and Deploy**，部署成功后访问提供的 `https://项目名.pages.dev`。推送 `main` 后通常会自动重新部署。界面名称以 Cloudflare 当时显示为准；参见 [Cloudflare 静态 HTML 部署指南](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)。

## 可选：接入真正的 AI 对话

静态站默认不含大模型。若需要模型对话，请先按上一节把前端部署到合适的托管服务，再按 [`worker/README.md`](worker/README.md) 部署仓库内的 Cloudflare Worker。Worker 已默认配置为智谱 BigModel 国内站接口和免费模型 `glm-4.7-flash`；你需要在服务端设置 `ZHIPU_API_KEY`（填入智谱 API Key）和 `APP_TOKEN`，再在网页“设置与数据”里填入 Worker 地址和访问口令并勾选启用。`ZHIPU_API_KEY` **绝不可**放进网页、GitHub 仓库或浏览器；访问口令只保留在当前页面内，刷新后需重新输入。Worker 的 CORS 源应只填前端站点的 origin，例如 `https://项目名.pages.dev`，不要带路径或末尾 `/`。

如果你的目标是“别人用自己的设备打开后默认就能对话”，请在 `docs/ai-config.js` 填入已部署的 Worker 地址，并将 `enabled`、`publicAccess` 设为 `true`；同时把 Worker 的 `PUBLIC_ACCESS` 设为 `"true"`。这不会暴露智谱 Key，但会把你的模型额度暴露给公众，必须先配置限流、监控和费用告警。源码默认仍关闭公开访客模式，避免误部署后产生不可控调用。

Cloudflare Workers 有免费层，但 API 模型服务由第三方提供，可能另行收费、限流并有地区限制。先确认服务商支持你的所在地、数据政策和付费额度。示例的共享访问口令不具备企业级身份验证，也没有内建持久化限流，使用者能看到并转发口令；公网商用前需要单独设计登录、授权、限流、监控及安全审计。请先阅读 [Worker 安全及部署说明](worker/README.md) 和 [Cloudflare Workers 用量限制](https://developers.cloudflare.com/workers/platform/limits/)。

## 本地运行与测试

无需安装前端依赖。电脑已安装 Python 3 时，在项目根目录执行：

```bash
python3 -m http.server 3000 --directory docs
```

打开 `http://localhost:3000/`。建议通过本地服务器访问，而不是直接双击 HTML；本地 `http://localhost` 页面不能直接使用只允许正式 HTTPS origin 的 Worker。

如已安装 Node.js，可运行测试：

```bash
node --test tests/*.test.mjs
node --test worker/test/worker.test.mjs
```

## 后续升级方向

若需要接近真实业务，应由合规、法律、数据安全及工程人员共同建设：为每个法规数据源取得授权并维护时间戳；建立版本化规则、可回溯的官方证据和人工审核流程；对货物、HS 与主体采用官方或授权数据；设计身份、权限、加密、审计、监控；并仅在获得正式授权后集成海关、物流及税务系统。不要把模拟提示或模型输出当作真实的制裁筛查、自动归类、原产地裁定、退税申报、CBAM 计算或自动订舱。

项目代码按 MIT 许可证提供；请核对所用模型、官方资源和第三方服务的各自条款。
