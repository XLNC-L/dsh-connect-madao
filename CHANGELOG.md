# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.12.1 — 2026-11-28

修一个只在 scoped 包名下出现的回归：设置页左侧的「码道连接器」入口不见了，
模型页里那张卡片却还在。原因是客户端 bundle 的
`window.__ModuleLoader__.load({ id })` 被硬编码成 `dsh-connect-madao`，而 DSH
的客户端加载器用 **npm 包名**定位并应用模块；包名改成
`@yzdys/dsh-connect-madao` 后 id 对不上，客户端插件就被跳过了。

现在 id 从 `package.json` 的 `name` 读取，换 scope 不用再改构建脚本。

## 0.12.0 — 2026-11-27

码道的 provider 改由插件**自带 adapter** 注册，不再复用 `llm-pi-ai` 的
`providers` 配置。效果是 DSH「设置 → 模型」里那张卡片不再带「自定义」标签，
展开后也只显示名称、路由 id 和「其余字段在 cordis.patch.yml 中」的提示，
和 trae / WorkBuddy 这类连接器一致。

### 变更

- **自带 LLM adapter。** 运行时复用宿主里的 `@deepseek-ai/dsh-llm-pi-ai` 与
  pi-ai：流式、工具调用、思考档位仍由上游实现，插件只负责把网关模型映射成
  pi-ai 的 `Model`，并注册 `madao` provider（`declared: false`）。
- **迁移旧配置。** 启动时如果发现 profile 的 `llm-pi-ai.providers.madao`
  还在，会先删掉这一段再注册（只删 `madao`，`ark-coding-plan` 等其它 provider
  原样保留），避免 adapter 重复注册。
- **保存立即生效。** 「模型」页的勾选/上下文上限现在直接重建 adapter 的模型
  目录并通知 DSH，不再写 `llm-pi-ai` 配置；上下文上限与勾选仍存在
  `dsh-connect-madao-state.json`。
- **模型清单不再写回 `cordis.patch.yml`。** 这份 patch 现在只负责把插件挂进
  profile，因此删掉了 `models --write` 与发版前的 `sync-patch` 脚本。
- **新增 `/diag/native`。** 只读诊断：返回 adapter 当前对外提供的模型。
- **补上插件自己的 settings 命名空间。** 模型设置页只渲染“命名空间存在”的
  provider（`configured` 依赖 `namespaces.has(settingsNs)`），所以插件的
  `Config` 现在用 schemastery 声明（字段标记 volatile，改配置不会重载插件），
  并用 `settings.configure({ auto: false })` 隐藏自动生成的设置页。

### 升级注意

- **npm 包名改为 `@yzdys/dsh-connect-madao`。** 旧的 `dsh-connect-madao`
  停在 0.9.2；装新包时先卸旧包即可，profile 里的插件 id 与 settings 命名空间
  仍是 `dsh-connect-madao`，模型选择和状态文件不受影响。
- 从 0.11.x 升级不需要手动改 YAML；首次启动会自动完成迁移。
- 选择器里原来选中的 `madao/*` 模型 id 不变，session 不受影响。

## 0.11.0 — 2026-11-27

「模型」页从一张只读表改成**可选可调**：勾掉不想看到的模型，DSH 的模型选择器里
就真的不会出现；还能单独调小某个模型的上下文上限。改完点一次「保存」即可，
不重启 DSH。

### 新增

- **模型勾选列表（设置 → 码道连接器 → 模型）。** 每行一个勾选框，取消勾选即从
  DSH 模型选择器移除；「全选 / 全不选」批量操作；搜索框按显示名或 `model_id`
  过滤。至少保留一个模型，全勾掉会被服务端拦下。
- **每模型独立的上下文上限。** 行内下拉框可把展示上下文调小（`1M → 256K` 等，
  只允许往小调）。调小后 DSH 会更早压缩历史；网关真实上限不变。
- **保存按钮 + 未保存提示。** 勾选和上限先改本地草稿，点保存才写盘并应用，
  避免每勾一下就重载一次 provider。保存成功显示「模型选择器已更新」，
  失败会显示具体原因。
- **`POST /settings` 接受 `hiddenModels` / `contextCaps`，返回 `modelApply`。**
  保存时通过宿主 `configEditor.edit()` 只改写 `llm-pi-ai` 的 `providers.madao`，
  其它 provider 与 profile 配置原样保留，由 Loader 协调后立即生效。
  宿主缺少 `configEditor` 时如实返回 `unavailable`，面板提示「重启后生效」。
- `src/model-config.ts`：模型筛选、上限套用、provider 配置合并与应用的纯函数，
  配 `tests/model-selection.spec.ts` 覆盖（含 HMR 事务上下文逃逸的回归用例）。

### 修复

- **`lib/bin.js` 与源码不同步。** 之前提交的 CLI bundle 还是 0.9.x 时期的构建，
  缺少签到、额度过期、设置等模块；本次一并重建。
- **从 HMR 重载后的 HTTP 请求里改配置会报「HMR transactions cannot be nested」。**
  桥接服务创建于插件 apply 期间，请求回调继承了当时的 AsyncLocalStorage 事务
  上下文；应用模型选择前先 `executing.exit()` 跳出，避免误判嵌套。

## 0.10.0 — 2026-11-25

本版把设置面板从「只能从插件详情页进」提升为**设置页左侧导航里的独立一页**，
并补上两个一直缺的界面开关。三个功能都可以在插件自己的面板里操作，不需要改配置、
不需要重启 DSH。

### 新增

- **设置页侧栏入口。** 面板注册到 `settings.section`（`id = dsh-connect-madao`，
  `order = 55`），左侧导航里出现「码道连接器」一页，与 Trae / Qoder / Meoo 并列。
  同时保留原来的 `plugins.bundle.config`，插件详情页那张卡片照旧存在。
  图标走 `settings.section.icon`（同一个 id）；该槽位在部分宿主版本上没有，
  缺了只是退回默认齿轮，页面本身不受影响。
- **「界面」标签页 + 输入框胶囊显隐开关。** 关掉后 `conversation.input.right`
  槽位里的胶囊组件直接返回 `null`，输入框右侧不再出现「● 码道」。
  默认显示，升级后老用户界面不变。
- **「每日签到」区的自动签到开关（默认关闭）。** 打开后宿主侧每分钟 tick 一次，
  命中当天可领就调 `/v1/ops/claim`；两次真实请求之间至少间隔 15 分钟（节流），
  开关翻转时立刻跑一轮。与桥接共用同一份已登录客户端和 STS 续期，不另起一套。
  面板会显示上次结果（「已自动签到，+100 积分」／「今日已领取」）。
  默认关闭是刻意的：签到会改变账号状态，应由用户显式开启。
- **`GET/POST /settings`** —— 两个开关的读写端点，顺带返回自动签到的运行状态。
  状态落在 `$DSH_HOME/dsh-connect-madao-state.json`（`DSH_HOME` 未设时 `~/.dsh`），
  写入走「临时文件 + rename」，权限 `0o600`。
  不用 DSH 的插件 config 是有原因的：那两个开关要求「点一下立刻生效」，
  写 config 会触发插件重载，把桥接服务和在途对话一起掀掉。

### 修复

- **浅色模式下设置面板几乎看不清。** 面板用的 `--dsh-fg` / `--dsh-border` /
  `--dsh-muted` / `--dsh-input-bg` 在当前 DSH 里**并不存在**，所有 `var()` 都会
  回退到写死的暗色值（`#ddd` / `#333` / `#1b1b1b`）。结果在白色主题下是
  「浅灰字配白底」、「账号」标签直接白字白底看不见、输入框是一块刺眼的黑。
  现已全部换成真实的 `--dsw-alias-*` 主题令牌，并把若干 `opacity: 0.55~0.65`
  的文字改成语义色（`label-secondary`），因为叠加透明度会把对比度再削一次。
  实测对比度：浅色 正文 18.9:1 / 次要 5.8:1，深色 15.9:1 / 11.1:1。

### 内部

- 新增 `src/settings.ts`（设置读写）、`src/auto-checkin.ts`（调度器）、
  `src/client/settings.ts`（前端发布-订阅 store）、`src/client/SectionIcon.tsx`。
- `RunningServer` 现在带出内部 `ctx`，并新增 `borrowClient()`；调度器借此复用
  桥接那份客户端，避免两条链路各自换 STS、撞上 IAM 频率限制。
- 前端 store 带 `localStorage` 首屏缓存：胶囊在第一次 `/settings` 回来之前不会
  闪一下。权威数据仍在宿主侧，缓存只是镜像。

## 0.9.2 — 2026-11-20

本版主要来自社区贡献者 **[@vzhentian1-design](https://github.com/vzhentian1-design)** 的
[PR #1](https://github.com/XLNC-L/dsh-connect-madao/pull/1)。该 PR 基于 11-16 的 main，
之后 `server.ts` / `sse.ts` / `lib/index.js` 均已大改，无法直接合并；这里按「只移植协议
增量」的方式重放了他的四项改动，其余部分（含提交进仓库的 `lib/index.js` 构建产物）
未采用，产物由本仓库重新构建生成。原始思路与判据均来自他。

### 新增

- **`POST /v1/ops/confirm`** —— 补上漏掉的协议环节。
  上游是四态状态机 `ELIGIBLE → CLAIMED → CONFIRMED → CONSUMED`：`claim` 之后积分
  虽然已经到账，状态却停在 `CLAIMED`（"已领取"），必须再 `confirm` 一次才变
  `CONFIRMED`（"已到账"）。本仓库之前只做了 `claim`，所以网页端会一直显示「已领取」。
  - `confirm` 的 body **只认 `{campaignId}`**，多带 `channel` 会 `HTTP 400 HDN.1000
    channel : unknown exception`（实测）。
  - `confirm` **不校验状态机**：对已经 `CONFIRMED` 的活动再调用也返回 `code=0`。
    因此只对 `status === "CLAIMED"` 的活动调用，绝不随手乱发。
  - 列表里遇到 `CLAIMED` 时只补 `confirm`，不重复 `claim`。
- **多活动扫描 + `type` / `triggerEvent` 白名单** —— 之前只认死 `campaignId=34`，
  其它签到类活动全部漏领（实测曾见过 `campaignId=40`「Skill创新赛每日签到礼」
  每天 1000 分，是每日签到的十倍）。现在：
  - 判据按可靠程度：`type === 'USER_LOGIN'` → `extra.triggerEvent === 'user.login'`
    → 标题含「签到」且不含「报名 / 认证 / 注册 / 邀请」（前两者缺失时才用标题兜底）。
  - 只领 `triggerMode !== 'AUTO_GRANT'` 且 `claimable === true` 且
    `status === 'ELIGIBLE'` 的活动。
  - **不替用户报名/认证**：报名、学生认证、邀请有礼这类一次性动作一律跳过，
    宁可漏领也不误签。
  - 新增 `POST /diag/checkin/all`（面板上的「领全部」按钮）。
- **积分到期预警** —— 上游在额度接口里给了 `package_credit_expiring_amount`
  （即将到期的数量）和顶层的 `start_date` / `end_date`，之前一个字段都没读，
  用户只能等某天突然发现余额少了一大截。现在读取并算出三档提醒
  （`urgent` ≤ 2 天 / `warn` ≤ 7 天 / `info`），通过 `/diag/account` 的
  `creditExpiry` 字段暴露，面板上额度行下面直接显示。
  - 实测这两个汇总指标报的是**同一个值**（同一批积分），取首个命中即可，
    累加会把 33.54 说成 67.08。
- **`LICENSE`** —— MIT 全文。之前仓库根确实没有；`package.json` 的 `files`
  也一并补上，否则 npm 包里不会带这个文件。

### 未采用（本仓库已自行实现）

- **缓存命中透传**：PR 里的 `pickUsage` 会挑字段重组 usage，覆盖面反而比本仓库
  0.8.x 起的实现更窄 —— 本仓库在 `protocol/sse.ts` 是**整体保留**上游 usage
  （含 `prompt_tokens_details.cached_tokens`），并在 `server.ts` 里读取打日志。
- **自动签到调度器**（`src/checkin-scheduler.ts`）：每分钟轮询、开机补跑、
  每天最多 3 次重试、默认开启。本版**不包含** —— 签到仍只由用户点击触发，
  不替用户自动改账号状态。需要的话建议后续以「默认关闭 + 显式开关」的方式加。

### 内部

- `chatLog` 从 `server.ts` 抽到 `src/protocol/log.ts`（签到模块也要写同一个
  `chat.log`，两处各写一份会互相交错）。
- 签到逻辑独立成 `src/checkin.ts`，纯函数可单测，不绑在 HTTP 层；
  `server.ts` 已 1100+ 行，不再往里塞。
- `src/credit-expiry.ts` 只依赖一个极小的 `ExpiryInput` 接口，不 import `server.ts`。
- 单测 42 → **80**，新增 `tests/checkin-filter.spec.ts`（16 项）与
  `tests/credit-expiry.spec.ts`（22 项）。

## 0.9.1 — 2026-11-19

- 请求体超限返回 413 而不是 400。
- 上下文窗口改为如实上报真实值（系数 2.5 → 1.0），修掉「压缩失败」。

## 0.9.0 — 2026-11-19

- 首个正式发布版本，插件市场上架。