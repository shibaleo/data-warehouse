// Clerk JWT verification for GAS Web App (doPost) — see docs/006.
//
// Why pure-JS RSA: Apps Script's Utilities.computeRsaSha256Signature only signs.
// There is no built-in verify, so we implement RSASSA-PKCS1-v1_5 (RS256) using
// V8 BigInt for the modular exponentiation. Bounded cost — modPow runs once per
// request and Clerk JWTs are short-lived, so no batching concerns.

interface JwksKey {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
  use?: string;
}

interface JwksResponse {
  keys: JwksKey[];
}

interface ClerkJwtClaims {
  sub: string;
  iss: string;
  aud?: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  [k: string]: unknown;
}

const JWKS_CACHE_KEY = 'clerk_jwks_v1';
const JWKS_CACHE_TTL_SEC = 3600;
const CLOCK_SKEW_SEC = 30;

// DER prefix for SHA-256 inside PKCS#1 v1.5 EMSA encoding (RFC 8017 §9.2).
const SHA256_DIGEST_INFO_PREFIX: number[] = [
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01,
  0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
];

function base64UrlToBytes(s: string): number[] {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4;
  if (pad === 2) b += '==';
  else if (pad === 3) b += '=';
  else if (pad === 1) throw new Error('invalid base64url');
  const signed = Utilities.base64Decode(b);
  const out: number[] = new Array(signed.length);
  for (let i = 0; i < signed.length; i++) out[i] = signed[i] & 0xff;
  return out;
}

function base64UrlToString(s: string): string {
  const bytes = base64UrlToBytes(s);
  const signed: number[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    signed[i] = bytes[i] > 127 ? bytes[i] - 256 : bytes[i];
  }
  return Utilities.newBlob(signed).getDataAsString('UTF-8');
}

function stringToUtf8Bytes(s: string): number[] {
  const signed = Utilities.newBlob(s).getBytes();
  const out: number[] = new Array(signed.length);
  for (let i = 0; i < signed.length; i++) out[i] = signed[i] & 0xff;
  return out;
}

// clasp の ts2gas が BigInt リテラル (0n / 8n 等) を strip して syntax error にする
// ので、GAS V8 runtime には BigInt() コール経由で渡す。値は同じ。
const BI0 = BigInt(0);
const BI1 = BigInt(1);
const BI8 = BigInt(8);
const BI_FF = BigInt(0xff);

function bytesToBigInt(bytes: number[]): bigint {
  let v = BI0;
  for (let i = 0; i < bytes.length; i++) {
    v = (v << BI8) | BigInt(bytes[i]);
  }
  return v;
}

function bigIntToBytes(v: bigint, length: number): number[] {
  const out: number[] = new Array(length).fill(0);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & BI_FF);
    v >>= BI8;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BI1;
  base = base % mod;
  while (exp > BI0) {
    if (exp & BI1) result = (result * base) % mod;
    exp >>= BI1;
    base = (base * base) % mod;
  }
  return result;
}

function sha256(messageBytesUnsigned: number[]): number[] {
  const signed: number[] = new Array(messageBytesUnsigned.length);
  for (let i = 0; i < messageBytesUnsigned.length; i++) {
    const b = messageBytesUnsigned[i];
    signed[i] = b > 127 ? b - 256 : b;
  }
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signed);
  const out: number[] = new Array(digest.length);
  for (let i = 0; i < digest.length; i++) out[i] = digest[i] & 0xff;
  return out;
}

function rsaVerifySha256(
  messageBytes: number[],
  sigBytes: number[],
  nB64u: string,
  eB64u: string,
): boolean {
  const n = bytesToBigInt(base64UrlToBytes(nB64u));
  const e = bytesToBigInt(base64UrlToBytes(eB64u));
  const sig = bytesToBigInt(sigBytes);
  if (sig >= n) return false;

  const modLen = Math.ceil(n.toString(2).length / 8);
  const em = bigIntToBytes(modPow(sig, e, n), modLen);

  const t = SHA256_DIGEST_INFO_PREFIX.concat(sha256(messageBytes));
  const tLen = t.length;
  if (modLen < tLen + 11) return false;
  if (em[0] !== 0x00 || em[1] !== 0x01) return false;

  const psLen = modLen - 3 - tLen;
  for (let i = 0; i < psLen; i++) {
    if (em[2 + i] !== 0xff) return false;
  }
  if (em[2 + psLen] !== 0x00) return false;
  for (let i = 0; i < tLen; i++) {
    if (em[3 + psLen + i] !== t[i]) return false;
  }
  return true;
}

function fetchJwks(force: boolean): JwksResponse {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const cached = cache.get(JWKS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as JwksResponse;
  }
  const url = PropertiesService.getScriptProperties().getProperty('CLERK_JWKS_URL');
  if (!url) throw new Error('CLERK_JWKS_URL not set');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: false });
  const body = res.getContentText();
  cache.put(JWKS_CACHE_KEY, body, JWKS_CACHE_TTL_SEC);
  return JSON.parse(body) as JwksResponse;
}

/**
 * Verify a Clerk-issued JWT. Returns parsed claims on success, throws on failure.
 * Busts the JWKS cache and retries once on signature mismatch / unknown kid
 * to absorb Clerk key rotations between requests.
 */
function verifyClerkJwt(token: string): ClerkJwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('jwt: malformed');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(base64UrlToString(headerB64)) as { alg: string; kid: string };
  if (header.alg !== 'RS256') throw new Error(`jwt: unsupported alg ${header.alg}`);
  if (!header.kid) throw new Error('jwt: missing kid');

  const claims = JSON.parse(base64UrlToString(payloadB64)) as ClerkJwtClaims;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC < now) {
    throw new Error('jwt: expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SEC > now) {
    throw new Error('jwt: not yet valid');
  }

  const props = PropertiesService.getScriptProperties();
  const expectedIss = props.getProperty('CLERK_ISSUER');
  if (expectedIss && claims.iss !== expectedIss) {
    throw new Error(`jwt: bad iss ${claims.iss}`);
  }
  const expectedAud = props.getProperty('CLERK_AUDIENCE');
  if (expectedAud) {
    const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!auds.includes(expectedAud)) throw new Error('jwt: bad aud');
  }

  const signingInput = stringToUtf8Bytes(`${headerB64}.${payloadB64}`);
  const sigBytes = base64UrlToBytes(sigB64);

  for (const force of [false, true]) {
    const jwks = fetchJwks(force);
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key) {
      if (force) throw new Error('jwt: kid not in JWKS');
      continue;
    }
    if (key.kty !== 'RSA') throw new Error(`jwt: unsupported kty ${key.kty}`);
    if (rsaVerifySha256(signingInput, sigBytes, key.n, key.e)) return claims;
    if (force) throw new Error('jwt: bad signature');
  }
  throw new Error('jwt: verification failed');
}
