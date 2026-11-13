/**
 * 用 IAM 永久 AK/SK 换 STS 临时凭证。
 *
 * 端点：POST /v3.0/OS-CREDENTIAL/securitytokens
 *
 * 两条实测到的关键规范（踩过坑）：
 *
 *   1. 签名用的 canonical URI 必须**补尾斜杠**：
 *        签名: /v3.0/OS-CREDENTIAL/securitytokens/
 *        请求: /v3.0/OS-CREDENTIAL/securitytokens
 *      两者不一致是华为云 APIG 的既定行为，不这么做会 401
 *      "verify ak sk signature failed"。
 *
 *   2. 身份方式必须用 `methods: ["token"]`，不能是 `["hw_ak_sk"]`。
 *      后者会被 IAM 拒绝：`Unsupported method:["hw_ak_sk"]`。
 *      AK/SK 体现在**请求签名**上，不体现在 body 里。
 *
 * 返回的 access/secret 是临时凭证，securitytoken 是 STS token，
 * 三者一起用于后续签名。
 */

import { signHuawei } from './protocol/huawei-sign.ts'

const IAM_HOST = 'iam.cn-north-4.myhuaweicloud.com'
const IAM_REQUEST_PATH = '/v3.0/OS-CREDENTIAL/securitytokens'
const IAM_SIGN_PATH = `${IAM_REQUEST_PATH}/`

export interface TemporaryCredential {
  /** 临时 AK */
  ak: string
  /** 临时 SK */
  sk: string
  /** STS token，签名时放 X-Security-Token */
  securityToken: string
  /** ISO 时间 */
  expiresAt: string
}

interface IamStsResponse {
  credential?: {
    access?: string
    secret?: string
    securitytoken?: string
    expires_at?: string
  }
  error?: unknown
  error_msg?: string
}

/**
 * 交换 STS 临时凭证。
 *
 * @param ak 永久 Access Key Id
 * @param sk 永久 Secret Access Key
 * @param durationSeconds 有效期，默认 3600，最大 86400
 */
export async function getStsFromIam(
  ak: string,
  sk: string,
  durationSeconds = 3600,
): Promise<TemporaryCredential> {
  const body = JSON.stringify({
    auth: {
      identity: {
        methods: ['token'],
        token: { duration_seconds: durationSeconds },
      },
    },
  })

  const headers = signHuawei({
    method: 'POST',
    host: IAM_HOST,
    path: IAM_SIGN_PATH,
    contentType: 'application/json;charset=utf8',
    body,
    ak,
    sk,
  })

  const res = await fetch(`https://${IAM_HOST}${IAM_REQUEST_PATH}`, {
    method: 'POST',
    headers,
    body,
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(
      `IAM 换 STS 失败: HTTP ${res.status}\n${text.slice(0, 800)}`,
    )
  }

  let json: IamStsResponse
  try {
    json = JSON.parse(text) as IamStsResponse
  } catch {
    throw new Error(`IAM 返回非 JSON: ${text.slice(0, 300)}`)
  }

  const cred = json.credential
  if (!cred?.access || !cred?.secret || !cred?.securitytoken) {
    throw new Error(`IAM 响应缺少 credential 字段:\n${text.slice(0, 800)}`)
  }

  return {
    ak: cred.access,
    sk: cred.secret,
    securityToken: cred.securitytoken,
    expiresAt: cred.expires_at ?? '',
  }
}
