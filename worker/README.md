# 可选 AI Worker（独立部署）

这个目录可单独复制和部署：Cloudflare Worker 接收静态站的提问，用服务端密钥调用智谱 AI（BigModel）的 Chat Completions 接口（OpenAI 兼容格式）。**未部署本 Worker 也不影响静态站的本地规则功能。** Worker 不提供实时联网、官方法规查询或制裁筛查；输出仅供整理和人工复核，不是法律意见、合规证明或可申报结论。

## 费用、隐私与安全

- GitHub Pages 免费 **不代表模型免费**。模型服务可能按请求、输入/输出量收费；Cloudflare 账户也可能有使用量上限或超额费用。请事先核对自己的服务合同、价格与额度，设置提供商预算/用量提醒，并人工定期检查调用量；预算提醒不一定自动阻断扣费。
- 选择使用 AI 时，浏览器将 `question`、`shipment` 和 `report` 发送到 Cloudflare Worker，再由 Worker 发送给配置的模型服务商，可能涉及跨境传输。请先取得必要授权，避免提交个人敏感信息、客户机密及不必要的单证，审阅 Cloudflare 和模型服务商的数据处理、留存与地区政策。本代码不主动写入数据库或日志，但不能承诺 Cloudflare、模型服务商或其平台没有日志或留存。
- `ZHIPU_API_KEY` **只存 Worker 服务端 secret**，绝不填入前端、Git、`wrangler.toml` 或聊天内容。`APP_TOKEN` 也在服务端存为 secret，但使用者必须把该访问口令提供给静态页面，因此它只是共享密钥：浏览器使用者能查看、复制、转发，不能作为企业级身份权限管理。
- 精确 CORS 限制的是浏览器能否跨域读取，并非访问控制的全部；非浏览器客户端可伪造 `Origin`。共享口令也无法抵御泄露或所有滥用。本示例**没有内建用户级身份、持久化限流、配额或审计**。上线前应结合 Cloudflare WAF/Rate Limiting、Cloudflare Access 或自有身份鉴权、模型提供商限额、监控及密钥轮换；敏感或商业场景请做安全审查。
- 模型指令只是降低风险的措施，并不能保证答案准确或完全抵御提示注入。对法规、原产地、制裁、HS 归类和申报结论，必须由人员到官方渠道核验。

## 准备

需要 Cloudflare 账户、Node.js（建议 22 或更高版本，具体以 Wrangler 当前要求为准）和 npm，以及一个可用的智谱 API Key（在 [open.bigmodel.cn](https://open.bigmodel.cn/) 注册并创建）。当前默认配置使用智谱国内站接口和免费模型 `glm-4.7-flash`；具体能力、额度和计费以智谱账户当前规则为准。以下命令在本 `worker/` 目录运行；`npx` 会下载/调用 Wrangler，需网络连接。

1. 编辑 `wrangler.toml`：
   - 将 `ALLOWED_ORIGIN` 替换为静态网站的**完整 HTTPS origin**，例如 `https://your-project.pages.dev`。只填协议、主机和可选非默认端口，不要加 `/`、仓库路径、查询参数或片段；自定义域名同理。只允许一个 origin，不支持通配符或列表。切换域名/协议/端口必须更新并重新部署。`file://` 打开 HTML 的 `null` origin 不受支持。GitHub Pages 不适合提交访问口令，使用 AI 模式请改用允许此用途的静态托管。
   - 按需改 Worker `name`，避免覆盖账户中同名服务。当前默认 `ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"`、`MODEL = "glm-4.7-flash"`、`PUBLIC_ACCESS = "false"`；如果你的账号是国际站 z.ai，把基础地址改为 `https://api.z.ai/api/paas/v4`（两站 Key 不互通）。模型名必须小写，如 `glm-4.7-flash`、`glm-4-flash`。基础地址不要包括 `/chat/completions`，因为代码会自动追加；不支持 URL 用户名、密码、查询参数、片段或 HTTP 明文。
2. 登录并首次部署：

   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```

   首次部署前确保已替换 `ALLOWED_ORIGIN` 占位符。没有 secret 时 Worker 会拒绝实际 POST 并返回配置错误，不会发起模型调用。
3. 在命令提示时分别输入服务商密钥和一个随机共享访问口令：

   ```bash
   npx wrangler secret put ZHIPU_API_KEY
   npx wrangler secret put APP_TOKEN
   ```

   如果希望别人打开网站后无需输入共享口令，必须在 `wrangler.toml` 中显式改为 `PUBLIC_ACCESS = "true"`，并在前端 `docs/ai-config.js` 中填入 Worker 地址、开启 `enabled` 和 `publicAccess`。这种模式会把你的模型额度暴露给公众，可能被刷量并产生费用；上线前应配置 Cloudflare 限流、监控和预算告警。公开模式仍不会把智谱 API Key 放进网页。

   访问口令必须使用**无空格的可打印 ASCII 字符**，不要使用中文或空格；网页最多接受 300 个字符。建议用 `openssl rand -hex 32` 生成高强度口令；请安全保存，不要写进仓库、终端命令历史或公开文档。`wrangler secret put` 更新的是对应 Worker 的 secret，部署或更换后可通过下方测试确认生效。需要更换口令或撤销泄露的密钥时，重新执行相应 `secret put` 并通知使用者；必要时在智谱平台吊销原 API key。
4. 使用 Wrangler 输出的 `https://...workers.dev` URL（或自己绑定的 HTTPS Worker 域名）作为主前端的 Worker URL，并在前端设置中输入同一个 `APP_TOKEN`。前端只需知道 Worker URL 和共享口令，**不需要、也不应知道模型 API key**。

修改 `wrangler.toml` 中普通变量后重新执行 `npx wrangler deploy`；安装和发布可能需要 Cloudflare 授权。账号未启用 `workers.dev` 或有组织权限限制时，请按 Wrangler 提示处理。

## HTTP 协议

- `OPTIONS` 处理 CORS 预检；`POST` 接受 `Content-Type: application/json` 和 `Authorization: Bearer <APP_TOKEN>`。浏览器会自动附带 `Origin`；缺少 `Origin`、与配置不完全一致或配置不合法时拒绝（命令行测试须自行设置）。不支持 cookie、GET、流式回复或附加鉴权头。
- JSON 格式：

  ```json
  {
    "question": "这票货还需要核实什么？",
    "shipment": { "goods": "玩具", "destination": "欧盟" },
    "report": { "items": ["核实商品编码"] }
  }
  ```

  `question` 必填、非空、最多 2,000 个 JavaScript UTF-16 代码单元；`shipment` 和 `report` 可缺省（按 `null` 处理），也可为对象、数组、字符串或 `null`。两者 JSON 序列化后的 UTF-8 大小分别最多 16 KiB 和 32 KiB；整个请求体最多 64 KiB（实际读取字节数也会检查）。不要传不必要的额外字段：未识别字段不会发送给模型。过于复杂而无法序列化的上下文会被拒绝。
- 成功：HTTP 200，`{"answer":"中文回答"}`。失败：JSON `{"error":"可理解的错误信息"}`；常见状态为 400（JSON 或字段无效）、401（口令无效）、403（来源不允许）、405（方法无效）、413（请求体过大）、415（格式错误）、500（服务配置错误）、502（上游请求或响应异常）、504（上游超过 30 秒）。非允许来源的响应没有 `Access-Control-Allow-Origin`，浏览器可能只显示 CORS 网络错误。不会将上游错误响应体或服务端密钥返回给前端。
- 上游请求使用 `POST <ZHIPU_BASE_URL>/chat/completions`、`Authorization: Bearer <ZHIPU_API_KEY>`，默认即智谱 `https://open.bigmodel.cn/api/paas/v4/chat/completions` 和 `glm-4.7-flash`，发送模型名、中文审慎系统提示及用户 JSON，`stream: false`；仅提取 `choices[0].message.content` 字符串作为答案。禁止自动跟随重定向；服务商需要直接返回此兼容格式。最长等待约 30 秒，响应最多读取 1 MiB。

### 命令行验证

部署完成并输入 secret 后，将以下 origin 和 URL 改成自己的值。不要把真实口令写进命令历史；下面用交互式读取（适用于 Bash）。若修改了 `ALLOWED_ORIGIN`，请先重新部署。

```bash
WORKER_URL='https://your-worker.your-subdomain.workers.dev'
read -r -s -p 'APP_TOKEN: ' APP_TOKEN; echo
curl -sS -X POST "$WORKER_URL" \
  -H 'Origin: https://your-project.pages.dev' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $APP_TOKEN" \
  --data '{"question":"需要核实哪些资料？","shipment":{"goods":"玩具"},"report":null}'
unset APP_TOKEN
```

实际请求会调用模型并可能产生费用。若返回 401，请核对口令；500 检查 Worker secrets、精确 origin、模型基础地址；502 检查服务商账户、额度、模型名和接口兼容性；504 可稍后重试。不可在公开问题或截图中包含令牌与敏感资料。

## 本地检查

不需要安装依赖，也不需要真实密钥；测试会模拟上游服务：

```bash
node --check src/index.mjs
node --test test/worker.test.mjs
```
