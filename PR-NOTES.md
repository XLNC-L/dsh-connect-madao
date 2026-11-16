# 本次改动的四点说明

> 由一个实际使用这个插件的人提的，全部改动都在本机真实跑过。
> 目的只有一个：**别让白送的积分悄悄过期**。

## 1. 补 `LICENSE`

`package.json` 里写的是 `"license": "MIT"`，但仓库根目录没有 `LICENSE` 文件。
GitHub 因此识别不到许可（仓库页显示 `license: -`），插件目录也把它标成「未声明许可」。

这份 LICENSE 就按你 `package.json` 里已有的 MIT 声明补全文，版权行 `Copyright (c) 2026 XLNC-L`。
**不含任何代码改动**，纯粹是补一个你本来就想表达的东西。

## 2. 自动签到（默认关闭）

原来签到只有设置页里一个按钮，**宿主侧一个定时器都没有**（`grep setInterval|setTimeout|setTimeout|ctx.timer` 全空）。
而签到是「一天一次」的收益，最容易漏的就是每天都得记得点。

改动：
- 抽 `queryCheckin()` / `claimCheckin()` 两个导出函数（`src/server.ts`），
  让「设置页手动点」和「定时器自动签」走**同一份逻辑** —— 各写一遍迟早漂移；
- 新增 `src/checkin-scheduler.ts`：墙钟对齐（不是 `setInterval` 24 小时，
  那个会随重启漂移，最后跑到半夜三点去签）；
- 配置项 `autoCheckin` / `autoCheckinHour` / `autoCheckinMinute`，**默认关闭**；
- 跟 `ctx.effect` 绑定，插件卸载时定时器一起停。

为什么默认关：替用户改账号状态这种事，得他本人点头。

幂等性：`claimCheckin` 先查 `status`，当天已签（`CLAIMED`/`CONFIRMED`）就直接跳过，不发请求。

## 3. 积分到期预警（这条最重要）

上游 `/snap-manager/v1/statistics/plugin` 的两个汇总指标里有
**`package_credit_expiring_amount`**，这是「即将到期的积分数量」。
之前插件完全没读这个字段 —— 所以用户只能等某天发现余额突然少了一截。

真实例子（本机，2026-11-16）：

```
remain=9637.06  expiringAmount=6637.06  packageStart=2026-10-18  packageEnd=2026-11-19
→ [warn] 6,637 积分还有 3 天到期（2026-11-19），过期即清零
```

改动：
- `CreditInfo` 增加 `expiringAmount` / `packageStart` / `packageEnd`；
- 新增 `src/credit-expiry.ts`：纯计算，三档预警
  （`info` 远、`warn` ≤7 天、`urgent` ≤2 天）；
- `/diag/credit` 返回里多一个 `creditExpiry` 字段；
- 调度器每轮顺带查一次，写进日志（`[expiry WARN] …`）。

**说明一个已知限制**：上游只给了「多少积分要到期」+ 套餐周期结束日，
**没给每批积分各自哪天到期**。所以这里用 `end_date` 当参照，
宁可提醒得保守，也不报一个错的精确日期。将来如果找到更细的接口，改 `credit-expiry.ts` 一个文件就够。

## 4. 缓存命中数透传

上游**默认开前缀缓存**，命中部分价格约是冷启动的 1/10。
它确实在 `usage.prompt_tokens_details.cached_tokens` 里给了这个数，但插件在解析 SSE 时把它丢了：

```json
// 上游真实返回（本机实测）
"usage":{"prompt_tokens":1436,"completion_tokens":16,"total_tokens":1452,
         "prompt_tokens_details":{"cached_tokens":1024}}
```

后果：DSH 那边的账本拿不到缓存数，只能把每次输入都按全价算，
**显示金额虚高好几倍，而真正省下的钱谁都看不见**。

改动：
- `src/protocol/sse.ts` 增加 `UsageInfo`（含可选 `cached_tokens`）与 `pickUsage()`；
- 两种命名都认（`prompt_tokens_details.cached_tokens` / 扁平 `cached_tokens` /
  `cache_read_input_tokens`），拿不到就不给这个字段（而不是填 0）。

实测透传结果：

```json
{"usage":{"prompt_tokens":1436,"completion_tokens":12,"total_tokens":1448,"cached_tokens":1024}}
{"usage":{"prompt_tokens":1436,"completion_tokens":16,"total_tokens":1452,"cached_tokens":1280}}
```

---

## 怎么验证

```bash
# 全部测试（新增 26 条，其中到期 16 条、缓存 10 条）
node --test --experimental-strip-types tests/*.spec.ts
```

改动前：`pass 32 / fail 1`
改动后：`pass 58 / fail 1`

那 1 个失败是**原来就有**的（`crypto.spec.ts` 里 `Unknown cipher` ——
当前 Node 不自带 SM4，跟这次改动无关；改动前跑同样失败）。

单跑新增的两组：

```bash
node --test --experimental-strip-types tests/credit-expiry.spec.ts
node --test --experimental-strip-types tests/usage-cache.spec.ts
```

带真实凭证跑一次到期预警：

```ts
const srv = await startServer({ port: 8896 })
const client = await srv.getClient()
const credit = await queryCredit(client)
console.log(evaluateExpiry(credit))
```

## 改动清单

| 文件 | 性质 |
|---|---|
| `LICENSE` | 新增 |
| `src/checkin-scheduler.ts` | 新增 |
| `src/credit-expiry.ts` | 新增 |
| `tests/credit-expiry.spec.ts` | 新增（16 条） |
| `tests/usage-cache.spec.ts` | 新增（10 条） |
| `src/index.ts` | 接入调度器 + 三个配置项 |
| `src/server.ts` | 抽签到函数、`queryCredit` 导出、额度补到期字段、`RunningServer.getClient()` |
| `src/protocol/sse.ts` | `UsageInfo` + `pickUsage()` |

没有改协议层（加密、签名、密钥协商一行没动），没有改 UI 组件。