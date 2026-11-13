/**
 * 客户端插件入口。
 *
 * DSH 的客户端插件契约（实测自 dsh-connect-workbuddy 的 lib/client.js）：
 *   exports.name   = "<plugin>-client"
 *   exports.inject = ["slots", "locale"]
 *   exports.apply  = (ctx) => void
 *
 * 注册 UI 的方式：
 *   ctx.locale.register(ns, { zh, en })
 *   ctx.slots.inject(slotName, () => ctx.slots.register({ name, key, priority, inject }, Component))
 *
 * 用到的 slot（均已在本机 DSH 中确认存在）：
 *   plugins.bundle.config  — 设置页里展开的配置区（主面板）
 *   plugins.item           — 插件列表行
 *   conversation.input.right — 输入框右侧（状态胶囊）
 */

import { CodeArtsPanel } from './Panel.tsx'
import { ComposerChip } from './ComposerChip.tsx'

export const name = 'dsh-connect-madao-client'
export const inject = ['slots', 'locale']

/** i18n 文案：中文为主，英文兜底。 */
const zh = {
  'meta.title': '码道连接器',
  'meta.desc': '把华为云码道（CodeArts Agent）模型接入 DSH',
  'tab.account': '账号',
  'tab.models': '模型',
  'tab.diagnostics': '诊断',
  'tab.about': '关于',
  'account.title': '华为云凭证',
  'account.hint': '不填也能用：装过并登录过码道客户端的话，插件会自动借用它的登录态。填上永久 AK/SK 则一劳永逸，之后不用再管。',
  'account.sourceTitle': '凭证从哪来',
  'account.sourceDesc': '插件按下面的顺序找凭证，找到第一个能用的就用，不需要三种都配。',
  'account.sourceEnv': '环境变量 MADAO_AK / MADAO_SK',
  'account.sourceFile': '上面填写的永久 AK/SK',
  'account.sourceCodearts': '码道客户端登录态（零配置）',
  'account.sourceActive': '当前生效',
  'account.sourceTemp': '临时凭证，剩 {n} 分钟',
  'account.sourceExpired': '已过期 · 打开一次码道让它刷新，再点上方「测试连接」',
  'account.sourceTempSoon': '即将过期，剩 {n} 分钟 · 建议现在打开码道刷新，或改填永久 AK/SK',
  'account.sourceTempSec': '剩 {n} 秒，即将失效',
  'account.sourceTempNote':
    '你用的是从码道登录态借来的临时凭证，几小时后会失效。失效后：打开一次码道客户端让它刷新，再点上面的「测试连接」即可恢复。想免去这一步，就填上面的永久 AK/SK —— 只配一次，插件会自动换 STS 并续期，之后不用再管。',
  'account.sourcePermNote': '当前用的是永久凭证，插件会自动换取 STS 并在过期前续期，无需再操作。',
  'account.howToGetAk': '怎么拿到 AK/SK',
  'account.howToGetAkSteps':
    '华为云控制台 → 右上角账号名 → 我的凭证 → 访问密钥 → 新增访问密钥。下载的 credentials.csv 里 Access Key Id 和 Secret Access Key 就对应上面两栏（Secret 只在创建时显示一次，务必保存）。不需要填 STS。',
  'account.howCodeartsWorks': '第 3 项是怎么工作的',
  'account.howCodeartsWorksDesc':
    '本机装过码道客户端（CodeArts Agent）并登录过的话，插件会直接读它存在本地的登录态，你什么都不用填。注意：插件自身没有登录入口，登录这个动作始终在码道客户端里完成 —— 所以"不填也能用"的前提是那台机器上码道已经登录过。',
  'account.needBoth': 'Access Key ID 和 Secret Access Key 都要填。',
  'account.saving': '保存中…',
  'account.saveOk': '已写入磁盘并立即生效（来源：{source}）',
  'account.saveFail': '保存失败',
  'account.ak': 'Access Key ID',
  'account.sk': 'Secret Access Key',
  'account.save': '保存',
  'account.saved': '已保存',
  'account.test': '测试连接',
  'account.testing': '测试中…',
  'account.ok': '连接正常',
  'account.fail': '连接失败',
  'account.masked': '已生效 · 留空保持不变，输入即覆盖旧值',
  'account.current': '当前连接',
  'account.refresh': '刷新',
  'account.user': '华为云账号',
  'account.credit': '积分额度',
  'account.used': '已用',
  'account.noState': '桥接服务未就绪，稍后刷新重试',
  'account.checkin': '每日签到',
  'checkin.done': '今日已签到，+{n} 积分已到账',
  'checkin.available': '可领取 {n} 积分',
  'checkin.idle': '暂无可领取的签到奖励',
  'checkin.claim': '领取',
  'checkin.doing': '领取中…',
  'checkin.unavailable': '签到状态暂时查询不到',
  'models.title': '可用模型',
  'models.hint': '以下模型取自码道网关，共 {n} 个。',
  'models.name': '名称',
  'models.context': '上下文',
  'models.output': '最大输出',
  'models.ratio': '计费倍率',
  'models.ratioHint': '相对基准价格的消耗倍率，越低越省',
  'models.think': '思考',
  'models.thinkHint': '该模型在码道侧可选的思考强度。注意：网关的 chat 接口不透传强度参数（实测各种字段名与 model 变体均被忽略），因此这里的档位目前只影响 DSH 侧展示，不会改变上游行为。',
  'models.visionHint': '码道网关是否为该模型开放图片输入。注意：桥接目前只转发文本，图片会在请求构造阶段被丢弃，因此现在不能真的发图。',
  'models.visionYes': '网关支持图片输入（桥接暂只转发文本）',
  'models.visionNo': '网关不支持图片输入',
  'diag.title': '诊断',
  'diag.run': '运行自检',
  'diag.running': '自检中…',
  'diag.credentials': '凭证',
  'diag.sts': 'STS 换取',
  'diag.handshake': '密钥协商',
  'diag.models': '模型清单',
  'diag.chat': '对话连通',
  'about.title': '关于',
  'about.protocol': '协议',
  'about.auth': '鉴权',
  'about.encrypt': '载荷加密',
  'chip.ready': '码道',
  'chip.idle': '码道·未配置',
  'chip.busy': '码道·请求中',
  'chip.account': '账号',
  'chip.online': '已连接',
  'chip.offline': '未连接',
  'chip.keyId': 'keyId',
  'chip.role': '角色',
  'chip.credit': '积分额度',
  'chip.refresh': '刷新',
  'chip.used': '已用',
  'chip.bonus': '赠送余额',
  'chip.basic': '基础余额',
  'chip.tokens': '累计 token',
  'chip.noCredit': '额度接口未返回，稍后点刷新重试',
  'chip.testRefresh': '测试并刷新额度',
  'chip.testing': '检测中…',
}

const en: Record<string, string> = {
  'meta.title': 'CodeArts Connector',
  'meta.desc': 'Bring Huawei Cloud CodeArts Agent models into DSH',
  'tab.account': 'Account',
  'tab.models': 'Models',
  'tab.diagnostics': 'Diagnostics',
  'tab.about': 'About',
  'account.title': 'Huawei Cloud credentials',
  'account.hint': 'Nothing to fill in is fine: if the CodeArts client is installed and signed in, the plugin borrows its login state automatically. Entering permanent AK/SK makes it fully hands-off afterwards.',
  'account.sourceTitle': 'Where the credential comes from',
  'account.sourceDesc': 'The plugin tries these in order and uses the first usable one — you do not need all three.',
  'account.sourceEnv': 'Environment variables MADAO_AK / MADAO_SK',
  'account.sourceFile': 'Permanent AK/SK entered above',
  'account.sourceCodearts': 'CodeArts client login state (zero config)',
  'account.sourceActive': 'in use',
  'account.sourceTemp': 'temporary, {n} min left',
  'account.sourceExpired': 'expired · open CodeArts once so it refreshes, then retry the connection test',
  'account.sourceTempSoon': 'expiring in {n} min · refresh CodeArts now, or use permanent AK/SK',
  'account.sourceTempSec': '{n}s left, about to expire',
  'account.sourceTempNote':
    'You are using a temporary credential borrowed from the CodeArts login state; it stops working after a few hours. To recover: open the CodeArts client once so it refreshes, then click "Test connection" above. To skip this entirely, enter permanent AK/SK above — one-time setup, and the plugin keeps exchanging and renewing STS by itself.',
  'account.sourcePermNote': 'Using a permanent credential. The plugin exchanges STS automatically and renews it before expiry — nothing left to do.',
  'account.howToGetAk': 'How to get AK/SK',
  'account.howToGetAkSteps':
    'Huawei Cloud console → account menu (top right) → My Credentials → Access Keys → Create Access Key. In the downloaded credentials.csv, "Access Key Id" and "Secret Access Key" are the two fields above (the secret is shown only once — save it). Do not fill in STS.',
  'account.howCodeartsWorks': 'How option 3 works',
  'account.howCodeartsWorksDesc':
    'If the CodeArts client is installed and signed in on this machine, the plugin reads its local login state directly — nothing to fill in. Note: the plugin has no login screen of its own; signing in always happens in the CodeArts client. So "works with no setup" assumes CodeArts is already signed in on that machine.',
  'account.needBoth': 'Both Access Key ID and Secret Access Key are required.',
  'account.saving': 'Saving…',
  'account.saveOk': 'Written to disk and applied immediately (source: {source})',
  'account.saveFail': 'Save failed',
  'account.ak': 'Access Key ID',
  'account.sk': 'Secret Access Key',
  'account.save': 'Save',
  'account.saved': 'Saved',
  'account.test': 'Test connection',
  'account.testing': 'Testing…',
  'account.ok': 'Connected',
  'account.fail': 'Connection failed',
  'account.masked': 'Active · leave blank to keep, type to replace',
  'account.current': 'Current connection',
  'account.refresh': 'Refresh',
  'account.user': 'Huawei Cloud account',
  'account.credit': 'Credits',
  'account.used': 'used',
  'account.noState': 'Bridge not ready, try Refresh again',
  'account.checkin': 'Daily check-in',
  'checkin.done': 'Checked in today, +{n} credits added',
  'checkin.available': '{n} credits available',
  'checkin.idle': 'Nothing to claim right now',
  'checkin.claim': 'Claim',
  'checkin.doing': 'Claiming…',
  'checkin.unavailable': 'Check-in status unavailable',
  'models.title': 'Available models',
  'models.hint': '{n} models from the CodeArts gateway.',
  'models.name': 'Name',
  'models.context': 'Context',
  'models.output': 'Max output',
  'models.ratio': 'Rate',
  'models.ratioHint': 'Credit multiplier vs. baseline price; lower is cheaper',
  'models.think': 'Thinking',
  'models.thinkHint': 'Thinking strengths offered by CodeArts. Note: the gateway chat endpoint does not forward a strength parameter (every field name and model-id variant probed was ignored), so these levels currently affect display only, not upstream behaviour.',
  'models.visionHint': 'Whether the CodeArts gateway opens image input for this model. Note: the bridge forwards text only, so images are dropped when building the request.',
  'models.visionYes': 'Gateway supports images (bridge forwards text only)',
  'models.visionNo': 'Gateway: text only',
  'diag.title': 'Diagnostics',
  'diag.run': 'Run check',
  'diag.running': 'Running…',
  'diag.credentials': 'Credentials',
  'diag.sts': 'STS exchange',
  'diag.handshake': 'Key exchange',
  'diag.models': 'Model list',
  'diag.chat': 'Chat',
  'about.title': 'About',
  'about.protocol': 'Protocol',
  'about.auth': 'Auth',
  'about.encrypt': 'Payload encryption',
  'chip.ready': 'CodeArts',
  'chip.idle': 'CodeArts · unset',
  'chip.busy': 'CodeArts · busy',
  'chip.account': 'Account',
  'chip.online': 'Connected',
  'chip.offline': 'Not connected',
  'chip.keyId': 'keyId',
  'chip.role': 'Role',
  'chip.credit': 'Credits',
  'chip.refresh': 'Refresh',
  'chip.used': 'Used',
  'chip.bonus': 'Bonus',
  'chip.basic': 'Basic',
  'chip.tokens': 'Total tokens',
  'chip.noCredit': 'Credit endpoint unavailable, try Refresh later',
  'chip.testRefresh': 'Test & refresh',
  'chip.testing': 'Testing…',
}

export function apply(ctx: any): void {
  const namespace = 'settings.madao'

  try {
    ctx.effect(
      () => ctx.locale.register(namespace, { zh, en }),
      'dsh-connect-madao: settings copy',
    )
  } catch (err) {
    console.warn('[dsh-connect-madao] locale register failed:', err)
  }

  const t = ctx.locale.bind(namespace)

  /** 注册一张卡片到指定 slot；失败不影响宿主。 */
  const registerCard = (slotName: string): (() => void) | undefined => {
    try {
      return ctx.slots.inject(slotName, () =>
        ctx.slots.register(
          {
            name: slotName,
            key: 'dsh-connect-madao',
            priority: 40,
            inject: () => ({ t }),
          },
          CodeArtsPanel,
        ),
      )
    } catch (err) {
      console.error(`[dsh-connect-madao] slot "${slotName}" register failed:`, err)
      return undefined
    }
  }

  // 设置页主面板。
  //
  // 只注册 plugins.bundle.config 一处 —— 同时注册 plugins.item 会让同一个
  // 面板在「内置插件配置」里出现两次（列表行 + 展开区），用户看到重复卡片。
  registerCard('plugins.bundle.config')

  // 输入框右侧状态胶囊
  try {
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.right',
          id: 'dsh-connect-madao-chip',
          order: 6,
          locale: namespace,
          inject: () => ({ t }),
        },
        ComposerChip,
      ),
    )
  } catch (err) {
    console.warn('[dsh-connect-madao] composer chip register failed:', err)
  }
}






