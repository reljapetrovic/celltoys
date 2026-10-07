import { describe, test, expect } from 'vitest';
import { createStore } from '../shared/settings-store.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    dump: () => Object.fromEntries(m),
  };
}

const defaults = { a: 1, b: 'x' };

describe('createStore', () => {
  test('returns defaults when empty', () => {
    const s = createStore({ key: 'k', version: 1, defaults, storage: memoryStorage() });
    expect(s.load()).toEqual(defaults);
  });
  test('save merges and persists with version envelope', () => {
    const st = memoryStorage();
    const s = createStore({ key: 'k', version: 1, defaults, storage: st });
    expect(s.save({ a: 2 })).toEqual({ a: 2, b: 'x' });
    expect(JSON.parse(st.dump().k)).toEqual({ v: 1, data: { a: 2, b: 'x' } });
    expect(s.load()).toEqual({ a: 2, b: 'x' });
  });
  test('discards other versions', () => {
    const st = memoryStorage({ k: JSON.stringify({ v: 0, data: { a: 9 } }) });
    const s = createStore({ key: 'k', version: 1, defaults, storage: st });
    expect(s.load()).toEqual(defaults);
  });
  test('tolerates corrupt, foreign and null JSON', () => {
    for (const raw of ['{not json', '[1,2]', 'null', '"str"', JSON.stringify({ v: 1, data: null })]) {
      const s = createStore({ key: 'k', version: 1, defaults, storage: memoryStorage({ k: raw }) });
      expect(s.load()).toEqual(defaults);
    }
  });
  test('works with no storage at all', () => {
    const s = createStore({ key: 'k', version: 1, defaults, storage: undefined });
    expect(s.load()).toEqual(defaults);
    expect(s.save({ a: 5 })).toEqual({ a: 5, b: 'x' });
  });
  test('survives a throwing storage', () => {
    const bad = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
    const s = createStore({ key: 'k', version: 1, defaults, storage: bad });
    expect(s.load()).toEqual(defaults);
    expect(s.save({ a: 3 })).toEqual({ a: 3, b: 'x' });
  });
});
