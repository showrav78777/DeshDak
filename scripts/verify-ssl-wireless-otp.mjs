import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = (await readFile(new URL('../src/modules/notifications/adapters/ssl-wireless-otp.ts', import.meta.url), 'utf8')).replace('import "server-only";', '');
const { createSslWirelessOtpTransport: create } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const config = { approved: true, apiToken: 'test-api-token-0123456789abcdef', secretKey: 'ssl-test-secret-0123456789abcdef', senderId: 'TESTSID' };
const input = () => ({ recipient: '+8801712345678', code: '123456', clientReference: 'testref1234567890123', expiresAt: new Date(Date.now() + 300000) });
const payload = () => ({ status: 'SUCCESS', status_code: 200, smsinfo: [{ sms_status: 'SUCCESS', msisdn: '8801712345678', csms_id: input().clientReference, reference_id: 'opaque-123', sms_body: 'sensitive echo' }] });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let count = 0;
const transport = create(config, { randomIv: () => Buffer.from(Array.from({ length: 16 }, (_, i) => i)), transport: async (url, options) => {
  count++;
  assert.equal(url, 'https://smsplus.sslwireless.com/api/v3/secure/otp-sms');
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body).sort(), ['api_token', 'csms_id', 'msisdn', 'sid', 'sms']);
  assert.equal(body.msisdn, '8801712345678'); assert.equal(body.api_token, config.apiToken);
  assert.equal(body.sms, 'AAECAwQFBgcICQoLDA0OD2ZlbllUNlVHTytYb3RWQkdTZ3pnUXdsQjY4ZUp3RENjazZ5WFVjZzVmUjZrcXE2ZUxObk1sZ1VsR29SZDRrNUhBS2tzQ2JlT3pzdlpIdHU1MDkraWtBa05lcTQvY1JweStLdG1obHBTclNFPQ==');
  assert.equal(options.headers['X-Signature'], '6d787a394adbe9dacf24d9761093181ce141a1dd28e1b9740755a5b5f94f04da');
  assert.ok(!options.body.includes('123456.')); return response(payload());
} });
assert.deepEqual(await transport.submitOtp(input()), { state: 'ACCEPTED', clientReference: input().clientReference, providerReference: 'opaque-123' }); assert.equal(count, 1);
for (const bad of [null, { ...config, approved: false }, { ...config, senderId: undefined }, { ...config, apiToken: 'short' }, { ...config, secretKey: config.apiToken }]) assert.throws(() => create(bad), /SMS_(APPROVAL_REQUIRED|CONFIGURATION_INVALID)/);
const noIO = create(config, { transport: () => { throw new Error('Unexpected network'); } });
for (const bad of [null, { recipient: '+12025550123' }, { recipient: '01712345678' }, { code: 123456 }, { clientReference: undefined }, { clientReference: 'x'.repeat(21) }, { expiresAt: new Date(0) }, { expiresAt: new Date(Date.now() + 1000) }, { expiresAt: new Date(NaN) }, { expiresAt: new Date(Date.now() + 900000) }]) await assert.rejects(noIO.submitOtp(bad === null ? null : { ...input(), ...bad }), /^Error: SMS_INPUT_INVALID$/);
async function denied(makeResponse) {
  let calls = 0;
  const adapter = create(config, { transport: async () => { calls++; return makeResponse(); } });
  await assert.rejects(adapter.submitOtp(input()), /^Error: SMS_SUBMISSION_UNCONFIRMED$/); assert.equal(calls, 1);
}
for (const mutate of [p => p.status = 'FAILED', p => p.status_code = 4023, p => p.smsinfo = [], p => p.smsinfo.push(p.smsinfo[0]), p => p.smsinfo[0].sms_status = 'FAILED', p => p.smsinfo[0].msisdn = '8801812345678', p => p.smsinfo[0].csms_id = 'other', p => delete p.smsinfo[0].reference_id, p => p.smsinfo[0].reference_id = 'x'.repeat(256)]) await denied(() => { const p = payload(); mutate(p); return response(p); });
await denied(() => new Response('credentials and private echo', { status: 403 }));
await denied(() => new Response('{', { headers: { 'Content-Type': 'application/json' } }));
await denied(() => new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }));
await denied(() => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } }));
await denied(() => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '9000' } }));
let cancelled = false;
await denied(() => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(9000)); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } })); assert.ok(cancelled);
for (const echo of ['+8801712345678', '01712345678']) {
  const adapter = create(config, { transport: async () => { const p = payload(); p.smsinfo[0].msisdn = echo; return response(p); } });
  assert.equal((await adapter.submitOtp(input())).state, 'ACCEPTED');
}
let rejectedBodyCancelled = false;
await denied(() => new Response(new ReadableStream({ cancel() { rejectedBodyCancelled = true; } }), { headers: { 'Content-Type': 'text/html' } })); assert.ok(rejectedBodyCancelled);
const bodies = [];
const random = create(config, { transport: async (_, options) => { bodies.push(JSON.parse(options.body).sms); return response(payload()); } });
await random.submitOtp(input()); await random.submitOtp(input()); assert.notEqual(bodies[0], bodies[1]);
// The caller cannot change the reference being checked while I/O is in flight.
let release;
const pending = new Promise(resolve => { release = resolve; });
const mutable = input();
const snapshot = create(config, { transport: async () => { await pending; return response(payload()); } });
const submitted = snapshot.submitOtp(mutable); mutable.clientReference = 'changed'; release();
assert.equal((await submitted).clientReference, input().clientReference);
const originalTimeout = globalThis.setTimeout;
try {
  globalThis.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms === 12000 ? 10 : ms, ...args);
  await denied(() => new Promise(() => {}));
  let stopped = false;
  await denied(() => new Response(new ReadableStream({ cancel() { stopped = true; } }), { headers: { 'Content-Type': 'application/json' } })); assert.ok(stopped);
} finally { globalThis.setTimeout = originalTimeout; }
console.log('SSL Wireless OTP protocol: golden vector, redaction, validation, bounded responses and deadlines passed. Simulated transport only; no SMS sent.');
