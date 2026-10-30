import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  algParams, base64UrlDecode, base64UrlEncode, claimRows, decodeJwt, derToPem, relativeTime, signJwt, timeStatus, verifyJwt,
} from '../tools/jwt/jwt.js';

const JWT_IO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const encoder = new TextEncoder();
const b64u = (value) => base64UrlEncode(encoder.encode(JSON.stringify(value)));

test('decodes the jwt.io example', () => {
  const decoded = decodeJwt(JWT_IO);
  assert.deepEqual(decoded.header, { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(decoded.payload, { sub: '1234567890', name: 'John Doe', iat: 1516239022 });
  assert.equal(decoded.signature.length, 32);
  assert.equal(decoded.payloadJson, '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}');
  assert.equal(decodeJwt(`Bearer ${JWT_IO}\n`).token, JWT_IO);
});

test('the jwt.io example verifies with its secret, and fails with another', async () => {
  const good = await verifyJwt(JWT_IO, { secret: 'your-256-bit-secret' });
  assert.equal(good.ok, true);
  assert.equal(good.alg, 'HS256');
  const bad = await verifyJwt(JWT_IO, { secret: 'wrong' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Invalid signature/);
  assert.match((await verifyJwt(JWT_IO, {})).message, /Enter the secret/);
});

test('a changed payload no longer verifies', async () => {
  const [h, , s] = JWT_IO.split('.');
  const forged = `${h}.${b64u({ sub: '1234567890', name: 'Jane Doe', iat: 1516239022 })}.${s}`;
  assert.equal((await verifyJwt(forged, { secret: 'your-256-bit-secret' })).ok, false);
});

test('signs HS256/384/512 tokens that verify, with text or Base64 secrets', async () => {
  const token256 = await signJwt('{"alg":"HS256","typ":"JWT"}', '{"sub":"1234567890","name":"John Doe","iat":1516239022}', 'your-256-bit-secret');
  assert.equal(token256, JWT_IO);
  for (const alg of ['HS384', 'HS512']) {
    const token = await signJwt('{}', { sub: 'x' }, 'shh', { alg });
    assert.deepEqual(decodeJwt(token).header, { alg, typ: 'JWT' });
    assert.equal(decodeJwt(token).signature.length, Number(alg.slice(2)) / 8);
    assert.equal((await verifyJwt(token, { secret: 'shh' })).ok, true);
  }
  const secret = base64UrlEncode(Uint8Array.from([0, 255, 1, 254, 2]));
  const token = await signJwt('{}', '{"a":1}', secret, { secretIsBase64: true });
  assert.equal((await verifyJwt(token, { secret, secretIsBase64: true })).ok, true);
  assert.equal((await verifyJwt(token, { secret })).ok, false);
});

test('signing rejects bad input', async () => {
  await assert.rejects(signJwt('{', '{}', 's'), /header isn't valid JSON/);
  await assert.rejects(signJwt('{}', '[1]', 's'), /payload must be a JSON object/);
  await assert.rejects(signJwt('{}', '{}', ''), /Enter a secret/);
  await assert.rejects(signJwt('{}', '{}', 's', { alg: 'RS256' }), /supports HS256/);
  await assert.rejects(signJwt('{}', '{}', '***', { secretIsBase64: true }), /isn't valid Base64/);
});

async function asymmetricRoundTrip(alg, generateParams) {
  const params = algParams(alg);
  const pair = await crypto.subtle.generateKey(generateParams, true, ['sign', 'verify']);
  const input = `${b64u({ alg, typ: 'JWT', kid: 'k1' })}.${b64u({ sub: 'user', iat: 1700000000 })}`;
  const signature = new Uint8Array(await crypto.subtle.sign(params.signParams, pair.privateKey, encoder.encode(input)));
  const token = `${input}.${base64UrlEncode(signature)}`;
  const pem = derToPem(await crypto.subtle.exportKey('spki', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const result = await verifyJwt(token, { publicKey: pem });
  assert.equal(result.ok, true, `${alg} PEM: ${result.message}`);
  assert.equal((await verifyJwt(token, { publicKey: JSON.stringify(jwk) })).ok, true, `${alg} JWK`);
  assert.equal((await verifyJwt(token, { publicKey: JSON.stringify(privateJwk) })).ok, true, `${alg} private JWK`);
  const set = { keys: [{ ...jwk, kid: 'other' }, { ...jwk, kid: 'k1' }] };
  assert.equal((await verifyJwt(token, { publicKey: JSON.stringify(set) })).ok, true, `${alg} JWKS`);
  const other = await crypto.subtle.generateKey(generateParams, true, ['sign', 'verify']);
  const otherPem = derToPem(await crypto.subtle.exportKey('spki', other.publicKey));
  const wrong = await verifyJwt(token, { publicKey: otherPem });
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /Invalid signature/);
}

const rsa = (name, hash) => ({ name, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash });

test('RS256/384/512 verify with PEM, JWK and JWK sets', async () => {
  await asymmetricRoundTrip('RS256', rsa('RSASSA-PKCS1-v1_5', 'SHA-256'));
  await asymmetricRoundTrip('RS384', rsa('RSASSA-PKCS1-v1_5', 'SHA-384'));
  await asymmetricRoundTrip('RS512', rsa('RSASSA-PKCS1-v1_5', 'SHA-512'));
});

test('PS256/384/512 verify', async () => {
  await asymmetricRoundTrip('PS256', rsa('RSA-PSS', 'SHA-256'));
  await asymmetricRoundTrip('PS384', rsa('RSA-PSS', 'SHA-384'));
  await asymmetricRoundTrip('PS512', rsa('RSA-PSS', 'SHA-512'));
});

test('ES256/384/512 verify', async () => {
  await asymmetricRoundTrip('ES256', { name: 'ECDSA', namedCurve: 'P-256' });
  await asymmetricRoundTrip('ES384', { name: 'ECDSA', namedCurve: 'P-384' });
  await asymmetricRoundTrip('ES512', { name: 'ECDSA', namedCurve: 'P-521' });
});

test('EdDSA verifies where the runtime supports Ed25519', async (t) => {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  } catch {
    t.skip('Ed25519 not supported here');
    return;
  }
  await asymmetricRoundTrip('EdDSA', { name: 'Ed25519' });
});

test('key problems come back as messages', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pem = derToPem(await crypto.subtle.exportKey('spki', pair.publicKey));
  const rsToken = `${b64u({ alg: 'RS256' })}.${b64u({})}.AAAA`;
  assert.match((await verifyJwt(rsToken, { publicKey: pem })).message, /can't be used for RS256/);
  assert.match((await verifyJwt(rsToken, {})).message, /Paste the public key/);
  assert.match((await verifyJwt(rsToken, { publicKey: 'nonsense' })).message, /complete PEM block/);
  assert.match((await verifyJwt(rsToken, { publicKey: '{"kty":' })).message, /doesn't parse/);
  assert.match((await verifyJwt(rsToken, { publicKey: pem.replace(/PUBLIC KEY/g, 'RSA PUBLIC KEY') })).message, /PKCS#1/);
  assert.match((await verifyJwt(rsToken, { publicKey: pem.replace(/PUBLIC KEY/g, 'PRIVATE KEY') })).message, /private key/);
  assert.match((await verifyJwt(rsToken, { publicKey: pem.replace(/PUBLIC KEY/g, 'CERTIFICATE') })).message, /certificate/);
  assert.match((await verifyJwt(rsToken, { publicKey: '{"keys":[{"kid":"a"},{"kid":"b"}]}' })).message, /no kid/);
});

test('alg none and unknown algs are flagged', async () => {
  const none = `${b64u({ alg: 'none' })}.${b64u({ sub: 'x' })}.`;
  const result = await verifyJwt(none, { secret: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.message, /alg is "none"/);
  assert.equal(decodeJwt(none).signature.length, 0);
  assert.match((await verifyJwt(`${b64u({ alg: 'XS1' })}.${b64u({})}.`, {})).message, /isn't supported/);
});

test('malformed tokens explain what is wrong', () => {
  assert.throws(() => decodeJwt('abc.def'), /three parts.*has 2/);
  assert.throws(() => decodeJwt('a.b.c.d.e'), /encrypted token/);
  assert.throws(() => decodeJwt(''), /Paste a token/);
  assert.throws(() => decodeJwt('!!!.e30.'), /header isn't valid base64url/);
  assert.throws(() => decodeJwt(`${base64UrlEncode(encoder.encode('{nope'))}.e30.`), /header decodes, but not to valid JSON/);
  assert.throws(() => decodeJwt(`e30.${base64UrlEncode(encoder.encode('[1]'))}.`), /payload must be a JSON object/);
  assert.throws(() => decodeJwt('e30.e30.a'), /signature isn't valid/);
});

test('base64url round trip', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 255);
  assert.deepEqual(base64UrlDecode(base64UrlEncode(bytes)), bytes);
  assert.equal(base64UrlEncode(Uint8Array.from([0xfb, 0xff])), '-_8');
});

test('claims table rows with dates and relative times', () => {
  const now = Date.UTC(2024, 0, 1);
  const t = now / 1000;
  const rows = claimRows({ iss: 'me', aud: ['a', 'b'], exp: t + 7200, nbf: t - 60, iat: t - 86400 * 3, jti: 'id-1', name: 'skip' }, now, (d) => d.toISOString());
  assert.deepEqual(rows.map((r) => r.claim), ['iss', 'aud', 'exp', 'nbf', 'iat', 'jti']);
  assert.equal(rows[1].value, 'a, b');
  assert.equal(rows[2].date, '2024-01-01T02:00:00.000Z');
  assert.equal(rows[2].relative, 'in 2 hours');
  assert.equal(rows[3].relative, '1 minute ago');
  assert.equal(rows[4].relative, '3 days ago');
  assert.match(claimRows({ exp: 'soon' }, now)[0].problem, /number of seconds/);
  assert.match(claimRows({ exp: now }, now)[0].problem, /milliseconds/);
});

test('time status: expired, not yet valid, valid', () => {
  const now = 1_700_000_000_000;
  const t = now / 1000;
  assert.equal(timeStatus({ exp: t - 1 }, now).state, 'expired');
  assert.equal(timeStatus({ exp: t }, now).state, 'expired');
  assert.equal(timeStatus({ exp: t + 10, nbf: t + 5 }, now).state, 'not-yet-valid');
  assert.equal(timeStatus({ exp: t + 10, nbf: t - 5 }, now).state, 'valid');
  assert.equal(timeStatus({}, now).state, 'no-expiry');
  assert.equal(relativeTime(0), 'now');
});
