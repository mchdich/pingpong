import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../web/release-notes.js', import.meta.url), 'utf8');
const { activeRelease } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const published = Date.parse('2026-10-08T04:00:00.000Z');
const release = { id: 'example', publishedAt: new Date(published).toISOString(), changes: ['One change'] };

test('first viewing gets ten seconds even long after publication', () => {
  const firstShown = published + 86400000;
  assert.equal(activeRelease(release, firstShown).expiresAt, firstShown + 10000);
  assert.ok(activeRelease(release, firstShown + 9999, firstShown));
  assert.equal(activeRelease(release, firstShown + 10000, firstShown), null);
  assert.equal(activeRelease(release, firstShown + 10001, firstShown), null);
});

test('reload continues the original ten-second window without restarting it', () => {
  assert.equal(activeRelease(release, published + 5000, published).expiresAt, published + 10000);
  assert.equal(activeRelease(release, published + 10000, published), null);
});

test('a new release gets its own first-view window', () => {
  const next = { ...release, id: 'next-version' }, later = published + 86400000;
  assert.equal(activeRelease(release, later, published), null);
  assert.equal(activeRelease(next, later).expiresAt, later + 10000);
});

test('invalid or empty manifest cannot render a card', () => {
  for (const value of [null, {}, { ...release, id: '' }, { ...release, publishedAt: 'invalid' },
    { ...release, changes: [] }, { ...release, changes: [null, 3, ' '] }])
    assert.equal(activeRelease(value, published), null);
});

test('manifest text stays text and is bounded', () => {
  assert.deepEqual(activeRelease({ ...release, changes: [' <img src=x onerror=alert(1)> ', null] }, published).changes,
    ['<img src=x onerror=alert(1)>']);
  assert.equal(activeRelease({ ...release, changes: Array(20).fill('x'.repeat(300)) }, published).changes.length, 10);
  assert.equal(activeRelease({ ...release, changes: ['x'.repeat(300)] }, published).changes[0].length, 200);
});
