// node docs/world-api-profiles-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function main() {
  const values = new Map([
    ['world_engine_settings', JSON.stringify({ apiUrl: 'https://world.test/v1', apiKey: 'world-secret', model: 'world-model' })],
    ['memory_engine_settings', JSON.stringify({ apiUrl: 'https://memory.test/v1', apiKey: 'memory-secret', model: 'memory-model' })]
  ]);
  const profile = { id: 'tavern-b', name: '供应商 B', model: 'tavern-model', 'secret-id': 'server-secret-id' };
  const requests = [];
  const context = {
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [profile], selectedProfile: '正文连接' } },
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [profile],
      async sendRequest(...args) { requests.push(args); return { content: '{"ok":true}' }; }
    }
  };
  const sandbox = { console, AbortController, setTimeout, clearTimeout, SillyTavern: { getContext: () => context },
    WORLD_ENGINE_STORE: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) },
    fetch: async (url, options) => { requests.push([url, options]); return { ok: true, text: async () => '{"choices":[{"message":{"content":"direct-ok"}}]}' }; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../world-engine-api.js'), 'utf8'), sandbox);
  const api = sandbox.WORLD_ENGINE_API;
  assert.equal(api.listApiProfiles().length, 2, '迁移应保留两个引擎各自的旧连接');
  assert.equal(api.listApiProfiles().length, 2, '重复读取不得重复迁移');
  const p = api.saveApiProfile('供应商 C', { apiUrl: 'https://c.test', apiKey: 'c-secret', model: 'c-model' });
  api.saveApiProfile('供应商 C2', { ...p, model: 'c2-model' }, p.id);
  assert.equal(api.listApiProfiles().length, 3);
  assert.equal(api.listApiProfiles().find(x => x.id === p.id).model, 'c2-model');
  api.deleteApiProfile(p.id);
  assert.equal(api.listApiProfiles().length, 2);
  assert.equal(JSON.parse(values.get('memory_engine_settings')).apiKey, 'memory-secret');
  await api.callApi('prompt', 128, 0.3, null, { apiSource: 'tavern', tavernProfileId: profile.id });
  assert.equal(requests[0][0], profile.id);
  assert.equal(requests[0][3].includePreset, false);
  assert.equal(requests[0][3].includeInstruct, false);
  assert.equal(context.extensionSettings.connectionManager.selectedProfile, '正文连接');
  assert.equal(requests[0][4].temperature, 0.3);
  await api.callApi('memory prompt', 128, 0.2, null, { apiUrl: 'https://memory.test/v1', apiKey: 'memory-secret' });
  assert.equal(requests[1][0], 'https://memory.test/v1/chat/completions');
  assert.equal(requests[1][1].headers.Authorization, 'Bearer memory-secret');
  context.ConnectionManagerRequestService.sendRequest = () => new Promise(() => {});
  await assert.rejects(api.callApi('timeout', 16, 0, null, { apiSource: 'tavern', tavernProfileId: profile.id, apiTimeoutMs: 10 }), /超时/);
  const controller = new AbortController();
  const pending = api.callApi('abort', 16, 0, controller.signal, { apiSource: 'tavern', tavernProfileId: profile.id, apiTimeoutMs: 0 });
  controller.abort();
  await assert.rejects(pending, e => e.name === 'AbortError');
  console.log('✓ API 连接迁移、请求隔离、酒馆配置、超时与取消测试通过');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
