# dsh-connect-madao

把华为云码道（CodeArts Agent）的模型接入 DeepSeek Harness。

自签 `SDK-HMAC-SHA256`、P-256 密钥协商、SM4-GCM 载荷加解密，对外提供 OpenAI 兼容接口，带设置面板与状态胶囊。

---

## 状态

| 部分 | 状态 |
|---|---|
| 协议逆向 | ✅ 全部实测确认 |
| 密码层（ECDH / SM4-GCM / 签名） | ✅ 单测 7 项通过 |
| 凭证（AK/SK → 自动换 STS） | ✅ 端到端验证 |
| OpenAI 兼容 HTTP 服务 | ✅ 流式 + 非流式均验证 |
| 前端设置面板 | ✅ 构建通过（19.5KB bundle） |
| 输入框状态胶囊 | ✅ 构建通过 |

**已实测打通**：`doctor` 四步全绿，HTTP 流式返回 `reasoning_content` + `content` + `[DONE]`，非流式返回完整 JSON。

---

## 快速开始

### 1. 凭证：三种来源，按需选一种

插件按下面的顺序找凭证，**找到第一个能用的就用**，不需要三种都配。

| 顺序 | 来源 | 有效期 | 怎么来 |
|---|---|---|---|
| 1 | 环境变量 `MADAO_AK` / `MADAO_SK` | 永久 | 临时测试用 |
| 2 | 设置页填的 AK/SK（或 `credentials.json`） | **永久** | 华为云控制台 → 我的凭证 → 访问密钥 |
| 3 | 码道客户端登录态 | 几小时 | **什么都不用做** |

#### 想一劳永逸 → 选第 2 种

装好插件后在设置页填一次（设置 → 插件 → 码道连接器 → 账号）。

只有 IAM 的 AK/SK 两项，**不需要填 STS**，也不需要填模型清单 ——
STS 由插件调 IAM 自动换取并按期续租；模型清单在每次启动时从网关实时拉取。

也可以直接写文件：

```json
// ~/.dsh-connect-madao/credentials.json
{ "ak": "HPUA...", "sk": "kDls..." }
```

> AK/SK 在华为云控制台 → 我的凭证 → 访问密钥创建。

#### 想零配置 → 选第 3 种

如果本机装过**码道客户端**（CodeArts Agent）并且登录过，**可以什么都不填**。

插件会读码道存在这里的登录态：

```
%APPDATA%\codearts-agent\User\globalStorage\state.vscdb
```

码道已经把换好的临时三件套（AK + SK + STS）明文存在里面，插件直接借用。

**限制**：这是临时凭证，通常只有几小时。过期后打开一次码道客户端让它刷新，
再点浮层里的「测试并刷新额度」（或设置页的「测试连接」）就恢复。

临时凭证换不出新的 STS，只有永久 AK/SK 可以。所以想彻底免维护，还是选第 2 种。

### 2. 重启 DSH

就这样。插件会自动：

1. 起本地桥接服务 `http://127.0.0.1:8765/v1`
2. 从网关拉当前模型清单（含倍率、是否多模态、可选思考强度）
3. 按拉到的结果重写插件自带的 `cordis.patch.yml`
4. 把 `madao` provider 注册进 DSH

**不需要手写任何 YAML**，上游上新模型或调价，重启即同步。

### 3. 验证

输入框右侧会出现 `● 码道` 状态胶囊，点开能看到账号和积分额度，
点「测试并刷新额度」会跑完整链路：STS → 密钥协商 → 模型清单 → 额度。

命令行也能查：

```bash
node lib/bin.js doctor        # 四步自检
node lib/bin.js models        # 打印网关当前模型清单
node lib/bin.js models --write # 顺手把清单写回 patch
```

### 4. 手动接入（不走插件）

如果不装插件，只要本地服务：

```bash
node lib/bin.js serve --port 8765
```

然后把任意 OpenAI 兼容客户端的 base URL 指向 `http://127.0.0.1:8765/v1`。

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/chat/completions` | 对话，支持 `stream` |
| GET | `/v1/models` | 11 个模型 |
| GET | `/healthz` | 自检：凭证 / STS / 密钥协商 |

---

## 结构

```
src/
  protocol/
    crypto.ts     P-256 ECDH + SHA256 派生 + SM4-GCM 加解密
    sign.ts       华为云 SDK-HMAC-SHA256（码道网关）
    huawei-sign.ts 同一签名的早期版本（IAM 换 STS 用）
    body.ts       请求体规范化（上游就是 OpenAI 形状）
    sse.ts        SSE 翻译
  sts.ts          IAM 换 STS
  sts-provider.ts STS 缓存与自动续期
  client.ts       协商缓存 + 签名 + 加密请求 + SSE 解密流
  credentials.ts  凭证加载（env / file）
  server.ts       OpenAI 兼容 HTTP 服务
  bin.ts          CLI：serve / doctor / models
  client/
    index.ts      客户端插件入口（apply/inject/name）
    Panel.tsx     设置面板（账号/模型/诊断/关于）
    ComposerChip.tsx 输入框状态胶囊
lib/              构建产物
  index.js        宿主侧
  client.js       前端 bundle
  bin.js          CLI
```

---

## 实测踩过的 8 个坑

全部用真实网关验证，写下来省得重踩：

| # | 坑 | 正确做法 |
|---|---|---|
| 1 | IAM 换 STS 的认证方式 | body 用 `methods:["token"]`，不是 `hw_ak_sk` |
| 2 | 签名路径 | 签名用带尾斜杠 `/a/b/c/`，请求发 `/a/b/c` |
| 3 | payloadHash | 用**真实 body 的 SHA256**，不是 `UNSIGNED-PAYLOAD` |
| 4 | SignedHeaders | 必须与实际发送的头**一一对应**，多签少签都 401 |
| 5 | 密钥协商曲线 | 是 **P-256**（`prime256v1`），不是 X25519 |
| 6 | KDF | **裸 SHA256 截前 16 字节**，不是 HKDF |
| 7 | 加密请求体 | 是 **Base64 文本**，不是原始二进制 |
| 8 | SSE 解密 AAD | **`keyId\|chunkIndex`**，与请求的 method/path/ts 无关 |

第 5、6 条推翻了内核源码给人的印象；第 8 条尤其隐蔽——源码里写的是 `aadPrefix|index`，而实际 `aadPrefix` 就是 keyId。

---

## 已知限制

- **思考强度已生效**（0.5.1 起）：网关认的是 **`reasoning_effort`**，不是 `strength`。
  之前一直发 `strength`，网关当未知字段忽略，所以界面上换档位毫无效果 ——
  这也是当时误判成"完全不支持"的原因。实测（GLM-5.2，同一道题各跑 3 次取平均）：
  `high` → reasoning 1014 字，不传 → 1254 字，`max` → 1323 字；组内 σ≈75，
  组间差 240 / 69，统计上确认生效。`off` 走网关的 `none`。
  注意幅度有限：`max` 只比默认多约 5%，真正有明显差别的是 `high`（比默认少约 19%）。
- **工具调用（tool_calls）已支持**（0.4.1 起）：早期版本只转发 `content` 和
  `reasoning_content`，把 `tool_calls` 帧整个丢掉了。表现是 `finish_reason: "tool_calls"`
  但 `content` 为空，客户端只看到「有思考、没内容」，于是判定异常并中断 ——
  用户观感就是「莫名其妙中断」。现在按 OpenAI 标准原样透传分片
  （`id`+`name` 在第一帧，`arguments` 后续逐片累积，`index` 标识同一调用）。
- **图片已支持**（0.4.0 起）：网关接受**标准 OpenAI** 的
  `{type:"image_url", image_url:{url:"data:image/png;base64,…"}}`，实测能真正识别图片内容
  （8×8 纯蓝 PNG：带图答"蓝色"，无图答"无法确定"）。
  注意码道客户端自己在内部用的是 `{type:"file", filename, mime, url}`，
  那个格式网关**不认**（返回空内容）—— 桥接用的是 OpenAI 标准格式。
  `supports_images` 为真的 5 个模型才建议发图：glm-5.3-flash、deepseek-v4.1-flash、
  deepseek-v4.1-flash-1017、kimi-k3、kimi-k3.1-pro。
  音频和 file 类型仍会返回 `400 unsupported_content`。
- **没有签到接口**：`/snap-manager` 与 `/v1/ops` 下 12 个候选路径全部 404（PROTOCOL.md §13.3）。
- **并发上限 3 个会话**（`TM.00001041`）。网关按 `user-session-id` 头计会话数，
  早期版本没带这个头，每次请求都被算作新会话，重启几次就把名额占满。
  现已固定复用同一个会话 id（按 AK 哈希），并在每次对话前后发 `heartbeat` 标
  busy/idle，让名额及时释放。万一仍撞上，等 1–2 分钟让旧会话过期。
- **IAM 换 STS 有频率限制**，短时间反复换会触发 `forbidden`，等约 1 分钟恢复。
  插件已做缓存与提前 10 分钟续期。
- **额度是实时值**：基础包 500 + 赠送包（活动得来，可能有过期时间）= 总额。
  数字会随使用和活动变化，以网关返回为准。
- **DSH 的上下文估算是虚高的**：pi-ai 在发请求前会自己估算上下文，把 `tools` 的
  JSON schema 按接近 1 token/字符 算，而那是英文+JSON，真实只有 1/3 左右。
  DSH 自带 377 个工具，光 tools 就被估成 20 多万 token —— 于是 202752 的 GLM-5.2
  被判超限，请求根本发不出去（`CONTEXT_WINDOW_EXCEEDED`）。
  **实测同一请求打到网关只有 172491 tokens，完全在窗口内。**
  插件已把报给 DSH 的 `contextWindow` 放大 2.5 倍，让它按自己的虚高数字能放行；
  真正的保护留在桥接里，用网关给的真实窗口判断。
- **桥接自己的估算也可能偏**：没有 tokenizer，只能按字符类型粗估，实测偏差
  1.15–2.0×（内容越重复、英文越多，偏差越大）。所以闸门放在窗口的 1.2 倍，
  宁可漏拦也不误拦 —— 误拦会让模型彻底不可用，漏拦只是网关返回空内容，
  而空响应会被 `chat.log` 标记，且请求体落盘到 `last-rejected.json` 可复查。
- **网关不认 `developer` 角色**：DSH 用 OpenAI 新规范的 `developer` 角色承载系统提示，
  而码道网关只接受 `system`/`user`/`assistant`/`tool`。收到 `developer` 时它**不报错**，
  而是返回 HTTP 200 + `finish_reason: stop` + 空 `content`，DSH 只能显示
  `EMPTY_RESPONSE: returned a completed response with no content`。
  桥接已统一把它降级成 `system`（`protocol/body.ts`）。
  这也是为什么"新对话、短上下文、换哪个思考档位都失败" —— 只要带系统提示就必失败。
- **`max_tokens` 设太小会返回空 content**：码道的模型都会先输出 `reasoning_content`
  （思考过程），它和正文共享 `max_tokens` 预算。给 60 这种小值，思考就把额度吃光了，
  正文 `content` 为空，DSH 显示成 `EMPTY_RESPONSE: model 'GLM-5.2' returned a completed
  response with no content`。这不是模型坏了，把 `max_tokens` 提到几百以上即可。
- **模型名要用 model_id 或显示名，别自己拼**：网关只认 `model_id`（如 `deepseek-v4.1-flash`），
  不认显示名。DSH 界面上显示的是 `名称 · 倍率`（如 `GLM-5.2 · 0.7x`），桥接会自动还原成
  id；但如果你绕过桥接直接打网关，就必须自己用 id，否则会拿到 HTTP 200 + 空 content。

---

## 协议全文

见 [`../PROTOCOL.md`](../PROTOCOL.md)。

## 侦察记录

见 [`../RECON.md`](../RECON.md)。







