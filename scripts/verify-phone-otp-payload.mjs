import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code.replace('import "server-only";', ''))).toString('base64')}`;
// Synthetic secrets only. Never load the owner's environment file.
const previous = Object.fromEntries(['NODE_ENV','AUTH_SECRET','AUTH_OUTBOX_ENCRYPTION_KEY'].map(k => [k, process.env[k]]));
try {
  process.env.NODE_ENV = 'production'; process.env.AUTH_SECRET = 'synthetic-phone-otp-auth-key';
  process.env.AUTH_OUTBOX_ENCRYPTION_KEY = Buffer.alloc(32, 37).toString('base64');
  const securityUrl = moduleUrl(await readFile(new URL('../src/lib/security-secrets.ts', import.meta.url), 'utf8'));
  const security = await import(securityUrl);
  const source = (await readFile(new URL('../src/modules/notifications/phone-otp-payload.ts', import.meta.url), 'utf8')).replace('from "@/lib/security-secrets"', `from "${securityUrl}"`);
  const { sealPhoneOtpPayload: seal, openPhoneOtpForDispatch: open } = await import(moduleUrl(source));
  const code = '849276';
  const context = { userId: 'user-123', sessionId: 'session-123', tokenId: 'token-123', phone: '+8801712345678', expiresAt: new Date(Date.now()+300000), accountActive: true, sessionActive: true, phoneVerified: false, tokenUsed: false };
  context.tokenHash = security.hashPhoneVerificationCode(context.userId, context.phone, code);
  const encrypted = seal(context, code), second = seal(context, code);
  assert.deepEqual(Object.keys(encrypted).sort(), ['securePayloadCiphertext','securePayloadIv','securePayloadTag']);
  assert.notEqual(encrypted.securePayloadCiphertext, second.securePayloadCiphertext);
  const opened = open(encrypted, context);
  assert.equal(opened.code, code); assert.equal(opened.recipient, context.phone); assert.match(opened.clientReference, /^[a-f0-9]{20}$/);
  assert.equal(open(encrypted, context).clientReference, opened.clientReference);
  assert.notEqual(open(second, context).clientReference, opened.clientReference);
  assert.notEqual(opened.expiresAt, context.expiresAt); assert.equal(+opened.expiresAt, +context.expiresAt);
  const denied = fn => assert.throws(fn, /^Error: PHONE_OTP_DISPATCH_DENIED$/);
  for (const patch of [{userId:'other'}, {sessionId:'other'}, {tokenId:'other'}, {phone:'+8801812345678'}, {tokenHash:'a'.repeat(64)}, {expiresAt:new Date(Date.now()+1000)}, {expiresAt:new Date(NaN)}, {accountActive:false}, {sessionActive:false}, {phoneVerified:true}, {tokenUsed:true}, {tokenUsed:undefined}]) denied(() => open(encrypted, {...context,...patch}));
  for (const key of Object.keys(encrypted)) denied(() => open({...encrypted,[key]:'A'.repeat(encrypted[key].length)}, context));
  denied(() => open({...encrypted,securePayloadCiphertext:'A'.repeat(4097)},context));
  denied(() => open(null, context)); denied(() => open(encrypted, null));
  for (const invalid of [123456,'12345','000000',null]) denied(() => seal(context,invalid));
  for (const patch of [{phone:'+12025550123'},{tokenHash:'invalid'},{expiresAt:new Date(Date.now()+900000)},{sessionId:undefined}]) denied(() => seal({...context,...patch},code));
  const inner = security.decryptOutboxPayload(encrypted);
  for (const patch of [{version:2},{code:'000000'},{clientReference:'x'},{userId:'other'},{expiresAt:'wrong'}]) denied(() => open(security.encryptOutboxPayload({...inner,...patch}),context));
  process.env.AUTH_OUTBOX_ENCRYPTION_KEY = Buffer.alloc(32, 38).toString('base64'); denied(() => open(encrypted,context));
  delete process.env.AUTH_OUTBOX_ENCRYPTION_KEY; denied(() => open(encrypted,context)); denied(() => seal(context,code));
  console.log('Encrypted phone OTP payload: binding, tamper, expiry, key and state checks passed. No database or SMS transport used.');
} finally { for (const [key,value] of Object.entries(previous)) { if(value === undefined) delete process.env[key]; else process.env[key]=value; } }
