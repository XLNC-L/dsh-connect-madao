#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn2, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn2 && (res = (0, fn2[__getOwnPropNames(fn2)[0]])(fn2 = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/protocol/sign.ts
import { createHash, createHmac } from "node:crypto";
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
var SIGN_ALGO;
var init_sign = __esm({
  "src/protocol/sign.ts"() {
    SIGN_ALGO = "SDK-HMAC-SHA256";
  }
});

// src/protocol/sm4.ts
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
var SBOX, CK, FK;
var init_sm4 = __esm({
  "src/protocol/sm4.ts"() {
    SBOX = new Uint8Array([
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
    CK = new Uint32Array([
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
    FK = new Uint32Array([2746333894, 1453994832, 1736282519, 2993693404]);
  }
});

// src/protocol/crypto.ts
import { createECDH, createHash as createHash2, randomBytes } from "node:crypto";
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
var CURVE, SM4_ALGO, KEY_BYTES, IV_BYTES;
var init_crypto = __esm({
  "src/protocol/crypto.ts"() {
    init_sm4();
    CURVE = "prime256v1";
    SM4_ALGO = "sm4-gcm";
    KEY_BYTES = 16;
    IV_BYTES = 12;
  }
});

// src/client.ts
var client_exports = {};
__export(client_exports, {
  CHAT_PATH: () => CHAT_PATH,
  DEFAULT_GATEWAY: () => DEFAULT_GATEWAY,
  KEY_EXCHANGE_PATH: () => KEY_EXCHANGE_PATH,
  MODELS_PATH: () => MODELS_PATH,
  MadaoClient: () => MadaoClient,
  decryptSseStream: () => decryptSseStream
});
import { createHash as createHash3, randomUUID } from "node:crypto";
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
var DEFAULT_GATEWAY, CHAT_PATH, KEY_EXCHANGE_PATH, MODELS_PATH, REFRESH_MARGIN_MS, DEFAULT_IDENTITY, MadaoClient;
var init_client = __esm({
  "src/client.ts"() {
    init_sign();
    init_crypto();
    DEFAULT_GATEWAY = "https://snap-access.cn-north-4.myhuaweicloud.com";
    CHAT_PATH = "/api/v2/chat/completions";
    KEY_EXCHANGE_PATH = "/api/v1/security/key-exchange";
    MODELS_PATH = "/v1/model/builtin";
    REFRESH_MARGIN_MS = 3e5;
    DEFAULT_IDENTITY = {
      pluginName: "codemate_vscode",
      pluginVersion: "26.11.100",
      ideName: "VSCode",
      ideVersion: "26.11.100"
    };
    MadaoClient = class {
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
  }
});

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
var init_huawei_sign = __esm({
  "src/protocol/huawei-sign.ts"() {
  }
});

// src/sts.ts
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
var IAM_HOST, IAM_REQUEST_PATH, IAM_SIGN_PATH;
var init_sts = __esm({
  "src/sts.ts"() {
    init_huawei_sign();
    IAM_HOST = "iam.cn-north-4.myhuaweicloud.com";
    IAM_REQUEST_PATH = "/v3.0/OS-CREDENTIAL/securitytokens";
    IAM_SIGN_PATH = `${IAM_REQUEST_PATH}/`;
  }
});

// src/sts-provider.ts
var sts_provider_exports = {};
__export(sts_provider_exports, {
  StsProvider: () => StsProvider
});
var REFRESH_MARGIN_MS2, StsProvider;
var init_sts_provider = __esm({
  "src/sts-provider.ts"() {
    init_sts();
    REFRESH_MARGIN_MS2 = 10 * 60 * 1e3;
    StsProvider = class {
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
  }
});

// src/codearts-auth.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
var ANCHOR;
var init_codearts_auth = __esm({
  "src/codearts-auth.ts"() {
    ANCHOR = '"id":"huawei-cloud-authentication"';
  }
});

// src/credentials.ts
var credentials_exports = {};
__export(credentials_exports, {
  CredentialError: () => CredentialError,
  DEFAULT_CRED_PATH: () => DEFAULT_CRED_PATH,
  loadCredentials: () => loadCredentials,
  maskKey: () => maskKey
});
import { readFile } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function fromEnv() {
  const ak = process.env.MADAO_AK?.trim();
  const sk = process.env.MADAO_SK?.trim();
  if (!ak || !sk) return null;
  const token = process.env.MADAO_SECURITY_TOKEN?.trim();
  return { ak, sk, ...token ? { securityToken: token } : {} };
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
    throw new CredentialError(`credentials.json \u4E0D\u662F\u5408\u6CD5 JSON: ${path}`);
  }
  const ak = parsed.ak ?? parsed.accessKeyId ?? parsed.access_key_id ?? parsed["Access Key Id"];
  const sk = parsed.sk ?? parsed.secretAccessKey ?? parsed.secret_access_key ?? parsed["Secret Access Key"];
  const securityToken = parsed.securityToken ?? parsed.security_token ?? parsed.securitytoken ?? parsed.token;
  if (!ak || !sk) {
    throw new CredentialError(`credentials.json \u7F3A\u5C11 ak / sk\uFF08\u5F53\u524D ${path}\uFF09`);
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
async function loadCredentials(path = DEFAULT_CRED_PATH) {
  const env = fromEnv();
  if (env) return { key: env, source: "env" };
  const file = await fromFile(path);
  if (file) return { key: file, source: "file", path };
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
var DEFAULT_CRED_PATH, CredentialError;
var init_credentials = __esm({
  "src/credentials.ts"() {
    init_codearts_auth();
    DEFAULT_CRED_PATH = join2(homedir2(), ".dsh-connect-madao", "credentials.json");
    CredentialError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "CredentialError";
      }
    };
  }
});

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

// src/host-patch.ts
var host_patch_exports = {};
__export(host_patch_exports, {
  renderPatch: () => renderPatch,
  syncPatch: () => syncPatch
});
import { readFileSync as readFileSync2, writeFileSync, existsSync as existsSync2 } from "node:fs";
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
function displayName(m) {
  return m.ratio ? `${m.name} \xB7 ${m.ratio}` : m.name;
}
function renderModel(m) {
  const lines = [];
  lines.push(`          - id: ${q(m.id)}`);
  lines.push(`            name: ${q(displayName(m))}`);
  lines.push(`            contextWindow: ${m.context}`);
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
    writeFileSync(path, next, "utf8");
    return { changed: true, path, models: models.length };
  } catch (e) {
    return { changed: false, path, models: models.length, error: String(e?.message ?? e) };
  }
}
var BRIDGE_PORT;
var init_host_patch = __esm({
  "src/host-patch.ts"() {
    BRIDGE_PORT = 8765;
  }
});

// src/server.ts
init_client();
init_sts_provider();
import { createServer } from "node:http";

// src/protocol/body.ts
var DEFAULT_MAX_TOKENS = 65536;
function hasNonTextContent(messages) {
  for (const m of messages ?? []) {
    if (!Array.isArray(m?.content)) continue;
    for (const part of m.content) {
      if (part && typeof part.type === "string" && part.type !== "text") return true;
    }
  }
  return false;
}
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
  }
  return "";
}
function buildUpstreamBody(req, overrides = {}) {
  const messages = (req.messages ?? []).map((m) => ({
    role: m.role,
    content: flattenContent(m.content),
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
    ...typeof req.strength === "string" && req.strength ? { strength: req.strength } : {}
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

// src/server.ts
init_credentials();
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
async function startServer(opts = {}) {
  const port = opts.port ?? 8765;
  const host = opts.host ?? "127.0.0.1";
  const ctx = { client: null, sts: null, loaded: null, loadError: null, models: opts.models ?? FALLBACK_MODELS };
  try {
    const loaded = await loadCredentials(opts.credentialPath);
    ctx.loaded = loaded;
    if (loaded.key.securityToken) {
      ctx.client = new MadaoClient({
        credentials: {
          ak: loaded.key.ak,
          sk: loaded.key.sk,
          securityToken: loaded.key.securityToken
        },
        gateway: opts.gateway
      });
    } else {
      const sts = new StsProvider({ ak: loaded.key.ak, sk: loaded.key.sk });
      ctx.sts = sts;
      const creds = await sts.credentials();
      ctx.client = new MadaoClient({ credentials: creds, gateway: opts.gateway });
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
  if (req.method === "POST" && url.pathname === "/diag/test") {
    return json(res, 200, await runSelfTest(ctx));
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    return json(res, 200, {
      object: "list",
      data: ctx.models.map((m) => ({
        id: m.id,
        object: "model",
        owned_by: "huawei-codearts",
        name: m.name,
        context_window: m.context,
        max_output_tokens: m.maxOutput,
        ratio: m.ratio,
        supports_images: m.supportsImages,
        strengths: m.strengths,
        default_strength: m.defaultStrength
      }))
    });
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (!ctx.client) {
      return json(res, 503, { error: { message: ctx.loadError ?? "\u51ED\u8BC1\u672A\u52A0\u8F7D", type: "credentials_error" } });
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
function normalizeRequest(body, models) {
  const out = { ...body };
  const canonical = models.find((m) => m.id.toLowerCase() === String(body.model ?? "").toLowerCase());
  if (canonical) out.model = canonical.id;
  const effort = body.strength ?? body.reasoning_effort;
  if (typeof effort === "string" && effort) out.strength = effort;
  return out;
}
async function chatCompletion(res, client, rawBody, ctxModels) {
  if (hasNonTextContent(rawBody.messages)) {
    return json(res, 400, {
      error: {
        message: "\u7801\u9053\u6865\u63A5\u5F53\u524D\u53EA\u8F6C\u53D1\u6587\u672C\u8F93\u5165\uFF1A\u56FE\u7247\u7B49\u975E text \u5185\u5BB9\u5C1A\u672A\u652F\u6301\uFF08\u7801\u9053\u7684\u56FE\u7247\u6D88\u606F\u683C\u5F0F\u672A\u786E\u8BA4\uFF09\u3002\u8BF7\u79FB\u9664\u56FE\u7247\u6216\u6539\u7528\u7EAF\u6587\u672C\u3002",
        type: "unsupported_content"
      }
    });
  }
  const body = normalizeRequest(rawBody, ctxModels);
  const wantStream = body.stream !== false;
  const upstreamBody = buildUpstreamBody(body);
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const model = body.model;
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
    for await (const ev of events()) {
      if (ev.reasoning) reasoning += ev.reasoning;
      if (ev.text) text += ev.text;
      if (ev.finish) finish2 = ev.finish;
      if (ev.usage) usage2 = ev.usage;
    }
    markIdle();
    return json(res, 200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text, ...reasoning ? { reasoning_content: reasoning } : {} },
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
  try {
    for await (const ev of events()) {
      if (ev.reasoning) res.write(sseLine(makeChunk(id, model, { reasoning_content: ev.reasoning })));
      if (ev.text) res.write(sseLine(makeChunk(id, model, { content: ev.text })));
      if (ev.finish) finish = ev.finish;
      if (ev.usage) usage = ev.usage;
    }
  } catch (err) {
    res.write(sseLine({ error: { message: String(err?.message ?? err), type: "upstream_error" } }));
  }
  if (usage) {
    res.write(sseLine({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1e3), model, choices: [], usage }));
  }
  res.write(sseLine(makeChunk(id, model, {}, finish ?? "stop")));
  res.write(SSE_DONE);
  res.end();
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
function pickMetric(list, name) {
  return list.find((m) => m?.name === name);
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
  const step = async (name, fn2) => {
    const t0 = Date.now();
    try {
      const detail = await fn2();
      steps.push({ name, ok: true, detail: detail || void 0, ms: Date.now() - t0 });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, detail: String(e?.message ?? e).slice(0, 200), ms: Date.now() - t0 });
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

// src/bin.ts
init_credentials();
init_sts_provider();
init_client();
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
async function cmdServe() {
  const port = Number(arg("port", "8765"));
  const host = arg("host", "127.0.0.1");
  const gateway = arg("gateway");
  const srv = await startServer({ port, host, gateway });
  console.log(`dsh-connect-madao listening on ${srv.url}`);
  console.log(`  OpenAI base URL : ${srv.url}/v1`);
  console.log(`  health          : ${srv.url}/healthz`);
  const shutdown = async () => {
    await srv.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
async function cmdDoctor() {
  console.log("== dsh-connect-madao doctor ==\n");
  let loaded;
  try {
    loaded = await loadCredentials();
  } catch (err) {
    console.error("\u2717 \u51ED\u8BC1\u52A0\u8F7D\u5931\u8D25");
    console.error(String(err.message));
    process.exit(1);
  }
  const m = maskKey(loaded.key.ak, loaded.key.sk);
  console.log("\u2713 \u51ED\u8BC1\u5DF2\u52A0\u8F7D");
  console.log(`  \u6765\u6E90: ${loaded.source}${loaded.path ? ` (${loaded.path})` : ""}`);
  console.log(`  AK: ${m.ak}   SK: ${m.sk}`);
  console.log(`  STS: ${loaded.key.securityToken ? "\u5DF2\u76F4\u63A5\u63D0\u4F9B" : "\u5F85\u6362\u53D6"}
`);
  let creds;
  if (loaded.key.securityToken) {
    creds = { ak: loaded.key.ak, sk: loaded.key.sk, securityToken: loaded.key.securityToken };
    console.log("\u2713 \u4F7F\u7528\u5DF2\u63D0\u4F9B\u7684 STS\n");
  } else {
    console.log("== \u6362\u53D6 STS ==");
    try {
      const sts = new StsProvider({ ak: loaded.key.ak, sk: loaded.key.sk });
      creds = await sts.credentials();
      const exp = sts.expiresAtMs();
      console.log("\u2713 \u6210\u529F");
      console.log(`  \u4E34\u65F6 AK: ${creds.ak}`);
      console.log(`  STS \u957F\u5EA6: ${creds.securityToken.length}`);
      if (exp) console.log(`  \u8FC7\u671F: ${new Date(exp).toISOString()}`);
      console.log();
    } catch (err) {
      console.error("\u2717 \u5931\u8D25");
      console.error(String(err.message).slice(0, 600));
      process.exit(1);
    }
  }
  console.log("== \u5BC6\u94A5\u534F\u5546 ==");
  const client = new MadaoClient({ credentials: creds });
  try {
    const key = await client.ensureSessionKey();
    console.log("\u2713 \u6210\u529F");
    console.log(`  keyId: ${key.keyId}`);
    console.log(`  TTL: ${Math.round((key.expiresAt - Date.now()) / 1e3)}s
`);
  } catch (err) {
    console.error("\u2717 \u5931\u8D25");
    console.error(String(err.message).slice(0, 600));
    process.exit(1);
  }
  console.log("== \u6A21\u578B\u6E05\u5355 ==");
  try {
    const models = await client.getModels();
    const list = models?.builtinModels ?? [];
    console.log(`\u2713 ${list.length} \u4E2A\u6A21\u578B`);
    for (const it of list) console.log(`  - ${it.model_id}  (${it.model_category ?? ""})`);
  } catch (err) {
    console.warn("\u26A0 \u62C9\u53D6\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD chat\uFF09:", String(err.message).slice(0, 200));
  }
}
async function cmdModels() {
  const write = process.argv.includes("--write");
  const { loadCredentials: loadCredentials2 } = await Promise.resolve().then(() => (init_credentials(), credentials_exports));
  const { StsProvider: StsProvider2 } = await Promise.resolve().then(() => (init_sts_provider(), sts_provider_exports));
  const { MadaoClient: MadaoClient2 } = await Promise.resolve().then(() => (init_client(), client_exports));
  const { discoverModels: discoverModels2 } = await Promise.resolve().then(() => (init_models(), models_exports));
  const { syncPatch: syncPatch2 } = await Promise.resolve().then(() => (init_host_patch(), host_patch_exports));
  const { dirname, join: join3 } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  try {
    const loaded = await loadCredentials2();
    let creds = loaded.key;
    if (!creds.securityToken) creds = await new StsProvider2({ ak: creds.ak, sk: creds.sk }).credentials();
    const client = new MadaoClient2({ credentials: creds });
    const found = await discoverModels2(client);
    if (found.source === "fallback") {
      console.log(`\u7F51\u5173\u4E0D\u53EF\u8FBE\uFF0C\u4EE5\u4E0B\u4E3A\u515C\u5E95\u6E05\u5355\uFF1A${found.error ?? ""}`);
    }
    for (const m of found.models) {
      const tags = [m.supportsImages ? "\u{1F5BC}" : "", m.strengths.length ? `\u601D\u8003:${m.strengths.join("/")}` : ""].filter(Boolean).join(" ");
      console.log(
        `${m.id.padEnd(26)} ${m.name.padEnd(22)} ctx=${String(m.context).padEnd(8)} max=${String(m.maxOutput).padEnd(6)} ${(m.ratio ?? "-").padEnd(7)} ${tags}`
      );
    }
    if (write) {
      const here = dirname(fileURLToPath(import.meta.url));
      const target = join3(here, "..", "cordis.patch.yml");
      const r = syncPatch2(target, found.models);
      console.log(r.error ? `
\u5199\u56DE\u5931\u8D25\uFF1A${r.error}` : `
${r.changed ? "\u5DF2\u5199\u5165" : "\u65E0\u53D8\u5316"} \u2192 ${r.path}`);
    }
  } catch (e) {
    console.error(`\u8BFB\u53D6\u6A21\u578B\u6E05\u5355\u5931\u8D25\uFF1A${String(e?.message ?? e)}`);
    process.exitCode = 1;
  }
}
var cmd = process.argv[2] ?? "serve";
var table = {
  serve: cmdServe,
  doctor: cmdDoctor,
  models: cmdModels
};
var fn = table[cmd];
if (!fn) {
  console.error(`\u672A\u77E5\u5B50\u547D\u4EE4: ${cmd}
\u53EF\u7528: ${Object.keys(table).join(", ")}`);
  process.exit(2);
}
fn().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
