// Versioned JSON settings in localStorage (or any getItem/setItem object).
// Never throws: missing, corrupt or foreign data yields defaults.

export function createStore({ key, version, defaults, storage = globalThis.localStorage }) {
  function load() {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaults };
      if (parsed.v !== version || !parsed.data || typeof parsed.data !== 'object') return { ...defaults };
      return { ...defaults, ...parsed.data };
    } catch {
      return { ...defaults };
    }
  }
  function save(partial) {
    const next = { ...load(), ...partial };
    try {
      storage?.setItem(key, JSON.stringify({ v: version, data: next }));
    } catch {
      // storage full or unavailable: keep running with the in-memory value
    }
    return next;
  }
  return { load, save };
}
