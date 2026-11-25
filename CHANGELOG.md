# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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