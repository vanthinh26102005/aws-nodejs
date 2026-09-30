import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from './server.mjs';

// Catches broken routes, unsafe input handling, and CORS failures between FE and BE.
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const origin = 'https://demo.artium.id.vn';
const post = (body, headers = {}) => fetch(`${base}/api/greet`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body,
});

try {
  const health = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
  assert.equal(health.status, 200, 'Health endpoint must be available');
  assert.equal((await health.json()).status, 'ok');
  assert.equal(health.headers.get('access-control-allow-origin'), origin);

  const greeting = await post(JSON.stringify({ name: '  Thịnh  ' }), { Origin: origin });
  assert.equal(greeting.status, 200);
  assert.match((await greeting.json()).message, /Thịnh/);

  for (const body of ['{', 'null', '[]', '{}', '{"name":"   "}', '{"name":123}', JSON.stringify({ name: 'x'.repeat(81) })]) {
    const invalid = await post(body);
    assert.equal(invalid.status, 400, `Invalid name/JSON must be rejected: ${body}`);
    assert.equal(typeof (await invalid.json()).error, 'string');
  }
  const wrongType = await post('{"name":"Thịnh"}', { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
  const tooLarge = await post(JSON.stringify({ name: 'ệ'.repeat(6000) }));
  assert.equal(tooLarge.status, 413, 'Body limit must measure bytes, including Unicode');

  const preflight = await fetch(`${base}/api/greet`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Content-Type/i);

  const blocked = await fetch(`${base}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);

  const wrongMethod = await fetch(`${base}/api/greet`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);

  const page = await fetch(base);
  assert.equal(page.status, 200, 'Local start must serve the frontend too');
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2, 'Page must load its JS and stylesheet');
  for (const asset of assets) assert.equal((await fetch(new URL(asset, `${base}/`))).status, 200);

  console.log('PASS: health, greeting, validation, body limit, CORS, routing, and frontend assets');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
