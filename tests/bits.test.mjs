import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bitsOf, bitsToFloat, bytesOf, decodeFloat, describeFloat, describeFloatBits, exactDecimal, floatClassLabel, floatToBits,
  groupDigits, isExactlyStored, leadingZeros, normalizeDecimal, parseFloatHex, parseFloatInput, parseInteger, popcount, shortestFloat32, smallestWidth,
  toBase, toggleBit, trailingZeros, twosComplement,
} from '../tools/bits/bits.js';

test('auto base reads 0x, 0b, 0o prefixes and decimal', () => {
  assert.deepEqual(parseInteger('0xff'), { value: 255n, base: 16 });
  assert.deepEqual(parseInteger('0B1010'), { value: 10n, base: 2 });
  assert.deepEqual(parseInteger('0o17'), { value: 15n, base: 8 });
  assert.deepEqual(parseInteger('1234'), { value: 1234n, base: 10 });
  assert.deepEqual(parseInteger('-0x10'), { value: -16n, base: 16 });
  assert.deepEqual(parseInteger('+42'), { value: 42n, base: 10 });
  assert.deepEqual(parseInteger('1_000_000'), { value: 1000000n, base: 10 });
  assert.deepEqual(parseInteger('0b1111 0000'), { value: 240n, base: 2 });
});

test('explicit and custom bases', () => {
  assert.equal(parseInteger('ff', 16).value, 255n);
  assert.equal(parseInteger('0xff', 16).value, 255n);
  assert.equal(parseInteger('777', 8).value, 511n);
  assert.equal(parseInteger('zz', 36).value, 1295n);
  assert.equal(parseInteger('-122', 3).value, -17n);
  // "0b" is not a prefix in base 16: it is the digits 0 and b.
  assert.equal(parseInteger('0b1', 16).value, 0xb1n);
});

test('BigInt keeps precision far past 2^53', () => {
  assert.equal(parseInteger('18446744073709551615').value, 2n ** 64n - 1n);
  assert.equal(parseInteger('0x' + 'f'.repeat(32)).value, 2n ** 128n - 1n);
  assert.equal(toBase(2n ** 64n, 16), '10000000000000000');
});

test('parse errors say what is wrong', () => {
  assert.throws(() => parseInteger(''), /Enter a number/);
  assert.throws(() => parseInteger('-'), /no digits/);
  assert.throws(() => parseInteger('0x'), /no digits/);
  assert.throws(() => parseInteger('12a'), /"a" isn't a decimal digit\. For hex/);
  assert.throws(() => parseInteger('102', 2), /"2" isn't a binary digit/);
  assert.throws(() => parseInteger('9', 7), /"9" isn't a base 7 digit/);
  assert.throws(() => parseInteger('1', 37), /from 2 to 36/);
  assert.throws(() => parseInteger('1'.repeat(5000)), /too long/);
});

test('base output and digit grouping', () => {
  assert.equal(toBase(255n, 2), '11111111');
  assert.equal(toBase(-255n, 16), '-ff');
  assert.equal(groupDigits('11110000', 4), '1111 0000');
  assert.equal(groupDigits('101', 4), '101');
  assert.equal(groupDigits('1010101', 4), '101 0101');
  assert.equal(groupDigits('-1234567', 3, ','), '-1,234,567');
  assert.equal(groupDigits('0', 4), '0');
});

test("two's complement: -1 at 8 bits is 0xFF", () => {
  const t = twosComplement(-1n, 8);
  assert.equal(t.pattern, 0xffn);
  assert.equal(t.unsigned, 255n);
  assert.equal(t.signed, -1n);
  assert.equal(t.fits, true);
  assert.equal(twosComplement(-128n, 8).pattern, 0x80n);
  assert.equal(twosComplement(200n, 8).signed, -56n);
  assert.equal(twosComplement(-1n, 128).pattern, 2n ** 128n - 1n);
});

test('overflow detection', () => {
  assert.equal(twosComplement(255n, 8).fits, true);
  assert.equal(twosComplement(255n, 8).fitsSigned, false);
  assert.equal(twosComplement(256n, 8).fits, false);
  assert.equal(twosComplement(256n, 8).pattern, 0n);
  assert.equal(twosComplement(-128n, 8).fits, true);
  assert.equal(twosComplement(-129n, 8).fits, false);
  assert.equal(twosComplement(-129n, 8).signed, 127n);
  assert.equal(twosComplement(2n ** 64n, 64).fits, false);
  assert.equal(smallestWidth(255n), 8);
  assert.equal(smallestWidth(-129n), 16);
  assert.equal(smallestWidth(2n ** 64n), 128);
  assert.equal(smallestWidth(2n ** 128n), null);
});

test('bit grid, toggling, bytes and endianness', () => {
  assert.deepEqual(bitsOf(0b10010110n, 8), [1, 0, 0, 1, 0, 1, 1, 0]);
  assert.equal(toggleBit(0n, 7, 8), 0x80n);
  assert.equal(toggleBit(0xffn, 0, 8), 0xfen);
  assert.deepEqual(bytesOf(0x12345678n, 32), [0x12, 0x34, 0x56, 0x78]);
  assert.deepEqual(bytesOf(0x12345678n, 32).reverse(), [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual(bytesOf(0xabn, 16), [0x00, 0xab]);
});

test('popcount and leading/trailing zeros', () => {
  assert.equal(popcount(0n), 0);
  assert.equal(popcount(0xffn), 8);
  assert.equal(popcount(2n ** 128n - 1n), 128);
  assert.equal(leadingZeros(1n, 32), 31);
  assert.equal(leadingZeros(0n, 16), 16);
  assert.equal(leadingZeros(0x80n, 8), 0);
  assert.equal(trailingZeros(8n, 8), 3);
  assert.equal(trailingZeros(0n, 64), 64);
});

test('float32(0.1) is 0x3DCCCCCD', () => {
  assert.equal(floatToBits(0.1, 'f32'), 0x3dcccccdn);
  const d = describeFloat(0.1, 'f32');
  assert.equal(d.hex, '3dcccccd');
  assert.equal(d.signBits, '0');
  assert.equal(d.exponentBits, '01111011');
  assert.equal(d.mantissaBits, '10011001100110011001101');
  assert.equal(d.fields.unbiased, -4);
  assert.equal(d.exact, '0.100000001490116119384765625');
  assert.equal(d.storedText, '0.1');
  assert.equal(d.rounded, true);
});

test('exact decimal of float64 0.1', () => {
  assert.equal(floatToBits(0.1, 'f64'), 0x3fb999999999999an);
  assert.equal(exactDecimal(floatToBits(0.1, 'f64'), 'f64'), '0.1000000000000000055511151231257827021181583404541015625');
  assert.equal(exactDecimal(floatToBits(1, 'f64'), 'f64'), '1');
  assert.equal(exactDecimal(floatToBits(-2.5, 'f64'), 'f64'), '-2.5');
  assert.equal(exactDecimal(floatToBits(2 ** 70, 'f64'), 'f64'), (2n ** 70n).toString());
  assert.equal(describeFloat(0.5, 'f64').rounded, false);
});

test('subnormals', () => {
  const tiny = describeFloat(5e-324, 'f64');
  assert.equal(tiny.hex, '0000000000000001');
  assert.equal(tiny.fields.kind, 'subnormal');
  assert.equal(tiny.fields.unbiased, -1022);
  assert.ok(tiny.exact.startsWith(`0.${'0'.repeat(323)}49406564584124654`));
  assert.equal(tiny.exact.length, 2 + 1074);
  const f32min = describeFloatBits(1n, 'f32');
  assert.equal(f32min.fields.kind, 'subnormal');
  assert.equal(f32min.stored, 2 ** -149);
  assert.equal(floatClassLabel(f32min.fields), 'Subnormal');
  assert.equal(decodeFloat(floatToBits(2 ** -126, 'f32'), 'f32').kind, 'normal');
  assert.equal(decodeFloat(floatToBits(2 ** -127, 'f32'), 'f32').kind, 'subnormal');
});

test('NaN, infinities and -0', () => {
  const nan = describeFloat(NaN, 'f32');
  assert.equal(nan.fields.kind, 'nan');
  assert.equal(nan.exponentBits, '11111111');
  assert.equal(nan.exact, 'NaN');
  assert.equal(floatClassLabel(nan.fields), 'NaN (quiet)');
  assert.equal(floatClassLabel(decodeFloat(0x7f800001n, 'f32')), 'NaN (signaling)');
  assert.equal(describeFloat(Infinity, 'f32').hex, '7f800000');
  assert.equal(describeFloat(-Infinity, 'f64').hex, 'fff0000000000000');
  assert.equal(floatClassLabel(describeFloat(-Infinity, 'f64').fields), '−Infinity');
  const negZero = describeFloat(-0, 'f64');
  assert.equal(negZero.hex, '8000000000000000');
  assert.equal(negZero.exact, '-0');
  assert.equal(negZero.storedText, '-0');
  assert.equal(floatClassLabel(negZero.fields), 'Negative zero');
  assert.equal(describeFloat(1e40, 'f32').fields.kind, 'infinity');
});

test('decimal input for floats', () => {
  assert.equal(parseFloatInput('0.1'), 0.1);
  assert.equal(parseFloatInput('-2.5e-3'), -0.0025);
  assert.ok(Object.is(parseFloatInput('-0'), -0));
  assert.ok(Number.isNaN(parseFloatInput('NaN')));
  assert.equal(parseFloatInput('-inf'), -Infinity);
  assert.equal(parseFloatInput('Infinity'), Infinity);
  assert.equal(parseFloatInput('1_000.5'), 1000.5);
  assert.throws(() => parseFloatInput('0x10'), /isn't a decimal number/);
  assert.throws(() => parseFloatInput(''), /Enter a number/);
});

test('hex to float', () => {
  assert.equal(parseFloatHex('3dcccccd', 'f32'), 0x3dcccccdn);
  assert.equal(bitsToFloat(parseFloatHex('0x3F800000', 'f32'), 'f32'), 1);
  assert.equal(bitsToFloat(parseFloatHex('3fb9 9999 9999 999a', 'f64'), 'f64'), 0.1);
  assert.equal(bitsToFloat(parseFloatHex('c0490fdb', 'f32'), 'f32'), Math.fround(-Math.PI));
  assert.ok(Number.isNaN(bitsToFloat(0x7fc00000n, 'f32')));
  assert.throws(() => parseFloatHex('123456789', 'f32'), /8 hex digits; this has 9/);
  assert.throws(() => parseFloatHex('xyz', 'f64'), /Only hex digits/);
});

test('shortest float32 text', () => {
  assert.equal(shortestFloat32(Math.fround(0.1)), '0.1');
  assert.equal(shortestFloat32(Math.fround(1 / 3)), '0.33333334');
  assert.equal(shortestFloat32(16777216), '16777216');
  assert.equal(shortestFloat32(-0), '-0');
});

test('typed decimals compare exactly with the stored value', () => {
  assert.equal(normalizeDecimal('1.50e-3'), '0.0015');
  assert.equal(normalizeDecimal('0012.3400'), '12.34');
  assert.equal(normalizeDecimal('.5'), '0.5');
  assert.equal(normalizeDecimal('1e3'), '1000');
  assert.equal(normalizeDecimal('-0.0'), '-0');
  assert.equal(normalizeDecimal('nan'), null);
  assert.equal(isExactlyStored('0.1', describeFloat(0.1, 'f64').exact), false);
  assert.equal(isExactlyStored('0.5', describeFloat(0.5, 'f32').exact), true);
  assert.equal(isExactlyStored('2.5e0', describeFloat(2.5, 'f64').exact), true);
  assert.equal(isExactlyStored('16777217', describeFloat(16777217, 'f32').exact), false);
  assert.equal(isExactlyStored('-0', describeFloat(-0, 'f32').exact), true);
});
