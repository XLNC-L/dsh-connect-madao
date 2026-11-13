/**
 * Windows DPAPI 加解密。
 *
 * 为什么用它：DPAPI（`CryptProtectData`）的密钥由 Windows 绑定到**当前用户账户**，
 * 密文离开这台机器、或换一个用户账户都解不开。这样即使 credentials 文件
 * 被备份/同步/误传到别处，也读不出 AK/SK。
 *
 * 为什么走 PowerShell：Node 没有内置 DPAPI。通过 stdin 传数据（而非命令行参数）
 * 避免注入和长度限制，只在保存/启动时调用一次，开销可以接受。
 *
 * 非 Windows 或调用失败时一律返回 null，调用方回退到明文存储 ——
 * 功能不能因为加密不可用而挂掉。
 */

import { execFileSync } from 'node:child_process'

const PS_PROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($enc))
`

const PS_UNPROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($dec))
`

function run(script: string, inputB64: string): string | null {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: inputB64,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    const trimmed = out.trim()
    return trimmed || null
  } catch {
    return null
  }
}

/** DPAPI 是否可用（Windows + PowerShell 可调）。 */
export function dpapiAvailable(): boolean {
  if (process.platform !== 'win32') return false
  const probe = run(
    `Add-Type -AssemblyName System.Security; [Console]::Out.Write('ok')`,
    '',
  )
  return probe === 'ok'
}

/** 加密任意字符串，返回 base64 密文；不可用时返回 null。 */
export function dpapiEncrypt(plaintext: string): string | null {
  if (process.platform !== 'win32') return null
  const b64 = Buffer.from(plaintext, 'utf8').toString('base64')
  const enc = run(PS_PROTECT, b64)
  if (!enc) return null
  try {
    // 确认能解回来，避免写入一份自己都打不开的密文
    const back = dpapiDecrypt(enc)
    if (back !== plaintext) return null
    return enc
  } catch {
    return null
  }
}

/** 解密 base64 密文；失败返回 null。 */
export function dpapiDecrypt(cipherB64: string): string | null {
  if (process.platform !== 'win32') return null
  const out = run(PS_UNPROTECT, cipherB64.trim())
  if (!out) return null
  try {
    return Buffer.from(out, 'base64').toString('utf8')
  } catch {
    return null
  }
}
