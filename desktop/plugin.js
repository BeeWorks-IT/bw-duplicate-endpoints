// Hermes Duplicate Settings — native Desktop half.
// Plain disk-plugin ESM: React, the UI kit and the SDK are supplied by Desktop.
// Settings > Plugins > Duplicate Custom Endpoints, with four sub-pages:
//   Duplicate endpoints — guided cross-profile endpoint duplication
//   Profiles            — profile management (metadata, backend enable, default route)
//   Settings            — duplication defaults and backend status
//   Help                — what it does, key handling, safety
// All writes go through the plugin backend, which drives Hermes' own handlers.
// No core markup is touched; only SDK surfaces are used.
import {
  host, useQuery, useMutation, queryClient,
  Button, Badge, Checkbox, Switch, Input, Textarea, SegmentedControl, SearchField,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  ConfirmDialog, EmptyState, ErrorState, Skeleton, Separator, StatusDot,
  SETTINGS_PLUGINS_AREA, PALETTE_AREA, pluginSettingsHref, usePluginI18n,
} from '@hermes/plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import * as SDK from '@hermes/plugin-sdk';

const ID = 'bw-duplicate-endpoints';

// ---------------------------------------------------------------------------
// Locale bundles (plugin-scoped; the app locale picks, English is the fallback)
// ---------------------------------------------------------------------------
const en = {
  page: {
    title: 'Duplicate Custom Endpoints',
    subtitle: 'Duplicate custom endpoints between Hermes profiles and manage your profiles — with or without API keys. Every run is confirmed, validated and verified.',
  },
  steps: { source: 'Source', target: 'Destination', run: 'Validation & duplication' },
  source: {
    label: 'Source profile', placeholder: 'Choose a profile…', refresh: 'Refresh',
    selectAll: 'Select all', clear: 'Clear selection',
    emptyTitle: 'No custom endpoints', empty: 'This profile has no custom endpoints to duplicate.',
    test: 'Test', testing: 'Testing…', models: n => `${n} models`,
    key: 'API key', noKey: 'no key', active: 'active', legacy: 'legacy',
    probeOk: 'Connection OK', probeFail: 'Connection failed',
    searchPlaceholder: 'Filter endpoints…', withKeyOnly: 'With key only',
    probeSelection: 'Probe selection', noMatch: 'No endpoint matches the filter.',
  },
  target: {
    label: 'Target profiles', hint: 'The source profile is excluded automatically.',
    endpoints: n => `${n} endpoints`, willUpdate: n => `updates ${n}`, willSkip: n => `skips ${n}`,
    none: 'No other profiles are available on this host.', all: 'All', clear: 'None',
  },
  options: {
    copyKeys: 'Copy API keys',
    copyKeysHint: 'Keys are resolved through Hermes and stored in the target profile by Hermes itself. Off: existing target keys are kept, new endpoints arrive keyless.',
    validateFirst: 'Test connections before duplicating',
    validateFirstHint: 'Probes each endpoint first; an endpoint that fails the probe is skipped, never written.',
    makeDefault: 'Set as default model route in targets',
    makeDefaultHint: 'Also changes the target profiles’ active model. Leave off to only add the endpoints.',
    conflict: 'When an endpoint already exists in a target',
    conflictUpdate: 'Update it', conflictSkip: 'Skip it',
  },
  run: {
    summary: (e, t) => `${e} endpoint(s) × ${t} target profile(s)`,
    keysOn: 'keys copied', keysOff: 'keys not copied',
    missingSource: 'Choose a source profile.', missingEndpoints: 'Select at least one endpoint.',
    missingTargets: 'Select at least one target profile.',
    button: 'Duplicate…',
    confirmTitle: 'Duplicate endpoints',
    confirmDesc: 'Writes go through Hermes’ own endpoint save path: atomic config updates, keys stored by Hermes in the target profile, then a read-back check of every write.',
    confirm: 'Duplicate', busy: 'Duplicating…', cancel: 'Cancel',
    create: 'create', update: 'update', skip: 'skip', copy: 'copy key', keep: 'keep target key', none: 'no key',
  },
  results: {
    title: 'Results', succeeded: n => `${n} succeeded`, failed: n => `${n} failed`,
    verified: 'verified', created: 'created', updated: 'updated', skipped: 'skipped',
    keyCopied: 'key copied', keyKept: 'key kept', keyAbsent: 'no key', keyMissing: 'source key not found',
    activated: 'set as default', notVerified: 'read-back check failed',
  },
  notify: {
    done: (ok, fail) => fail ? `Duplication finished: ${ok} ok, ${fail} failed` : `Duplicated successfully (${ok} writes)`,
    error: 'Duplication failed',
  },
  backend: {
    title: 'Plugin backend unavailable',
    desc: 'The plugin backend is not mounted for this profile. Enable the plugin for the connected profile and restart its gateway, then retry.',
    retry: 'Retry',
  },
  profiles: {
    title: 'Profiles', subtitle: 'Every Hermes profile on this host: metadata, endpoints, and the plugin backend state.',
    gateway: 'gateway running', gatewayOff: 'gateway stopped', default: 'default',
    alias: a => `alias: ${a}`, noDescription: 'No description yet.',
    endpoints: n => `${n} endpoints`, keys: n => `${n} keys`, skills: n => `${n} skills`,
    pluginLabel: 'Plugin backend enabled',
    pluginHint: 'Serves this page when this profile is active. A gateway restart may be needed to apply.',
    edit: 'Edit', save: 'Save', cancel: 'Cancel',
    displayName: 'Display name', description: 'Description',
    useAsSource: 'Duplicate from this profile',
    defaultRoute: 'Default model route', routePlaceholder: 'Choose an endpoint…', activate: 'Activate',
    activateTitle: 'Change default model route',
    activateDesc: p => `This sets the active model of profile “${p}” to the selected endpoint. The profile’s next sessions will use it.`,
    activated: 'Default route updated', metaSaved: 'Profile updated',
    pluginOn: 'Backend enabled for this profile', pluginOff: 'Backend disabled for this profile',
    autoDesc: 'auto-generated — edit to confirm', noEndpoints: 'no endpoints',
  },
  settings: {
    title: 'Settings', subtitle: 'Management parameters for the endpoint duplication tools.',
    defaults: 'Duplication defaults',
    defaultsHint: 'Initial values of the duplication workflow options. You can still change them per run.',
    reset: 'Reset defaults', backend: 'Backend status', backendOk: v => `Mounted · v${v}`,
    manageProfiles: 'Per-profile backend enablement, display names and default routes live on the Profiles page.',
    preferredSource: 'Preferred source profile',
    preferredSourceHint: 'Preselected when the duplication page opens.',
    sourceNone: 'No preference',
    autoRefresh: 'Auto-refresh',
    autoRefreshHint: 'Refresh the profile and endpoint lists periodically.',
    refreshOff: 'Off',
    keepResults: 'Keep last results',
    keepResultsHint: 'Restore the last duplication results when the page reopens.',
  },
  help: {
    title: 'Help',
    what: 'What this plugin does',
    whatBody: 'Copies custom OpenAI-compatible endpoints (the ones in Settings > Model > Custom endpoints) from one Hermes profile to others: name, URL, model catalogue, transport, context lengths and headers. Optionally copies the API key, and optionally makes the endpoint the target’s default model route. The Profiles page manages display names, descriptions, per-profile backend enablement and default model routes.',
    keys: 'How keys are handled',
    keysBody: 'Key values are resolved through Hermes’ secret scope and written by Hermes’ own credential store into the target profile. They never appear in this UI, in config.yaml, or in any API response. With “Copy API keys” off, an endpoint that already exists in a target keeps its own key; a new endpoint arrives keyless.',
    validation: 'Validation',
    validationBody: 'The form checks your selection before anything is sent. The backend re-validates every endpoint (name, URL, default model), can probe the connection first, asks for confirmation, and reads each target back after writing to verify the result.',
    safety: 'Safety',
    safetyBody: 'Writes use the same handlers as the Settings panel: profile-scoped, under the config mutation lock, atomic and comment-preserving. A target’s active model is never changed unless you explicitly activate a route. Profile creation and deletion stay in Hermes’ own profile tools. No telemetry, no background processes, no network calls except the optional probe to your own endpoints.',
    install: 'Install & enable',
    installBody: 'Install the package, enable it for each profile that should serve the page (the Profiles page can do this for you), and restart the gateway once so the backend mounts:',
  },
  create: {
    title: 'New endpoint',
    subtitle: 'Create one custom endpoint on several profiles at once, through the Hermes save path.',
    name: 'Name', namePlaceholder: 'My endpoint',
    providerId: 'Provider ID (optional)', providerIdPlaceholder: 'my-endpoint',
    baseUrl: 'Base URL', baseUrlPlaceholder: 'https://api.example.com/v1',
    model: 'Default model', modelPlaceholder: 'model-id',
    apiKey: 'API key (optional)', apiKeyPlaceholder: 'Stored by Hermes in each profile',
    apiMode: 'Transport', modeAuto: 'Auto', modeChat: 'Chat Completions', modeResponses: 'Responses', modeAnthropic: 'Anthropic',
    contextLength: 'Context length (optional)',
    discoverModels: 'Discover models', makeDefault: 'Set as default model route in the checked profiles',
    profiles: 'Create on profiles', profilesHint: 'The endpoint is saved on every checked profile.',
    missingName: 'Enter a name.', missingUrl: 'Enter a valid base URL (scheme + host).',
    missingModel: 'Enter a default model.', missingProfiles: 'Check at least one profile.',
    button: 'Create endpoint…',
    confirmTitle: 'Create endpoint',
    confirmDesc: 'The endpoint is saved on each checked profile through the Hermes endpoint save path (keys stored by Hermes), then read back to verify.',
    confirm: 'Create', busy: 'Creating…', cancel: 'Cancel',
    resultsTitle: 'Results', created: 'created', updated: 'updated',
    keyCopied: 'key stored', keyAbsent: 'no key', verified: 'verified', activated: 'set as default',
    notifyDone: (ok, fail) => fail ? `Creation finished: ${ok} ok, ${fail} failed` : `Endpoint created on ${ok} profile(s)`,
    notifyError: 'Endpoint creation failed',
  },
  also: {
    title: 'Also create on other profiles',
    hint: 'After Save, the endpoint is copied to the checked profiles (with its key when present).',
    working: 'Copying…', done: 'Copied to checked profiles', failed: 'Copy failed',
    none: 'No other profiles available.',
  },
};
// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------
function StepCard({ step, title, children, actions }) {
  return jsxs('section', { className: 'space-y-3 rounded-md border border-(--ui-stroke-secondary) p-4', children: [
    jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
      jsxs('h2', { className: 'flex items-center gap-2 text-sm font-semibold', children: [
        jsx('span', { className: 'grid size-5 place-items-center rounded-full border border-(--ui-stroke-secondary) text-[0.65rem] font-bold text-(--ui-text-secondary)', children: String(step) }),
        title,
      ] }),
      actions ?? null,
    ] }),
    children,
  ] });
}

function OptionRow({ label, hint, checked, onChange, tone }) {
  return jsxs('div', { className: 'flex items-start justify-between gap-4', children: [
    jsxs('div', { className: 'space-y-0.5', children: [
      jsx('div', { className: `text-sm font-medium ${tone === 'warn' ? 'text-amber-600 dark:text-amber-300' : ''}`, children: label }),
      jsx('div', { className: 'max-w-prose text-xs text-(--ui-text-tertiary)', children: hint }),
    ] }),
    jsx(Switch, { checked, onCheckedChange: onChange, 'aria-label': label, className: 'mt-0.5' }),
  ] });
}

function PageHeader({ title, subtitle, onRefresh, refreshing, refreshLabel }) {
  return jsxs('div', { className: 'flex items-start justify-between gap-3', children: [
    jsxs('div', { className: 'space-y-1', children: [
      jsx('h1', { className: 'text-base font-semibold', children: title }),
      jsx('p', { className: 'max-w-prose text-xs text-(--ui-text-tertiary)', children: subtitle }),
    ] }),
    onRefresh && jsx(Button, { type: 'button', variant: 'outline', size: 'sm',
      onClick: onRefresh, disabled: refreshing, children: refreshLabel }),
  ] });
}

function BackendFailure({ error, retry, t }) {
  const missing = /404|403|disabled|not found/i.test(String(error?.message));
  return jsx('div', { role: 'alert', children: jsx(ErrorState, {
    title: t('backend.title'),
    description: missing ? t('backend.desc') : String(error?.message || t('backend.desc')),
    children: jsxs('div', { className: 'space-y-3', children: [
      missing && jsx('pre', { className: 'whitespace-pre-wrap text-xs', children:
        'hermes plugins enable bw-duplicate-endpoints\n# then restart the gateway (hermes-serve)' }),
      jsx(Button, { type: 'button', variant: 'outline', onClick: retry, children: t('backend.retry') }),
    ] }),
  }) });
}

const invalidateAll = () => {
  queryClient.invalidateQueries({ queryKey: [ID, 'overview'] });
  queryClient.invalidateQueries({ queryKey: [ID, 'profiles'] });
};

// ---------------------------------------------------------------------------
// Sub-page 1: Duplicate endpoints
// ---------------------------------------------------------------------------
function DuplicatePage({ ctx }) {
  const t = usePluginI18n(ID);
  const refreshMs = Number(ctx.storage.get('refreshInterval', 0)) * 1000;
  const overview = useQuery({
    queryKey: [ID, 'overview'],
    queryFn: () => ctx.rest('/overview'),
    staleTime: 15_000,
    refetchInterval: refreshMs > 0 ? refreshMs : false,
  });
  const [source, setSource] = useState(() => ctx.storage.get('lastSource', null) ?? ctx.storage.get('preferredSource', null));
  const [selected, setSelected] = useState(() => new Set());
  const [targets, setTargets] = useState(() => new Set());
  const [copyKeys, setCopyKeys] = useState(() => ctx.storage.get('copyKeys', true));
  const [validateFirst, setValidateFirst] = useState(() => ctx.storage.get('validateFirst', false));
  const [makeDefault, setMakeDefault] = useState(() => ctx.storage.get('makeDefault', false));
  const [onConflict, setOnConflict] = useState(() => ctx.storage.get('onConflict', 'update'));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [results, setResults] = useState(() => ctx.storage.get('keepResults', false) ? ctx.storage.get('lastResults', null) : null);
  const [probes, setProbes] = useState({});
  const [search, setSearch] = useState('');
  const [withKeyOnly, setWithKeyOnly] = useState(false);

  const profiles = overview.data?.profiles ?? [];
  const sourceRow = profiles.find(p => p.name === source) ?? null;
  const sourceEndpoints = sourceRow?.endpoints ?? [];
  const needle = search.trim().toLowerCase();
  const visibleEndpoints = sourceEndpoints.filter(e =>
    (!withKeyOnly || e.has_api_key) &&
    (!needle || `${e.name} ${e.base_url} ${e.model}`.toLowerCase().includes(needle)));
  const targetCandidates = profiles.filter(p => p.name !== source);
  const selectedRows = sourceEndpoints.filter(e => selected.has(e.id));

  const pickSource = name => {
    setSource(name); ctx.storage.set('lastSource', name);
    setSelected(new Set()); setTargets(new Set()); setResults(null); setProbes({});
  };
  const toggleEndpoint = id => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleTarget = name => setTargets(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next;
  });
  const setOption = (key, setter) => value => { setter(value); ctx.storage.set(key, value); };

  const targetHas = (targetName, endpointId) => {
    const row = profiles.find(p => p.name === targetName);
    return (row?.endpoints ?? []).some(e => e.id === endpointId);
  };
  const conflictsFor = targetName => selectedRows.filter(e => targetHas(targetName, e.id)).length;

  const missing = [];
  if (!sourceRow) missing.push(t('run.missingSource'));
  else if (!selected.size) missing.push(t('run.missingEndpoints'));
  if (!targets.size) missing.push(t('run.missingTargets'));
  const canSubmit = missing.length === 0 && !overview.isPending;

  const payload = () => ({
    source_profile: source,
    endpoint_ids: [...selected],
    target_profiles: [...targets],
    copy_keys: copyKeys,
    validate_first: validateFirst,
    make_default: makeDefault,
    on_conflict: onConflict,
  });

  const mutation = useMutation({
    mutationFn: body => ctx.rest('/duplicate', { method: 'POST', body }),
    onSuccess: data => {
      setResults(data);
      if (ctx.storage.get('keepResults', false)) ctx.storage.set('lastResults', data);
      invalidateAll();
      host.notify({ kind: data.summary?.failed ? 'warning' : 'success',
        message: t('notify.done', data.summary?.succeeded ?? 0, data.summary?.failed ?? 0) });
    },
    onError: error => host.notifyError(error, t('notify.error')),
  });

  const runProbe = async endpointId => {
    setProbes(prev => ({ ...prev, [endpointId]: { state: 'busy' } }));
    try {
      const r = await ctx.rest('/probe', { method: 'POST', body: { profile: source, endpoint_id: endpointId } });
      setProbes(prev => ({ ...prev, [endpointId]: {
        state: r.ok ? 'ok' : (r.reachable ? 'warn' : 'bad'),
        message: r.message || (r.ok ? t('source.probeOk') : t('source.probeFail')),
      } }));
    } catch (error) {
      setProbes(prev => ({ ...prev, [endpointId]: { state: 'bad', message: String(error?.message || error) } }));
    }
  };

  const probeSelection = async () => {
    for (const endpointId of [...selected]) await runProbe(endpointId);
  };

  const keyActionFor = (targetName, endpointRow) => {
    if (onConflict === 'skip' && targetHas(targetName, endpointRow.id)) return 'keep';
    if (copyKeys) return endpointRow.has_api_key ? 'copy' : 'none';
    return targetHas(targetName, endpointRow.id) ? 'keep' : 'none';
  };
  const conflictActionFor = (targetName, endpointRow) =>
    targetHas(targetName, endpointRow.id) ? (onConflict === 'skip' ? 'skip' : 'update') : 'create';

  if (overview.isError) {
    return jsxs('div', { className: 'space-y-4', children: [
      jsx(PageHeader, { title: t('page.title'), subtitle: t('page.subtitle') }),
      jsx(BackendFailure, { error: overview.error, retry: () => overview.refetch(), t }),
    ] });
  }
  if (overview.isPending) {
    return jsxs('div', { className: 'space-y-4', children: [
      jsx(PageHeader, { title: t('page.title'), subtitle: t('page.subtitle') }),
      jsx(Skeleton, { className: 'h-24 w-full' }), jsx(Skeleton, { className: 'h-24 w-full' }),
    ] });
  }

  const step1 = jsx(StepCard, { step: 1, title: t('steps.source'), actions: sourceRow && sourceEndpoints.length > 0 && jsxs('div', { className: 'flex gap-1', children: [
    jsx(Button, { type: 'button', variant: 'ghost', size: 'sm',
      onClick: () => void probeSelection(), disabled: selected.size === 0, children: t('source.probeSelection') }),
    jsx(Button, { type: 'button', variant: 'ghost', size: 'sm',
      onClick: () => setSelected(new Set(visibleEndpoints.map(e => e.id))), children: t('source.selectAll') }),
    jsx(Button, { type: 'button', variant: 'ghost', size: 'sm',
      onClick: () => setSelected(new Set()), children: t('source.clear') }),
  ] }), children: jsxs('div', { className: 'space-y-3', children: [
    jsxs('div', { className: 'space-y-1', children: [
      jsx('label', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: t('source.label') }),
      jsxs(Select, { value: source ?? '', onValueChange: pickSource, children: [
        jsx(SelectTrigger, { className: 'w-full max-w-sm', 'aria-label': t('source.label'),
          children: jsx(SelectValue, { placeholder: t('source.placeholder') }) }),
        jsx(SelectContent, { children: profiles.map(p =>
          jsx(SelectItem, { value: p.name, children: `${p.name} (${p.endpoints.length})` }, p.name)) }),
      ] }),
    ] }),
    sourceRow && (sourceEndpoints.length === 0
      ? jsx(EmptyState, { title: t('source.emptyTitle'), description: t('source.empty') })
      : jsxs('div', { className: 'space-y-2', children: [
        jsxs('div', { className: 'flex flex-wrap items-center gap-3', children: [
          jsx(SearchField, { variant: 'box', placeholder: t('source.searchPlaceholder'), value: search,
            onChange: setSearch, 'aria-label': t('source.searchPlaceholder'), containerClassName: 'min-w-56 flex-1' }),
          jsxs('label', { className: 'flex cursor-pointer items-center gap-2 text-xs text-(--ui-text-secondary)', children: [
            jsx(Checkbox, { checked: withKeyOnly, onCheckedChange: v => setWithKeyOnly(Boolean(v)), 'aria-label': t('source.withKeyOnly') }),
            t('source.withKeyOnly'),
          ] }),
        ] }),
        visibleEndpoints.length === 0
          ? jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('source.noMatch') })
          : visibleEndpoints.map(row => {
        const probe = probes[row.id];
        return jsxs('div', { className: 'flex items-start gap-3 rounded-md border border-(--ui-stroke-secondary) p-3', children: [
          jsx(Checkbox, { checked: selected.has(row.id), onCheckedChange: () => toggleEndpoint(row.id),
            'aria-label': row.name, className: 'mt-0.5' }),
          jsxs('div', { className: 'min-w-0 flex-1 space-y-1', children: [
            jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
              jsx('span', { className: 'text-sm font-medium', children: row.name }),
              row.is_current && jsx(Badge, { children: t('source.active') }),
              jsx(Badge, { variant: row.has_api_key ? 'success' : 'muted',
                children: row.has_api_key ? t('source.key') : t('source.noKey') }),
              row.source === 'custom_providers' && jsx(Badge, { variant: 'outline', children: t('source.legacy') }),
              jsx(Badge, { variant: 'muted', children: t('source.models', row.models?.length ?? 0) }),
            ] }),
            jsx('div', { className: 'truncate font-mono text-xs text-(--ui-text-tertiary)', children: row.base_url }),
            jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: row.model }),
            probe && probe.state !== 'busy' && jsxs('div', { className: 'flex items-center gap-1.5 text-xs', children: [
              jsx(StatusDot, { tone: probe.state === 'ok' ? 'good' : probe.state === 'warn' ? 'warn' : 'bad' }),
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: probe.message }),
            ] }),
          ] }),
          jsx(Button, { type: 'button', variant: 'ghost', size: 'sm',
            onClick: () => void runProbe(row.id), disabled: probe?.state === 'busy',
            children: probe?.state === 'busy' ? t('source.testing') : t('source.test') }),
        ] }, row.id);
      }) ] })),
  ] }) });

  const step2 = jsx(StepCard, { step: 2, title: t('steps.target'), actions: jsxs('div', { className: 'flex gap-1', children: [
    jsx(Button, { type: 'button', variant: 'ghost', size: 'sm',
      onClick: () => setTargets(new Set(targetCandidates.map(p => p.name))), children: t('target.all') }),
    jsx(Button, { type: 'button', variant: 'ghost', size: 'sm',
      onClick: () => setTargets(new Set()), children: t('target.clear') }),
  ] }), children: jsxs('div', { className: 'space-y-3', children: [
    jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('target.hint') }),
    targetCandidates.length === 0
      ? jsx(EmptyState, { title: t('target.none') })
      : jsx('div', { className: 'space-y-2', children: targetCandidates.map(p => {
        const conflicts = sourceRow ? conflictsFor(p.name) : 0;
        return jsxs('label', { className: 'flex cursor-pointer items-center gap-3 rounded-md border border-(--ui-stroke-secondary) p-3', children: [
          jsx(Checkbox, { checked: targets.has(p.name), onCheckedChange: () => toggleTarget(p.name), 'aria-label': p.name }),
          jsx('span', { className: 'text-sm font-medium', children: p.name }),
          jsx(Badge, { variant: 'muted', children: t('target.endpoints', p.endpoints.length) }),
          conflicts > 0 && jsx(Badge, { variant: onConflict === 'skip' ? 'muted' : 'warn',
            children: onConflict === 'skip' ? t('target.willSkip', conflicts) : t('target.willUpdate', conflicts) }),
          p.error && jsx(Badge, { variant: 'destructive', children: p.error }),
        ] }, p.name);
      }) }),
    jsx(Separator, {}),
    jsx(OptionRow, { label: t('options.copyKeys'), hint: t('options.copyKeysHint'),
      checked: copyKeys, onChange: setOption('copyKeys', setCopyKeys) }),
    jsx(OptionRow, { label: t('options.validateFirst'), hint: t('options.validateFirstHint'),
      checked: validateFirst, onChange: setOption('validateFirst', setValidateFirst) }),
    jsx(OptionRow, { label: t('options.makeDefault'), hint: t('options.makeDefaultHint'),
      checked: makeDefault, onChange: setOption('makeDefault', setMakeDefault), tone: 'warn' }),
    jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-3', children: [
      jsx('span', { className: 'text-sm font-medium', children: t('options.conflict') }),
      jsx(SegmentedControl, { value: onConflict, onChange: setOption('onConflict', setOnConflict),
        options: [{ id: 'update', label: t('options.conflictUpdate') }, { id: 'skip', label: t('options.conflictSkip') }] }),
    ] }),
  ] }) });

  const step3 = jsx(StepCard, { step: 3, title: t('steps.run'), children: jsxs('div', { className: 'space-y-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2 text-sm', children: [
      jsx('span', { children: t('run.summary', selected.size, targets.size) }),
      jsx(Badge, { variant: copyKeys ? 'success' : 'muted', children: copyKeys ? t('run.keysOn') : t('run.keysOff') }),
      makeDefault && jsx(Badge, { variant: 'warn', children: t('options.makeDefault') }),
    ] }),
    missing.length > 0 && jsx('ul', { className: 'list-inside list-disc space-y-0.5 text-xs text-(--ui-text-tertiary)',
      children: missing.map((m, i) => jsx('li', { children: m }, i)) }),
    jsx(Button, { type: 'button', onClick: () => setConfirmOpen(true), disabled: !canSubmit || mutation.isPending,
      children: t('run.button') }),
  ] }) });

  const confirmMatrix = jsxs('div', { className: 'max-h-64 space-y-2 overflow-y-auto', children: selectedRows.map(row =>
    jsxs('div', { className: 'space-y-1 rounded-md border border-(--ui-stroke-secondary) p-2', children: [
      jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
        jsx('span', { className: 'text-sm font-medium', children: row.name }),
        jsx('span', { className: 'font-mono text-xs text-(--ui-text-tertiary)', children: row.base_url }),
      ] }),
      jsx('div', { className: 'flex flex-wrap gap-1.5', children: [...targets].map(name =>
        jsx(Badge, { variant: 'outline',
          children: `${name}: ${t(`run.${conflictActionFor(name, row)}`)} · ${t(`run.${keyActionFor(name, row)}`)}` }, name)) }),
    ] }, row.id)) });

  const resultsPanel = results && jsxs('section', { className: 'space-y-2 rounded-md border border-(--ui-stroke-secondary) p-4', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('h2', { className: 'text-sm font-semibold', children: t('results.title') }),
      jsx(Badge, { variant: 'success', children: t('results.succeeded', results.summary?.succeeded ?? 0) }),
      (results.summary?.failed ?? 0) > 0 && jsx(Badge, { variant: 'destructive', children: t('results.failed', results.summary.failed) }),
    ] }),
    jsx('div', { className: 'space-y-1.5', children: (results.results ?? []).map((r, i) =>
      jsxs('div', { className: 'flex flex-wrap items-center gap-1.5 text-xs', children: [
        jsx(StatusDot, { tone: r.ok ? (r.verified ? 'good' : 'warn') : 'bad' }),
        jsx('span', { className: 'font-medium', children: r.target }),
        jsx('span', { className: 'text-(--ui-text-tertiary)', children: '·' }),
        jsx('span', { children: r.name }),
        r.action && jsx(Badge, { variant: 'muted', children: t(`results.${r.action}`) }),
        r.key && jsx(Badge, { variant: r.key === 'copied' || r.key === 'kept' ? 'success' : r.key === 'missing' ? 'warn' : 'muted',
          children: t(`results.key${r.key.charAt(0).toUpperCase()}${r.key.slice(1)}`) }),
        r.ok && r.action !== 'skipped' && (r.verified
          ? jsx(Badge, { variant: 'success', children: t('results.verified') })
          : jsx(Badge, { variant: 'warn', children: t('results.notVerified') })),
        r.activated && jsx(Badge, { children: t('results.activated') }),
        r.error && jsx('span', { className: 'text-destructive', children: r.error }),
      ] }, i)) }),
  ] });

  return jsxs('div', { className: 'space-y-4', children: [
    jsx(PageHeader, { title: t('page.title'), subtitle: t('page.subtitle'),
      onRefresh: () => overview.refetch(), refreshing: overview.isPending, refreshLabel: t('source.refresh') }),
    step1, step2, step3, resultsPanel,
    jsx(ConfirmDialog, {
      open: confirmOpen,
      onClose: () => setConfirmOpen(false),
      onConfirm: async () => { await mutation.mutateAsync(payload()); },
      title: t('run.confirmTitle'),
      description: t('run.confirmDesc'),
      confirmLabel: t('run.confirm'),
      busyLabel: t('run.busy'),
      cancelLabel: t('run.cancel'),
      destructive: makeDefault,
      children: confirmMatrix,
    }),
  ] });
}

// ---------------------------------------------------------------------------
// Sub-page 2: Profiles management
// ---------------------------------------------------------------------------
function ProfileCard({ ctx, row, t, onUseAsSource }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(row.display_name || '');
  const [draftDesc, setDraftDesc] = useState(row.description || '');
  const [route, setRoute] = useState('');
  const [activateOpen, setActivateOpen] = useState(false);

  const metaMutation = useMutation({
    mutationFn: body => ctx.rest('/profiles/meta', { method: 'POST', body }),
    onSuccess: () => { setEditing(false); invalidateAll(); host.notify({ kind: 'success', message: t('profiles.metaSaved') }); },
    onError: error => host.notifyError(error, t('notify.error')),
  });
  const pluginMutation = useMutation({
    mutationFn: body => ctx.rest('/profiles/plugin', { method: 'POST', body }),
    onSuccess: data => { invalidateAll(); host.notify({ kind: 'success', message: data.plugin_enabled ? t('profiles.pluginOn') : t('profiles.pluginOff') }); },
    onError: error => host.notifyError(error, t('notify.error')),
  });
  const activateMutation = useMutation({
    mutationFn: body => ctx.rest('/profiles/activate', { method: 'POST', body }),
    onSuccess: () => { invalidateAll(); host.notify({ kind: 'success', message: t('profiles.activated') }); },
    onError: error => host.notifyError(error, t('notify.error')),
  });

  const startEdit = () => { setDraftName(row.display_name || ''); setDraftDesc(row.description || ''); setEditing(true); };

  return jsxs('section', { className: 'space-y-3 rounded-md border border-(--ui-stroke-secondary) p-4', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx(StatusDot, { tone: row.gateway_running ? 'good' : 'muted' }),
      jsx('span', { className: 'text-sm font-semibold', children: row.display_name || row.name }),
      row.display_name && jsx(Badge, { variant: 'outline', children: row.name }),
      row.is_default && jsx(Badge, { children: t('profiles.default') }),
      jsx(Badge, { variant: 'muted', children: row.gateway_running ? t('profiles.gateway') : t('profiles.gatewayOff') }),
      row.alias_name && row.alias_name !== row.name && jsx(Badge, { variant: 'outline', children: t('profiles.alias', row.alias_name) }),
    ] }),
    editing
      ? jsxs('div', { className: 'space-y-2', children: [
        jsxs('div', { className: 'space-y-1', children: [
          jsx('label', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: t('profiles.displayName') }),
          jsx(Input, { value: draftName, onChange: e => setDraftName(e.target.value), maxLength: 64, 'aria-label': t('profiles.displayName') }),
        ] }),
        jsxs('div', { className: 'space-y-1', children: [
          jsx('label', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: t('profiles.description') }),
          jsx(Textarea, { value: draftDesc, onChange: e => setDraftDesc(e.target.value), maxLength: 500, rows: 2, 'aria-label': t('profiles.description') }),
        ] }),
        jsxs('div', { className: 'flex gap-2', children: [
          jsx(Button, { type: 'button', size: 'sm', disabled: metaMutation.isPending,
            onClick: () => metaMutation.mutate({ profile: row.name, display_name: draftName, description: draftDesc }),
            children: t('profiles.save') }),
          jsx(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: () => setEditing(false), children: t('profiles.cancel') }),
        ] }),
      ] })
      : jsxs('p', { className: 'text-xs text-(--ui-text-tertiary)', children: [
        row.description || t('profiles.noDescription'),
        row.description && row.description_auto ? ` (${t('profiles.autoDesc')})` : '',
      ] }),
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx(Badge, { variant: 'outline', children: `${row.provider || '—'} / ${row.model || '—'}` }),
      jsx(Badge, { variant: 'muted', children: t('profiles.endpoints', row.endpoint_count) }),
      jsx(Badge, { variant: 'muted', children: t('profiles.keys', row.key_count) }),
      jsx(Badge, { variant: 'muted', children: t('profiles.skills', row.skill_count) }),
      row.error && jsx(Badge, { variant: 'destructive', children: row.error }),
    ] }),
    jsx(OptionRow, { label: t('profiles.pluginLabel'), hint: t('profiles.pluginHint'),
      checked: row.plugin_enabled, onChange: v => pluginMutation.mutate({ profile: row.name, enabled: v }) }),
    row.endpoint_count > 0 && jsxs('div', { className: 'flex flex-wrap items-end gap-2', children: [
      jsxs('div', { className: 'min-w-56 flex-1 space-y-1', children: [
        jsx('label', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: t('profiles.defaultRoute') }),
        jsxs(Select, { value: route, onValueChange: setRoute, children: [
          jsx(SelectTrigger, { className: 'w-full', 'aria-label': t('profiles.defaultRoute'),
            children: jsx(SelectValue, { placeholder: t('profiles.routePlaceholder') }) }),
          jsx(SelectContent, { children: row.endpoints.map(e =>
            jsx(SelectItem, { value: e.id, children: `${e.name} (${e.model})` }, e.id)) }),
        ] }),
      ] }),
      jsx(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: !route || activateMutation.isPending,
        onClick: () => setActivateOpen(true), children: t('profiles.activate') }),
    ] }),
    jsxs('div', { className: 'flex flex-wrap gap-2', children: [
      jsx(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: () => onUseAsSource(row.name),
        children: t('profiles.useAsSource') }),
      !editing && jsx(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: startEdit, children: t('profiles.edit') }),
    ] }),
    jsx(ConfirmDialog, {
      open: activateOpen,
      onClose: () => setActivateOpen(false),
      onConfirm: async () => { await activateMutation.mutateAsync({ profile: row.name, endpoint_id: route }); },
      title: t('profiles.activateTitle'),
      description: t('profiles.activateDesc', row.name),
      confirmLabel: t('profiles.activate'),
      cancelLabel: t('profiles.cancel'),
      destructive: true,
    }),
  ] });
}

function ProfilesPage({ ctx }) {
  const t = usePluginI18n(ID);
  const refreshMs = Number(ctx.storage.get('refreshInterval', 0)) * 1000;
  const query = useQuery({
    queryKey: [ID, 'profiles'],
    queryFn: () => ctx.rest('/profiles'),
    staleTime: 15_000,
    refetchInterval: refreshMs > 0 ? refreshMs : false,
  });
  const useAsSource = name => {
    ctx.storage.set('lastSource', name);
    host.navigate(pluginSettingsHref(ID, 'duplicate'));
  };
  if (query.isError) {
    return jsxs('div', { className: 'space-y-4', children: [
      jsx(PageHeader, { title: t('profiles.title'), subtitle: t('profiles.subtitle') }),
      jsx(BackendFailure, { error: query.error, retry: () => query.refetch(), t }),
    ] });
  }
  return jsxs('div', { className: 'space-y-4', children: [
    jsx(PageHeader, { title: t('profiles.title'), subtitle: t('profiles.subtitle'),
      onRefresh: () => query.refetch(), refreshing: query.isPending, refreshLabel: t('source.refresh') }),
    query.isPending
      ? jsxs('div', { className: 'space-y-3', children: [jsx(Skeleton, { className: 'h-32 w-full' }), jsx(Skeleton, { className: 'h-32 w-full' })] })
      : jsx('div', { className: 'space-y-3', children: (query.data?.profiles ?? []).map(row =>
        jsx(ProfileCard, { ctx, row, t, onUseAsSource: useAsSource }, row.name)) }),
  ] });
}

// ---------------------------------------------------------------------------
// Sub-page 3: Settings (management parameters)
// ---------------------------------------------------------------------------
function SettingsPage({ ctx }) {
  const t = usePluginI18n(ID);
  const [copyKeys, setCopyKeys] = useState(() => ctx.storage.get('copyKeys', true));
  const [validateFirst, setValidateFirst] = useState(() => ctx.storage.get('validateFirst', false));
  const [makeDefault, setMakeDefault] = useState(() => ctx.storage.get('makeDefault', false));
  const [onConflict, setOnConflict] = useState(() => ctx.storage.get('onConflict', 'update'));
  const [preferredSource, setPreferredSource] = useState(() => ctx.storage.get('preferredSource', ''));
  const [refreshInterval, setRefreshInterval] = useState(() => String(ctx.storage.get('refreshInterval', 0)));
  const [keepResults, setKeepResults] = useState(() => ctx.storage.get('keepResults', false));
  const health = useQuery({ queryKey: [ID, 'health'], queryFn: () => ctx.rest('/health'), staleTime: 30_000 });
  const overview = useQuery({ queryKey: [ID, 'overview'], queryFn: () => ctx.rest('/overview'), staleTime: 15_000 });

  const setOption = (key, setter) => value => { setter(value); ctx.storage.set(key, value); };
  const reset = () => {
    setOption('copyKeys', setCopyKeys)(true);
    setOption('validateFirst', setValidateFirst)(false);
    setOption('makeDefault', setMakeDefault)(false);
    setOption('onConflict', setOnConflict)('update');
    setOption('preferredSource', setPreferredSource)('');
    setOption('refreshInterval', setRefreshInterval)('0');
    setOption('keepResults', setKeepResults)(false);
  };

  return jsxs('div', { className: 'space-y-4', children: [
    jsx(PageHeader, { title: t('settings.title'), subtitle: t('settings.subtitle') }),
    jsx(StepCard, { step: 1, title: t('settings.defaults'), actions: jsx(Button, {
      type: 'button', variant: 'ghost', size: 'sm', onClick: reset, children: t('settings.reset') }),
      children: jsxs('div', { className: 'space-y-3', children: [
        jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('settings.defaultsHint') }),
        jsx(OptionRow, { label: t('options.copyKeys'), hint: t('options.copyKeysHint'),
          checked: copyKeys, onChange: setOption('copyKeys', setCopyKeys) }),
        jsx(OptionRow, { label: t('options.validateFirst'), hint: t('options.validateFirstHint'),
          checked: validateFirst, onChange: setOption('validateFirst', setValidateFirst) }),
        jsx(OptionRow, { label: t('options.makeDefault'), hint: t('options.makeDefaultHint'),
          checked: makeDefault, onChange: setOption('makeDefault', setMakeDefault), tone: 'warn' }),
        jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-3', children: [
          jsx('span', { className: 'text-sm font-medium', children: t('options.conflict') }),
          jsx(SegmentedControl, { value: onConflict, onChange: setOption('onConflict', setOnConflict),
            options: [{ id: 'update', label: t('options.conflictUpdate') }, { id: 'skip', label: t('options.conflictSkip') }] }),
        ] }),
        jsx(Separator, {}),
        jsxs('div', { className: 'space-y-1', children: [
          jsx('label', { className: 'text-sm font-medium', children: t('settings.preferredSource') }),
          jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('settings.preferredSourceHint') }),
          jsxs(Select, { value: preferredSource || 'none',
            onValueChange: v => setOption('preferredSource', setPreferredSource)(v === 'none' ? '' : v), children: [
            jsx(SelectTrigger, { className: 'w-full max-w-sm', 'aria-label': t('settings.preferredSource'),
              children: jsx(SelectValue, { placeholder: t('settings.sourceNone') }) }),
            jsxs(SelectContent, { children: [
              jsx(SelectItem, { value: 'none', children: t('settings.sourceNone') }),
              ...(overview.data?.profiles ?? []).map(p => jsx(SelectItem, { value: p.name, children: p.name }, p.name)),
            ] }),
          ] }),
        ] }),
        jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-3', children: [
          jsxs('div', { className: 'space-y-0.5', children: [
            jsx('span', { className: 'text-sm font-medium', children: t('settings.autoRefresh') }),
            jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('settings.autoRefreshHint') }),
          ] }),
          jsx(SegmentedControl, { value: refreshInterval, onChange: setOption('refreshInterval', setRefreshInterval),
            options: [{ id: '0', label: t('settings.refreshOff') }, { id: '15', label: '15 s' }, { id: '30', label: '30 s' }, { id: '60', label: '60 s' }] }),
        ] }),
        jsx(OptionRow, { label: t('settings.keepResults'), hint: t('settings.keepResultsHint'),
          checked: keepResults, onChange: setOption('keepResults', setKeepResults) }),
      ] }) }),
    jsx(StepCard, { step: 2, title: t('settings.backend'), children: jsxs('div', { className: 'space-y-2', children: [
      jsxs('div', { className: 'flex items-center gap-2 text-sm', children: [
        jsx(StatusDot, { tone: health.isError ? 'bad' : health.isPending ? 'muted' : 'good' }),
        jsx('span', { children: health.isError ? t('backend.title') : health.isPending ? '…' : t('settings.backendOk', health.data?.version ?? '?') }),
      ] }),
      jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('settings.manageProfiles') }),
    ] }) }),
  ] });
}

// ---------------------------------------------------------------------------
// Sub-page 4: Help
// ---------------------------------------------------------------------------
function HelpSection({ title, children }) {
  return jsxs('section', { className: 'space-y-1', children: [
    jsx('h2', { className: 'text-sm font-semibold', children: title }),
    jsx('p', { className: 'max-w-prose text-xs leading-relaxed text-(--ui-text-secondary)', children }),
  ] });
}

function HelpPage() {
  const t = usePluginI18n(ID);
  return jsxs('div', { className: 'space-y-4', children: [
    jsx('h1', { className: 'text-base font-semibold', children: t('help.title') }),
    jsx(HelpSection, { title: t('help.what'), children: t('help.whatBody') }),
    jsx(HelpSection, { title: t('help.keys'), children: t('help.keysBody') }),
    jsx(HelpSection, { title: t('help.validation'), children: t('help.validationBody') }),
    jsx(HelpSection, { title: t('help.safety'), children: t('help.safetyBody') }),
    jsx(HelpSection, { title: t('help.install'), children: t('help.installBody') }),
    jsx('pre', { className: 'whitespace-pre-wrap rounded-md border border-(--ui-stroke-secondary) p-3 text-xs', children:
      'hermes plugins install BeeWorks-IT/bw-duplicate-endpoints\nhermes plugins enable bw-duplicate-endpoints\n# restart the gateway once (hermes-serve), then open\n# Settings > Plugins > Duplicate Custom Endpoints' }),
  ] });
}

// ---------------------------------------------------------------------------
// Sub-page: New endpoint (multi-profile creation form)
// ---------------------------------------------------------------------------
function Field({ label, children }) {
  return jsxs('label', { className: 'grid gap-1.5 text-xs text-(--ui-text-secondary)', children: [label, children] });
}

function NewEndpointPage({ ctx }) {
  const t = usePluginI18n(ID);
  const overview = useQuery({ queryKey: [ID, 'overview'], queryFn: () => ctx.rest('/overview'), staleTime: 15_000 });
  const [form, setForm] = useState({ name: '', endpointId: '', baseUrl: '', model: '', apiKey: '', apiMode: '', contextLength: '', discoverModels: true, makeDefault: false });
  const [checked, setChecked] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [results, setResults] = useState(null);

  const profiles = overview.data?.profiles ?? [];
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggleProfile = name => setChecked(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next;
  });

  const urlOk = /^https?:\/\/[^\s]+$/i.test(form.baseUrl.trim());
  const missing = [];
  if (!form.name.trim()) missing.push(t('create.missingName'));
  if (!urlOk) missing.push(t('create.missingUrl'));
  if (!form.model.trim()) missing.push(t('create.missingModel'));
  if (!checked.size) missing.push(t('create.missingProfiles'));
  const canSubmit = missing.length === 0 && !overview.isPending;

  const payload = () => ({
    name: form.name.trim(),
    base_url: form.baseUrl.trim(),
    model: form.model.trim(),
    profiles: [...checked],
    endpoint_id: form.endpointId.trim(),
    api_key: form.apiKey.trim() || null,
    api_mode: form.apiMode,
    context_length: form.contextLength ? Number.parseInt(form.contextLength, 10) : null,
    discover_models: form.discoverModels,
    make_default: form.makeDefault,
  });

  const mutation = useMutation({
    mutationFn: body => ctx.rest('/create', { method: 'POST', body }),
    onSuccess: data => {
      setResults(data);
      invalidateAll();
      host.notify({ kind: data.summary?.failed ? 'warning' : 'success',
        message: t('create.notifyDone', data.summary?.succeeded ?? 0, data.summary?.failed ?? 0) });
    },
    onError: error => host.notifyError(error, t('create.notifyError')),
  });

  if (overview.isError) {
    return jsxs('div', { className: 'space-y-4', children: [
      jsx(PageHeader, { title: t('create.title'), subtitle: t('create.subtitle') }),
      jsx(BackendFailure, { error: overview.error, retry: () => overview.refetch(), t }),
    ] });
  }

  const fieldsCard = jsx(StepCard, { step: 1, title: t('create.title'), children: jsxs('div', { className: 'grid gap-3', children: [
    jsxs('div', { className: 'grid gap-3 sm:grid-cols-2', children: [
      jsx(Field, { label: t('create.name'), children: jsx(Input, { value: form.name, placeholder: t('create.namePlaceholder'),
        onChange: e => set('name', e.target.value), 'aria-label': t('create.name') }) }),
      jsx(Field, { label: t('create.providerId'), children: jsx(Input, { value: form.endpointId, placeholder: t('create.providerIdPlaceholder'),
        onChange: e => set('endpointId', e.target.value), 'aria-label': t('create.providerId') }) }),
    ] }),
    jsx(Field, { label: t('create.baseUrl'), children: jsx(Input, { value: form.baseUrl, placeholder: t('create.baseUrlPlaceholder'),
      onChange: e => set('baseUrl', e.target.value), 'aria-label': t('create.baseUrl') }) }),
    jsxs('div', { className: 'grid gap-3 sm:grid-cols-2', children: [
      jsx(Field, { label: t('create.model'), children: jsx(Input, { value: form.model, placeholder: t('create.modelPlaceholder'),
        onChange: e => set('model', e.target.value), 'aria-label': t('create.model') }) }),
      jsx(Field, { label: t('create.contextLength'), children: jsx(Input, { value: form.contextLength, inputMode: 'numeric',
        onChange: e => set('contextLength', e.target.value), 'aria-label': t('create.contextLength') }) }),
    ] }),
    jsx(Field, { label: t('create.apiKey'), children: jsx(Input, { type: 'password', value: form.apiKey, placeholder: t('create.apiKeyPlaceholder'),
      onChange: e => set('apiKey', e.target.value), 'aria-label': t('create.apiKey') }) }),
    jsxs('div', { className: 'space-y-1', children: [
      jsx('span', { className: 'text-xs text-(--ui-text-secondary)', children: t('create.apiMode') }),
      jsx(SegmentedControl, { value: form.apiMode, onChange: v => set('apiMode', v), sizing: 'content',
        options: [{ id: '', label: t('create.modeAuto') }, { id: 'chat_completions', label: t('create.modeChat') },
          { id: 'codex_responses', label: t('create.modeResponses') }, { id: 'anthropic_messages', label: t('create.modeAnthropic') }] }),
    ] }),
    jsxs('div', { className: 'flex flex-wrap gap-4', children: [
      jsxs('label', { className: 'flex cursor-pointer items-center gap-2 text-xs', children: [
        jsx(Checkbox, { checked: form.discoverModels, onCheckedChange: v => set('discoverModels', Boolean(v)), 'aria-label': t('create.discoverModels') }),
        t('create.discoverModels'),
      ] }),
      jsxs('label', { className: 'flex cursor-pointer items-center gap-2 text-xs text-amber-600 dark:text-amber-300', children: [
        jsx(Checkbox, { checked: form.makeDefault, onCheckedChange: v => set('makeDefault', Boolean(v)), 'aria-label': t('create.makeDefault') }),
        t('create.makeDefault'),
      ] }),
    ] }),
  ] }) });

  const profilesCard = jsx(StepCard, { step: 2, title: t('create.profiles'), children: jsxs('div', { className: 'space-y-2', children: [
    jsx('p', { className: 'text-xs text-(--ui-text-tertiary)', children: t('create.profilesHint') }),
    overview.isPending
      ? jsx(Skeleton, { className: 'h-20 w-full' })
      : jsx('div', { className: 'space-y-2', children: profiles.map(p =>
        jsxs('label', { className: 'flex cursor-pointer items-center gap-3 rounded-md border border-(--ui-stroke-secondary) p-3', children: [
          jsx(Checkbox, { checked: checked.has(p.name), onCheckedChange: () => toggleProfile(p.name), 'aria-label': p.name }),
          jsx('span', { className: 'text-sm font-medium', children: p.name }),
          jsx(Badge, { variant: 'muted', children: t('target.endpoints', p.endpoints.length) }),
        ] }, p.name)) }),
  ] }) });

  const runCard = jsx(StepCard, { step: 3, title: t('steps.run'), children: jsxs('div', { className: 'space-y-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2 text-sm', children: [
      jsx('span', { children: `${form.name.trim() || '…'} → ${checked.size} profile(s)` }),
      form.apiKey.trim() && jsx(Badge, { variant: 'success', children: t('create.keyCopied') }),
      form.makeDefault && jsx(Badge, { variant: 'warn', children: t('create.makeDefault') }),
    ] }),
    missing.length > 0 && jsx('ul', { className: 'list-inside list-disc space-y-0.5 text-xs text-(--ui-text-tertiary)',
      children: missing.map((m, i) => jsx('li', { children: m }, i)) }),
    jsx(Button, { type: 'button', onClick: () => setConfirmOpen(true), disabled: !canSubmit || mutation.isPending,
      children: t('create.button') }),
  ] }) });

  const resultsPanel = results && jsxs('section', { className: 'space-y-2 rounded-md border border-(--ui-stroke-secondary) p-4', children: [
    jsx('h2', { className: 'text-sm font-semibold', children: t('create.resultsTitle') }),
    jsx('div', { className: 'space-y-1.5', children: (results.results ?? []).map((r, i) =>
      jsxs('div', { className: 'flex flex-wrap items-center gap-1.5 text-xs', children: [
        jsx(StatusDot, { tone: r.ok ? (r.verified ? 'good' : 'warn') : 'bad' }),
        jsx('span', { className: 'font-medium', children: r.profile }),
        r.action && jsx(Badge, { variant: 'muted', children: t(`create.${r.action}`) }),
        r.key && jsx(Badge, { variant: r.key === 'copied' ? 'success' : 'muted',
          children: r.key === 'copied' ? t('create.keyCopied') : t('create.keyAbsent') }),
        r.ok && (r.verified ? jsx(Badge, { variant: 'success', children: t('create.verified') })
          : jsx(Badge, { variant: 'warn', children: t('results.notVerified') })),
        r.activated && jsx(Badge, { children: t('create.activated') }),
        r.error && jsx('span', { className: 'text-destructive', children: r.error }),
      ] }, i)) }),
  ] });

  return jsxs('div', { className: 'space-y-4', children: [
    jsx(PageHeader, { title: t('create.title'), subtitle: t('create.subtitle'),
      onRefresh: () => overview.refetch(), refreshing: overview.isPending, refreshLabel: t('source.refresh') }),
    fieldsCard, profilesCard, runCard, resultsPanel,
    jsx(ConfirmDialog, {
      open: confirmOpen,
      onClose: () => setConfirmOpen(false),
      onConfirm: async () => { await mutation.mutateAsync(payload()); },
      title: t('create.confirmTitle'),
      description: t('create.confirmDesc'),
      confirmLabel: t('create.confirm'),
      busyLabel: t('create.busy'),
      cancelLabel: t('create.cancel'),
      destructive: form.makeDefault,
      children: jsx('div', { className: 'space-y-1 text-sm', children: [
        jsx('div', { className: 'font-medium', children: form.name.trim() }),
        jsx('div', { className: 'font-mono text-xs text-(--ui-text-tertiary)', children: form.baseUrl.trim() }),
        jsx('div', { className: 'flex flex-wrap gap-1.5', children: [...checked].map(name =>
          jsx(Badge, { variant: 'outline', children: name }, name)) }),
      ] }),
    }),
  ] });
}

// ---------------------------------------------------------------------------
// Core editor seam (forward-compatible): when the host SDK exposes
// CUSTOM_ENDPOINT_FORM_AREA, offer "also create on other profiles" right inside
// the core Custom Endpoints editor. On older hosts the area is absent and this
// registration is skipped — the plugin's own pages cover the workflow.
// ---------------------------------------------------------------------------
function AlsoCreateProfiles({ ctx, profile, saved }) {
  const t = usePluginI18n(ID);
  const overview = useQuery({ queryKey: [ID, 'overview'], queryFn: () => ctx.rest('/overview'), staleTime: 15_000 });
  const [checked, setChecked] = useState(() => new Set());
  const [status, setStatus] = useState(null);
  const handled = useRef(0);

  const sourceName = profile ?? host.state.profile.get();
  const others = (overview.data?.profiles ?? []).filter(p => p.name !== sourceName);

  useEffect(() => {
    if (!saved || !saved.savedAt || saved.savedAt <= handled.current || checked.size === 0 || !sourceName) return;
    handled.current = saved.savedAt;
    const targets = [...checked];
    setStatus({ state: 'working' });
    ctx.rest('/duplicate', { method: 'POST', body: {
      source_profile: sourceName, endpoint_ids: [saved.id], target_profiles: targets,
      copy_keys: Boolean(saved.has_api_key), validate_first: false, make_default: false, on_conflict: 'update',
    } }).then(data => {
      invalidateAll();
      setStatus(data.summary?.failed ? { state: 'failed', message: t('also.failed') } : { state: 'done', message: t('also.done') });
    }).catch(() => setStatus({ state: 'failed', message: t('also.failed') }));
  }, [saved?.savedAt]);

  if (overview.isPending || others.length === 0) return null;
  return jsxs('div', { className: 'space-y-2 rounded-md border border-(--ui-stroke-secondary) p-3', children: [
    jsxs('div', { className: 'space-y-0.5', children: [
      jsx('div', { className: 'text-xs font-medium', children: t('also.title') }),
      jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: t('also.hint') }),
    ] }),
    jsx('div', { className: 'flex flex-wrap gap-3', children: others.map(p =>
      jsxs('label', { className: 'flex cursor-pointer items-center gap-2 text-xs', children: [
        jsx(Checkbox, { checked: checked.has(p.name),
          onCheckedChange: () => setChecked(prev => {
            const next = new Set(prev); next.has(p.name) ? next.delete(p.name) : next.add(p.name); return next;
          }), 'aria-label': p.name }),
        p.name,
      ] }, p.name)) }),
    status && jsxs('div', { className: 'flex items-center gap-1.5 text-xs', children: [
      jsx(StatusDot, { tone: status.state === 'done' ? 'good' : status.state === 'working' ? 'muted' : 'bad' }),
      jsx('span', { className: 'text-(--ui-text-tertiary)', children: status.message || t('also.working') }),
    ] }),
  ] });
}

// ---------------------------------------------------------------------------
// Plugin contract
// ---------------------------------------------------------------------------
export default {
  id: ID,
  name: 'Hermes Duplicate Settings',
  defaultEnabled: false,
  register(ctx) {
    ctx.i18n?.register?.({ en });
    const landing = () => jsx(DuplicatePage, { ctx });
    const children = [
      { id: 'duplicate', title: 'Duplicate endpoints', render: landing },
      { id: 'new-endpoint', title: 'New endpoint', render: () => jsx(NewEndpointPage, { ctx }) },
      { id: 'profiles', title: 'Profiles', render: () => jsx(ProfilesPage, { ctx }) },
      { id: 'settings', title: 'Settings', render: () => jsx(SettingsPage, { ctx }) },
      { id: 'help', title: 'Help', render: () => jsx(HelpPage, {}) },
    ];
    if (typeof ctx.registerSettingsPage === 'function') {
      ctx.registerSettingsPage({ id: 'endpoints', title: 'Duplicate Custom Endpoints', icon: 'plug', order: 40, render: landing, children });
    } else {
      ctx.register({ id: 'endpoints', area: SETTINGS_PLUGINS_AREA, title: 'Duplicate Custom Endpoints', render: landing,
        data: { icon: 'plug', children } });
    }
    ctx.register({
      id: 'open-duplicate', area: PALETTE_AREA,
      data: {
        id: `${ID}.open`,
        label: 'Hermes Duplicate Settings: Duplicate endpoint to profile',
        keywords: ['endpoint', 'duplicate', 'profile', 'provider', 'custom'],
        run: () => host.navigate(pluginSettingsHref(ID, 'duplicate')),
      },
    });
    ctx.register({
      id: 'open-profiles', area: PALETTE_AREA,
      data: {
        id: `${ID}.profiles`,
        label: 'Hermes Duplicate Settings: Manage profiles',
        keywords: ['profiles', 'manage', 'metadata', 'gateway'],
        run: () => host.navigate(pluginSettingsHref(ID, 'profiles')),
      },
    });
    ctx.register({
      id: 'open-new-endpoint', area: PALETTE_AREA,
      data: {
        id: `${ID}.new`,
        label: 'Hermes Duplicate Settings: New endpoint on profiles',
        keywords: ['endpoint', 'new', 'create', 'profile', 'provider'],
        run: () => host.navigate(pluginSettingsHref(ID, 'new-endpoint')),
      },
    });
    // Forward-compatible core editor seam: only registers when the host SDK
    // exposes the area (see the companion hermes-agent PR). Older hosts skip it.
    if (SDK.CUSTOM_ENDPOINT_FORM_AREA) {
      ctx.register({
        id: 'also-create-profiles', area: SDK.CUSTOM_ENDPOINT_FORM_AREA,
        data: { render: props => jsx(AlsoCreateProfiles, { ctx, ...props }) },
      });
    }
  },
};
