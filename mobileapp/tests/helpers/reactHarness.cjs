// Executes the real hooks/components with controlled effects and native boundaries.
// It does not emulate UIKit/Android layout or GPS hardware.
function reactHarness() {
  const slots = [], cleanups = new Map(), pending = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    createContext: () => ({ Provider: 'Provider' }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index], deps)) { slots[index] = deps; pending.push(() => { cleanups.get(index)?.(); cleanups.set(index, fn()); }); }
    },
  };
  return { React: { __esModule: true, default: React, ...React },
    render(component, props) { cursor = 0; const result = component(props); while (pending.length) pending.shift()(); return result; },
    dispose() { for (const fn of cleanups.values()) fn?.(); },
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  for (const child of children) { const result = find(child, predicate); if (result) return result; }
  return null;
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return (Array.isArray(tree) ? tree : tree.props?.children ?? []).map(text).join(' ');
}
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function memoryStorage() {
  const values = new Map();
  return { values, getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); }, getAllKeys: async () => [...values.keys()],
    multiRemove: async keys => { keys.forEach(key => values.delete(key)); } };
}
module.exports = { reactHarness, find, text, settle, memoryStorage };
