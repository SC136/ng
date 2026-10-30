import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseSpaces, convertCase, countGraphemes, countLines, countParagraphs, countWords, dedupeLines, formatReadingTime, numberLines,
  randomInt, readingMinutes, removeEmptyLines, removeLineBreaks, reverseLines, sentenceCase, shuffleLines, slugify, sortLines, splitWords,
  stats, stripDiacritics, titleCase, transform, trimLines, trimText,
} from '../tools/text/text.js';

test('words split at case changes and keep acronyms together', () => {
  assert.deepEqual(splitWords('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  assert.deepEqual(splitWords('getHTTPResponseCode'), ['get', 'HTTP', 'Response', 'Code']);
  assert.deepEqual(splitWords('some_snake-kebab.dot words'), ['some', 'snake', 'kebab', 'dot', 'words']);
  assert.deepEqual(splitWords("don't stop"), ['dont', 'stop']);
  assert.deepEqual(splitWords('file2Name'), ['file', '2', 'Name']);
});

test('programmer cases', () => {
  assert.equal(convertCase('XMLHttpRequest', 'snake'), 'xml_http_request');
  assert.equal(convertCase('hello world', 'camel'), 'helloWorld');
  assert.equal(convertCase('hello world', 'pascal'), 'HelloWorld');
  assert.equal(convertCase('Hello World', 'kebab'), 'hello-world');
  assert.equal(convertCase('maxRetryCount', 'constant'), 'MAX_RETRY_COUNT');
  assert.equal(convertCase('Max retry count', 'dot'), 'max.retry.count');
  assert.equal(convertCase('user_id', 'camel'), 'userId');
  assert.equal(convertCase('first line\nsecond-line', 'camel'), 'firstLine\nsecondLine');
  assert.throws(() => convertCase('x', 'nope'), /Unknown case/);
});

test('lower, upper, title and sentence case', () => {
  assert.equal(convertCase('Hello World', 'lower'), 'hello world');
  assert.equal(convertCase('straße', 'upper'), 'STRASSE');
  assert.equal(titleCase('the lord of the rings'), 'The Lord of the Rings');
  assert.equal(titleCase('what is it for'), 'What Is It For');
  assert.equal(titleCase('ÉCOLE normale'), 'École Normale');
  assert.equal(sentenceCase('HELLO THERE. how ARE you? fine!  ok'), 'Hello there. How are you? Fine!  Ok');
  assert.equal(sentenceCase('first\nsecond'), 'First\nSecond');
});

test('slugs strip diacritics', () => {
  assert.equal(slugify('Héllo Wörld!'), 'hello-world');
  assert.equal(slugify('  Crème brûlée & Café  '), 'creme-brulee-cafe');
  assert.equal(slugify('Straße in Øresund'), 'strasse-in-oresund');
  assert.equal(slugify("It's 2024"), 'its-2024');
  assert.equal(slugify('one\nTwo Three'), 'one\ntwo-three');
  assert.equal(stripDiacritics('Ærø Łódź'), 'Aero Lodz');
});

test('sorting lines, including natural order', () => {
  assert.equal(sortLines('pear\nApple\nbanana\n', 'az'), 'Apple\nbanana\npear\n');
  assert.equal(sortLines('pear\nApple\nbanana', 'za'), 'pear\nbanana\nApple');
  assert.equal(sortLines('file10\nfile2\nfile1', 'az'), 'file1\nfile10\nfile2');
  assert.equal(sortLines('file10\nfile2\nfile1', 'natural'), 'file1\nfile2\nfile10');
  assert.equal(sortLines('b\r\na\r\n', 'az'), 'a\r\nb\r\n');
  assert.equal(sortLines('', 'az'), '');
});

test('reverse, dedupe, remove empty, trim and number lines', () => {
  assert.equal(reverseLines('1\n2\n3'), '3\n2\n1');
  assert.equal(dedupeLines('a\nb\na\nA\n'), 'a\nb\nA\n');
  assert.equal(dedupeLines('a\nb\na\nA\n', { ignoreCase: true }), 'a\nb\n');
  assert.equal(removeEmptyLines('a\n\n  \nb\n'), 'a\nb\n');
  assert.equal(trimLines('  a  \n\tb'), 'a\nb');
  assert.equal(numberLines('a\nb'), '1. a\n2. b');
  assert.equal(numberLines(Array(10).fill('x').join('\n')).split('\n')[0], ' 1. x');
});

test('shuffle keeps every line and uses an unbiased random source', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
  const shuffled = shuffleLines(lines.join('\n')).split('\n');
  assert.deepEqual(shuffled.slice().sort(), lines.slice().sort());
  // A fake source that returns values in the biased zone first: they must be rejected.
  const values = [0xffffffff, 7];
  const fake = { getRandomValues: (buffer) => { buffer[0] = values.shift(); return buffer; } };
  assert.equal(randomInt(10, fake), 7);
  assert.equal(randomInt(1), 0);
  for (let i = 0; i < 200; i++) {
    const n = randomInt(3);
    assert.ok(n >= 0 && n < 3);
  }
});

test('whitespace clean-up', () => {
  assert.equal(trimText('  hi \n'), 'hi');
  assert.equal(collapseSpaces('a   b\t\tc\n  d'), 'a b c\n d');
  assert.equal(removeLineBreaks('one\ntwo  \n\n  three\r\nfour\n'), 'one two three four');
});

test('a family emoji counts as one character', () => {
  assert.equal(countGraphemes('👨‍👩‍👧‍👦'), 1);
  assert.equal(countGraphemes('é'), 1);
  assert.equal(countGraphemes('🇳🇬 ok'), 4);
  assert.equal('👨‍👩‍👧‍👦'.length, 11);
});

test('words, lines and paragraphs', () => {
  assert.equal(countWords('Hello, world! It\'s 2024.'), 4);
  assert.equal(countWords(''), 0);
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\n\nb'), 3);
  assert.equal(countParagraphs('one\ntwo\n\nthree\n  \nfour'), 3);
  assert.equal(countParagraphs('   '), 0);
});

test('stats bundle counts, bytes and reading time', () => {
  assert.deepEqual(stats('Héllo wörld\n\nBye 👋'), {
    characters: 18,
    charactersNoSpaces: 14,
    words: 3,
    lines: 3,
    paragraphs: 2,
    bytes: 23,
    readingMinutes: 1,
  });
  assert.equal(readingMinutes(0), 0);
  assert.equal(readingMinutes(476), 2);
  assert.equal(formatReadingTime(0, 0), '0 min');
  assert.equal(formatReadingTime(1, 50), 'Under 1 min');
  assert.equal(formatReadingTime(2, 400), '2 min');
});

test('transform dispatches by id', () => {
  assert.equal(transform('Hello World', 'case-snake'), 'hello_world');
  assert.equal(transform('a\nA', 'dedupe', { ignoreCase: true }), 'a');
  assert.equal(transform('x  y', 'collapse-spaces'), 'x y');
  assert.throws(() => transform('x', 'nope'), /Unknown transform/);
});
