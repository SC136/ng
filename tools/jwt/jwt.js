// JWT logic: decoding, claim checks, and signing/verifying with Web Crypto. No DOM access.

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** Base64url-encodes bytes without padding. */
export function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url (standard Base64 and padding are tolerated). Throws on bad characters. */
export function base64UrlDecode(text) {
  const clean = String(text).replace(/\s+/g, '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new Error('not valid base64url');
  const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decodes standard Base64 (used for "secret is Base64"). */
function base64Decode(text, what) {
  try {
    return base64UrlDecode(text);
  } catch {
    throw new Error(`The ${what} isn't valid Base64.`);
  }
}

const SEGMENT_NAMES = ['header', 'payload', 'signature'];

/**
 * Splits and decodes a compact JWT. A leading "Bearer " is ignored.
 * Returns { token, parts, header, payload, headerJson, payloadJson, signature, signingInput }.
 * Throws an Error that says which part is broken.
 */
export function decodeJwt(input) {
  const token = String(input).trim().replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  if (!token) throw new Error('Paste a token to decode it.');
  const parts = token.split('.');
  if (parts.length === 5) throw new Error('This has five parts, so it is an encrypted token (JWE). It can only be read with the decryption key.');
  if (parts.length !== 3) {
    throw new Error(`A JWT has three parts separated by dots. This has ${parts.length}.`);
  }
  const json = (index) => {
    const name = SEGMENT_NAMES[index];
    let text;
    try {
      text = strictUtf8.decode(base64UrlDecode(parts[index]));
    } catch {
      throw new Error(`The ${name} isn't valid base64url text.`);
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`The ${name} decodes, but not to valid JSON.`);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${name} must be a JSON object.`);
    return value;
  };
  const header = json(0);
  const payload = json(1);
  let signature;
  try {
    signature = base64UrlDecode(parts[2]);
  } catch {
    throw new Error('The signature isn\'t valid base64url.');
  }
  return {
    token, parts, header, payload, signature,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "in 3 hours", "5 minutes ago", for a difference in seconds (positive = future). */
export function relativeTime(seconds) {
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size || unit === 'second') return rtf.format(Math.round(seconds / size), unit);
  }
  return '';
}

const CLAIMS = [
  ['iss', 'Issuer'],
  ['sub', 'Subject'],
  ['aud', 'Audience'],
  ['exp', 'Expires'],
  ['nbf', 'Not before'],
  ['iat', 'Issued at'],
  ['jti', 'Token ID'],
];
const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

/**
 * The registered claims present in a payload, as rows for a table:
 * [{ claim, label, value, date?, relative?, problem? }]. now is in milliseconds.
 */
export function claimRows(payload, now = Date.now(), formatDate = (d) => d.toLocaleString()) {
  const rows = [];
  for (const [claim, label] of CLAIMS) {
    if (!(claim in payload)) continue;
    const raw = payload[claim];
    const row = { claim, label, value: Array.isArray(raw) ? raw.join(', ') : typeof raw === 'object' ? JSON.stringify(raw) : String(raw) };
    if (TIME_CLAIMS.has(claim)) {
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        const date = new Date(raw * 1000);
        if (Number.isNaN(date.getTime())) {
          row.problem = 'Out of range';
        } else {
          row.date = formatDate(date);
          row.relative = relativeTime(raw - now / 1000);
          if (raw > 1e11) row.problem = 'Looks like milliseconds; JWT times are in seconds';
        }
      } else {
        row.problem = 'Should be a number of seconds since 1970';
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Checks exp and nbf against now (milliseconds).
 * Returns { state: 'valid'|'expired'|'not-yet-valid'|'no-expiry', label }.
 */
export function timeStatus(payload, now = Date.now(), leeway = 0) {
  const t = now / 1000;
  if (typeof payload.exp === 'number' && t >= payload.exp + leeway) return { state: 'expired', label: 'Expired' };
  if (typeof payload.nbf === 'number' && t < payload.nbf - leeway) return { state: 'not-yet-valid', label: 'Not yet valid' };
  if (typeof payload.exp !== 'number') return { state: 'no-expiry', label: 'Valid, never expires' };
  return { state: 'valid', label: 'Valid' };
}

const HASH = { 256: 'SHA-256', 384: 'SHA-384', 512: 'SHA-512' };
const CURVES = { 256: 'P-256', 384: 'P-384', 512: 'P-521' };

/**
 * Web Crypto parameters for a JWS alg: { family: 'hmac'|'rsa'|'ec'|'ed', importParams, signParams }.
 * Throws for unknown algs.
 */
export function algParams(alg) {
  const match = /^(HS|RS|PS|ES)(256|384|512)$/.exec(String(alg));
  if (match) {
    const [, kind, bits] = match;
    const hash = HASH[bits];
    if (kind === 'HS') return { family: 'hmac', importParams: { name: 'HMAC', hash }, signParams: { name: 'HMAC' } };
    if (kind === 'RS') return { family: 'rsa', importParams: { name: 'RSASSA-PKCS1-v1_5', hash }, signParams: { name: 'RSASSA-PKCS1-v1_5' } };
    if (kind === 'PS') return { family: 'rsa', importParams: { name: 'RSA-PSS', hash }, signParams: { name: 'RSA-PSS', saltLength: Number(bits) / 8 } };
    return { family: 'ec', importParams: { name: 'ECDSA', namedCurve: CURVES[bits] }, signParams: { name: 'ECDSA', hash } };
  }
  if (alg === 'EdDSA' || alg === 'Ed25519') return { family: 'ed', importParams: { name: 'Ed25519' }, signParams: { name: 'Ed25519' } };
  if (alg === 'none') throw new Error('alg is "none": this token has no signature, so anyone could have made it.');
  throw new Error(`The alg "${alg}" isn't supported here.`);
}

/** Turns a secret string into key bytes, decoding Base64 when asked. */
export function secretBytes(secret, isBase64 = false) {
  return isBase64 ? base64Decode(secret, 'secret') : encoder.encode(secret);
}

/** Converts a PEM block to DER bytes and reports its label. */
export function pemToDer(pem) {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!match) throw new Error('The key isn\'t a complete PEM block. It should start with -----BEGIN PUBLIC KEY-----.');
  try {
    return { label: match[1], der: base64UrlDecode(match[2].replace(/\s+/g, '')) };
  } catch {
    throw new Error('The PEM block isn\'t valid Base64 inside.');
  }
}

const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

/**
 * Imports a public key for verifying with the given alg. Accepts PEM (SPKI, "PUBLIC KEY"),
 * a JWK, or a JWK set ({ keys: [...] }, picked by kid). Private JWKs are reduced to their public part.
 */
export async function importPublicKey(text, alg, kid) {
  const { family, importParams } = algParams(alg);
  if (family === 'hmac') throw new Error('HMAC tokens are verified with a secret, not a public key.');
  const str = String(text).trim();
  if (!str) throw new Error('Paste the public key as PEM or JWK to verify the signature.');
  try {
    if (str.startsWith('{')) {
      let jwk;
      try {
        jwk = JSON.parse(str);
      } catch {
        throw new Error('The key looks like JSON but doesn\'t parse.');
      }
      if (Array.isArray(jwk.keys)) {
        const pick = jwk.keys.find((key) => kid && key.kid === kid) || (jwk.keys.length === 1 ? jwk.keys[0] : null);
        if (!pick) throw new Error(kid ? `No key in this set has kid "${kid}".` : 'This key set has several keys and the token has no kid. Paste just one key.');
        jwk = pick;
      }
      const pub = { ...jwk };
      for (const field of PRIVATE_JWK_FIELDS) delete pub[field];
      delete pub.key_ops;
      delete pub.alg;
      pub.ext = true;
      return await crypto.subtle.importKey('jwk', pub, importParams, true, ['verify']);
    }
    const { label, der } = pemToDer(str);
    if (label === 'RSA PUBLIC KEY') throw new Error('This is a PKCS#1 RSA key. Convert it to SPKI ("BEGIN PUBLIC KEY"), for example with openssl rsa -RSAPublicKey_in -pubout.');
    if (label === 'CERTIFICATE') throw new Error('This is a certificate. Paste its public key instead (openssl x509 -pubkey -noout).');
    if (/PRIVATE/.test(label)) throw new Error('This is a private key. Paste the public key instead.');
    if (label !== 'PUBLIC KEY') throw new Error(`A "${label}" block isn't a public key.`);
    return await crypto.subtle.importKey('spki', der, importParams, true, ['verify']);
  } catch (error) {
    if (family === 'ed' && error?.name === 'NotSupportedError') throw new Error('This browser can\'t verify EdDSA (Ed25519) signatures.');
    if (error instanceof Error && !(error.name === 'DataError' || error.name === 'NotSupportedError' || error.name === 'SyntaxError' || error.name === 'TypeError')) throw error;
    throw new Error(`This key can't be used for ${alg}. Check that the key type matches the token's alg.`);
  }
}

/**
 * Verifies a token's signature. key: { secret, secretIsBase64 } for HS*, { publicKey } (PEM or JWK text) otherwise.
 * Resolves to { ok, alg, message }. Never throws for bad input; problems come back as ok: false.
 */
export async function verifyJwt(token, key = {}) {
  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch (error) {
    return { ok: false, alg: null, message: error.message };
  }
  const alg = decoded.header.alg;
  try {
    const params = algParams(alg);
    const data = encoder.encode(decoded.signingInput);
    let cryptoKey;
    if (params.family === 'hmac') {
      if (!key.secret) return { ok: false, alg, message: 'Enter the secret to verify the signature.' };
      cryptoKey = await crypto.subtle.importKey('raw', secretBytes(key.secret, key.secretIsBase64), params.importParams, false, ['verify']);
    } else {
      cryptoKey = await importPublicKey(key.publicKey || '', alg, decoded.header.kid);
    }
    let ok;
    try {
      ok = await crypto.subtle.verify(params.signParams, cryptoKey, decoded.signature, data);
    } catch (error) {
      if (params.family === 'ed') throw new Error('This browser can\'t verify EdDSA (Ed25519) signatures.');
      throw error;
    }
    return ok
      ? { ok: true, alg, message: `Signature verified (${alg}).` }
      : { ok: false, alg, message: params.family === 'hmac' ? 'Invalid signature. The secret is wrong or the token was changed.' : 'Invalid signature. The key is wrong or the token was changed.' };
  } catch (error) {
    return { ok: false, alg, message: error.message };
  }
}

/**
 * Signs a new HS256/384/512 token. header and payload are JSON text or objects; the header's alg
 * is set to `alg` (typ defaults to "JWT"). Resolves to the compact token.
 */
export async function signJwt(header, payload, secret, { alg = 'HS256', secretIsBase64 = false } = {}) {
  if (!/^HS(256|384|512)$/.test(alg)) throw new Error('Signing here supports HS256, HS384 and HS512.');
  const parse = (value, what) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`The ${what} isn't valid JSON: ${error.message}`);
    }
  };
  const head = parse(header || '{}', 'header');
  const body = parse(payload, 'payload');
  for (const [value, what] of [[head, 'header'], [body, 'payload']]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${what} must be a JSON object.`);
  }
  if (!secret) throw new Error('Enter a secret to sign with.');
  const fullHeader = { alg, typ: 'JWT', ...head, alg };
  const input = `${base64UrlEncode(encoder.encode(JSON.stringify(fullHeader)))}.${base64UrlEncode(encoder.encode(JSON.stringify(body)))}`;
  const { importParams, signParams } = algParams(alg);
  const key = await crypto.subtle.importKey('raw', secretBytes(secret, secretIsBase64), importParams, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign(signParams, key, encoder.encode(input)));
  return `${input}.${base64UrlEncode(signature)}`;
}

/** Wraps DER bytes as PEM with the given label. */
export function derToPem(der, label = 'PUBLIC KEY') {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
}
