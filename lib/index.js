var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/models.ts
var models_exports = {};
__export(models_exports, {
  FALLBACK_MODELS: () => FALLBACK_MODELS,
  discoverModels: () => discoverModels
});
function clampMaxOutput(fromGateway, fallback) {
  const base = fromGateway && fromGateway > 0 ? fromGateway : fallback ?? MAX_OUTPUT_CAP;
  return Math.min(base, MAX_OUTPUT_CAP);
}
async function discoverModels(client) {
  try {
    const raw = await client.getJson("/v1/model/builtin");
    const list = raw?.builtinModels ?? [];
    if (list.length === 0) return { models: FALLBACK_MODELS, source: "fallback", error: "\u7F51\u5173\u8FD4\u56DE\u7A7A\u6E05\u5355" };
    let variants = {};
    try {
      const tv = await client.postJson("/v1/model/thinking-variants", {
        model_names: list.map((m) => m.model_id)
      });
      variants = tv?.variants ?? {};
    } catch {
    }
    const models = list.filter((m) => m.model_id && m.enable !== false).map((m) => {
      const v = variants[m.model_id];
      const fb = FALLBACK_MODELS.find((f) => f.id === m.model_id);
      return {
        id: m.model_id,
        name: m.model_name || m.model_id,
        context: m.context_window ?? fb?.context ?? 0,
        // 单次输出上限不能照抄网关的 max_tokens。DSH 的压缩逻辑会把它
        // 当作 reservedCompletionTokens 从窗口里扣掉，同时还会再扣一份
        // headroomTokens（默认 65536）。照抄 65536 的话，202752 的窗口
        // 只剩 ~71k 可用，稍微长一点的会话就切不过去。
        // 这里封顶 MAX_OUTPUT_CAP，把剩下的还给对话上下文。
        maxOutput: clampMaxOutput(m.max_tokens, fb?.maxOutput),
        ratio: m.credit?.[0]?.ratio_display,
        supportsImages: m.supports_images === true,
        strengths: v?.strengths ?? [],
        defaultStrength: v?.default_strength || void 0,
        description: m.model_desc
      };
    });
    return { models, source: "gateway" };
  } catch (e) {
    return { models: FALLBACK_MODELS, source: "fallback", error: String(e?.message ?? e) };
  }
}
var MAX_OUTPUT_CAP, FALLBACK_MODELS;
var init_models = __esm({
  "src/models.ts"() {
    MAX_OUTPUT_CAP = 32768;
    FALLBACK_MODELS = [
      { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash", context: 1048576, maxOutput: 32768, ratio: "0.18x", supportsImages: true, strengths: [] },
      { id: "deepseek-v4.1-flash-1017", name: "DeepSeek-V4.1-Flash-1017", context: 1048576, maxOutput: 32768, ratio: "0.18x", supportsImages: true, strengths: [] },
      { id: "glm-5.3", name: "GLM-5.3", context: 1048576, maxOutput: 32768, ratio: "0.79x", supportsImages: false, strengths: [] },
      { id: "glm-5.3-flash", name: "GLM-5.3-Flash", context: 1048576, maxOutput: 32768, ratio: "0.08x", supportsImages: true, strengths: [] },
      { id: "GLM-5.2", name: "GLM-5.2", context: 202752, maxOutput: 32768, ratio: "0.7x", supportsImages: false, strengths: ["high", "max"], defaultStrength: "high" },
      { id: "glm-5.2-sft-harmony", name: "GLM-5.2-ArkTS-SPARK", context: 202752, maxOutput: 32768, ratio: "0.7x", supportsImages: false, strengths: ["high", "max"], defaultStrength: "high" },
      { id: "kimi-k3", name: "Kimi-K3", context: 1048576, maxOutput: 32768, ratio: "2.38x", supportsImages: true, strengths: [] },
      { id: "kimi-k3.1-pro", name: "Kimi-K3.1-Pro", context: 1048576, maxOutput: 32768, ratio: "1.63x", supportsImages: true, strengths: [] },
      { id: "openpangu-2.0-pro", name: "OpenPangu-2.0-Pro", context: 524288, maxOutput: 32768, ratio: "0.7x", supportsImages: false, strengths: [] },
      { id: "openpangu-2.0-flash", name: "OpenPangu-2.0-Flash", context: 524288, maxOutput: 32768, ratio: "0.32x", supportsImages: false, strengths: [] },
      { id: "speed", name: "\u667A\u901F\u6A21\u5F0F", context: 1048576, maxOutput: 32768, ratio: "0.18x", supportsImages: false, strengths: [] }
    ];
  }
});

// src/server.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { createServer } from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";

// src/client.ts
import { createHash as createHash3, randomUUID } from "node:crypto";

// src/protocol/sign.ts
import { createHash, createHmac } from "node:crypto";
var SIGN_ALGO = "SDK-HMAC-SHA256";
function formatSdkDate(d = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function canonicalUri(pathname) {
  const encoded = pathname.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return encoded.endsWith("/") ? encoded : `${encoded}/`;
}
function canonicalHeaders(headers) {
  const lower = /* @__PURE__ */ new Map();
  for (const [k, v] of Object.entries(headers)) lower.set(k.toLowerCase(), v);
  const names = [...lower.keys()].sort((a, b) => a.localeCompare(b));
  const block = names.map((n) => `${n}:${(lower.get(n) ?? "").replace(/[\r\n]/g, " ").trim()}
`).join("");
  return { block, signed: names.join(";") };
}
function signRequest(input) {
  const { method, url, contentType, credentials } = input;
  const sdkDate = input.sdkDate ?? formatSdkDate();
  const payloadHash = input.bodyBytes ? createHash("sha256").update(input.bodyBytes).digest("hex") : createHash("sha256").update(input.body ?? "").digest("hex");
  const host = url.port && !isDefaultPort(url.protocol, url.port) ? `${url.hostname}:${url.port}` : url.hostname;
  const toSign = {
    Host: host,
    "X-Sdk-Date": sdkDate,
    "X-Security-Token": credentials.securityToken
  };
  if (contentType) toSign["Content-Type"] = contentType;
  const { block, signed } = canonicalHeaders(toSign);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(url.pathname),
    url.search ? url.search.slice(1) : "",
    block,
    signed,
    payloadHash
  ].join("\n");
  const stringToSign = [
    SIGN_ALGO,
    sdkDate,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = createHmac("sha256", credentials.sk).update(stringToSign).digest("hex");
  const out = {
    Host: host,
    "X-Sdk-Date": sdkDate,
    "X-Security-Token": credentials.securityToken,
    Authorization: `${SIGN_ALGO} Access=${credentials.ak}, SignedHeaders=${signed}, Signature=${signature}`
  };
  if (contentType) out["Content-Type"] = contentType;
  return out;
}
function isDefaultPort(protocol, port) {
  return protocol === "https:" && port === "443" || protocol === "http:" && port === "80";
}

// src/protocol/crypto.ts
import { createECDH, createHash as createHash2, randomBytes } from "node:crypto";

// src/protocol/sm4.ts
var SBOX = new Uint8Array([
  214,
  144,
  233,
  254,
  204,
  225,
  61,
  183,
  22,
  182,
  20,
  194,
  40,
  251,
  44,
  5,
  43,
  103,
  154,
  118,
  42,
  190,
  4,
  195,
  170,
  68,
  19,
  38,
  73,
  134,
  6,
  153,
  156,
  66,
  80,
  244,
  145,
  239,
  152,
  122,
  51,
  84,
  11,
  67,
  237,
  207,
  172,
  98,
  228,
  179,
  28,
  169,
  201,
  8,
  232,
  149,
  128,
  223,
  148,
  250,
  117,
  143,
  63,
  166,
  71,
  7,
  167,
  252,
  243,
  115,
  23,
  186,
  131,
  89,
  60,
  25,
  230,
  133,
  79,
  168,
  104,
  107,
  129,
  178,
  113,
  100,
  218,
  139,
  248,
  235,
  15,
  75,
  112,
  86,
  157,
  53,
  30,
  36,
  14,
  94,
  99,
  88,
  209,
  162,
  37,
  34,
  124,
  59,
  1,
  33,
  120,
  135,
  212,
  0,
  70,
  87,
  159,
  211,
  39,
  82,
  76,
  54,
  2,
  231,
  160,
  196,
  200,
  158,
  234,
  191,
  138,
  210,
  64,
  199,
  56,
  181,
  163,
  247,
  242,
  206,
  249,
  97,
  21,
  161,
  224,
  174,
  93,
  164,
  155,
  52,
  26,
  85,
  173,
  147,
  50,
  48,
  245,
  140,
  177,
  227,
  29,
  246,
  226,
  46,
  130,
  102,
  202,
  96,
  192,
  41,
  35,
  171,
  13,
  83,
  78,
  111,
  213,
  219,
  55,
  69,
  222,
  253,
  142,
  47,
  3,
  255,
  106,
  114,
  109,
  108,
  91,
  81,
  141,
  27,
  175,
  146,
  187,
  221,
  188,
  127,
  17,
  217,
  92,
  65,
  31,
  16,
  90,
  216,
  10,
  193,
  49,
  136,
  165,
  205,
  123,
  189,
  45,
  116,
  208,
  18,
  184,
  229,
  180,
  176,
  137,
  105,
  151,
  74,
  12,
  150,
  119,
  126,
  101,
  185,
  241,
  9,
  197,
  110,
  198,
  132,
  24,
  240,
  125,
  236,
  58,
  220,
  77,
  32,
  121,
  238,
  95,
  62,
  215,
  203,
  57,
  72
]);
var CK = new Uint32Array([
  462357,
  472066609,
  943670861,
  1415275113,
  1886879365,
  2358483617,
  2830087869,
  3301692121,
  3773296373,
  4228057617,
  404694573,
  876298825,
  1347903077,
  1819507329,
  2291111581,
  2762715833,
  3234320085,
  3705924337,
  4177462797,
  337322537,
  808926789,
  1280531041,
  1752135293,
  2223739545,
  2695343797,
  3166948049,
  3638552301,
  4110090761,
  269950501,
  741554753,
  1213159005,
  1684763257
]);
var FK = new Uint32Array([2746333894, 1453994832, 1736282519, 2993693404]);
function rotl(x, n) {
  n &= 31;
  return (x << n | x >>> 32 - n) >>> 0;
}
function tau(a) {
  return (SBOX[a >>> 24 & 255] << 24 | SBOX[a >>> 16 & 255] << 16 | SBOX[a >>> 8 & 255] << 8 | SBOX[a & 255]) >>> 0;
}
function t1(x) {
  const a = tau(x);
  return (a ^ rotl(a, 2) ^ rotl(a, 10) ^ rotl(a, 18) ^ rotl(a, 24)) >>> 0;
}
function t2(x) {
  const a = tau(x);
  return (a ^ rotl(a, 13) ^ rotl(a, 23)) >>> 0;
}
function u32be(b, off) {
  return (b[off] << 24 | b[off + 1] << 16 | b[off + 2] << 8 | b[off + 3]) >>> 0;
}
function w32be(b, off, v) {
  b[off] = v >>> 24 & 255;
  b[off + 1] = v >>> 16 & 255;
  b[off + 2] = v >>> 8 & 255;
  b[off + 3] = v & 255;
}
function expandKey(key) {
  const k = new Uint32Array(36);
  k[0] = (u32be(key, 0) ^ FK[0]) >>> 0;
  k[1] = (u32be(key, 4) ^ FK[1]) >>> 0;
  k[2] = (u32be(key, 8) ^ FK[2]) >>> 0;
  k[3] = (u32be(key, 12) ^ FK[3]) >>> 0;
  const rk = new Uint32Array(32);
  for (let i = 0; i < 32; i++) {
    k[i + 4] = (k[i] ^ t2((k[i + 1] ^ k[i + 2] ^ k[i + 3] ^ CK[i]) >>> 0)) >>> 0;
    rk[i] = k[i + 4];
  }
  return rk;
}
function sm4Block(rk, input, off, out, outOff) {
  const x = new Uint32Array(36);
  x[0] = u32be(input, off);
  x[1] = u32be(input, off + 4);
  x[2] = u32be(input, off + 8);
  x[3] = u32be(input, off + 12);
  for (let i = 0; i < 32; i++) {
    x[i + 4] = (x[i] ^ t1((x[i + 1] ^ x[i + 2] ^ x[i + 3] ^ rk[i]) >>> 0)) >>> 0;
  }
  w32be(out, outOff, x[35]);
  w32be(out, outOff + 4, x[34]);
  w32be(out, outOff + 8, x[33]);
  w32be(out, outOff + 12, x[32]);
}
function gfMul(x, y) {
  const z = new Uint8Array(16);
  const v = new Uint8Array(y);
  for (let i = 0; i < 128; i++) {
    const bit = x[i >> 3] >>> 7 - (i & 7) & 1;
    if (bit) {
      for (let j = 0; j < 16; j++) z[j] ^= v[j];
    }
    const lsb = v[15] & 1;
    for (let j = 15; j > 0; j--) {
      v[j] = (v[j] >>> 1 | (v[j - 1] & 1) << 7) & 255;
    }
    v[0] = v[0] >>> 1 & 255;
    if (lsb) v[0] ^= 225;
  }
  return z;
}
function ghashBlocks(h, data) {
  let y = new Uint8Array(16);
  const nBlocks = Math.ceil(data.length / 16);
  for (let i = 0; i < nBlocks; i++) {
    const block = new Uint8Array(16);
    const start = i * 16;
    block.set(data.subarray(start, Math.min(start + 16, data.length)));
    for (let j = 0; j < 16; j++) y[j] ^= block[j];
    y = gfMul(y, h);
  }
  return y;
}
function inc32(counter) {
  for (let i = 15; i >= 12; i--) {
    counter[i] = counter[i] + 1 & 255;
    if (counter[i] !== 0) break;
  }
}
function gctr(rk, icb, data) {
  if (data.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(data.length);
  const cb = new Uint8Array(icb);
  const ks = new Uint8Array(16);
  let off = 0;
  while (off < data.length) {
    sm4Block(rk, cb, 0, ks, 0);
    const len = Math.min(16, data.length - off);
    for (let i = 0; i < len; i++) out[off + i] = data[off + i] ^ ks[i];
    off += len;
    inc32(cb);
  }
  return out;
}
function ghashInput(aad, ct) {
  const aadPad = Math.ceil(aad.length / 16) * 16;
  const ctPad = Math.ceil(ct.length / 16) * 16;
  const total = aadPad + ctPad + 16;
  const buf = new Uint8Array(total);
  buf.set(aad, 0);
  buf.set(ct, aadPad);
  const aadBits = BigInt(aad.length) * 8n;
  const ctBits = BigInt(ct.length) * 8n;
  const tail = aadPad + ctPad;
  for (let i = 0; i < 8; i++) {
    buf[tail + 7 - i] = Number(aadBits >> BigInt(8 * i) & 0xffn);
    buf[tail + 15 - i] = Number(ctBits >> BigInt(8 * i) & 0xffn);
  }
  return buf;
}
function gcmSetup(key, iv) {
  const rk = expandKey(key);
  const h = new Uint8Array(16);
  sm4Block(rk, new Uint8Array(16), 0, h, 0);
  const j0 = new Uint8Array(16);
  j0.set(iv.subarray(0, Math.min(12, iv.length)));
  j0[15] = 1;
  return { rk, h, j0 };
}
function computeTag(rk, h, j0, aad, ct) {
  const s = ghashBlocks(h, ghashInput(aad, ct));
  const ekj0 = gctr(rk, j0, new Uint8Array(16));
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) tag[i] = s[i] ^ ekj0[i];
  return tag;
}
function sm4GcmEncrypt(key, iv, plaintext, aad) {
  const { rk, h, j0 } = gcmSetup(new Uint8Array(key), new Uint8Array(iv));
  const icb = new Uint8Array(j0);
  inc32(icb);
  const ct = gctr(rk, icb, new Uint8Array(plaintext));
  const tag = computeTag(rk, h, j0, new Uint8Array(aad), ct);
  return { ciphertext: Buffer.from(ct), tag: Buffer.from(tag) };
}
function sm4GcmDecrypt(key, iv, ciphertext, tag, aad) {
  const { rk, h, j0 } = gcmSetup(new Uint8Array(key), new Uint8Array(iv));
  const ct = new Uint8Array(ciphertext);
  const expected = computeTag(rk, h, j0, new Uint8Array(aad), ct);
  if (tag.length !== 16) throw new Error("SM4-GCM: tag must be 16 bytes");
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= expected[i] ^ tag[i];
  if (diff !== 0) throw new Error("SM4-GCM: authentication tag mismatch");
  const icb = new Uint8Array(j0);
  inc32(icb);
  return Buffer.from(gctr(rk, icb, ct));
}

// src/protocol/crypto.ts
var CURVE = "prime256v1";
var SM4_ALGO = "sm4-gcm";
var KEY_BYTES = 16;
var IV_BYTES = 12;
function randomIv() {
  return randomBytes(IV_BYTES);
}
function deriveSessionKey(sharedSecret) {
  return createHash2("sha256").update(sharedSecret).digest().subarray(0, KEY_BYTES);
}
function createEcdhPair() {
  const ecdh = createECDH(CURVE);
  const publicKey = ecdh.generateKeys();
  return { ecdh, publicKeyB64: publicKey.toString("base64") };
}
function completeKeyExchange(pair, serverPublicKeyB64, keyId, expiresInSec) {
  const serverPub = Buffer.from(serverPublicKeyB64, "base64");
  const shared = pair.ecdh.computeSecret(serverPub);
  return {
    keyId,
    key: deriveSessionKey(shared),
    expiresAt: Date.now() + (expiresInSec > 0 ? expiresInSec * 1e3 : 72e5)
  };
}
function encryptRequest(key, plaintext, method, pathname, timestamp = Date.now()) {
  const iv = randomIv();
  const aad = Buffer.from(`${method}|${pathname}|${timestamp}`, "utf8");
  const { ciphertext: ct, tag } = sm4GcmEncrypt(key.key, iv, plaintext, aad);
  return {
    body: Buffer.from(ct.toString("base64"), "utf8"),
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Encrypt-Algo": SM4_ALGO,
      "X-Encrypt-Key-Id": key.keyId,
      "X-Encrypt-Iv": iv.toString("base64"),
      "X-Encrypt-Tag": tag.toString("base64"),
      "X-Encrypt-Ts": String(timestamp)
    }
  };
}
function decryptStreamChunk(key, block, _method, _pathname, _timestamp, chunkIndex) {
  const parts = block.split(":");
  if (parts.length !== 3) {
    throw new Error(`Invalid encrypted SSE chunk: expected 3 fields, got ${parts.length}`);
  }
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const aad = Buffer.from(`${key.keyId}|${chunkIndex}`, "utf8");
  const plain = sm4GcmDecrypt(key.key, iv, ct, tag, aad);
  return plain.toString("utf8");
}

// src/client.ts
var DEFAULT_GATEWAY = "https://snap-access.cn-north-4.myhuaweicloud.com";
var CHAT_PATH = "/api/v2/chat/completions";
var KEY_EXCHANGE_PATH = "/api/v1/security/key-exchange";
var MODELS_PATH = "/v1/model/builtin";
var REFRESH_MARGIN_MS = 3e5;
var DEFAULT_IDENTITY = {
  pluginName: "codemate_vscode",
  pluginVersion: "26.11.100",
  ideName: "VSCode",
  ideVersion: "26.11.100"
};
var MadaoClient = class {
  gateway;
  creds;
  fetchImpl;
  identity;
  language;
  defaultSessionId;
  sessionKey = null;
  negotiating = null;
  constructor(opts) {
    this.gateway = (opts.gateway ?? DEFAULT_GATEWAY).replace(/\/+$/, "");
    this.creds = opts.credentials;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.identity = { ...DEFAULT_IDENTITY, ...opts.identity };
    this.language = opts.language ?? "zh-cn";
    this.defaultSessionId = opts.sessionId ?? `madao-${createHash3("sha256").update(opts.credentials.accessKeyId ?? "default").digest("hex").slice(0, 16)}`;
  }
  // ── 密钥协商 ────────────────────────────────────────────────
  /** 取可用会话密钥；过期或临期则重新协商。并发调用只会触发一次协商。 */
  async ensureSessionKey() {
    if (this.sessionKey && Date.now() < this.sessionKey.expiresAt - REFRESH_MARGIN_MS) {
      return this.sessionKey;
    }
    if (this.negotiating) return this.negotiating;
    this.negotiating = this.negotiate().finally(() => {
      this.negotiating = null;
    });
    return this.negotiating;
  }
  async negotiate() {
    const url = new URL(this.gateway + KEY_EXCHANGE_PATH);
    const pair = createEcdhPair();
    const body = JSON.stringify({
      clientPublicKey: pair.publicKeyB64,
      sessionId: randomHex(16),
      timestamp: Date.now()
    });
    const headers = signRequest({
      method: "POST",
      url,
      contentType: "application/json",
      body,
      credentials: this.creds
    });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...headers, "User-Agent": `codearts/${this.identity.ideVersion}` },
      body
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`key-exchange failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    const json2 = await res.json();
    if (!json2.keyId || !json2.serverPublicKey) {
      throw new Error("key-exchange response missing keyId/serverPublicKey");
    }
    this.sessionKey = completeKeyExchange(pair, json2.serverPublicKey, json2.keyId, json2.expiresIn ?? 7200);
    return this.sessionKey;
  }
  /** 丢弃缓存密钥（凭证轮换后调用）。 */
  resetSessionKey() {
    this.sessionKey = null;
  }
  // ── chat ────────────────────────────────────────────────────
  /**
   * 发起一次加密 chat 请求，返回已解密的 SSE 文本事件流。
   *
   * @param payload 上游期望的请求体（JSON 可序列化）
   */
  async chatStream(payload, extraHeaders = {}) {
    const key = await this.ensureSessionKey();
    const url = new URL(this.gateway + CHAT_PATH);
    const ts = Date.now();
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const { body, headers: encHeaders } = encryptRequest(key, plaintext, "POST", CHAT_PATH, ts);
    const signed = signRequest({
      method: "POST",
      url,
      contentType: encHeaders["Content-Type"],
      bodyBytes: body,
      credentials: this.creds
    });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        ...signed,
        ...encHeaders,
        Accept: "text/event-stream",
        "X-Encrypt-Capable": "sm4-gcm",
        "User-Agent": `ai-sdk/provider-utils/4.0.21 runtime/bun/1.3.14`,
        ...this.identityHeaders(),
        // 会话与消息标识：网关据此判断"还是同一个会话"。
        // 缺了这两个头，每次请求都会被算作新会话，3 个并发名额很快耗尽
        // 并持续报 TM.00001041。调用方可通过 extraHeaders 覆盖。
        "user-session-id": this.defaultSessionId,
        "user-msg-id": randomUUID(),
        ...extraHeaders
      },
      body
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`chat failed: HTTP ${res.status} ${await this.describeError(text, key)}`);
    }
    const respAlgo = res.headers.get("x-encrypt-algo");
    if (respAlgo !== "sm4-gcm") {
      return res.body;
    }
    return decryptSseStream(res.body, key, "POST", CHAT_PATH, ts);
  }
  // ── 只读接口（明文，无需加密） ──────────────────────────────
  /**
   * 会话心跳。标记当前会话 busy / idle。
   *
   * 网关按 `user-session-id` 计并发会话数（上限 3 个，超了报 TM.00001041）。
   * 对话结束标 idle 能让名额及时释放，不至于挂满两小时。
   *
   * 失败不抛错 —— 这只是优化项，不影响对话本身。
   */
  async heartbeat(status) {
    try {
      const path = `/snap-manager/v1/chat-session/heartbeat?status=${status}`;
      const url = new URL(this.gateway + path);
      const headers = signRequest({
        method: "PUT",
        url,
        contentType: null,
        body: "",
        credentials: this.creds
      });
      const res = await this.fetchImpl(url, {
        method: "PUT",
        headers: {
          ...headers,
          "User-Agent": `codearts/${this.identity.ideVersion}`,
          "Agent-Type": "PromptCenter",
          "x-language": this.language,
          "user-session-id": this.defaultSessionId
        }
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  async getModels() {
    return this.getJson(MODELS_PATH);
  }
  /** 通用 GET，供额度 / 任务等只读接口复用。 */
  async getJson(path) {
    const url = new URL(this.gateway + path);
    const headers = signRequest({
      method: "GET",
      url,
      contentType: null,
      body: "",
      credentials: this.creds
    });
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        ...headers,
        "User-Agent": `codearts/${this.identity.ideVersion}`,
        // 码道网关要求业务头，缺了报 TM.00001001
        "Agent-Type": "PromptCenter",
        "X-Language": "zh-cn"
      }
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`GET ${path} failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
    return res.json();
  }
  /**
   * 通用 POST（JSON 明文，不加密）。
   *
   * 仅用于 `/v1/model/thinking-variants` 这类元数据接口 —— 聊天走 chatStream 的加密通道。
   */
  async postJson(path, payload) {
    const url = new URL(this.gateway + path);
    const body = JSON.stringify(payload);
    const headers = signRequest({
      method: "POST",
      url,
      contentType: "application/json",
      body,
      credentials: this.creds
    });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "User-Agent": `codearts/${this.identity.ideVersion}`,
        "Agent-Type": "PromptCenter",
        "X-Language": "zh-cn"
      },
      body
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`POST ${path} failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
    return res.json();
  }
  /**
   * 尽力把错误响应解成明文。
   *
   * 网关的 4xx 响应体也是 `IV:TAG:CIPHERTEXT` 的 SM4-GCM 密文，
   * 直接打印只能看到乱码。解不出来时原样返回前 200 字符。
   */
  async describeError(raw, key) {
    const text = (raw ?? "").trim();
    if (!text) return "(\u7A7A\u54CD\u5E94\u4F53)";
    try {
      return decryptStreamChunk(key, text, "POST", CHAT_PATH, Date.now(), 0);
    } catch {
      return text.slice(0, 200);
    }
  }
  identityHeaders() {
    return {
      // 码道网关必需的业务头，缺任一都会 400
      "Agent-Type": "PromptCenter",
      "x-language": this.language,
      "plugin-name": this.identity.pluginName,
      "plugin-version": this.identity.pluginVersion,
      "ide-name": this.identity.ideName,
      "ide-version": this.identity.ideVersion
    };
  }
};
function decryptSseStream(upstream, key, method, pathname, timestamp) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let chunkIndex = 0;
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) {
            const rest = buffer.trim();
            if (rest) {
              const plain = decryptStreamChunk(key, rest, method, pathname, timestamp, chunkIndex++);
              controller.enqueue(encoder.encode(plain.endsWith("\n\n") ? plain : `${plain}

`));
            }
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            if (!block) continue;
            const plain = decryptStreamChunk(key, block, method, pathname, timestamp, chunkIndex++);
            controller.enqueue(encoder.encode(plain.endsWith("\n\n") ? plain : `${plain}

`));
          }
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });
}
function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// src/protocol/huawei-sign.ts
import { createHash as createHash4, createHmac as createHmac2 } from "node:crypto";
function huaweiSdkDate(d = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function signHuawei(opts) {
  const method = opts.method.toUpperCase();
  const sdkDateVal = opts.sdkDate ?? huaweiSdkDate();
  const body = opts.body ?? "";
  const payloadHash = createHash4("sha256").update(body).digest("hex");
  const headers = {
    Host: opts.host,
    "X-Sdk-Date": sdkDateVal
  };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  if (opts.securityToken) headers["X-Security-Token"] = opts.securityToken;
  const entries = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]).sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalHeaders2 = entries.map(([k, v]) => `${k}:${v.trim()}
`).join("");
  const signedHeaders = entries.map(([k]) => k).join(";");
  const canonicalRequest = [
    method,
    opts.path,
    opts.query ?? "",
    canonicalHeaders2,
    signedHeaders,
    payloadHash
  ].join("\n");
  const stringToSign = [
    "SDK-HMAC-SHA256",
    sdkDateVal,
    createHash4("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = createHmac2("sha256", opts.sk).update(stringToSign).digest("hex");
  return {
    ...headers,
    Authorization: `SDK-HMAC-SHA256 Access=${opts.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

// src/sts.ts
var IAM_HOST = "iam.cn-north-4.myhuaweicloud.com";
var IAM_REQUEST_PATH = "/v3.0/OS-CREDENTIAL/securitytokens";
var IAM_SIGN_PATH = `${IAM_REQUEST_PATH}/`;
async function getStsFromIam(ak, sk, durationSeconds = 3600) {
  const body = JSON.stringify({
    auth: {
      identity: {
        methods: ["token"],
        token: { duration_seconds: durationSeconds }
      }
    }
  });
  const headers = signHuawei({
    method: "POST",
    host: IAM_HOST,
    path: IAM_SIGN_PATH,
    contentType: "application/json;charset=utf8",
    body,
    ak,
    sk
  });
  const res = await fetch(`https://${IAM_HOST}${IAM_REQUEST_PATH}`, {
    method: "POST",
    headers,
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `IAM \u6362 STS \u5931\u8D25: HTTP ${res.status}
${text.slice(0, 800)}`
    );
  }
  let json2;
  try {
    json2 = JSON.parse(text);
  } catch {
    throw new Error(`IAM \u8FD4\u56DE\u975E JSON: ${text.slice(0, 300)}`);
  }
  const cred = json2.credential;
  if (!cred?.access || !cred?.secret || !cred?.securitytoken) {
    throw new Error(`IAM \u54CD\u5E94\u7F3A\u5C11 credential \u5B57\u6BB5:
${text.slice(0, 800)}`);
  }
  return {
    ak: cred.access,
    sk: cred.secret,
    securityToken: cred.securitytoken,
    expiresAt: cred.expires_at ?? ""
  };
}

// src/sts-provider.ts
var REFRESH_MARGIN_MS2 = 10 * 60 * 1e3;
var StsProvider = class {
  current = null;
  pending = null;
  ak;
  sk;
  durationSeconds;
  constructor(key, durationSeconds = 3600) {
    this.ak = key.ak;
    this.sk = key.sk;
    this.durationSeconds = durationSeconds;
  }
  /** 取可用的 STS 凭证；临近过期则续期。 */
  async get() {
    if (this.current && !this.isExpiring(this.current)) return this.current;
    if (this.pending) return this.pending;
    this.pending = getStsFromIam(this.ak, this.sk, this.durationSeconds).then((c) => {
      this.current = c;
      return c;
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  /** 直接产出可签名的 Credentials。 */
  async credentials() {
    const c = await this.get();
    return { ak: c.ak, sk: c.sk, securityToken: c.securityToken };
  }
  /** 强制丢弃缓存，下次 get() 会重新交换。 */
  invalidate() {
    this.current = null;
  }
  /**
   * 只读当前缓存的凭证，不触发交换。
   *
   * 面板要展示 STS 身份时需要 securityToken 明文，
   * 但又不该为了看一眼身份就多换一次 STS（IAM 有限流）。
   */
  peek() {
    return this.current;
  }
  /** 当前 STS 的过期时间（epoch ms），无则为 null。 */
  expiresAtMs() {
    if (!this.current?.expiresAt) return null;
    const t = Date.parse(this.current.expiresAt);
    return Number.isFinite(t) ? t : null;
  }
  isExpiring(c) {
    if (!c.expiresAt) return false;
    const t = Date.parse(c.expiresAt);
    if (!Number.isFinite(t)) return false;
    return Date.now() > t - REFRESH_MARGIN_MS2;
  }
};

// src/protocol/body.ts
var DEFAULT_MAX_TOKENS = 65536;
function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.type === "text" && typeof raw.text === "string") {
      parts.push({ type: "text", text: raw.text });
    } else if (raw.type === "image_url" && raw.image_url?.url) {
      parts.push({ type: "image_url", image_url: { url: String(raw.image_url.url) } });
    }
  }
  if (parts.length === 0) return "";
  if (parts.every((p) => p.type === "text")) {
    return parts.map((p) => p.text).join("");
  }
  return parts;
}
function hasUnsupportedContent(messages) {
  for (const m of messages ?? []) {
    if (!Array.isArray(m?.content)) continue;
    for (const part of m.content) {
      const t = part?.type;
      if (typeof t === "string" && t !== "text" && t !== "image_url") return t;
    }
  }
  return null;
}
function buildUpstreamBody(req, overrides = {}) {
  const messages = (req.messages ?? []).map((m) => ({
    // 网关不认 `developer` 角色。
    // OpenAI 新规范里 DSH 用 developer 承载系统提示，而码道网关只接受
    // system/user/assistant/tool —— 遇到 developer 会**静默返回空响应**
    // （HTTP 200、finish=stop、content 为空），上层只能看到 EMPTY_RESPONSE，
    // 完全看不出原因。这里统一降级成 system。
    role: m.role === "developer" ? "system" : m.role,
    content: normalizeContent(m.content),
    ...m.name ? { name: m.name } : {},
    ...m.tool_call_id ? { tool_call_id: m.tool_call_id } : {},
    ...m.tool_calls ? { tool_calls: m.tool_calls } : {}
  }));
  const body = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    ...typeof req.temperature === "number" ? { temperature: req.temperature } : {},
    ...typeof req.top_p === "number" ? { top_p: req.top_p } : {},
    ...req.stop ? { stop: req.stop } : {},
    ...req.tools ? { tools: req.tools } : {},
    ...req.tool_choice ? { tool_choice: req.tool_choice } : {},
    // 思考强度：取值来自 POST /v1/model/thinking-variants 的 strengths
    // （目前只有 GLM-5.2 / glm-5.2-sft-harmony 支持 high|max）
    // 思考强度。
    //
    // 网关认的是 **`reasoning_effort`**，不是 `strength` —— 之前一直发
    // `strength` 字段，网关当未知字段忽略，所以界面上换档位毫无效果。
    //
    // 实测（GLM-5.2，同一道题各跑 3 次取平均）：
    //   reasoning_effort=high → reasoning 1014 字
    //   不传                  → reasoning 1254 字
    //   reasoning_effort=max  → reasoning 1323 字
    // 组内波动 σ≈75，组间差异 240/69，确认字段真的生效。
    //
    // `off` 走网关的 `none`（内核里 forceReasoningNone 也是这么发的）。
    ...typeof req.strength === "string" && req.strength ? { reasoning_effort: req.strength === "off" ? "none" : req.strength } : {}
  };
  return { ...body, ...overrides };
}

// src/protocol/sse.ts
function makeChunk(id, model, delta, finishReason = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1e3),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  };
}
function sseLine(payload) {
  return `data: ${JSON.stringify(payload)}

`;
}
var SSE_DONE = "data: [DONE]\n\n";
function parseUpstreamEvent(data) {
  const trimmed = data.trim();
  if (!trimmed) return {};
  if (trimmed === "[DONE]") return { done: true };
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return {};
  }
  const out = { raw: obj };
  if (Array.isArray(obj.choices)) {
    const out2 = { raw: obj };
    if (obj.usage) {
      out2.usage = {
        prompt_tokens: obj.usage.prompt_tokens ?? 0,
        completion_tokens: obj.usage.completion_tokens ?? 0,
        total_tokens: obj.usage.total_tokens ?? 0
      };
    }
    const ch = obj.choices[0];
    if (!ch) return out2;
    const d = ch.delta ?? ch.message ?? {};
    if (typeof d.content === "string" && d.content) out2.text = d.content;
    if (typeof d.reasoning_content === "string" && d.reasoning_content) {
      out2.reasoning = d.reasoning_content;
    }
    if (typeof d.reasoning === "string" && d.reasoning) out2.reasoning = d.reasoning;
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) out2.toolCalls = d.tool_calls;
    if (ch.finish_reason) out2.finish = String(ch.finish_reason);
    return out2;
  }
  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "text-delta" || type === "text_delta") {
    out.text = obj.delta ?? obj.textDelta ?? obj.text ?? "";
    return out;
  }
  if (type === "reasoning" || type === "reasoning-delta") {
    out.reasoning = obj.delta ?? obj.textDelta ?? obj.text ?? "";
    return out;
  }
  if (type === "finish" || type === "finish-step") {
    out.finish = obj.finishReason ?? obj.finish_reason ?? "stop";
    if (obj.usage) {
      out.usage = {
        prompt_tokens: obj.usage.promptTokens ?? obj.usage.prompt_tokens ?? 0,
        completion_tokens: obj.usage.completionTokens ?? obj.usage.completion_tokens ?? 0,
        total_tokens: obj.usage.totalTokens ?? obj.usage.total_tokens ?? 0
      };
    }
    return out;
  }
  if (type === "error") {
    out.finish = "error";
    return out;
  }
  if (type === "message.part.updated") {
    const part = obj.part ?? obj.properties?.part ?? {};
    if (part.type === "text" && typeof part.text === "string") out.text = part.text;
    if (part.type === "reasoning" && typeof part.text === "string") out.reasoning = part.text;
    return out;
  }
  return out;
}

// src/credentials.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";

// src/codearts-auth.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var ANCHOR = '"id":"huawei-cloud-authentication"';
function candidateStateDbPaths() {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const base = [
    join(appData, "codearts-agent", "User", "globalStorage", "state.vscdb"),
    join(appData, "CodeArts Agent", "User", "globalStorage", "state.vscdb"),
    join(appData, "codearts", "User", "globalStorage", "state.vscdb")
  ];
  return base;
}
function parseFromRaw(raw, sourcePath) {
  const at = raw.indexOf(ANCHOR);
  if (at < 0) return null;
  const seg = raw.slice(at, at + 8192);
  const grab = (key) => {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(seg);
    return m?.[1] || void 0;
  };
  const ak = grab("accessKey");
  const sk = grab("secretKey");
  const sts = grab("securityToken");
  if (!ak || !sk || !sts) return null;
  const expires = grab("expiresAt");
  const t = expires ? Date.parse(expires) : NaN;
  const account = /"account"\s*:\s*\{[^}]*"label"\s*:\s*"([^"]+)"/.exec(seg)?.[1];
  return {
    ak,
    sk,
    securityToken: sts,
    expiresAtMs: Number.isFinite(t) ? t : null,
    account,
    sourcePath
  };
}
function readCodeArtsCredential(minRemainingMs = 5 * 60 * 1e3) {
  for (const p of candidateStateDbPaths()) {
    if (!existsSync(p)) continue;
    let raw;
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const cred = parseFromRaw(raw, p);
    if (!cred) continue;
    if (cred.expiresAtMs !== null && cred.expiresAtMs - Date.now() < minRemainingMs) {
      continue;
    }
    return cred;
  }
  return null;
}

// src/dpapi.ts
import { execFileSync } from "node:child_process";
var PS_PROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($enc))
`;
var PS_UNPROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($dec))
`;
function run(script, inputB64) {
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      input: inputB64,
      encoding: "utf8",
      timeout: 15e3,
      windowsHide: true
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}
function dpapiEncrypt(plaintext) {
  if (process.platform !== "win32") return null;
  const b64 = Buffer.from(plaintext, "utf8").toString("base64");
  const enc = run(PS_PROTECT, b64);
  if (!enc) return null;
  try {
    const back = dpapiDecrypt(enc);
    if (back !== plaintext) return null;
    return enc;
  } catch {
    return null;
  }
}
function dpapiDecrypt(cipherB64) {
  if (process.platform !== "win32") return null;
  const out = run(PS_UNPROTECT, cipherB64.trim());
  if (!out) return null;
  try {
    return Buffer.from(out, "base64").toString("utf8");
  } catch {
    return null;
  }
}

// src/credentials.ts
var CRED_DIR = join2(process.env.APPDATA || join2(homedir2(), ".config"), "dsh-connect-madao");
var DEFAULT_CRED_PATH = join2(CRED_DIR, "credentials.json");
var CRED_ENC_PATH = join2(CRED_DIR, "credentials.enc");
var LEGACY_CRED_PATH = join2(homedir2(), ".dsh-connect-madao", "credentials.json");
var CredentialError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialError";
  }
};
function fromEnv() {
  const ak = process.env.MADAO_AK?.trim();
  const sk = process.env.MADAO_SK?.trim();
  if (!ak || !sk) return null;
  const token = process.env.MADAO_SECURITY_TOKEN?.trim();
  return { ak, sk, ...token ? { securityToken: token } : {} };
}
function parseStored(parsed, where) {
  const ak = parsed.ak ?? parsed.accessKeyId ?? parsed.access_key_id ?? parsed["Access Key Id"];
  const sk = parsed.sk ?? parsed.secretAccessKey ?? parsed.secret_access_key ?? parsed["Secret Access Key"];
  const securityToken = parsed.securityToken ?? parsed.security_token ?? parsed.securitytoken ?? parsed.token;
  if (!ak || !sk) {
    throw new CredentialError(`${where} \u7F3A\u5C11 ak / sk`);
  }
  return {
    ak: String(ak).trim(),
    sk: String(sk).trim(),
    ...securityToken ? { securityToken: String(securityToken) } : {},
    expiresAt: parsed.expiresAt,
    region: parsed.region,
    account: parsed.account
  };
}
async function fromEncryptedFile() {
  let cipher;
  try {
    cipher = await readFile(CRED_ENC_PATH, "utf8");
  } catch {
    return null;
  }
  const plain = dpapiDecrypt(cipher);
  if (!plain) return null;
  try {
    return parseStored(JSON.parse(plain), CRED_ENC_PATH);
  } catch {
    return null;
  }
}
async function fromFile(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredentialError(`${path} \u4E0D\u662F\u5408\u6CD5 JSON`);
  }
  return parseStored(parsed, path);
}
async function saveCredentials(key) {
  const payload = JSON.stringify({ ak: key.ak, sk: key.sk }, null, 2);
  await mkdir(CRED_DIR, { recursive: true });
  const enc = dpapiEncrypt(payload);
  if (enc) {
    await writeFile(CRED_ENC_PATH, enc, "utf8");
    try {
      await rename(DEFAULT_CRED_PATH, `${DEFAULT_CRED_PATH}.bak`);
    } catch {
    }
    return { encrypted: true, path: CRED_ENC_PATH };
  }
  await writeFile(DEFAULT_CRED_PATH, payload, "utf8");
  return { encrypted: false, path: DEFAULT_CRED_PATH };
}
async function migratePlaintextToEncrypted() {
  try {
    const already = await readFile(CRED_ENC_PATH, "utf8").catch(() => null);
    if (already) return false;
    const plain = await fromFile(DEFAULT_CRED_PATH);
    if (!plain) return false;
    const r = await saveCredentials({ ak: plain.ak, sk: plain.sk });
    return r.encrypted;
  } catch {
    return false;
  }
}
async function candidateCredentials(path = DEFAULT_CRED_PATH) {
  const out = [];
  const env = fromEnv();
  if (env) out.push({ key: env, source: "env", label: "\u73AF\u5883\u53D8\u91CF MADAO_AK/MADAO_SK" });
  const encrypted = await fromEncryptedFile();
  if (encrypted) {
    out.push({ key: encrypted, source: "file", path: CRED_ENC_PATH, label: `\u52A0\u5BC6\u51ED\u8BC1 ${CRED_ENC_PATH}` });
  }
  const file = await fromFile(path);
  if (file) out.push({ key: file, source: "file", path, label: `\u51ED\u8BC1\u6587\u4EF6 ${path}\uFF08\u660E\u6587\uFF09` });
  if (path !== LEGACY_CRED_PATH) {
    const legacy = await fromFile(LEGACY_CRED_PATH);
    if (legacy) {
      out.push({ key: legacy, source: "file", path: LEGACY_CRED_PATH, label: `\u51ED\u8BC1\u6587\u4EF6 ${LEGACY_CRED_PATH}\uFF08\u65E7\u8DEF\u5F84\uFF09` });
    }
  }
  const borrowed = readCodeArtsCredential();
  if (borrowed) {
    out.push({
      key: {
        ak: borrowed.ak,
        sk: borrowed.sk,
        securityToken: borrowed.securityToken,
        account: borrowed.account,
        ...borrowed.expiresAtMs ? { expiresAt: borrowed.expiresAtMs } : {}
      },
      source: "codearts",
      path: borrowed.sourcePath,
      expiresAtMs: borrowed.expiresAtMs,
      label: `\u7801\u9053\u5BA2\u6237\u7AEF\u767B\u5F55\u6001\uFF08${borrowed.account ?? "\u672A\u77E5\u8D26\u53F7"}\uFF09`
    });
  }
  return out;
}
async function loadCredentials(path = DEFAULT_CRED_PATH) {
  const env = fromEnv();
  if (env) return { key: env, source: "env" };
  const encrypted = await fromEncryptedFile();
  if (encrypted) return { key: encrypted, source: "file", path: CRED_ENC_PATH };
  const file = await fromFile(path);
  if (file) return { key: file, source: "file", path };
  if (path !== LEGACY_CRED_PATH) {
    const legacy = await fromFile(LEGACY_CRED_PATH);
    if (legacy) return { key: legacy, source: "file", path: LEGACY_CRED_PATH };
  }
  const borrowed = readCodeArtsCredential();
  if (borrowed) {
    return {
      key: {
        ak: borrowed.ak,
        sk: borrowed.sk,
        securityToken: borrowed.securityToken,
        account: borrowed.account,
        ...borrowed.expiresAtMs ? { expiresAt: borrowed.expiresAtMs } : {}
      },
      source: "codearts",
      path: borrowed.sourcePath,
      expiresAtMs: borrowed.expiresAtMs
    };
  }
  throw new CredentialError(
    [
      "\u672A\u627E\u5230\u7801\u9053\u51ED\u8BC1\u3002\u4EFB\u9009\u5176\u4E00\uFF1A",
      "  A) \u73AF\u5883\u53D8\u91CF MADAO_AK / MADAO_SK",
      `  B) \u5199\u5165 ${path}\uFF1A{"ak":"...","sk":"..."}`,
      "  C) \u6253\u5F00\u4E00\u6B21\u7801\u9053\u5BA2\u6237\u7AEF\u5E76\u786E\u8BA4\u5DF2\u767B\u5F55 \u2014\u2014 \u63D2\u4EF6\u4F1A\u81EA\u52A8\u501F\u7528\u5B83\u7684\u4E34\u65F6\u51ED\u8BC1",
      "ak/sk \u4E3A\u534E\u4E3A\u4E91 IAM \u8BBF\u95EE\u5BC6\u94A5\uFF08\u63A7\u5236\u53F0 \u2192 \u6211\u7684\u51ED\u8BC1 \u2192 \u8BBF\u95EE\u5BC6\u94A5\uFF09\u3002",
      "STS \u4E34\u65F6\u4EE4\u724C\u4F1A\u5728\u8FD0\u884C\u65F6\u81EA\u52A8\u6362\u53D6\uFF0C\u65E0\u9700\u624B\u586B\u3002"
    ].join("\n")
  );
}
function maskKey(ak, sk) {
  const m = (s) => s.length <= 8 ? "***" : `${s.slice(0, 4)}\u2026${s.slice(-4)}`;
  return { ak: m(ak), sk: m(sk) };
}

// src/server.ts
init_models();

// src/identity.ts
function findJsonEnd(raw, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function parseStsIdentity(securityToken) {
  if (!securityToken) return {};
  try {
    const raw = Buffer.from(securityToken, "base64").toString("utf8");
    const start = raw.indexOf("{");
    if (start < 0) return {};
    const end = findJsonEnd(raw, start);
    if (end < 0) return {};
    const obj = JSON.parse(raw.slice(start, end + 1));
    const user = obj?.user ?? {};
    return {
      accountName: user?.name ?? user?.domain?.name,
      domainId: user?.domain?.id,
      userId: user?.id,
      userType: typeof user?.user_type === "number" ? user.user_type : void 0
    };
  } catch {
    return {};
  }
}

// src/server.ts
async function ensureFreshClient(ctx) {
  if (!ctx.sts || !ctx.loaded) return;
  if (ctx.loaded.key.securityToken) return;
  try {
    const creds = await ctx.sts.get();
    if (ctx.lastCreds !== creds) {
      ctx.client = new MadaoClient({ credentials: creds });
      ctx.lastCreds = creds;
      chatLog("client rebuilt with refreshed STS");
    }
  } catch (e) {
    chatLog(`STS refresh failed: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}
async function startServer(opts = {}) {
  const port = opts.port ?? 8765;
  const host = opts.host ?? "127.0.0.1";
  const ctx = { client: null, sts: null, loaded: null, loadError: null, models: opts.models ?? FALLBACK_MODELS };
  try {
    if (await migratePlaintextToEncrypted()) {
      chatLog("credentials: \u5DF2\u628A\u660E\u6587\u51ED\u8BC1\u8FC1\u79FB\u4E3A DPAPI \u52A0\u5BC6");
    }
    const candidates = await candidateCredentials(opts.credentialPath);
    if (candidates.length === 0) {
      throw new Error("\u672A\u627E\u5230\u4EFB\u4F55\u53EF\u7528\u51ED\u8BC1\u6765\u6E90\uFF08\u73AF\u5883\u53D8\u91CF / \u51ED\u8BC1\u6587\u4EF6 / \u7801\u9053\u767B\u5F55\u6001\uFF09");
    }
    const failures = [];
    for (const c of candidates) {
      try {
        if (c.key.securityToken) {
          const probe = new MadaoClient({
            credentials: { ak: c.key.ak, sk: c.key.sk, securityToken: c.key.securityToken },
            gateway: opts.gateway
          });
          await probe.ensureSessionKey();
          ctx.loaded = c;
          ctx.client = probe;
          chatLog(`credentials: \u91C7\u7528 ${c.label}\uFF08\u4E09\u4EF6\u5957\uFF09`);
          break;
        }
        const sts = new StsProvider({ ak: c.key.ak, sk: c.key.sk });
        const creds = await sts.credentials();
        ctx.loaded = c;
        ctx.sts = sts;
        ctx.client = new MadaoClient({ credentials: creds, gateway: opts.gateway });
        ctx.lastCreds = creds;
        chatLog(`credentials: \u91C7\u7528 ${c.label}\uFF08\u5DF2\u6362 STS\uFF09`);
        break;
      } catch (e) {
        const msg = String(e?.message ?? e).slice(0, 200);
        failures.push(`${c.label} \u2192 ${msg}`);
        chatLog(`credentials: \u8DF3\u8FC7 ${c.label}\uFF08${msg}\uFF09`);
      }
    }
    if (!ctx.client) {
      throw new Error(`\u6240\u6709\u51ED\u8BC1\u6765\u6E90\u90FD\u4E0D\u53EF\u7528\uFF1A
${failures.map((f) => `  ${f}`).join("\n")}`);
    }
  } catch (err) {
    ctx.loadError = err instanceof Error ? err.message : String(err);
  }
  const server = createServer((req, res) => {
    handle(req, res, ctx).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(err?.message ?? err), type: "internal_error" } }));
        return;
      }
      try {
        res.end();
      } catch {
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()))
  };
}
async function handle(req, res, ctx) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/healthz") {
    return json(res, 200, await healthz(ctx));
  }
  if (req.method === "GET" && (url.pathname === "/diag/account" || url.pathname === "/diag/credit")) {
    return json(res, 200, await accountInfo(ctx));
  }
  if ((req.method === "POST" || req.method === "GET") && url.pathname === "/diag/test") {
    return json(res, 200, await runSelfTest(ctx));
  }
  if (url.pathname === "/diag/checkin" && (req.method === "GET" || req.method === "POST")) {
    await ensureFreshClient(ctx);
    if (!ctx.client) {
      return json(res, 503, { error: { message: ctx.loadError ?? "\u51ED\u8BC1\u672A\u52A0\u8F7D", type: "credentials_error" } });
    }
    try {
      const d = await ctx.client.getJson("/v1/ops/delivery?channel=IDE");
      const items = d?.data?.items ?? [];
      const daily = items.find((x) => x?.campaignId === 34);
      if (!daily) {
        return json(res, 200, {
          ok: true,
          available: false,
          reason: "\u7F51\u5173\u7684\u798F\u5229\u5217\u8868\u91CC\u6CA1\u6709\u6BCF\u65E5\u7B7E\u5230\u6D3B\u52A8\uFF08campaignId=34\uFF09"
        });
      }
      const state = {
        campaignId: 34,
        title: daily.title,
        status: daily.status,
        claimable: daily.claimable === true,
        pendingAmount: daily.pendingTotalAmount ?? 0,
        unit: daily.benefitUnit ?? "CREDIT",
        expireAt: daily.expireAt ?? null
      };
      if (req.method === "GET") {
        return json(res, 200, { ok: true, available: true, ...state });
      }
      if (!state.claimable || daily.status !== "ELIGIBLE") {
        return json(res, 200, { ok: true, available: true, claimed: false, ...state, reason: "\u5F53\u524D\u4E0D\u53EF\u9886\u53D6" });
      }
      const r = await ctx.client.postJson("/v1/ops/claim", {
        campaignId: 34,
        idempotentKey: randomUUID2(),
        channel: "IDE"
      });
      const claimed = r?.code === 0;
      chatLog(`checkin ${claimed ? "OK" : "FAIL"} campaign=34 ${JSON.stringify(r?.data ?? r).slice(0, 200)}`);
      return json(res, 200, {
        ok: true,
        available: true,
        claimed,
        ...state,
        status: r?.data?.status ?? state.status,
        amount: r?.data?.totalAmount ?? state.pendingAmount,
        claimedAt: r?.data?.claimedAt ?? null,
        ...claimed ? {} : { reason: String(r?.message ?? "\u9886\u53D6\u5931\u8D25") }
      });
    } catch (e) {
      chatLog(`checkin ERROR ${String(e?.message ?? e).slice(0, 200)}`);
      return json(res, 502, {
        error: { message: `\u7B7E\u5230\u63A5\u53E3\u8C03\u7528\u5931\u8D25\uFF1A${String(e?.message ?? e)}`, type: "checkin_error" }
      });
    }
  }
  if (req.method === "POST" && url.pathname === "/diag/credentials") {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: { message: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" } });
    }
    const ak = String(payload.ak ?? "").trim();
    const sk = String(payload.sk ?? "").trim();
    if (!ak || !sk) {
      return json(res, 400, { error: { message: "Access Key ID \u4E0E Secret Access Key \u90FD\u4E0D\u80FD\u4E3A\u7A7A" } });
    }
    let saved;
    try {
      saved = await saveCredentials({ ak, sk });
      chatLog(
        `credentials saved via panel \u2192 ${saved.path} (${saved.encrypted ? "DPAPI \u52A0\u5BC6" : "\u26A0 \u660E\u6587\uFF0CDPAPI \u4E0D\u53EF\u7528"}, ak=${ak.slice(0, 4)}\u2026)`
      );
    } catch (e) {
      return json(res, 500, {
        error: {
          message: `\u4FDD\u5B58\u51ED\u8BC1\u5931\u8D25\uFF1A${String(e?.message ?? e)}
\u53EF\u6539\u7528\u73AF\u5883\u53D8\u91CF MADAO_AK / MADAO_SK\u3002`
        }
      });
    }
    try {
      const reloaded = await loadCredentials();
      ctx.loaded = reloaded;
      ctx.loadError = null;
      if (reloaded.key.securityToken) {
        ctx.client = new MadaoClient({
          credentials: {
            ak: reloaded.key.ak,
            sk: reloaded.key.sk,
            securityToken: reloaded.key.securityToken
          }
        });
        ctx.sts = null;
      } else {
        const sts = new StsProvider({ ak: reloaded.key.ak, sk: reloaded.key.sk });
        const creds = await sts.credentials();
        ctx.sts = sts;
        ctx.client = new MadaoClient({ credentials: creds });
        ctx.lastCreds = creds;
      }
      chatLog(`credentials reloaded after save (source=${reloaded.source})`);
    } catch (e) {
      return json(res, 200, {
        ok: true,
        warning: `\u5DF2\u5199\u5165\uFF0C\u4F46\u7ACB\u5373\u52A0\u8F7D\u5931\u8D25\uFF08\u91CD\u542F DSH \u540E\u751F\u6548\uFF09\uFF1A${String(e?.message ?? e)}`
      });
    }
    return json(res, 200, { ok: true, source: ctx.loaded?.source });
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    return json(res, 200, {
      object: "list",
      data: ctx.models.map((m) => ({
        id: m.id,
        object: "model",
        owned_by: "huawei-codearts",
        name: m.name,
        // 下划线是 OpenAI 生态的惯例，驼峰给前端面板用。
        // 之前只给了下划线，而面板读 m.context / m.maxOutput / m.supportsImages，
        // 结果三列全是 undefined —— `m.context.toLocaleString()` 直接抛错，
        // 模型 tab 一打开就崩。
        context_window: m.context,
        max_output_tokens: m.maxOutput,
        supports_images: m.supportsImages,
        default_strength: m.defaultStrength,
        context: m.context,
        maxOutput: m.maxOutput,
        supportsImages: m.supportsImages,
        defaultStrength: m.defaultStrength,
        ratio: m.ratio,
        strengths: m.strengths,
        description: m.description
      }))
    });
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    await ensureFreshClient(ctx);
    if (!ctx.client) {
      return json(res, 503, { error: { message: ctx.loadError ?? "\u51ED\u8BC1\u672A\u52A0\u8F7D", type: "credentials_error" } });
    }
    if (ctx.loaded?.source === "codearts") {
      const exp = typeof ctx.loaded.key.expiresAt === "number" ? ctx.loaded.key.expiresAt : ctx.loaded.expiresAtMs;
      if (typeof exp === "number" && Date.now() > exp) {
        const mins = Math.max(1, Math.round((Date.now() - exp) / 6e4));
        chatLog(`chat REJECT codearts credential expired ${mins}min ago`);
        return json(res, 401, {
          error: {
            message: `\u7801\u9053\u767B\u5F55\u6001\u7684\u4E34\u65F6\u51ED\u8BC1\u5DF2\u7ECF\u8FC7\u671F\uFF08\u8FC7\u671F\u7EA6 ${mins} \u5206\u949F\uFF09\u3002
\u8FD9\u4E0D\u662F\u6A21\u578B\u6545\u969C\uFF1A\u4E34\u65F6\u51ED\u8BC1\u53EA\u6709\u51E0\u5C0F\u65F6\u5BFF\u547D\uFF0C\u63D2\u4EF6\u65E0\u6CD5\u66FF\u4F60\u7EED\u671F\u3002
\u6062\u590D\u529E\u6CD5\uFF1A\u6253\u5F00\u4E00\u6B21\u7801\u9053\u5BA2\u6237\u7AEF\u8BA9\u5B83\u5237\u65B0\u767B\u5F55\u6001 \u2192 \u56DE\u5230\u8FD9\u91CC\u70B9\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u3002
\u60F3\u4E00\u52B3\u6C38\u9038\uFF0C\u5C31\u5728\u8D26\u53F7\u9875\u586B\u6C38\u4E45 AK/SK\uFF08\u63D2\u4EF6\u4F1A\u81EA\u52A8\u6362 STS \u5E76\u7EED\u671F\uFF09\u3002`,
            type: "credentials_expired"
          }
        });
      }
    }
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: { message: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON", type: "invalid_request_error" } });
    }
    return chatCompletion(res, ctx.client, body, ctx.models);
  }
  json(res, 404, { error: { message: `\u672A\u77E5\u8DEF\u5F84 ${url.pathname}`, type: "not_found" } });
}
function chatLog(line) {
  try {
    const dir = join3(homedir3(), ".dsh-connect-madao");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join3(dir, "chat.log"), `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`, "utf8");
  } catch {
  }
}
function estimateTokens(value) {
  let cjk = 0;
  let other = 0;
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 19968 && c <= 40959 || c >= 13312 && c <= 19903 || c >= 63744 && c <= 64255 || c >= 12288 && c <= 12351 || c >= 65280 && c <= 65519) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 2.5 + other / 5);
}
function resolveModelId(input, models) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  const byId = models.find((m) => m.id.toLowerCase() === low);
  if (byId) return byId.id;
  const shown = (m) => m.ratio ? `${m.name} \xB7 ${m.ratio}` : m.name;
  const byShown = models.find((m) => shown(m) === raw || m.name === raw);
  if (byShown) return byShown.id;
  const byShownCi = models.find((m) => shown(m).toLowerCase() === low || m.name.toLowerCase() === low);
  if (byShownCi) return byShownCi.id;
  const stripped = raw.split("\xB7")[0].trim();
  if (stripped && stripped !== raw) {
    const s = stripped.toLowerCase();
    const byStrip = models.find((m) => m.id.toLowerCase() === s || m.name.toLowerCase() === s);
    if (byStrip) return byStrip.id;
  }
  return null;
}
function normalizeRequest(body, models) {
  const out = { ...body };
  const resolved = resolveModelId(String(body.model ?? ""), models);
  out.model = resolved ?? "";
  const effort = body.strength ?? body.reasoning_effort;
  if (typeof effort === "string" && effort) out.strength = effort;
  return out;
}
async function chatCompletion(res, client, rawBody, ctxModels) {
  const unsupported = hasUnsupportedContent(rawBody.messages);
  if (unsupported) {
    return json(res, 400, {
      error: {
        message: `\u4E0D\u652F\u6301\u7684\u5185\u5BB9\u7C7B\u578B\uFF1A${unsupported}\u3002\u6865\u63A5\u76EE\u524D\u8F6C\u53D1 text \u4E0E image_url\uFF08\u56FE\u7247\uFF09\uFF0C\u5176\u4ED6\u7C7B\u578B\uFF08\u97F3\u9891\u3001file \u7B49\uFF09\u7F51\u5173\u4E0D\u8BA4\u3002`,
        type: "unsupported_content"
      }
    });
  }
  const body = normalizeRequest(rawBody, ctxModels);
  const wantStream = body.stream !== false;
  const upstreamBody = buildUpstreamBody(body);
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const model = body.model;
  if (!model) {
    const requestId = String(rawBody.model ?? "");
    chatLog(`chat REJECT unknown model ${JSON.stringify(requestId)}`);
    return json(res, 400, {
      error: {
        message: `\u672A\u77E5\u6A21\u578B\uFF1A${JSON.stringify(requestId)}
\u53EF\u7528\u6A21\u578B\uFF08model_id \u6216\u754C\u9762\u4E0A\u7684\u663E\u793A\u540D\u90FD\u53EF\uFF09\uFF1A
` + ctxModels.map((m) => `  ${m.id}${m.ratio ? `\uFF08\u663E\u793A\u540D ${m.name} \xB7 ${m.ratio}\uFF09` : ""}`).join("\n"),
        type: "model_not_found"
      }
    });
  }
  const info = ctxModels.find((m) => m.id === model);
  const estMessages = estimateTokens(rawBody.messages);
  const toolCount = Array.isArray(rawBody.tools) ? rawBody.tools.length : 0;
  const estTools = toolCount > 0 ? estimateTokens(rawBody.tools) : 0;
  const estTokens = estMessages + estTools;
  if (info && info.context > 0) {
    const limit = Math.floor(info.context * 1.2);
    if (estTokens > limit) {
      const bigger = ctxModels.filter((m) => m.context * 0.9 > estTokens).sort((a, b) => a.context - b.context).slice(0, 4).map((m) => `${m.name}\uFF08${m.context}\uFF09`);
      chatLog(
        `chat REJECT context ${estTokens} (msgs ${estMessages} + tools ${estTools}/${toolCount}) > ${limit} for ${model}`
      );
      try {
        writeFileSync(join3(homedir3(), ".dsh-connect-madao", "last-rejected.json"), JSON.stringify(rawBody), "utf8");
        chatLog("chat REJECT \u8BF7\u6C42\u4F53\u5DF2\u5B58\u81F3 ~/.dsh-connect-madao/last-rejected.json");
      } catch {
      }
      const toolsAloneExceed = estTools > limit;
      return json(res, 400, {
        error: {
          message: `\u4E0A\u4E0B\u6587\u8D85\u51FA\u300C${info.name}\u300D\u7684\u7A97\u53E3 ${info.context}\uFF08\u53EF\u7528\u7EA6 ${limit}\uFF09\uFF1A
  \u5DE5\u5177\u5B9A\u4E49 ${estTools}\uFF08${toolCount} \u4E2A\uFF09
  \u5BF9\u8BDD\u4E0E\u7CFB\u7EDF\u63D0\u793A ${estMessages}
  \u5408\u8BA1 ${estTokens} tokens
` + (toolsAloneExceed ? `
\u6CE8\u610F\uFF1A\u5149\u5DE5\u5177\u5B9A\u4E49\u5C31\u8D85\u8FC7\u4E86\u8BE5\u6A21\u578B\u6574\u4E2A\u7A97\u53E3\uFF0C\u6240\u4EE5\u54EA\u6015\u65B0\u5F00\u4F1A\u8BDD\u3001\u53EA\u53D1\u4E00\u4E2A\u5B57\u4E5F\u88C5\u4E0D\u4E0B\u3002
\u8FD9\u4E0D\u662F\u5BF9\u8BDD\u5386\u53F2\u592A\u957F\uFF0C\u538B\u7F29\u4F1A\u8BDD\u6CA1\u6709\u7528 \u2014\u2014 \u9700\u8981\u6362\u7A97\u53E3\u66F4\u5927\u7684\u6A21\u578B\uFF0C\u6216\u8005\u7981\u7528\u4E00\u4E9B\u63D2\u4EF6/MCP \u670D\u52A1\u5668\u6765\u51CF\u5C11\u5DE5\u5177\u6570\u91CF\u3002
` : `
\u53EF\u4EE5\u538B\u7F29\u4F1A\u8BDD\u3001\u5F00\u65B0\u5BF9\u8BDD\uFF0C\u6216\u6362\u7A97\u53E3\u66F4\u5927\u7684\u6A21\u578B\u3002
`) + (bigger.length ? `\u7A97\u53E3\u591F\u7528\u7684\u6A21\u578B\uFF1A${bigger.join("\u3001")}` : `\u8BF7\u51CF\u5C11\u5DE5\u5177\u6570\u91CF\u6216\u6362\u66F4\u5927\u7684\u6A21\u578B\u3002`),
          type: "context_length_exceeded"
        }
      });
    }
  }
  const rb = rawBody;
  const msgBrief = (rb.messages ?? []).map((m) => `${m.role}:${typeof m.content === "string" ? m.content.length : Array.isArray(m.content) ? "arr" + m.content.length : typeof m.content}`).join(",");
  chatLog(
    `chat in=${JSON.stringify(String(rawBody.model ?? ""))} \u2192 out=${JSON.stringify(model)} strength=${JSON.stringify(body.strength ?? null)} max_tokens=${rb.max_tokens ?? "\u672A\u4F20"} max_completion_tokens=${rb.max_completion_tokens ?? "\u672A\u4F20"} \u2192 \u5B9E\u9645\u53D1\u7ED9\u7F51\u5173=${upstreamBody.max_tokens} stream=${wantStream} est_tokens=${estTokens} msgs=[${msgBrief}] tools=${Array.isArray(rb.tools) ? rb.tools.length : 0} \u9876\u5C42\u5B57\u6BB5=${Object.keys(rb).join("|")}`
  );
  void client.heartbeat("busy");
  const markIdle = () => {
    void client.heartbeat("idle");
  };
  const up = await client.chatStream(upstreamBody);
  const reader = up.getReader();
  const decoder = new TextDecoder();
  async function* events() {
    let buf = "";
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) {
        if (buf.trim()) {
          for (const line of buf.split("\n")) {
            if (line.startsWith("data:")) yield parseUpstreamEvent(line.slice(5));
          }
        }
        return;
      }
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) yield parseUpstreamEvent(line.slice(5));
        }
      }
    }
  }
  if (!wantStream) {
    let text = "";
    let reasoning = "";
    let finish2 = null;
    let usage2;
    const mergedCalls = [];
    for await (const ev of events()) {
      if (ev.reasoning) reasoning += ev.reasoning;
      if (ev.text) text += ev.text;
      if (ev.toolCalls) {
        for (const tc of ev.toolCalls) {
          const idx = typeof tc?.index === "number" ? tc.index : mergedCalls.length;
          const cur = mergedCalls[idx] ?? { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) cur.id = tc.id;
          if (tc.type) cur.type = tc.type;
          if (tc.function?.name) cur.function.name += tc.function.name;
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
          mergedCalls[idx] = cur;
        }
      }
      if (ev.finish) finish2 = ev.finish;
      if (ev.usage) usage2 = ev.usage;
    }
    chatLog(
      `chat done model=${model} content_len=${text.length} reasoning_len=${reasoning.length} tool_calls=${mergedCalls.length} finish=${finish2 ?? "stop"}` + (text.length === 0 && mergedCalls.length === 0 ? "  \u26A0 content \u4E3A\u7A7A\u4E14\u65E0\u5DE5\u5177\u8C03\u7528" : "")
    );
    markIdle();
    return json(res, 200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text,
            ...reasoning ? { reasoning_content: reasoning } : {},
            ...mergedCalls.length > 0 ? { tool_calls: mergedCalls.filter(Boolean) } : {}
          },
          finish_reason: finish2 ?? "stop"
        }
      ],
      ...usage2 ? { usage: usage2 } : {}
    });
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(sseLine(makeChunk(id, model, { role: "assistant" })));
  let finish = null;
  let usage;
  let contentChars = 0;
  let reasoningChars = 0;
  let textEvents = 0;
  let reasoningEvents = 0;
  let toolCallEvents = 0;
  try {
    for await (const ev of events()) {
      if (ev.reasoning) {
        reasoningChars += ev.reasoning.length;
        reasoningEvents++;
        res.write(sseLine(makeChunk(id, model, { reasoning_content: ev.reasoning })));
      }
      if (ev.text) {
        contentChars += ev.text.length;
        textEvents++;
        res.write(sseLine(makeChunk(id, model, { content: ev.text })));
      }
      if (ev.toolCalls) {
        toolCallEvents++;
        res.write(sseLine(makeChunk(id, model, { tool_calls: ev.toolCalls })));
      }
      if (ev.finish) finish = ev.finish;
      if (ev.usage) usage = ev.usage;
    }
  } catch (err) {
    res.write(sseLine({ error: { message: String(err?.message ?? err), type: "upstream_error" } }));
    chatLog(`chat stream ERROR model=${model} ${String(err?.message ?? err).slice(0, 160)}`);
  }
  if (usage) {
    res.write(sseLine({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1e3), model, choices: [], usage }));
  }
  res.write(sseLine(makeChunk(id, model, {}, finish ?? "stop")));
  res.write(SSE_DONE);
  res.end();
  chatLog(
    `chat done stream model=${model} finish=${finish ?? "stop"} content=${contentChars}(${textEvents}\u6BB5) reasoning=${reasoningChars}(${reasoningEvents}\u6BB5) tool_calls=${toolCallEvents}\u5E27` + // 有工具调用时 content 为空是正常的（模型在调工具，不是产文本），不能报"空响应"
    (contentChars === 0 && toolCallEvents === 0 ? reasoningChars === 0 ? "  \u26A0 \u5B8C\u5168\u7A7A\u54CD\u5E94" : "  \u26A0 content \u4E3A\u7A7A" : "")
  );
  markIdle();
}
async function healthz(ctx) {
  if (!ctx.loaded || !ctx.client) {
    return { ok: false, stage: "credentials", error: ctx.loadError };
  }
  const masked = maskKey(ctx.loaded.key.ak, ctx.loaded.key.sk);
  try {
    const key = await ctx.client.ensureSessionKey();
    const stsExpiry = ctx.sts?.expiresAtMs() ?? null;
    return {
      ok: true,
      stage: "ready",
      credentials: { source: ctx.loaded.source, ...masked },
      sts: stsExpiry ? { expiresAt: new Date(stsExpiry).toISOString() } : "provided",
      sessionKey: { keyId: key.keyId, ttlSec: Math.round((key.expiresAt - Date.now()) / 1e3) },
      models: ctx.models.length
    };
  } catch (err) {
    return {
      ok: false,
      stage: "handshake",
      error: String(err?.message ?? err),
      credentials: { source: ctx.loaded.source, ...masked }
    };
  }
}
function pickMetric(list, name2) {
  return list.find((m) => m?.name === name2);
}
async function queryCredit(client) {
  try {
    const r = await client.getJson("/snap-manager/v1/statistics/plugin");
    const list = r?.metrics ?? [];
    const total = pickMetric(list, "usageTotalPackageCredit");
    if (!total) return null;
    const pkg = (m) => m ? { amount: Number(m.package_credit_amount ?? 0), used: Number(m.package_credit_used ?? 0), remain: Number(m.package_credit_remain ?? 0) } : void 0;
    const tokens = pickMetric(list, "usageTokenChatMessages");
    return {
      total: Number(total.package_credit_amount ?? 0),
      used: Number(total.package_credit_used ?? 0),
      remain: Number(total.package_credit_remain ?? 0),
      basic: pkg(pickMetric(list, "usageBasicPackageCredit")),
      bonus: pkg(pickMetric(list, "usageBonusPackageCredit")),
      onDemand: pkg(pickMetric(list, "usageOnDemandPackageCredit")),
      totalTokens: tokens ? Number(tokens.usage_token_num ?? 0) : void 0
    };
  } catch {
    return null;
  }
}
async function accountInfo(ctx) {
  if (!ctx.loaded || !ctx.client) {
    return { ok: false, stage: "credentials", error: ctx.loadError };
  }
  const masked = maskKey(ctx.loaded.key.ak, ctx.loaded.key.sk);
  let token = ctx.loaded.key.securityToken ?? ctx.sts?.peek()?.securityToken;
  if (!token && ctx.sts) {
    try {
      token = (await ctx.sts.get()).securityToken;
    } catch {
    }
  }
  const identity = parseStsIdentity(token);
  const borrowedExpiry = ctx.loaded.source === "codearts" ? typeof ctx.loaded.key.expiresAt === "number" ? ctx.loaded.key.expiresAt : ctx.loaded.expiresAtMs ?? null : null;
  const base = {
    ak: masked.ak,
    sk: masked.sk,
    source: ctx.loaded.source,
    account: identity.accountName,
    userId: identity.userId,
    /** 码道登录态借来的临时凭证到期时间（epoch ms）；永久 AK/SK 为 null */
    expiresAtMs: borrowedExpiry,
    /** 是否为临时凭证 —— 面板据此显示过期提示 */
    temporary: ctx.loaded.source === "codearts"
  };
  try {
    const key = await ctx.client.ensureSessionKey();
    const stsExpiry = ctx.sts?.expiresAtMs() ?? null;
    base.sts = stsExpiry ? { expiresAt: new Date(stsExpiry).toISOString(), ttlSec: Math.round((stsExpiry - Date.now()) / 1e3) } : "provided";
    base.sessionKey = { keyId: key.keyId, ttlSec: Math.round((key.expiresAt - Date.now()) / 1e3) };
    const credit = await queryCredit(ctx.client);
    if (credit) base.credit = credit;
    try {
      const roles = await ctx.client.getJson("/snap-manager/v1/member/roles");
      base.roles = roles?.enterprise_roles ?? [];
    } catch {
    }
    return { ok: true, stage: "ready", ...base };
  } catch (err) {
    return { ok: false, stage: "handshake", error: String(err?.message ?? err), ...base };
  }
}
async function runSelfTest(ctx) {
  if (!ctx.loaded) return { ok: false, steps: [{ name: "\u51ED\u8BC1", ok: false, detail: ctx.loadError ?? "\u672A\u52A0\u8F7D" }] };
  const steps = [];
  const step = async (name2, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps.push({ name: name2, ok: true, detail: detail || void 0, ms: Date.now() - t0 });
      return true;
    } catch (e) {
      steps.push({ name: name2, ok: false, detail: String(e?.message ?? e).slice(0, 200), ms: Date.now() - t0 });
      return false;
    }
  };
  const stsOk = await step("\u51ED\u8BC1\u5C31\u7EEA", async () => {
    let reloaded = null;
    try {
      reloaded = await loadCredentials();
    } catch {
    }
    if (reloaded) {
      ctx.loaded = reloaded;
      ctx.loadError = null;
      if (!reloaded.key.securityToken && !ctx.sts) {
        try {
          ctx.sts = new StsProvider({ ak: reloaded.key.ak, sk: reloaded.key.sk });
        } catch {
        }
      }
    }
    const l = ctx.loaded;
    if (!l) throw new Error(ctx.loadError ?? "\u672A\u52A0\u8F7D");
    if (l.key.securityToken) {
      const left = typeof l.key.expiresAt === "number" ? Math.round((l.key.expiresAt - Date.now()) / 6e4) : null;
      const from = l.source === "codearts" ? "\u7801\u9053\u767B\u5F55\u6001" : l.source;
      return `${from} \xB7 \u4E34\u65F6\u51ED\u8BC1${left !== null ? `\uFF0C\u5269 ${left} \u5206\u949F` : ""}`;
    }
    const sts = new StsProvider({ ak: l.key.ak, sk: l.key.sk });
    const creds = await sts.credentials();
    ctx.sts = sts;
    ctx.client = new MadaoClient({ credentials: creds });
    return `\u6C38\u4E45 AK/SK \xB7 \u5DF2\u6362 STS\uFF0C\u6709\u6548\u81F3 ${new Date(sts.expiresAtMs() ?? 0).toLocaleTimeString()}`;
  });
  if (!stsOk) return { ok: false, steps };
  await step("\u5BC6\u94A5\u534F\u5546", async () => {
    ctx.client.resetSessionKey();
    const k = await ctx.client.ensureSessionKey();
    return `keyId ${k.keyId.slice(0, 8)} \xB7 TTL ${Math.round((k.expiresAt - Date.now()) / 1e3)}s`;
  });
  await step("\u6A21\u578B\u6E05\u5355", async () => {
    const { discoverModels: discoverModels2 } = await Promise.resolve().then(() => (init_models(), models_exports));
    const found = await discoverModels2(ctx.client);
    if (found.source === "gateway") {
      ctx.models = found.models;
      return `${found.models.length} \u4E2A\u6A21\u578B`;
    }
    throw new Error(found.error ?? "\u7F51\u5173\u672A\u8FD4\u56DE\u6E05\u5355");
  });
  await step("\u79EF\u5206\u989D\u5EA6", async () => {
    const c = await queryCredit(ctx.client);
    if (!c) throw new Error("\u989D\u5EA6\u63A5\u53E3\u65E0\u8FD4\u56DE");
    return `\u5269\u4F59 ${c.remain} / \u5171 ${c.total}`;
  });
  const ok = steps.every((s) => s.ok);
  return { ok, steps };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// src/index.ts
init_models();

// src/host-patch.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, existsSync as existsSync2 } from "node:fs";
var BRIDGE_PORT = 8765;
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
function displayName(m) {
  return m.ratio ? `${m.name} \xB7 ${m.ratio}` : m.name;
}
var CONTEXT_DISPLAY_FACTOR = 2.5;
function displayContextWindow(real) {
  if (!Number.isFinite(real) || real <= 0) return real;
  return Math.round(real * CONTEXT_DISPLAY_FACTOR);
}
function renderModel(m) {
  const lines = [];
  lines.push(`          - id: ${q(m.id)}`);
  lines.push(`            name: ${q(displayName(m))}`);
  lines.push(`            contextWindow: ${displayContextWindow(m.context)}`);
  lines.push(`            maxTokens: ${m.maxOutput}`);
  lines.push(`            input: [ ${m.supportsImages ? "text, image" : "text"} ]`);
  if (m.strengths.length > 0) {
    const levels = Array.from(/* @__PURE__ */ new Set(["low", ...m.strengths]));
    lines.push("            reasoningEfforts:");
    lines.push("              off: null");
    for (const lv of levels) lines.push(`              ${lv}: ${q(lv)}`);
  } else {
    lines.push("            reasoningEfforts: false");
  }
  return lines.join("\n");
}
function renderPatch(models) {
  const header = `# \u7531 dsh-connect-madao \u81EA\u52A8\u751F\u6210\uFF0C\u8BF7\u52FF\u624B\u5DE5\u7F16\u8F91\u3002
# \u6A21\u578B\u6E05\u5355\u5728\u63D2\u4EF6\u542F\u52A8\u65F6\u4ECE\u7801\u9053\u7F51\u5173\u62C9\u53D6\uFF1B\u4E0A\u6E38\u4E0A\u65B0\u6216\u8C03\u4EF7\u540E\u91CD\u542F DSH \u5373\u81EA\u52A8\u540C\u6B65\u3002
# \u60F3\u5F3A\u5236\u5237\u65B0\uFF1A\u5220\u9664\u672C\u6587\u4EF6\u540E\u91CD\u542F\uFF0C\u6216\u8FD0\u884C \`dsh-connect-madao models --write\`\u3002
- insert:
    - id: dsh-connect-madao
      name: dsh-connect-madao
- id: llm-pi-ai
  config:
    providers:
      madao:
        displayName: ${q("\u7801\u9053 CodeArts")}
        api: openai-completions
        baseURL: http://127.0.0.1:${BRIDGE_PORT}/v1
        headers:
          Authorization: ${q("Bearer bridge-local")}
        models:
`;
  const body = models.map(renderModel).join("\n");
  return `${header}${body}
`;
}
function syncPatch(path, models) {
  try {
    const next = renderPatch(models);
    const prev = existsSync2(path) ? readFileSync2(path, "utf8") : "";
    if (prev === next) return { changed: false, path, models: models.length };
    writeFileSync2(path, next, "utf8");
    return { changed: true, path, models: models.length };
  } catch (e) {
    return { changed: false, path, models: models.length, error: String(e?.message ?? e) };
  }
}

// src/index.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync2, existsSync as existsSync3 } from "node:fs";
import { dirname as dirname2, join as join4 } from "node:path";
import { homedir as homedir4 } from "node:os";
import { fileURLToPath } from "node:url";
var name = "dsh-connect-madao";
var inject = [];
var PROVIDER = "madao";
function diag(line) {
  const dir = join4(homedir4(), ".dsh-connect-madao");
  try {
    mkdirSync2(dir, { recursive: true });
    appendFileSync2(join4(dir, "host.log"), `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`, "utf8");
  } catch {
  }
  try {
    console.log(`[dsh-connect-madao] ${line}`);
  } catch {
  }
}
function patchPath() {
  try {
    const here = dirname2(fileURLToPath(import.meta.url));
    const candidate = join4(here, "..", "cordis.patch.yml");
    if (existsSync3(candidate) || existsSync3(dirname2(candidate))) return candidate;
  } catch {
  }
  return join4(process.cwd(), "cordis.patch.yml");
}
function apply(ctx, config = {}) {
  diag(`apply() called; enabled=${config.enabled} port=${config.port ?? 8765}`);
  if (config.enabled === false) {
    diag("disabled, returning");
    return;
  }
  const port = config.port ?? 8765;
  let server;
  if (config.ak && config.sk) {
    process.env.MADAO_AK = config.ak;
    process.env.MADAO_SK = config.sk;
  }
  try {
    if (typeof ctx?.effect === "function") {
      ctx.effect(
        () => () => {
          void server?.close().catch(() => {
          });
          server = void 0;
          diag("disposed");
        },
        "dsh-connect-madao: local OpenAI bridge"
      );
      diag("ctx.effect registered");
    } else {
      diag("ctx.effect unavailable (no disposal hook)");
    }
  } catch (err) {
    diag(`ctx.effect threw: ${String(err)}`);
  }
  const syncModels = async () => {
    if (config.autoSyncModels === false) {
      diag("autoSyncModels disabled, keep patch as-is");
      return FALLBACK_MODELS;
    }
    try {
      const loaded = await loadCredentials();
      let creds = loaded.key;
      if (!creds.securityToken) {
        const sts = new StsProvider({ ak: creds.ak, sk: creds.sk });
        creds = await sts.credentials();
      }
      const client = new MadaoClient({ credentials: creds, gateway: config.gateway });
      const found = await discoverModels(client);
      const target = patchPath();
      const r = syncPatch(target, found.models);
      if (r.error) diag(`patch sync error: ${r.error}`);
      else if (r.changed) diag(`patch updated: ${r.models} models \u2192 ${r.path}\uFF08\u91CD\u542F DSH \u540E\u751F\u6548\uFF09`);
      else diag(`patch unchanged (${r.models} models, source=${found.source})`);
      return found.models;
    } catch (err) {
      diag(`model discovery skipped: ${String(err?.message ?? err)}`);
      return FALLBACK_MODELS;
    }
  };
  void (async () => {
    try {
      const models = await syncModels();
      let hint = "\u672A\u914D\u7F6E\uFF08\u8BF7\u6C42\u4F1A\u8FD4\u56DE 503\uFF09";
      try {
        await loadCredentials();
        hint = "\u5DF2\u89E3\u6790";
      } catch (err) {
        diag(`loadCredentials failed: ${String(err)}`);
      }
      server = await startServer({ port, host: "127.0.0.1", gateway: config.gateway, models });
      diag(`bridge ready at ${server.url}/v1 (models=${models.length}, credentials: ${hint})`);
    } catch (err) {
      diag(`bridge failed to start: ${String(err?.stack ?? err)}`);
    }
  })();
}
var meta = {
  PROVIDER,
  DEFAULT_CRED_PATH,
  models: FALLBACK_MODELS
};
export {
  PROVIDER,
  apply,
  inject,
  meta,
  name
};
