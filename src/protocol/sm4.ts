/**
 * 纯 TypeScript 实现的 SM4-GCM。
 *
 * 为什么需要：DSH 自带 Node v24.21.0 的 OpenSSL 只提供
 * sm4 / sm4-cbc / sm4-cfb / sm4-ctr / sm4-ecb / sm4-ofb，
 * **没有 sm4-gcm**，调用 createCipheriv('sm4-gcm', ...) 会抛 "Unknown cipher"。
 * 系统 Node v26 有，但桥接服务运行在 DSH 宿主进程里，只能用它自带的运行时。
 *
 * 实现：
 *   - SM4 分组密码（GB/T 32907-2016），128-bit key / block，32 轮
 *   - GCM 模式（NIST SP 800-38D），12-byte IV，16-byte tag
 *   - 与 Node v26 的 'sm4-gcm' 字节级一致（已交叉验证）
 */

// ── SM4 基础件 ────────────────────────────────────────────────

const SBOX = new Uint8Array([
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
])

const CK = new Uint32Array([
  0x00070e15, 0x1c232a31, 0x383f464d, 0x545b6269,
  0x70777e85, 0x8c939aa1, 0xa8afb6bd, 0xc4cbd2d9,
  0xe0e7eef5, 0xfc030a11, 0x181f262d, 0x343b4249,
  0x50575e65, 0x6c737a81, 0x888f969d, 0xa4abb2b9,
  0xc0c7ced5, 0xdce3eaf1, 0xf8ff060d, 0x141b2229,
  0x30373e45, 0x4c535a61, 0x686f767d, 0x848b9299,
  0xa0a7aeb5, 0xbcc3cad1, 0xd8dfe6ed, 0xf4fb0209,
  0x10171e25, 0x2c333a41, 0x484f565d, 0x646b7279,
])

const FK = new Uint32Array([0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc])

function rotl(x: number, n: number): number {
  n &= 31
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

function tau(a: number): number {
  return (
    (SBOX[(a >>> 24) & 0xff] << 24) |
    (SBOX[(a >>> 16) & 0xff] << 16) |
    (SBOX[(a >>> 8) & 0xff] << 8) |
    SBOX[a & 0xff]
  ) >>> 0
}

function t1(x: number): number {
  const a = tau(x)
  return (a ^ rotl(a, 2) ^ rotl(a, 10) ^ rotl(a, 18) ^ rotl(a, 24)) >>> 0
}

function t2(x: number): number {
  const a = tau(x)
  return (a ^ rotl(a, 13) ^ rotl(a, 23)) >>> 0
}

function u32be(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0
}

function w32be(b: Uint8Array, off: number, v: number): void {
  b[off] = (v >>> 24) & 0xff
  b[off + 1] = (v >>> 16) & 0xff
  b[off + 2] = (v >>> 8) & 0xff
  b[off + 3] = v & 0xff
}

/** 展开轮密钥（32 个 32-bit 字）。 */
function expandKey(key: Uint8Array): Uint32Array {
  const k = new Uint32Array(36)
  k[0] = (u32be(key, 0) ^ FK[0]) >>> 0
  k[1] = (u32be(key, 4) ^ FK[1]) >>> 0
  k[2] = (u32be(key, 8) ^ FK[2]) >>> 0
  k[3] = (u32be(key, 12) ^ FK[3]) >>> 0
  const rk = new Uint32Array(32)
  for (let i = 0; i < 32; i++) {
    k[i + 4] = (k[i] ^ t2((k[i + 1] ^ k[i + 2] ^ k[i + 3] ^ CK[i]) >>> 0)) >>> 0
    rk[i] = k[i + 4]
  }
  return rk
}

/** 加密单个 16 字节分组。 */
function sm4Block(rk: Uint32Array, input: Uint8Array, off: number, out: Uint8Array, outOff: number): void {
  const x = new Uint32Array(36)
  x[0] = u32be(input, off)
  x[1] = u32be(input, off + 4)
  x[2] = u32be(input, off + 8)
  x[3] = u32be(input, off + 12)
  for (let i = 0; i < 32; i++) {
    x[i + 4] = (x[i] ^ t1((x[i + 1] ^ x[i + 2] ^ x[i + 3] ^ rk[i]) >>> 0)) >>> 0
  }
  w32be(out, outOff, x[35])
  w32be(out, outOff + 4, x[34])
  w32be(out, outOff + 8, x[33])
  w32be(out, outOff + 12, x[32])
}

// ── GCM 模式 ──────────────────────────────────────────────────

/** GF(2^128) 乘法（GCM 的 GHASH 用），按位实现，无进位。 */
function gfMul(x: Uint8Array, y: Uint8Array): Uint8Array {
  const z = new Uint8Array(16)
  const v = new Uint8Array(y)
  for (let i = 0; i < 128; i++) {
    const bit = (x[i >> 3] >>> (7 - (i & 7))) & 1
    if (bit) {
      for (let j = 0; j < 16; j++) z[j] ^= v[j]
    }
    // v = v >> 1（GF(2^128) 右移，最高位补 0xe1 若原最低位为 1）
    const lsb = v[15] & 1
    for (let j = 15; j > 0; j--) {
      v[j] = ((v[j] >>> 1) | ((v[j - 1] & 1) << 7)) & 0xff
    }
    v[0] = (v[0] >>> 1) & 0xff
    if (lsb) v[0] ^= 0xe1
  }
  return z
}

/** 对任意长度数据做 GHASH（自动零填充到 16 字节块）。 */
function ghashBlocks(h: Uint8Array, data: Uint8Array): Uint8Array {
  let y = new Uint8Array(16)
  const nBlocks = Math.ceil(data.length / 16)
  for (let i = 0; i < nBlocks; i++) {
    const block = new Uint8Array(16)
    const start = i * 16
    block.set(data.subarray(start, Math.min(start + 16, data.length)))
    for (let j = 0; j < 16; j++) y[j] ^= block[j]
    y = gfMul(y, h)
  }
  return y
}

function inc32(counter: Uint8Array): void {
  for (let i = 15; i >= 12; i--) {
    counter[i] = (counter[i] + 1) & 0xff
    if (counter[i] !== 0) break
  }
}

/** GCTR：用计数器块流做 XOR 加解密。 */
function gctr(rk: Uint32Array, icb: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length === 0) return new Uint8Array(0)
  const out = new Uint8Array(data.length)
  const cb = new Uint8Array(icb)
  const ks = new Uint8Array(16)
  let off = 0
  while (off < data.length) {
    sm4Block(rk, cb, 0, ks, 0)
    const len = Math.min(16, data.length - off)
    for (let i = 0; i < len; i++) out[off + i] = data[off + i] ^ ks[i]
    off += len
    inc32(cb)
  }
  return out
}

/** 组装 GHASH 的输入：AAD || CT || [len(AAD)]64 || [len(CT)]64（bit 计）。 */
function ghashInput(aad: Uint8Array, ct: Uint8Array): Uint8Array {
  const aadPad = Math.ceil(aad.length / 16) * 16
  const ctPad = Math.ceil(ct.length / 16) * 16
  const total = aadPad + ctPad + 16
  const buf = new Uint8Array(total)
  buf.set(aad, 0)
  buf.set(ct, aadPad)
  const aadBits = BigInt(aad.length) * 8n
  const ctBits = BigInt(ct.length) * 8n
  const tail = aadPad + ctPad
  for (let i = 0; i < 8; i++) {
    buf[tail + 7 - i] = Number((aadBits >> BigInt(8 * i)) & 0xffn)
    buf[tail + 15 - i] = Number((ctBits >> BigInt(8 * i)) & 0xffn)
  }
  return buf
}

/** 由 key / iv 建立 GCM 的公共中间量。 */
function gcmSetup(key: Uint8Array, iv: Uint8Array) {
  const rk = expandKey(key)
  const h = new Uint8Array(16)
  sm4Block(rk, new Uint8Array(16), 0, h, 0) // H = E_K(0^128)

  // 12 字节 IV 是码道用的形式：J0 = IV || 0^31 || 1
  const j0 = new Uint8Array(16)
  j0.set(iv.subarray(0, Math.min(12, iv.length)))
  j0[15] = 1

  return { rk, h, j0 }
}

/** 由 AAD 与密文算出 tag。 */
function computeTag(
  rk: Uint32Array,
  h: Uint8Array,
  j0: Uint8Array,
  aad: Uint8Array,
  ct: Uint8Array,
): Uint8Array {
  const s = ghashBlocks(h, ghashInput(aad, ct))
  const ekj0 = gctr(rk, j0, new Uint8Array(16))
  const tag = new Uint8Array(16)
  for (let i = 0; i < 16; i++) tag[i] = s[i] ^ ekj0[i]
  return tag
}

// ── 公开 API ──────────────────────────────────────────────────

export interface Sm4GcmResult {
  ciphertext: Buffer
  tag: Buffer
}

/** 加密：返回密文与 16 字节 tag（iv 由调用方持有并放入请求头）。 */
export function sm4GcmEncrypt(key: Buffer, iv: Buffer, plaintext: Buffer, aad: Buffer): Sm4GcmResult {
  const { rk, h, j0 } = gcmSetup(new Uint8Array(key), new Uint8Array(iv))

  // 计数器从 inc32(J0) 开始
  const icb = new Uint8Array(j0)
  inc32(icb)
  const ct = gctr(rk, icb, new Uint8Array(plaintext))
  const tag = computeTag(rk, h, j0, new Uint8Array(aad), ct)

  return { ciphertext: Buffer.from(ct), tag: Buffer.from(tag) }
}

/** 解密：先验 tag，再解出明文；tag 不匹配抛错。 */
export function sm4GcmDecrypt(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
  aad: Buffer,
): Buffer {
  const { rk, h, j0 } = gcmSetup(new Uint8Array(key), new Uint8Array(iv))
  const ct = new Uint8Array(ciphertext)

  const expected = computeTag(rk, h, j0, new Uint8Array(aad), ct)
  if (tag.length !== 16) throw new Error('SM4-GCM: tag must be 16 bytes')
  let diff = 0
  for (let i = 0; i < 16; i++) diff |= expected[i] ^ tag[i]
  if (diff !== 0) throw new Error('SM4-GCM: authentication tag mismatch')

  const icb = new Uint8Array(j0)
  inc32(icb)
  return Buffer.from(gctr(rk, icb, ct))
}

/** 常量时间比较，供上层需要时使用。 */
export function timingSafeEqual16(a: Buffer, b: Buffer): boolean {
  if (a.length !== 16 || b.length !== 16) return false
  let d = 0
  for (let i = 0; i < 16; i++) d |= a[i] ^ b[i]
  return d === 0
}
