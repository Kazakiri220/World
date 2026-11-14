// node docs/world-api-response-test.js — real request/response handling, no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const values = new Map(), requests = [];
  let response, tavernResult, contentType = 'application/json';
  const sandbox = { console: { log() {}, warn() {}, error() {} }, AbortController, setTimeout, clearTimeout,
    WORLD_ENGINE_STORE: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)) },
    SillyTavern: { getContext: () => ({
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      ConnectionManagerRequestService: { getSupportedProfiles: () => [{ id: 'test', model: 'fixture' }],
        sendRequest: async (...args) => { requests.push(args); return tavernResult; } }
    }) },
    fetch: async (url, options) => {
      requests.push([url, JSON.parse(options.body)]);
      return { ok: true, status: 200, headers: { get: name => name === 'content-type' ? contentType : null },
        text: async () => typeof response === 'string' ? response : JSON.stringify(response) };
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../world-engine-api.js'), 'utf8'), sandbox);
  const api = sandbox.WORLD_ENGINE_API;
  const answer = '{"world_digest":"实际已正确返回的世界结果"}';
  const settings = { apiUrl: 'https://offline.test/v1', apiKey: 'fixture-secret', apiTimeoutMs: 1000 };
  const bodies = [
    JSON.parse(answer),
    { choices: [{ message: { content: answer } }] },
    { choices: [{ message: { content: JSON.parse(answer) } }] },
    { choices: [{ message: { content: [{ type: 'text', text: answer.slice(0, 20) }, { type: 'text', text: answer.slice(20) }] } }] },
    { choices: [{ message: { content: [{ type: 'text', text: { value: answer } }] } }] },
    { choices: [{ text: answer }] },
    { content: [{ type: 'thinking', thinking: '不要当作答案' }, { type: 'text', text: answer }] },
    { output_text: answer },
    { output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: answer }] }] },
    { candidates: [{ content: { parts: [{ thought: true, text: '不要当作答案' }, { text: answer }] } }] },
    { data: { choices: [{ message: { content: answer } }] } }
  ];
  for (const connectionMode of ['direct', 'proxy']) {
    for (const body of bodies) {
      response = body;
      assert.equal(await api.callApi('prompt', 100, 0.1, null, { ...settings, connectionMode }), answer);
      assert.equal(requests.at(-1)[1].stream, false, 'every HTTP request explicitly disables streaming');
    }
  }
  for (const body of [answer, ...bodies]) {
    tavernResult = body;
    assert.equal(await api.callApi('prompt', 100, 0.1, null, { ...settings, apiSource: 'tavern', tavernProfileId: 'test' }), answer);
  }
  console.log('✓ direct/proxy/tavern: strings, text blocks, legacy completions, output and wrapped responses');

  response = { storyTime: { text: '虚构纪年三年春', evidence: '场景时钟' },
    events: [{ id: 'event_8', name: '事务推进', type: 'progress', stage: '关键', stageRound: 3, level: 3,
      desc: '安排正在推进。', stall: false, time: { occurredAt: { text: '虚构纪年三年春', evidence: '正文依据' }, changed: true } }],
    factions: [], worldTrends: [], winds: [], reputation: { common: '默默无闻' },
    economy: { climate: '平稳', signals: [] }, enemies: [], influenceChain: [],
    blackbox: { secretActions: [], secretAssets: [] }, world_digest: 'X' };
  assert.deepEqual(JSON.parse(await api.callApi('prompt', 100, 0.1, null, settings)), response,
    'the reported bare world-state structure must pass through without losing fields');
  response = { personal_memory: [], entity_updates: [], small_summary: '纪要正文' };
  assert.deepEqual(JSON.parse(await api.callApi('prompt', 100, 0.1, null, settings)), response);
  console.log('✓ bare world-state JSON including story time and bare memory-task JSON retain all fields');

  contentType = 'text/event-stream';
  const chunks = [answer.slice(0, 17), answer.slice(17)];
  response = ': heartbeat\r\n\r\n' + chunks.map(content =>
    'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n').join('')
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  assert.equal(await api.callApi('prompt', 100, 0.1, null, settings), answer);
  contentType = 'application/json'; // Some bridges report JSON while sending SSE anyway.
  assert.equal(await api.callApi('prompt', 100, 0.1, null, settings), answer);
  response = chunks.map(delta => 'event: response.output_text.delta\ndata: '
    + JSON.stringify({ type: 'response.output_text.delta', delta }) + '\n\n').join('');
  assert.equal(await api.callApi('prompt', 100, 0.1, null, settings), answer);
  response += 'event: response.completed\ndata: ' + JSON.stringify({ type: 'response.completed', response: { output_text: answer } }) + '\n\n';
  assert.equal(await api.callApi('prompt', 100, 0.1, null, settings), answer, 'final snapshots must not duplicate streamed deltas');
  response = '\uFEFF' + JSON.stringify(bodies[1]);
  assert.equal(await api.callApi('prompt', 100, 0.1, null, settings), answer);
  console.log('✓ SSE deltas, final snapshots, incorrect content type and UTF-8 BOM');

  response = { id: 'chatcmpl-fixture', object: 'chat.completion', created: 1794669979,
    model: 'chat.deepseek.com', choices: [{ index: 0,
      message: { role: 'assistant', content: '', media: [] }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, media: [] };
  for (const connectionMode of ['direct', 'proxy']) {
    const before = requests.length;
    await assert.rejects(api.callApi('prompt', 100, 0.1, null, { ...settings, connectionMode }),
      error => error.status === 200 && /返回空正文.*token 用量全为 0.*finish_reason=stop/.test(error.message)
        && !error.message.includes('未找到可读取的答案文本'));
    assert.equal(requests.length, before + 1, 'classifying an empty response must not add retries');
    assert.deepEqual(JSON.parse(api.getApiErrors()[0].body), response, 'retain the original empty response');
  }
  console.log('✓ reported HTTP 200 / empty content / zero-token response is classified precisely without retrying');

  response = { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '只有推理过程 fixture-secret' } }] };
  await assert.rejects(api.callApi('prompt', 100, 0.1, null, settings), /仅返回推理内容.*长度上限/);
  assert.ok(!api.getApiErrors()[0].body.includes('fixture-secret'), 'raw failure bodies still redact credentials');
  response = { choices: [{ message: { content: null, refusal: '拒绝原因' } }] };
  await assert.rejects(api.callApi('prompt', 100, 0.1, null, settings), /模型拒绝.*拒绝原因/);
  response = { unknown: 'a response with an unsupported envelope' };
  await assert.rejects(api.callApi('prompt', 100, 0.1, null, settings), /已返回数据.*unknown/);
  response = '';
  await assert.rejects(api.callApi('prompt', 100, 0.1, null, settings), /返回空内容/);
  response = 'data: {"error":{"message":"供应商错误"}}\n\n';
  await assert.rejects(api.callApi('prompt', 100, 0.1, null, settings), /供应商错误/);
  assert.ok(api.getApiErrors()[0].body.includes('data:'), 'retain the original response for diagnostics');
  response = 'data: {broken}\n\n';
  await assert.rejects(api.callApi('prompt', 100, 0.1, null, settings), /不是有效 JSON/);
  console.log('✓ empty/refusal/reasoning-only/unsupported/malformed/error responses remain actionable and retain redacted raw data');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
