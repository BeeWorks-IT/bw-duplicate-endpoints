// Test-only SDK boundary. UI signatures mirror Desktop's component prop types.
// Just enough behaviour to drive the real plugin.js under node:test + jsdom.
import React, { useEffect, useState, useSyncExternalStore } from 'react';

export const SETTINGS_PLUGINS_AREA = 'settings.plugins';
export const PALETTE_AREA = 'palette';
export const CUSTOM_ENDPOINT_FORM_AREA = 'customEndpoint.form';
export const pluginSettingsHref = (id, page) => `/settings?tab=plugins&plugin=${id}&ppage=${page}`;

function atom(value) {
  const listeners = new Set();
  return { get: () => value, set(next) { value = next; listeners.forEach(fn => fn()); },
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
export const host = {
  state: { profile: atom('default'), connectionId: atom('local') },
  navigate() {}, notify() {}, notifyError() {},
};
export const useValue = store => useSyncExternalStore(store.listen, store.get);

const cache = new Map();
export const queryClient = {
  invalidateQueries() { return Promise.resolve(); },
  removeQueries() { cache.clear(); },
};
export function useQuery(options) {
  const key = JSON.stringify(options.queryKey);
  const [, update] = useState(0);
  let entry = cache.get(key);
  if (!entry) { entry = { isPending: true, data: undefined, isError: false, listeners: new Set() }; cache.set(key, entry); }
  const run = () => {
    Object.assign(entry, { isPending: true, isError: false });
    entry.listeners.forEach(fn => fn());
    Promise.resolve().then(options.queryFn).then(data => {
      Object.assign(entry, { data, isPending: false });
    }, error => {
      Object.assign(entry, { error, isError: true, isPending: false });
    }).finally(() => entry.listeners.forEach(fn => fn()));
  };
  useEffect(() => {
    const listener = () => update(n => n + 1);
    entry.listeners.add(listener);
    if ((options.enabled ?? true) && !entry.started) { entry.started = true; run(); }
    return () => { entry.listeners.delete(listener); };
  }, [key, options.enabled]);
  return { ...entry, refetch: run };
}
export function useMutation(options) {
  const [isPending, setPending] = useState(false);
  const mutateAsync = async payload => {
    setPending(true);
    try {
      const data = await options.mutationFn(payload);
      options.onSuccess?.(data);
      return data;
    } catch (error) {
      options.onError?.(error);
      throw error;
    } finally {
      setPending(false);
    }
  };
  return { mutate: payload => void mutateAsync(payload).catch(() => {}), mutateAsync, isPending };
}

// --- i18n: the test ctx registers bundles here; t() resolves the English tree.
let bundles = { en: {} };
export const __registerI18n = next => { bundles = next; };
export function usePluginI18n() {
  return (key, ...args) => {
    const value = key.split('.').reduce((node, part) => node?.[part], bundles.en);
    if (typeof value === 'function') return value(...args);
    return value ?? key;
  };
}

// --- UI kit stand-ins
export function Button({ variant, size, children, ...props }) {
  if (!['outline', 'ghost', 'secondary', undefined].includes(variant)) throw Error('Unsupported Button variant');
  return React.createElement('button', { type: 'button', ...props }, children);
}
export const Badge = ({ children, variant, ...props }) => React.createElement('span', props, children);
export function Checkbox({ checked, onCheckedChange, ...props }) {
  return React.createElement('button', {
    role: 'checkbox', 'aria-checked': Boolean(checked),
    onClick: () => onCheckedChange?.(!checked), ...props,
  });
}
export function Switch({ checked, onCheckedChange, ...props }) {
  return React.createElement('button', {
    role: 'switch', 'aria-checked': Boolean(checked),
    onClick: () => onCheckedChange?.(!checked), ...props,
  });
}
export const Input = props => React.createElement('input', props);
export const Textarea = props => React.createElement('textarea', props);
export function SearchField({ placeholder, value, onChange, 'aria-label': label }) {
  return React.createElement('input', {
    placeholder, value, 'aria-label': label,
    onChange: event => onChange(event.target.value),
  });
}
export function SegmentedControl({ options, value, onChange }) {
  return React.createElement('div', null, options.map(option =>
    React.createElement('button', {
      key: option.id, 'aria-pressed': value === option.id,
      onClick: () => onChange?.(option.id),
    }, option.label)));
}
export const Select = ({ value, onValueChange, children }) =>
  React.createElement('select', { value, onChange: e => onValueChange?.(e.target.value) }, children);
export const SelectTrigger = ({ children }) => React.createElement(React.Fragment, null, children);
export const SelectValue = ({ placeholder }) => React.createElement('option', { value: '' }, placeholder);
export const SelectContent = ({ children }) => React.createElement(React.Fragment, null, children);
export const SelectItem = ({ value, children }) => React.createElement('option', { value }, children);
export function ConfirmDialog({ open, onClose, onConfirm, title, description, children, confirmLabel, cancelLabel }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return React.createElement('div', { role: 'dialog' },
    React.createElement('h2', null, title),
    description && React.createElement('p', null, description),
    children,
    error && React.createElement('p', { role: 'alert' }, String(error?.message || error)),
    React.createElement('button', {
      onClick: async () => {
        setBusy(true); setError(null);
        try { await onConfirm?.(); onClose?.(); } catch (e) { setError(e); } finally { setBusy(false); }
      }, disabled: busy,
    }, confirmLabel || 'Confirm'),
    React.createElement('button', { onClick: onClose }, cancelLabel || 'Cancel'));
}
export const EmptyState = ({ title, description }) => React.createElement('div', null, title, description);
export const ErrorState = ({ title, description, children }) => React.createElement('div', null,
  React.createElement('h2', null, title), React.createElement('p', null, description), children);
export const Skeleton = props => React.createElement('div', props);
export const Separator = () => React.createElement('hr');
export const StatusDot = ({ tone }) => React.createElement('span', { 'data-tone': tone });
