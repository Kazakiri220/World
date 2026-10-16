// 随消息携带的世界历史。只操作 world_engine_* 字段，不监听正文编辑。
window.WORLD_ENGINE_HISTORY = (function() {
  const ROOT = 'world_engine_history_root', NODES = 'world_engine_history';
  const MID = 'world_engine_message_id', VID = 'world_engine_version_id';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const uid = () => 'wh-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const core = () => window.WORLD_ENGINE_CORE;
  const store = () => window.WORLD_ENGINE_STORE;
  const ctx = () => SillyTavern.getContext();
  const chat = () => ctx()?.chat || [];
  const root = () => chat()[0]?.[ROOT];
  let serial = 0, writing = false, ready = false, blocked = false;

  function messageId(message) { return message[MID] || (message[MID] = uid()); }
  function versionId(message, create = false) {
    if (!message || message.is_user) return '';
    const index = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    let id = message.swipe_info?.[index]?.extra?.[VID] || message.extra?.[VID];
    // 一次生成多个备选时，酒馆可能复制 extra；后续备选须有独立身份。
    if (id && message.swipe_info?.some((s, i) => i < index && s?.extra?.[VID] === id)) id = null;
    if (!id && create) id = uid();
    if (id && create) {
      if (!message.extra || typeof message.extra !== 'object') message.extra = {};
      message.extra[VID] = id;
      if (message.swipe_info?.[index]) {
        message.swipe_info[index].extra ||= {};
        message.swipe_info[index].extra[VID] = id;
      }
    }
    return id || '';
  }
  function cleanState(state) {
    const next = clone(state);
    for (const key of ['lastInjection', 'lastEvolveResult', 'lastUpdated', '_terminalEventsThisRound',
      '_historyPending', '_historyNodeId', '_historyEpoch', 'backfillJob']) delete next[key];
    return next;
  }
  function pack(state = core().loadState()) {
    return { state: cleanState(state), worldbook: store().getItem('world_engine_worldbook_selection_' + core().getChatId()) };
  }
  function saveChat() {
    const context = ctx();
    try {
      const result = typeof context.saveChat === 'function' ? context.saveChat() : context.saveMetadata?.();
      result?.catch?.(e => console.warn('[世界历史] 聊天保存失败', e));
    } catch (e) { console.warn('[世界历史] 聊天保存失败', e); }
  }
  function diff(before, after, path = [], out = []) {
    if (JSON.stringify(before) === JSON.stringify(after)) return out;
    if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!Object.prototype.hasOwnProperty.call(after, key)) out.push({ path: [...path, key], remove: true });
        else diff(before[key], after[key], [...path, key], out);
      }
    } else out.push({ path, value: clone(after) });
    return out;
  }
  function apply(base, patch) {
    let result = clone(base);
    for (const op of patch) {
      if (!op.path.length) { result = clone(op.value); continue; }
      let target = result;
      for (const key of op.path.slice(0, -1)) target = target[key];
      const key = op.path[op.path.length - 1];
      if (op.remove) delete target[key];
      else Object.defineProperty(target, key, { value: clone(op.value), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  function inventory() {
    const base = root(), all = [];
    chat().forEach((message, layer) => {
      for (const node of Object.values(message[NODES]?.versions || {})) {
        if (node?.epoch === base?.epoch) all.push({ node, message, layer });
      }
    });
    const byId = new Map(all.map(x => [x.node.id, x]));
    const memo = new Map(base ? [[base.id, clone(base.pack)]] : []), visiting = new Set();
    function materialize(id) {
      if (memo.has(id)) return clone(memo.get(id));
      const item = byId.get(id);
      if (!item || visiting.has(id)) return null;
      visiting.add(id);
      const prior = item.node.full ? null : materialize(item.node.parentId);
      const value = item.node.full ? clone(item.node.full) : prior ? apply(prior, item.node.patch || []) : null;
      visiting.delete(id); if (value) memo.set(id, value);
      return clone(value);
    }
    const positions = new Map(chat().map((m, i) => [m[MID], { message: m, layer: i }]));
    const active = [];
    let head = base?.id;
    for (const item of all) {
      const { node, message, layer } = item;
      if (layer <= (base?.floor ?? -1) || versionId(message) !== node.versionId || node.parentId !== head) continue;
      const sources = node.sources || [];
      if (sources.some(ref => {
        const found = positions.get(ref.id);
        return !found || (ref.version && versionId(found.message) !== ref.version);
      })) continue;
      if (!materialize(node.id)) continue;
      active.push(item); head = node.id;
    }
    return { base, all, active, byId, materialize };
  }
  function clearNodes(from = 0) {
    chat().forEach((m, i) => { if (i >= from) delete m[NODES]; });
  }
  function createRoot(state, floor) {
    if (!chat().length) return null;
    const epoch = uid();
    const data = { v: 1, epoch, id: uid(), ownerChatId: core().getChatId(), floor, highWater: chat().length - 1,
      prunedBefore: Math.max(0, floor), pack: pack({ ...state, chatLayer: floor, processedThrough: floor }) };
    chat()[0][ROOT] = data;
    chat().forEach(m => { messageId(m); versionId(m, true); });
    blocked = false;
    return data;
  }
  function beginRebuild() {
    serial++; writing = true;
    try { clearNodes(); createRoot(core().getDefaultState(), -1); }
    finally { writing = false; }
    saveChat();
  }
  function install(value, layer, nodeId, checkpoint) {
    writing = true;
    try {
      const state = clone(value.state);
      state.chatLayer = layer; state.processedThrough = layer;
      state._historyEpoch = root()?.epoch; state._historyNodeId = nodeId;
      core().saveState(state);
      if (checkpoint) core().saveCheckpoint(checkpoint); else core().clearCheckpoint();
      core().saveFingerprint(String(layer));
      store().removeItem('world_engine_' + core().getChatId() + '_backfill');
      const key = 'world_engine_worldbook_selection_' + core().getChatId();
      if (value.worldbook != null) store().setItem(key, value.worldbook); else store().removeItem(key);
    } finally { writing = false; }
  }
  function getStatus() {
    const inv = inventory();
    const bytes = new TextEncoder().encode(JSON.stringify(inv.base || {}) + inv.all.map(x => JSON.stringify(x.node)).join('')).length;
    return { blocked, earliestLayer: Math.max(0, inv.base?.floor ?? 0, inv.base?.prunedBefore || 0),
      processedThrough: core().hasState() ? core().loadState().processedThrough : null,
      snapshots: inv.all.length, bytes, retentionLayers: Math.max(0, parseInt(window.WORLD_ENGINE_API.getSettings().historyRetentionLayers) || 0) };
  }
  function prune() {
    const inv = inventory(), base = inv.base;
    if (!base) return;
    const limit = Math.max(0, parseInt(window.WORLD_ENGINE_API.getSettings().historyRetentionLayers) || 0);
    base.highWater = Math.max(base.highWater || 0, chat().length - 1);
    const cutoff = limit ? Math.max(0, base.highWater - limit + 1) : 0;
    if (cutoff <= (base.prunedBefore || 0)) return;
    // 先解开旧链，再移动基底；绝不先删掉仍被新节点依赖的差分。
    const materialized = new Map(inv.all.map(x => [x.node.id, inv.materialize(x.node.id)]));
    const before = inv.active.filter(x => x.layer < cutoff).pop();
    if (before) { base.pack = materialized.get(before.node.id); base.id = before.node.id; }
    base.floor = Math.max(base.floor, cutoff - 1); base.prunedBefore = cutoff;
    for (const item of inv.all) if (item.layer < cutoff) delete item.message[NODES];
    const retained = inv.all.filter(x => x.layer >= cutoff), ids = new Set(retained.map(x => x.node.id));
    for (const { node } of retained) {
      if (node.parentId !== base.id && !ids.has(node.parentId)) {
        node.full = materialized.get(node.id); delete node.patch; node.parentId = base.id;
      }
    }
    saveChat();
  }
  function commit(state, options = {}) {
    if (!ready || writing || blocked || !root() || window.WORLD_ENGINE_API.getSettings().engineEnabled === false) return false;
    const layer = Number(options.layer ?? state.chatLayer ?? core().getChatLayer());
    const message = chat()[layer];
    const value = pack(state);
    if (layer <= root().floor) {
      if (Number(root().pack.state.processedThrough ?? root().pack.state.chatLayer) > layer) return false;
      if (JSON.stringify(root().pack) === JSON.stringify(value)) return false;
      root().pack = value;
      writing = true;
      try { state._historyEpoch = root().epoch; state._historyNodeId = root().id; core().saveState(state); }
      finally { writing = false; }
      saveChat(); return true;
    }
    if (!message) return false;
    const inv = inventory();
    const previous = inv.active.filter(x => x.layer < layer).pop();
    const parentId = previous?.node.id || root().id;
    const parent = inv.materialize(parentId), version = versionId(message, true);
    const existing = message[NODES]?.versions?.[version];
    if (existing && JSON.stringify(inv.materialize(existing.id)) === JSON.stringify(value)) return false;
    // 改写某层的世界后，其后旧世界链不再作为当前分支的有效后继；正文编辑不走此入口。
    if (inv.active.some(x => x.layer > layer)) clearNodes(layer + 1);
    const from = options.fromLayer ?? previous?.layer + 1;
    const start = Number.isFinite(from) ? from : root().floor + 1;
    const sources = chat().slice(Math.max(0, start), layer + 1).map(m => ({ id: messageId(m), version: versionId(m, true) }));
    const node = { id: existing?.id || uid(), epoch: root().epoch, parentId, versionId: version, layer,
      fromLayer: start, batched: options.batched === true || state._historyPending?.batched === true,
      sources, seq: (previous?.node.seq || 0) + 1 };
    const patch = parent ? diff(parent, value) : null;
    if (!parent || node.seq % 20 === 0 || JSON.stringify(patch).length >= JSON.stringify(value).length) node.full = value;
    else node.patch = patch;
    message[NODES] ||= { v: 1, versions: {} };
    message[NODES].versions[version] = node;
    writing = true;
    try {
      delete state._historyPending;
      state._historyEpoch = root().epoch; state._historyNodeId = node.id;
      core().saveState(state);
    } finally { writing = false; }
    prune(); saveChat();
    return true;
  }
  function markPending(state, options) {
    if (!root()) return;
    if (state._historyEpoch !== root().epoch) {
      const inv = inventory();
      state._historyEpoch = root().epoch;
      state._historyNodeId = inv.active[inv.active.length - 1]?.node.id || root().id;
    }
    state._historyPending = { epoch: root().epoch, layer: options.layer,
      version: versionId(chat()[options.layer], true), fromLayer: options.fromLayer, batched: options.batched === true };
  }
  function onStateSaved(state) {
    if (!window.WORLD_ENGINE_EVOLUTION?.isRunning?.()) commit(state, { fromLayer: state._historyPending?.fromLayer });
  }
  function restoreToLayer(target, options = {}) {
    const inv = inventory(), base = inv.base;
    if (!base) return { ok: false, reason: 'no-base' };
    if (target < base.floor || (base.prunedBefore > 0 && target < base.prunedBefore && !(options.allowBoundary && target === base.prunedBefore - 1))) {
      return { ok: false, reason: 'history-pruned' };
    }
    if (options.range && inv.active.some(x => x.node.batched && x.node.fromLayer <= target && x.layer > target)) {
      return { ok: false, reason: 'batch-boundary' };
    }
    const selected = inv.active.filter(x => x.layer <= target).pop();
    const nodeId = selected?.node.id || base.id, value = inv.materialize(nodeId);
    if (!value) return { ok: false, reason: 'no-base' };
    const layer = selected?.layer ?? Number(value.state.processedThrough ?? value.state.chatLayer ?? base.floor);
    const prior = selected ? inv.materialize(selected.node.parentId) : null;
    serial++; blocked = false;
    install(value, layer, nodeId, prior?.state || null);
    if (options.truncate) clearNodes(target + 1);
    saveChat();
    return { ok: true, layer };
  }
  function rebase() {
    serial++; writing = true;
    try { clearNodes(); const state = core().loadState(); createRoot(state, core().getChatLayer()); }
    finally { writing = false; }
    saveChat();
  }
  function sync() {
    serial++; blocked = false;
    if (window.WORLD_ENGINE_API.getSettings().engineEnabled === false) return;
    if (!chat().length || core().getChatId() === 'default') return;
    if (!root()) {
      const state = core().hasState() ? core().loadState() : null;
      const cp = core().restoreCheckpoint();
      const legacy = state && Number.isFinite(Number(state.chatLayer)) ? state : null;
      const baseline = legacy && cp && Number.isFinite(Number(cp.chatLayer)) && cp.chatLayer < state.chatLayer ? cp : legacy;
      createRoot(baseline || core().getDefaultState(), baseline ? Number(baseline.chatLayer) : -1);
      if (legacy && Number(legacy.chatLayer) > root().floor && chat()[legacy.chatLayer]) commit(legacy);
      prune(); saveChat();
    }
    const ownerChanged = root().ownerChatId !== core().getChatId();
    const inv = inventory(), last = inv.active[inv.active.length - 1], id = last?.node.id || root().id;
    const state = core().hasState() ? core().loadState() : null;
    const pending = state?._historyPending;
    if (!ownerChanged && pending?.epoch === root().epoch && pending.layer < chat().length &&
      pending.version === versionId(chat()[pending.layer]) && state._historyNodeId === id) {
      writing = true;
      try { window.WORLD_ENGINE_LEDGER?.recordChanges?.(state); } finally { writing = false; }
      commit(state, { layer: pending.layer, fromLayer: pending.fromLayer, batched: pending.batched });
    } else if (root().floor > chat().length - 1 || ownerChanged || state?._historyEpoch !== root().epoch || state?._historyNodeId !== id) {
      const result = restoreToLayer(chat().length - 1);
      if (!result.ok) {
        blocked = true;
        writing = true;
        try {
          const empty = core().getDefaultState(); empty.worldDigest = '该位置的世界历史未保存或已清理，请选择范围重建。';
          core().saveState(empty); core().clearCheckpoint();
          store().removeItem('world_engine_' + core().getChatId() + '_backfill');
        } finally { writing = false; }
      }
    }
    root().ownerChatId = core().getChatId();
    prune(); saveChat();
  }
  function captureGuard(layer) {
    const generation = serial, id = core().getChatId(), message = chat()[layer], version = versionId(message, true);
    return () => serial === generation && core().getChatId() === id && chat()[layer] === message && versionId(message) === version;
  }
  function init() {
    if (ready) return; ready = true;
    const context = ctx();
    context.eventSource?.on?.(context.event_types?.CHAT_LOADED || 'chat_loaded', () => {
      window.WORLD_ENGINE_EVOLUTION?.abort?.(); sync();
    });
    sync();
  }
  return { init, sync, commit, prune, getStatus, beginRebuild, rebase, restoreToLayer, captureGuard, markPending, onStateSaved,
    isBlocked: () => blocked, block: () => { blocked = true; serial++; }, invalidateRequests: () => { serial++; } };
})();
