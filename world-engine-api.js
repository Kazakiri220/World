// world-engine-api.js — 独立 API 调用（支持自定义 OpenAI 兼容 API）
window.WORLD_ENGINE_API = (function() {
  // API 请求实现可以被两个引擎复用，但覆盖配置绝不能以世界引擎设置补缺。
  // 调用方一旦显式传入 settingsOverride，就只叠加无状态默认值。
  const REQUEST_DEFAULTS = Object.freeze({
    apiUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    connectionMode: 'direct',
    apiSource: 'custom',
    tavernProfileId: '',
    apiScope: 'world',
    apiPoolEnabled: false,
    apiPool: Object.freeze([]),
    apiRpmLimit: 0,
    temperature: 0.7,
    maxTokens: 65000,
    apiTimeoutMs: 120000
  });
  let cachedSettings = null;

  function getSettings(forceRefresh) {
    if (forceRefresh) cachedSettings = null;
    if (cachedSettings) return cachedSettings;
    const defaults = {
      apiUrl: '',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 65000,
      apiAutoRetries: 0,
      engineEnabled: true,
      firstLayerIsAiOpening: true,
      // [FIX] 连接方式：'direct'=浏览器直连（默认，原有行为）；'proxy'=经酒馆服务端转发，绕过第三方 API 的 CORS 限制
      connectionMode: 'direct',
      apiSource: 'custom',
      apiProfileId: '',
      tavernProfileId: '',
      apiScope: 'world',
      apiPoolEnabled: false,
      apiPool: [],
      apiRpmLimit: 0,
      injectIntoPrompt: true,
      injectMaxChars: 5000,
      // 正文注入等级筛选：false=仅注入高等级信息（兼容旧行为），true=事件链与风声不按等级过滤
      injectAllLevels: false,
      // 世界 API 成功后，把本轮世界信息联动到记忆引擎。
      memoryLinkEnabled: false,
      evolveMode: 'auto',
      // 酒馆缓存：把按聊天隔离的存档镜像进 chat_metadata，实现跨设备同步与防丢失存档（默认关闭）
      syncToChat: false,   // 实时同步：工作区状态持续镜像进聊天，换设备打开同一聊天即可续上
      autoBackup: false,   // 滚动自动备份：每当轮次推进，自动存一条到聊天（保留最近几条）
      worldbookTrigger: false, // 世界书蓝绿灯触发：🔵常驻恒注入 / 🟢关键词命中才注入（默认关闭=全部已选注入）
      // 范围更新：起止与数量统一按酒馆消息楼层，批次大小按 AI 回复数。
      backfillBatchSize: 5,    // 每批 AI 楼层数（每多少层调一次推演）
      backfillRetries: 2,      // 每批独立重试次数（推演失败时重试上限）
      backfillEndLayer: 0,     // 结束聊天楼层（0 = 最新 AI 回复）
      backfillMode: 'continue',
      backfillStartLayer: 0,
      backfillLayerCount: 0,
      historyRetentionLayers: 200, // 按酒馆聊天楼层保留世界历史；0 = 不限。
      evolveEveryX: 1,
      evolveReadRounds: 1,
      manualReadRounds: 1,
      evolveFilterRegex: '',
      tonePrompt: '',
      // 按时间推演模式
      evolveTimeFront: 0,
      evolveTimeBack: 80,
      evolveTimeRe1: '', evolveTimeRe2: '', evolveTimeRe3: '',
      evolveTimeRe4: '', evolveTimeRe5: '', evolveTimeRe6: '',
      evolveTimeMul1: 360, evolveTimeMul2: 30, evolveTimeMul3: 1,
      evolveTimeThreshold: 1,
      evolveTimeMaxRounds: 10,
      // Local mechanism tuning. Defaults match the previous hard-coded behavior.
      localRegionalIncidentChancePercent: 3,
      localRegionalIncidentDuration: 5,
      localRegionalIncidentCooldown: 5,
      localDistantEventLedgerThreshold: 10,
      localDistantEventChancePercent: 20,
      localDistantEventCooldown: 5,
      localDistantEventEventPercent: 50,
      localNearEventChancePercent: 20,
      localNearEventCooldown: 5,
      localNearEventEventPercent: 50,
      localEventDiceModifier: 0,
      localEventSetbackRatioPercent: 40,
      localProgressFailBase: 2,
      localConflictFailBase: 6,
      localTerminalBaseKeepRounds: 2,
      localTerminalLevelKeepRounds: 2,
      localInfluenceKeepRounds: 8,
      localEnemyTerminalKeepRounds: 20,
      localLedgerKeepRounds: 20,
      localCapEvents: 16,
      localCapFactions: 15,
      localCapWinds: 12,
      localCapWorldTrends: 4,
      localCapInfluence: 12,
      localCapEnemies: 8,
      localCapEconomySignals: 8,
      localCapBlackbox: 12,
      localWindAnnouncementBase: 10,
      localWindAnnouncementGrace: 4,
      localWindAnnouncementLinear: 3,
      localWindAnnouncementQuadratic: 1,
      localWindReportBase: 20,
      localWindReportGrace: 2,
      localWindReportLinear: 4,
      localWindReportQuadratic: 2,
      localWindRumorBase: 25,
      localWindRumorGrace: 1,
      localWindRumorLinear: 5,
      localWindRumorQuadratic: 3,
      localWindSentimentBase: 8,
      localWindSentimentGrace: 5,
      localWindSentimentLinear: 2,
      localWindSentimentQuadratic: 1,
      // [FIX] API 请求超时（毫秒）。0 = 不超时（旧行为）。默认 120s：
      //   推演请求若落入网络黑洞（代理无响应/上游不返回也不报错），fetch 会永久挂起，
      //   evolve 的 _isRunning 永不复位，此后所有自动推演被 isRunning() 守卫静默跳过，
      //   直到用户切一次聊天才解锁。超时让挂起请求按失败处理，finally 正常复位。
      apiTimeoutMs: 120000
    };
    const raw = window.WORLD_ENGINE_STORE.getItem('world_engine_settings');
    if (raw) {
      try {
        cachedSettings = { ...defaults, ...JSON.parse(raw) };
        cachedSettings.apiScope = 'world';
        if (parseInt(cachedSettings.maxTokens) === 4096) cachedSettings.maxTokens = 65000;
        return cachedSettings;
      } catch(e) {}
    }
    cachedSettings = defaults;
    return cachedSettings;
  }

  // 连接库只存全局 store，绝不进入聊天/世界快照。两个引擎独立选择连接。
  const PROFILES_KEY = 'world_engine_api_profiles';
  const CONNECTION_FIELDS = ['apiUrl', 'apiKey', 'model', 'connectionMode'];
  function connectionFields(value) {
    return Object.fromEntries(CONNECTION_FIELDS.map(key => [key, value?.[key] ?? REQUEST_DEFAULTS[key]]));
  }
  function listApiProfiles() {
    const raw = window.WORLD_ENGINE_STORE.getItem(PROFILES_KEY);
    if (raw) {
      try { const list = JSON.parse(raw); return Array.isArray(list) ? list : []; } catch (_) { return []; }
    }
    const list = [];
    for (const [key, name] of [['world_engine_settings', '原世界连接'], ['memory_engine_settings', '原记忆连接']]) {
      try {
        const settings = JSON.parse(window.WORLD_ENGINE_STORE.getItem(key) || '{}');
        if (!settings.apiUrl) continue;
        const connection = connectionFields(settings);
        if (list.some(p => JSON.stringify(connectionFields(p)) === JSON.stringify(connection))) continue;
        list.push({ id: 'legacy-' + list.length, name, ...connection });
      } catch (_) {}
    }
    window.WORLD_ENGINE_STORE.setItem(PROFILES_KEY, JSON.stringify(list));
    return list;
  }
  function saveApiProfile(name, settings, id) {
    name = String(name || '').trim().slice(0, 80);
    if (!name) throw new Error('请输入连接名称');
    const list = listApiProfiles();
    const profile = { id: id || 'api-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name, ...connectionFields(settings) };
    const index = list.findIndex(p => p.id === profile.id);
    if (index < 0) list.push(profile); else list[index] = profile;
    window.WORLD_ENGINE_STORE.setItem(PROFILES_KEY, JSON.stringify(list));
    return profile;
  }
  function deleteApiProfile(id) {
    window.WORLD_ENGINE_STORE.setItem(PROFILES_KEY, JSON.stringify(listApiProfiles().filter(p => p.id !== id)));
  }
  function getTavernProfiles() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx.extensionSettings?.disabledExtensions?.includes('connection-manager')) return [];
      const service = ctx.ConnectionManagerRequestService;
      return service?.getSupportedProfiles ? service.getSupportedProfiles() : (ctx.extensionSettings?.connectionManager?.profiles || []);
    } catch (_) { return []; }
  }

  const LIMITS_KEY = 'world_engine_api_rpm_limits';
  const ERRORS_KEY = 'world_engine_api_errors';
  const rpmWindows = new Map();
  const blockedUntil = new Map();
  const nextConnections = new Map();
  const routingStatus = new Map();
  let errorLogCache = null;
  const rpm = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const scopeOf = settings => settings.apiScope === 'memory' ? 'memory' : 'world';
  function readGlobal(key, fallback) {
    try { return JSON.parse(window.WORLD_ENGINE_STORE.getItem(key) || 'null') || fallback; } catch (_) { return fallback; }
  }
  function listApiConnections() {
    return [
      ...listApiProfiles().map(p => ({ ref: 'custom:' + p.id, name: p.name, source: 'custom', model: p.model })),
      ...getTavernProfiles().map(p => ({ ref: 'tavern:' + p.id, name: p.name, source: 'tavern', model: p.model }))
    ];
  }
  function getConnectionRpm(ref) { return rpm(readGlobal(LIMITS_KEY, {})[ref]); }
  function setConnectionRpm(ref, value) {
    if (!/^(custom|tavern):.+/.test(ref)) throw new Error('请选择已保存的连接');
    window.WORLD_ENGINE_STORE.setItem(LIMITS_KEY, JSON.stringify({ ...readGlobal(LIMITS_KEY, {}), [ref]: rpm(value) }));
  }
  function redact(value, settings) {
    let text = errorText(value);
    const secrets = [settings?.apiKey, ...listApiProfiles().map(p => p.apiKey)];
    for (const key of ['world_engine_settings', 'memory_engine_settings']) secrets.push(readGlobal(key, {}).apiKey);
    for (const secret of new Set(secrets.filter(Boolean).map(String))) text = text.split(secret).join('[已隐藏密钥]');
    return text.replace(/(Bearer\s+)[^\s"'<>]+/gi, '$1[已隐藏密钥]')
      .replace(/("(?:api[_-]?key|authorization|proxy_password|access_token)"\s*:\s*")[^"]*/gi, '$1[已隐藏密钥]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已隐藏鉴权]@');
  }
  function errorText(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value ?? '') ?? String(value); } catch (_) { return String(value); }
  }
  function errorInfo(error, settings) {
    const messages = [], bodies = [], seen = new Set();
    let status = null, retryAfterMs = null, rateLimited = false;
    for (let current = error; current && !seen.has(current) && seen.size < 8; current = current.cause) {
      seen.add(current);
      const message = typeof current === 'string' ? current : current.message;
      if (message && !messages.includes(String(message))) messages.push(String(message));
      status ||= Number(current.status || current.response?.status) || null;
      rateLimited ||= current.rateLimited === true || status === 429 || /\b429\b|rate.limit|too.many.requests/i.test(String(message || ''));
      retryAfterMs ??= current.retryAfterMs;
      const detail = current.responseBody ?? current.responseText ?? current.response?.data;
      if (detail != null) bodies.push(errorText(detail));
    }
    const full = redact(bodies.join('\n\n') || messages.join('\n原因：') || String(error), settings);
    return { status, retryAfterMs, rateLimited, message: redact(messages.join(' → ') || String(error), settings).slice(0, 2000),
      body: full.slice(0, 65536), truncated: full.length > 65536 };
  }
  function getApiErrors(scope) {
    if (!errorLogCache) {
      const saved = readGlobal(ERRORS_KEY, []);
      errorLogCache = Array.isArray(saved) ? saved : [];
    }
    return errorLogCache.filter(row => !scope || row.scope === scope);
  }
  function clearApiErrors(scope) {
    errorLogCache = scope ? getApiErrors().filter(row => row.scope !== scope) : [];
    try { window.WORLD_ENGINE_STORE.setItem(ERRORS_KEY, JSON.stringify(errorLogCache)); } catch (_) {}
  }
  function recordApiError(error, settings, candidate) {
    const info = errorInfo(error, settings);
    const row = { ...info, timestamp: Date.now(), scope: scopeOf(settings), connection: redact(candidate.name, settings), ref: candidate.ref };
    errorLogCache = [row, ...getApiErrors()].slice(0, 20);
    // 报错记录写满本地存储时仍允许故障转移，当前页面保留可查看的内存副本。
    try { window.WORLD_ENGINE_STORE.setItem(ERRORS_KEY, JSON.stringify(errorLogCache)); } catch (_) {}
    try { window.WORLD_ENGINE_UI?.refreshApiErrors?.(); } catch (_) {}
    const wrapped = new Error(info.message);
    Object.assign(wrapped, info, { name: error?.name || 'Error', connection: row.connection });
    return wrapped;
  }
  function abortError() { return Object.assign(new Error('已中止'), { name: 'AbortError' }); }
  function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
  function statusUpdate(settings, message, state, candidate, waitingUntil) {
    const scope = scopeOf(settings);
    routingStatus.set(scope, { state, connection: candidate?.name || '', waitingUntil: waitingUntil || null, message });
    try {
      window.WORLD_ENGINE_UI?.refreshApiErrors?.();
      if (state === 'waiting' || state === 'switching') window.__WE_SetExternalStatus?.(`${scope === 'memory' ? '记忆' : '世界'} API：${message}`);
    } catch (_) {}
  }
  function sleepAbortable(ms, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const finish = () => { signal?.removeEventListener('abort', stopped); resolve(); };
      const timer = setTimeout(finish, Math.min(60000, Math.max(1, ms)));
      const stopped = () => { clearTimeout(timer); signal.removeEventListener('abort', stopped); reject(abortError()); };
      signal?.addEventListener('abort', stopped, { once: true });
    });
  }
  function bucket(key, now) {
    const timestamps = (rpmWindows.get(key) || []).filter(time => time > now - 60000);
    rpmWindows.set(key, timestamps);
    return timestamps;
  }
  function waitFor(key, limit, now) {
    const times = bucket(key, now);
    return Math.max(0, (blockedUntil.get(key) || 0) - now, limit > 0 && times.length >= limit ? times[times.length - limit] + 60000 - now : 0);
  }
  function quotaKey(settings) {
    // 自定义连接的同地址、同密钥别名共用计数；此身份只留在内存，不持久化或输出。
    return settings.apiSource === 'tavern' ? 'tavern:' + settings.tavernProfileId
      : 'custom:' + normalizeUrl(settings.apiUrl || '') + '\n' + (settings.apiKey || '');
  }
  function connectionLimit(candidate) {
    const settings = candidate.settings;
    if (settings.apiSource === 'tavern') return getConnectionRpm(candidate.ref);
    const same = listApiProfiles().filter(p => normalizeUrl(p.apiUrl || '') === normalizeUrl(settings.apiUrl || '') && p.apiKey === settings.apiKey);
    const limits = [getConnectionRpm(candidate.ref), ...same.map(p => getConnectionRpm('custom:' + p.id))].filter(value => value > 0);
    return limits.length ? Math.min(...limits) : 0;
  }
  function candidatesFor(settings) {
    if (settings.apiPoolEnabled !== true) {
      const ref = settings.apiSource === 'tavern' ? 'tavern:' + settings.tavernProfileId : settings.apiProfileId ? 'custom:' + settings.apiProfileId : 'manual';
      const name = listApiConnections().find(row => row.ref === ref)?.name || (settings.apiSource === 'tavern' ? '酒馆连接' : '当前连接');
      return [{ ref, name, settings }];
    }
    const refs = [...new Set(Array.isArray(settings.apiPool) ? settings.apiPool.filter(ref => typeof ref === 'string') : [])];
    if (!refs.length) throw new Error('已启用负载均衡，请至少勾选一条 API 连接');
    const custom = listApiProfiles(), tavern = getTavernProfiles();
    return refs.map(ref => {
      const fromTavern = ref.startsWith('tavern:');
      const profile = (fromTavern ? tavern : custom).find(p => (fromTavern ? 'tavern:' : 'custom:') + p.id === ref);
      const next = fromTavern ? { ...settings, apiSource: 'tavern', tavernProfileId: profile?.id || '' }
        : { ...settings, ...connectionFields(profile), apiSource: 'custom', apiProfileId: profile?.id || '' };
      if (fromTavern && profile?.model) next.model = profile.model;
      return { ref, name: profile?.name || ref + '（不可用）', settings: next,
        error: profile ? null : new Error('连接已删除或不可用，请在 API 设置中重新选择') };
    });
  }
  async function chooseCandidate(candidates, attempted, settings, signal) {
    const scopeKey = 'scope:' + scopeOf(settings), poolKey = scopeOf(settings);
    const pick = candidate => {
      if (settings.apiPoolEnabled === true) nextConnections.set(poolKey, candidates[(candidates.indexOf(candidate) + 1) % candidates.length].ref);
      return candidate;
    };
    while (true) {
      checkAbort(signal);
      const startRef = nextConnections.get(poolKey);
      const start = Math.max(0, candidates.findIndex(row => row.ref === startRef));
      const ordered = candidates.map((_, offset) => candidates[(start + offset) % candidates.length]).filter(row => !attempted.has(row.ref));
      if (!ordered.length) return null;
      const now = Date.now();
      const globalWait = waitFor(scopeKey, rpm(settings.apiRpmLimit), now);
      let shortest = Infinity;
      for (const candidate of ordered) {
        if (candidate.error) return pick(candidate);
        const wait = Math.max(globalWait, waitFor(quotaKey(candidate.settings), connectionLimit(candidate), now));
        if (!wait) {
          // 检查与占位同步执行，多个并发调用也不能取得同一个 RPM 余量。
          bucket(scopeKey, now).push(now); bucket(quotaKey(candidate.settings), now).push(now);
          return pick(candidate);
        }
        shortest = Math.min(shortest, wait);
      }
      statusUpdate(settings, `等待 RPM 额度，约 ${Math.ceil(shortest / 1000)} 秒`, 'waiting', null, now + shortest);
      await sleepAbortable(shortest, signal);
    }
  }
  // 即使某个服务没有正确响应 AbortSignal，也会停止等待；迟到结果由 Promise.race 消费并丢弃。
  async function withRequestTimeout(work, signal, timeoutMs) {
    checkAbort(signal);
    const controller = new AbortController();
    let timer, rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const abort = () => { rejectStopped(abortError()); controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (Number(timeoutMs) > 0) timer = setTimeout(() => { rejectStopped(timeoutError(timeoutMs)); controller.abort(); }, Number(timeoutMs));
    try { return await Promise.race([Promise.resolve().then(() => { checkAbort(controller.signal); return work(controller.signal); }), stopped]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function callTavernProfile(settings, body, signal) {
    const ctx = SillyTavern.getContext();
    const service = ctx.ConnectionManagerRequestService;
    if (!service?.sendRequest) throw new Error('当前酒馆版本未提供连接配置请求服务，请升级酒馆或使用自定义连接');
    if (!settings.tavernProfileId) throw new Error('请先选择酒馆连接配置');
    const profile = getTavernProfiles().find(p => p.id === settings.tavernProfileId);
    if (!profile) throw new Error('酒馆连接配置不存在或已禁用，请重新选择');
    return withRequestTimeout(async requestSignal => {
      // 指定 profile 发请求，不切换正文连接；密钥由酒馆以 secret-id 解析。
      const result = await service.sendRequest(profile.id, body.messages, body.max_tokens,
        { stream: false, signal: requestSignal, extractData: true, includePreset: false, includeInstruct: false },
        { temperature: body.temperature });
      const content = typeof result === 'string' ? result : result?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('酒馆连接返回了空内容');
      return content;
    }, signal, settings.apiTimeoutMs);
  }

  // [FIX] 规整 chat/completions URL：只补 /chat/completions，不再替用户塞 /v1 等版本前缀。
  //   火山方舟等 OpenAI 兼容端点用自定义版本前缀（/api/v3、/api/coding/v3），旧逻辑会硬塞
  //   /v1 把 URL 拼成 .../v3/v1/chat/completions 而全部 404。版本前缀由用户在设置里填到完整，
  //   旁边有格式提示。三处调用点（getProxyBase / callApi / fetchModelList）语义一致受益。
  function normalizeUrl(url) {
    let u = url.trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    return u + '/chat/completions';
  }

  // [FIX] 经酒馆代理用：从完整的 chat/completions URL 还原出 base（形如 https://host/v1），
  // 交给酒馆后端，由它自己拼 /chat/completions 与 /models。
  function getProxyBase(settings) {
    return normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');
  }

  // [FIX] 调酒馆自身后端端点需要携带其 CSRF/鉴权头；仅在酒馆环境中可用。
  function tavernHeaders() {
    try {
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      if (ctx && typeof ctx.getRequestHeaders === 'function') {
        const h = ctx.getRequestHeaders();
        if (h && !h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';
        return h;
      }
    } catch (e) {}
    throw new Error('经酒馆代理需要在酒馆环境中运行（未取到酒馆请求头）');
  }

  function timeoutError(timeoutMs) {
    return Object.assign(new Error('API 请求超时（' + Math.max(1, Math.ceil(timeoutMs / 1000)) + 's 内未收到完整响应），已停止等待本次请求'), { name: 'TimeoutError' });
  }

  function timeoutSeconds(timeoutMs) {
    timeoutMs = Number(timeoutMs) || 0;
    return timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs / 1000)) : 0;
  }

  function messageChars(messages) {
    return (messages || []).reduce((total, msg) => total + String(msg && msg.content || '').length, 0);
  }

  function logRequestParams(label, target, settings, body) {
    console.log('[世界引擎] API 请求参数:', {
      connectionMode: settings.connectionMode === 'proxy' ? 'proxy' : 'direct',
      transport: label,
      target,
      model: body.model,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      timeout_sec: timeoutSeconds(settings.apiTimeoutMs),
      message_count: Array.isArray(body.messages) ? body.messages.length : 0,
      prompt_chars: messageChars(body.messages),
      stream: false
    });
  }

  async function readResponseBody(resp) {
    const text = await resp.text();
    let data = null;
    let parseError = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { parseError = e; }
    }
    return { resp, data, text, parseError };
  }

  function responseDetail(result) {
    const data = result && result.data;
    const text = result && result.text;
    if (data && data.error && data.error.message) return data.error.message;
    if (data) return JSON.stringify(data);
    return text ? String(text) : '';
  }

  function responseError(result, label) {
    const status = Number(result.resp.status) || null;
    const error = new Error(`${label || 'API'}${status ? ' HTTP ' + status : ''}: ${responseDetail(result) || '返回错误'}`);
    error.status = status; error.responseBody = result.text;
    if (status === 429 || /rate.limit|too.many.requests/i.test(String(result.data?.error?.code || ''))) {
      error.rateLimited = true;
      const after = String(result.resp.headers?.get?.('retry-after') || '').trim();
      error.retryAfterMs = after ? Math.max(0, Number.isFinite(Number(after)) ? Number(after) * 1000 : Date.parse(after) - Date.now()) : 60000;
      if (!Number.isFinite(error.retryAfterMs)) error.retryAfterMs = 60000;
    }
    return error;
  }

  function requireJson(result, label) {
    if (result.parseError) {
      const error = new Error((label || 'API') + ' 返回不是有效 JSON：' + result.parseError.message);
      error.status = Number(result.resp.status) || null; error.responseBody = result.text;
      throw error;
    }
    return result.data || {};
  }

  // 超时覆盖完整请求生命周期：fetch resolve 只代表响应头到达，正文读取仍可能卡住。
  async function fetchResponseWithTimeout(url, options, signal, timeoutMs) {
    return withRequestTimeout(async requestSignal => {
      const resp = await fetch(url, { ...options, signal: requestSignal });
      return await readResponseBody(resp);
    }, signal, timeoutMs);
  }

  // [FIX] 经酒馆服务端转发的推演调用：浏览器 → 同源酒馆后端（无 CORS）→ 服务端代发到第三方 API。
  // 走 OpenAI source + reverse_proxy 路线，这样可把我们自己的 URL/KEY 透传给上游。
  async function callApiViaProxy(settings, body, signal) {
    const base = getProxyBase(settings);
    if (!base) throw new Error('未配置 API URL，请在设置中填写');
    const payload = {
      chat_completion_source: 'openai',
      reverse_proxy: base,
      proxy_password: settings.apiKey || '',
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: false
    };
    logRequestParams('tavern-proxy', base, settings, payload);
    const result = await fetchResponseWithTimeout('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: tavernHeaders(),
      body: JSON.stringify(payload)
    }, signal, settings.apiTimeoutMs);
    const resp = result.resp;
    if (!resp.ok) {
      throw responseError(result, '酒馆代理');
    }
    const data = requireJson(result, '酒馆代理');
    if (data && data.error) {
      throw responseError(result, '酒馆代理');
    }
    const choice = data.choices?.[0];
    if (!choice) throw Object.assign(new Error('API 返回缺少 choices[0]'), { responseBody: result.text, status: resp.status });
    if (choice.finish_reason === 'length') {
      console.warn('[世界引擎] API 输出达到长度上限，将读取截断前已完整返回的字段');
    }
    const content = choice.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('API 返回空内容'), { responseBody: result.text, status: resp.status });
    return content;
  }

  /**
   * 调用独立 API（非酒馆自带），OpenAI 兼容格式
   */
  async function callApi(prompt, maxTokens, temperature, signal, settingsOverride) {
    const settings = settingsOverride
      ? { ...REQUEST_DEFAULTS, ...settingsOverride }
      : getSettings();
    const candidates = candidatesFor(settings), attempted = new Set();
    let lastError;
    try {
      while (attempted.size < candidates.length) {
        const candidate = await chooseCandidate(candidates, attempted, settings, signal);
        if (!candidate) break;
        attempted.add(candidate.ref);
        statusUpdate(settings, '正在请求 ' + candidate.name, 'requesting', candidate);
        try {
          if (candidate.error) throw candidate.error;
          const content = await sendApi(prompt, maxTokens, temperature, signal, candidate.settings);
          checkAbort(signal);
          statusUpdate(settings, candidate.name + ' 请求成功', 'success', candidate);
          return content;
        } catch (error) {
          checkAbort(signal);
          lastError = recordApiError(error, candidate.settings, candidate);
          if (lastError.rateLimited && !candidate.error) {
            const pause = lastError.retryAfterMs != null && Number.isFinite(Number(lastError.retryAfterMs)) ? Math.max(0, Number(lastError.retryAfterMs)) : 60000;
            blockedUntil.set(quotaKey(candidate.settings), Date.now() + pause);
          }
          if (attempted.size < candidates.length) statusUpdate(settings, candidate.name + ' 请求失败，切换下一条连接', 'switching', candidate);
        }
      }
      if (candidates.length > 1) lastError.message = `连接池全部失败（${candidates.length} 条）：${lastError.connection}：${lastError.message}`;
      statusUpdate(settings, lastError?.message || '请求失败', 'failed', { name: lastError?.connection || '' });
      throw lastError || new Error('没有可用的 API 连接');
    } catch (error) {
      if (signal?.aborted) {
        statusUpdate(settings, '已中止', 'stopped');
        throw abortError();
      }
      throw error;
    }
  }

  async function sendApi(prompt, maxTokens, temperature, signal, settings) {
    const selectedTemperature = temperature ?? settings.temperature;
    const configuredMaxTokens = Math.max(1, parseInt(maxTokens ?? settings.maxTokens) || 65000);
    // 兼容旧设置：曾保存为 4096 的输出上限自动提升到 65000。
    const selectedMaxTokens = configuredMaxTokens === 4096 ? 65000 : configuredMaxTokens;

    const body = {
      model: settings.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: Number.isFinite(Number(selectedTemperature)) ? Math.max(0, Number(selectedTemperature)) : 0.7,
      max_tokens: selectedMaxTokens
    };

    if (settings.apiSource === 'tavern') return callTavernProfile(settings, body, signal);

    // [FIX] 经酒馆代理：绕过第三方 API 的 CORS 限制，由酒馆 Node 服务端转发
    if (settings.connectionMode === 'proxy') {
      return callApiViaProxy(settings, body, signal);
    }

    const url = normalizeUrl(settings.apiUrl);
    if (!url) throw new Error('未配置 API URL，请在设置中填写');

    const headers = {
      'Content-Type': 'application/json'
    };
    if (settings.apiKey) {
      headers['Authorization'] = 'Bearer ' + settings.apiKey;
    }

    logRequestParams('direct', url, settings, body);

    const result = await fetchResponseWithTimeout(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }, signal, settings.apiTimeoutMs);
    const resp = result.resp;

    if (!resp.ok) {
      throw responseError(result, 'API');
    }

    const data = requireJson(result, 'API');
    if (data.error) throw responseError(result, 'API');
    const choice = data.choices?.[0];
    if (!choice) throw Object.assign(new Error('API 返回缺少 choices[0]'), { responseBody: result.text, status: resp.status });
    if (choice.finish_reason === 'length') {
      console.warn('[世界引擎] API 输出达到长度上限，将读取截断前已完整返回的字段');
    }
    const content = choice.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('API 返回空内容'), { responseBody: result.text, status: resp.status });
    return content;
  }

  function repairTruncatedJSON(content) {
    const rootStart = content.indexOf('{');
    if (rootStart === -1) return null;

    const stack = [];
    const candidates = [];
    let inString = false;
    let escaped = false;

    for (let i = rootStart; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        stack.pop();
      } else if (char === ',' && stack.length > 0) {
        candidates.push({
          end: i,
          suffix: stack.slice().reverse().map(open => open === '{' ? '}' : ']').join('')
        });
      }
    }

    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = content.slice(rootStart, candidates[i].end) + candidates[i].suffix;
      try {
        return JSON.parse(candidate);
      } catch(e) {}
    }
    return null;
  }

  /**
   * 解析 API 返回的 JSON（容错处理）
   */
  function parseJSON(text) {
    let content = String(text || '').trim();
    content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      return JSON.parse(content);
    } catch(e) {}

    // 从夹杂说明、思考文本或多个代码块的返回中提取顶层 JSON；
    // 模型的最终答案通常位于最后，因此采用最后一个有效对象。
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    let result = null;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            result = JSON.parse(content.slice(start, i + 1));
          } catch(e2) {}
          start = -1;
        }
      }
    }
    return result || repairTruncatedJSON(content);
  }

  /**
   * 获取模型列表（OpenAI 兼容格式）
   */
  async function fetchModelList(settingsOverride) {
    const settings = settingsOverride
      ? { ...REQUEST_DEFAULTS, ...settingsOverride }
      : getSettings();
    try { return await fetchModels(settings); }
    catch (error) {
      const candidate = candidatesFor({ ...settings, apiPoolEnabled: false })[0];
      throw recordApiError(error, settings, candidate);
    }
  }

  async function fetchModels(settings) {
    if (settings.apiSource === 'tavern') {
      const profile = getTavernProfiles().find(p => p.id === settings.tavernProfileId);
      if (!profile?.model) throw new Error('请先选择有效的酒馆连接配置');
      return [profile.model];
    }
    const baseUrl = normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');

    // [FIX] 经酒馆代理：用酒馆 /status 端点拉模型列表，绕过 CORS
    if (settings.connectionMode === 'proxy') {
      if (!baseUrl) throw new Error('未配置 API URL，请在设置中填写');
      const result = await fetchResponseWithTimeout('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: tavernHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: baseUrl,
          proxy_password: settings.apiKey || ''
        })
      }, null, settings.apiTimeoutMs);
      if (!result.resp.ok) throw responseError(result, '酒馆代理模型列表');
      const data = requireJson(result, '酒馆代理');
      if (data && data.error) throw responseError(result, '酒馆代理模型列表');
      if (data.data && Array.isArray(data.data)) {
        return data.data.map(m => m.id);
      }
      throw new Error('无法解析模型列表');
    }

    const url = baseUrl + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;

    const result = await fetchResponseWithTimeout(url, { headers }, null, settings.apiTimeoutMs);
    if (!result.resp.ok) throw responseError(result, '模型列表');
    const data = requireJson(result, 'API');
    if (data.error) throw responseError(result, '模型列表');
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id);
    }
    throw new Error('无法解析模型列表');
  }

  return { callApi, parseJSON, getSettings, fetchModelList, listApiProfiles, saveApiProfile, deleteApiProfile, getTavernProfiles,
    listApiConnections, getConnectionRpm, setConnectionRpm, getApiErrors, clearApiErrors,
    getRoutingStatus: scope => routingStatus.get(scope || 'world') || null };
})();
