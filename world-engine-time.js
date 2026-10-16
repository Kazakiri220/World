// 剧情时间标注。只记录时间，不改变按轮推进、骰子或 API 调度。
window.WORLD_ENGINE_TIME = (function() {
  const FIELDS = ['firstRecordedAt', 'lastChangedAt', 'occurredAt', 'expectedAt'];
  const LABELS = { firstRecordedAt: '首次记录', lastChangedAt: '最近变化', occurredAt: '发生时间', expectedAt: '预计／截止' };
  const COLLECTIONS = {
    events: ['name', ['type', 'stage', 'level', 'stall']],
    factions: ['name', ['scope', 'status', 'relation', 'core_person', 'powerPillars']],
    winds: ['topic', ['type', 'level', 'scope']],
    worldTrends: ['name', ['scope', 'status']],
    enemies: ['name', ['type', 'status']],
    influenceChain: ['trigger', []],
    'economy.signals': ['summary', ['scope']],
    'blackbox.secretActions': ['action', ['witnesses']],
    'blackbox.secretAssets': ['name', ['exposure', 'status']]
  };
  const SINGLETONS = {
    reputation: ['authority', 'common', 'shadow', 'circuit'],
    economy: ['climate'],
    regionalIncident: ['active', 'title', 'type', 'scope']
  };
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const clean = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const comparable = value => JSON.stringify(value, (key, val) => typeof val === 'string' ? val.replace(/\s+/g, '') : val);
  function get(object, path) { return path.split('.').reduce((v, key) => v?.[key], object); }
  function stamp(value, source = 'dialogue', layer = null) {
    const text = clean(typeof value === 'string' ? value : value?.text);
    if (!text || /^(?:未知|不详|未确定|unknown|null)$/i.test(text)) return null;
    const requested = typeof value === 'object' ? value.source : source;
    return { text, source: ['dialogue', 'manual', 'inherited'].includes(requested) ? requested : source,
      sourceLayer: Number.isInteger(value?.sourceLayer) ? value.sourceLayer : Number.isInteger(layer) ? layer : null,
      evidence: clean(value?.evidence, 400) || null };
  }
  function normalizeItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const previous = item.time || {};
    item.time = Object.fromEntries(FIELDS.map(key => [key, stamp(previous[key])]));
  }
  function normalizeState(state) {
    state.storyTime = stamp(state.storyTime);
    for (const [path, [key]] of Object.entries(COLLECTIONS)) {
      const items = get(state, path);
      if (!Array.isArray(items)) continue;
      for (let index = 0; index < items.length; index++) {
        if (typeof items[index] === 'string' && ['economy.signals', 'blackbox.secretActions', 'blackbox.secretAssets'].includes(path)) {
          items[index] = { [key]: items[index] };
        }
        normalizeItem(items[index]);
      }
    }
    for (const path of Object.keys(SINGLETONS)) normalizeItem(state[path]);
    return state;
  }
  function includesEvidence(text, evidence) {
    const needle = clean(evidence, 400).replace(/\s+/g, '');
    return needle.length >= 2 && String(text || '').replace(/\s+/g, '').includes(needle);
  }
  function requestContext(state, userMsg, aiMsg, opts = {}) {
    // 只使用本次实际处理的正文；回填时绝不读取聊天末尾或数据库最新缓存。
    const text = opts.dialogueText || [userMsg, aiMsg].filter(Boolean).join('\n');
    return { text, layer: opts.targetLayer ?? window.WORLD_ENGINE_CORE.getChatLayer(), previous: copy(state.storyTime), fresh: opts.fresh === true };
  }
  function prompt(context) {
    return `### 剧情时间标注（对所有预设生效）
本功能只标注剧情时间，不改变既有按轮推演规则。现实电脑时间、消息发送时间、轮数都不是剧情日期。
上次世界状态的剧情时间：${JSON.stringify(context.previous)}；本次处理至聊天第 ${context.layer} 楼。
在原有完整世界更新 JSON 根对象中增加 storyTime: {"text":"本段末尾当前场景的明确时间，保留原精度及纪年", "evidence":"本次近期对话中能直接支持此时间的原文短句"}；没有明确当前场景时间则返回 null，由本地标记沿用或未知。不得仅返回时间对象。
只选当前场景时间。回忆、引用、计划、截止日期及假设不是当前时间；不要因为它们更晚就选它们。不得推算一轮等于一天，不补造缺失的年/月/日/时分。虚构纪年原样保留。
events/factions/winds/worldTrends/enemies/influenceChain、economy/signals、reputation、regionalIncident、blackbox.secretActions/secretAssets 的对象均可增加 time：
{"occurredAt":{"text":"事实实际发生的时间或时间范围", "evidence":"支持这一时间的本次正文原句"}, "expectedAt":{"text":"明确的预计时间或截止时间", "evidence":"本次正文原句"}, "changed":true}
未知或本次没有新依据的字段省略或 null。发生时间不同于获知/记录时间；中途记录旧事件，不得把当前时间当成发生时间。相对日期只有在本段提供明确日期锚点时才可换算，否则保留原表述和参照说明。
changed 仅在实际新增事实、行动、目标变化或后果时为 true；仅重复、换句话说、改名或原样复述时必须为 false。该标记供本地合并，不会成为持久信息。
firstRecordedAt/lastChangedAt 由本地维护，禁止自行填写或重置；已有 time 字段不得因未返回而被清空。世界后台新生成事实若缺少准确发生时间，则保持 occurredAt 未知，不编造时间。`;
  }
  function resolveClock(candidate, context) {
    const next = stamp(candidate, 'dialogue', context.layer);
    if (next && includesEvidence(context.text, candidate?.evidence)) {
      next.source = 'dialogue'; next.sourceLayer = context.layer;
      return next;
    }
    const previous = stamp(context.previous);
    if (previous) previous.source = 'inherited';
    return previous;
  }
  function factualTime(candidate, context) {
    if (!candidate || !includesEvidence(context.text, candidate.evidence)) return null;
    const result = stamp(candidate, 'dialogue', context.layer);
    if (result) { result.source = 'dialogue'; result.sourceLayer = context.layer; }
    return result;
  }
  function material(item, keys) { return keys.some(key => comparable(item.before?.[key]) !== comparable(item.after?.[key])); }
  function narrative(item) {
    const omit = new Set(['time', 'stageRound', 'consecutiveFails', 'evolveResult', 'quietRounds', 'cooldown', 'duration', 'signals']);
    const pick = obj => Object.fromEntries(Object.entries(obj || {}).filter(([key]) => !omit.has(key) && !key.startsWith('_')));
    return comparable(pick(item.before)) !== comparable(pick(item.after));
  }
  function applyItem(after, before, incoming, keys, clock, context) {
    if (!after || typeof after !== 'object') return;
    const old = before?.time || {};
    // 老条目首次记录时间未知就一直未知，不把升级后第一次看到它的时间当作出生时间。
    const time = Object.fromEntries(FIELDS.map(key => [key, stamp(old[key])]));
    if (!before) { time.firstRecordedAt = copy(clock); time.lastChangedAt = copy(clock); }
    else if (material({ before, after }, keys) || (incoming?.time?.changed === true && narrative({ before, after }))) {
      time.lastChangedAt = copy(clock);
    }
    for (const key of ['occurredAt', 'expectedAt']) {
      const explicit = factualTime(incoming?.time?.[key], context);
      if (explicit && time[key]?.source !== 'manual') time[key] = explicit;
    }
    after.time = time;
  }
  function find(items, item, key, strictIdentity = false) {
    if (!Array.isArray(items)) return null;
    if (item.id) {
      const match = items.find(other => other?.id === item.id);
      if (match) return match;
      if (strictIdentity) return null;
    }
    const matches = items.filter(other => comparable(other?.[key]) === comparable(item[key]));
    return matches.length === 1 ? matches[0] : null;
  }
  function apply(state, baseline, update, context) {
    const clock = resolveClock(update.storyTime, context);
    state.storyTime = clock;
    for (const [path, [key, keys]] of Object.entries(COLLECTIONS)) {
      for (const item of get(state, path) || []) {
        if (!item || typeof item !== 'object') continue;
        applyItem(item, find(get(baseline, path), item, key, true), find(get(update, path), item, key), keys, clock, context);
      }
    }
    for (const [path, keys] of Object.entries(SINGLETONS)) {
      const after = state[path], before = baseline[path];
      if (path === 'regionalIncident' && !after?.title) { normalizeItem(after); continue; }
      const old = context.fresh || (path === 'regionalIncident' && (!before?.title || before.title !== after?.title)) ? null : before;
      applyItem(after, old, update[path], keys, clock, context);
    }
    // 终局事件可能在本轮即清退，先前调用 apply 的时间信息也随账本保留。
    return state;
  }
  function format(value, fallback = '未知') {
    const v = stamp(value);
    return v ? v.text + (v.source === 'inherited' ? '（沿用）' : '') : fallback;
  }
  function finalizeResult(state, update) {
    // lastEvolveResult 也会落盘并传给记忆引擎，只保留已采纳的时间，不传播临时标记或无依据日期。
    update.storyTime = copy(state.storyTime);
    for (const [path, [key]] of Object.entries(COLLECTIONS)) {
      for (const item of get(update, path) || []) {
        if (!item || typeof item !== 'object') continue;
        const accepted = find(get(state, path), item, key);
        if (accepted) item.time = copy(accepted.time);
        else delete item.time;
      }
    }
    for (const path of Object.keys(SINGLETONS)) {
      if (update[path] && typeof update[path] === 'object' && Object.keys(update[path]).length) {
        update[path].time = copy(state[path]?.time);
      }
    }
  }
  function brief(item) {
    const time = item?.time;
    if (!time) return '';
    const result = [['occurredAt', '发生'], ['lastChangedAt', '最近变化'], ['expectedAt', '预计／截止']]
      .filter(([key]) => time[key]).map(([key, label]) => `${label}：${format(time[key])}`).join('；');
    return result || (time.firstRecordedAt ? `首次记录：${format(time.firstRecordedAt)}` : '');
  }
  function setManualClock(state, text, layer) { state.storyTime = stamp(text, 'manual', layer); }
  function setManualItem(item, values, layer) {
    normalizeItem(item);
    for (const key of FIELDS) if (Object.prototype.hasOwnProperty.call(values, key)) item.time[key] = stamp(values[key], 'manual', layer);
  }
  return { FIELDS, LABELS, COLLECTIONS, SINGLETONS, normalizeState, requestContext, prompt, apply, finalizeResult, format, brief,
    setManualClock, setManualItem };
})();
