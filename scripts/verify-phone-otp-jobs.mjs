import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(url.searchParams.get('schema') ?? '')) throw new Error('Requires a generated disposable local schema.');
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code.replace('import "server-only";', ''))).toString('base64')}`;
const source = file => readFile(new URL(`../src/${file}`, import.meta.url),'utf8');
const securityUrl = moduleUrl(await source('lib/security-secrets.ts'));
const accountUrl = moduleUrl(await source('modules/auth/account-mutation.ts'));
const payloadUrl = moduleUrl((await source('modules/notifications/phone-otp-payload.ts')).replace('from "@/lib/security-secrets"',`from "${securityUrl}"`));
const jobsUrl = moduleUrl((await source('modules/notifications/phone-otp-jobs.ts')).replace('from "@/lib/security-secrets"',`from "${securityUrl}"`).replace('from "@/modules/auth/account-mutation"',`from "${accountUrl}"`).replace('from "@/modules/notifications/phone-otp-payload"',`from "${payloadUrl}"`));
const {enqueuePhoneOtp: enqueue,runPhoneOtpJobs: run} = await import(jobsUrl);
const issuanceSource = (await source('modules/auth/queued-phone-verification.ts')).replace('from "@/lib/security-secrets"',`from "${securityUrl}"`).replace('from "@/modules/auth/account-mutation"',`from "${accountUrl}"`).replace('from "@/modules/notifications/phone-otp-jobs"',`from "${jobsUrl}"`);
const {issueQueuedPhoneVerification: issue} = await import(moduleUrl(issuanceSource));
const {hashPhoneVerificationCode} = await import(securityUrl);
const db = new PrismaClient(), marker=randomBytes(8).toString('hex'), users=[];
let calls=0;
const sender={submitOtp:async input => {calls++; return {state:'ACCEPTED',clientReference:input.clientReference,providerReference:`synthetic-${calls}`};}};
async function fixture() {
 const user=await db.user.create({data:{email:`otp-${randomBytes(6).toString('hex')}-${marker}@example.test`,fullName:'Synthetic OTP customer',phone:`+88017${String(users.length+1).padStart(8,'0')}`,status:'ACTIVE',passwordHash:'unused'}});users.push(user.id);
 const session=await db.authSession.create({data:{userId:user.id,portal:'customer',expiresAt:new Date(Date.now()+3600000),lastSeenAt:new Date(),clientType:'WEB',clientName:'OTP acceptance'}});
 const code='849276';const token=await db.securityToken.create({data:{userId:user.id,purpose:'PHONE_VERIFICATION',tokenHash:hashPhoneVerificationCode(user.id,user.phone,code),expiresAt:new Date(Date.now()+300000)}});
 const input={userId:user.id,sessionId:session.id,tokenId:token.id,code};
 return {user,session,token,input};
}
const queue=f=>db.$transaction(tx=>enqueue(tx,f.input));
const worker=(transport=sender)=>run(db,transport,{approved:true});
try {
 assert.deepEqual(await run(null,null),{configured:false,claimed:0,accepted:0,cancelled:0,unconfirmed:0});
 const f=await fixture();
 const produced=await Promise.all([queue(f),queue(f)]);assert.equal(produced.filter(x=>x.created).length,1);assert.equal(produced[0].id,produced[1].id);
 const saved=await db.notificationDelivery.findUniqueOrThrow({where:{id:produced[0].id}});assert.equal(saved.status,'QUEUED');assert.ok(saved.securePayloadCiphertext);assert.equal(saved.attempts,0);
 const workers=await Promise.all([worker(),worker()]);assert.equal(workers.reduce((n,x)=>n+x.accepted,0),1);assert.equal(calls,1);
 let job=await db.notificationDelivery.findUniqueOrThrow({where:{id:saved.id}});assert.equal(job.status,'SENT');assert.equal(job.attempts,1);assert.ok(job.providerReference);assert.equal(job.deliveredAt,null);assert.equal(job.securePayloadCiphertext,null);
 const audit=await db.auditLog.findFirstOrThrow({where:{entityId:job.id,action:'auth.phone_otp_claimed'}});assert.match(audit.metadata.clientReference,/^[a-f0-9]{20}$/);assert.deepEqual(Object.keys(audit.metadata),['clientReference']);
 assert.equal((await queue(f)).created,false);await worker();assert.equal(calls,1);
 const uncertain=await fixture(),uq=await queue(uncertain);
 let attempts=0;const timeoutSender={submitOtp:async()=>{attempts++;throw new Error('sensitive provider diagnostic');}};
 assert.equal((await worker(timeoutSender)).unconfirmed,1);await worker(timeoutSender);assert.equal(attempts,1);
 job=await db.notificationDelivery.findUniqueOrThrow({where:{id:uq.id}});assert.equal(job.status,'SENT');assert.equal(job.attempts,1);assert.equal(job.securePayloadCiphertext,null);assert.ok(!job.lastError.includes('sensitive'));assert.equal(job.providerReference,null);
 // Even an accidental status reset cannot make a consumed attempt eligible.
 await db.notificationDelivery.update({where:{id:uq.id},data:{status:'QUEUED',nextAttemptAt:new Date(0)}});await worker(timeoutSender);assert.equal(attempts,1);
 for(const scenario of ['phone','revoked','used','expired','verified','disabled','tamper']) {
  const x=await fixture(),q=await queue(x);
  if(scenario==='phone')await db.user.update({where:{id:x.user.id},data:{phone:'+8801800000000'}});
  if(scenario==='revoked')await db.authSession.update({where:{id:x.session.id},data:{revokedAt:new Date()}});
  if(scenario==='used')await db.securityToken.update({where:{id:x.token.id},data:{usedAt:new Date()}});
  if(scenario==='expired')await db.securityToken.update({where:{id:x.token.id},data:{expiresAt:new Date(0)}});
  if(scenario==='verified')await db.user.update({where:{id:x.user.id},data:{phoneVerifiedAt:new Date()}});
  if(scenario==='disabled')await db.user.update({where:{id:x.user.id},data:{status:'SUSPENDED'}});
  if(scenario==='tamper')await db.notificationDelivery.update({where:{id:q.id},data:{securePayloadTag:'A'.repeat(24)}});
  if(scenario==='tamper') {
   await assert.rejects(worker(),/Encrypted SMS payload requires operator review/);
   const held=await db.notificationDelivery.findUniqueOrThrow({where:{id:q.id}});assert.equal(held.status,'QUEUED');assert.equal(held.attempts,0);assert.ok(held.securePayloadCiphertext);
   await db.notificationDelivery.update({where:{id:q.id},data:{nextAttemptAt:new Date(Date.now()+3600000)}});continue;
  }
  assert.equal((await worker()).cancelled,1,scenario);
  const cancelled=await db.notificationDelivery.findUniqueOrThrow({where:{id:q.id}});assert.equal(cancelled.status,'FAILED');assert.equal(cancelled.attempts,0);assert.equal(cancelled.securePayloadCiphertext,null);
 }
 assert.equal(calls,1);
 const rollback=await fixture();await assert.rejects(db.$transaction(async tx=>{await enqueue(tx,rollback.input);throw new Error('rollback');}));assert.equal(await db.notificationDelivery.count({where:{idempotencyKey:`phone-otp:${rollback.token.id}:sms`}}),0);
 // Durable claim exists before provider I/O; a second worker cannot reclaim it.
 const crash=await fixture(),cq=await queue(crash);let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const pending=worker({submitOtp:async input=>{entered();await held;return {state:'ACCEPTED',clientReference:input.clientReference,providerReference:'synthetic-held'};}});await started;
 const claimed=await db.notificationDelivery.findUniqueOrThrow({where:{id:cq.id}});assert.equal(claimed.attempts,1);assert.equal(claimed.status,'SENT');assert.equal(claimed.securePayloadCiphertext,null);assert.equal((await worker()).claimed,0);release();await pending;
 // An acknowledgement followed by database failure must not permit a resend.
 const persist=await fixture(),pq=await queue(persist);let persistenceCalls=0;
 const persistSender={submitOtp:async input=>{persistenceCalls++;return {state:'ACCEPTED',clientReference:input.clientReference,providerReference:'synthetic-persist'};}};
 const failingDb={$transaction:db.$transaction.bind(db),notificationDelivery:{findMany:db.notificationDelivery.findMany.bind(db.notificationDelivery),updateMany:async()=>{throw new Error('synthetic database write failure');}}};
 await assert.rejects(run(failingDb,persistSender,{approved:true}),/synthetic database write failure/);
 assert.equal((await worker(persistSender)).claimed,0);assert.equal(persistenceCalls,1);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:pq.id}})).providerReference,null);
 // Session revocation commits while the worker is waiting on the account lock.
 const racing=await fixture();await queue(racing);let unlock,locked;
 const hold=new Promise(r=>unlock=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${racing.user.id} FOR NO KEY UPDATE`;locked();await hold;await tx.authSession.update({where:{id:racing.session.id},data:{revokedAt:new Date()}});});
 await hasLock;const racingWorker=worker();await new Promise(r=>setTimeout(r,40));unlock();await blocker;assert.equal((await racingWorker).cancelled,1);
 // Issuance, replacement and encrypted enqueue are one transaction.
 const issuing=await fixture();await db.securityToken.update({where:{id:issuing.token.id},data:{createdAt:new Date(Date.now()-120000)}});
 const oldq=await queue(issuing);
 const request={userId:issuing.user.id,sessionId:issuing.session.id,expectedPhone:issuing.user.phone};
 const issued=await db.$transaction(tx=>issue(tx,request));
 assert.deepEqual(Object.keys(issued).sort(),['deliveryStatus','expiresAt','requested']);assert.equal(issued.deliveryStatus,'QUEUED');assert.equal(issued.requested,true);
 const oldjob=await db.notificationDelivery.findUniqueOrThrow({where:{id:oldq.id}});assert.equal(oldjob.status,'FAILED');assert.equal(oldjob.securePayloadCiphertext,null);
 assert.ok((await db.securityToken.findUniqueOrThrow({where:{id:issuing.token.id}})).usedAt);
 const latest=await db.securityToken.findFirstOrThrow({where:{userId:issuing.user.id,purpose:'PHONE_VERIFICATION',usedAt:null}});
 assert.equal(+latest.expiresAt,+issued.expiresAt);
 assert.equal(await db.notificationDelivery.count({where:{notification:{userId:issuing.user.id},status:'QUEUED'}}),1);
 await assert.rejects(db.$transaction(tx=>issue(tx,request)),/PHONE_CODE_COOLDOWN/);
 let sentCode;const issuedResult=await worker({submitOtp:async input=>{sentCode=input.code;return {state:'ACCEPTED',clientReference:input.clientReference,providerReference:'synthetic-issued'};}});assert.equal(issuedResult.accepted,1);
 assert.equal(hashPhoneVerificationCode(issuing.user.id,issuing.user.phone,sentCode),latest.tokenHash);
 const claim=await db.notificationDelivery.findUniqueOrThrow({where:{idempotencyKey:`phone-otp:${latest.id}:sms`}});
 await db.securityToken.update({where:{id:latest.id},data:{createdAt:new Date(Date.now()-120000)}});
 await db.$transaction(tx=>issue(tx,request));
 const preserved=await db.notificationDelivery.findUniqueOrThrow({where:{id:claim.id}});assert.equal(preserved.status,'SENT');assert.equal(preserved.providerReference,claim.providerReference);assert.equal(preserved.attempts,1);
 // Rollback restores the previous valid token and queue, not just the new row.
 const atomic=await fixture();await db.securityToken.update({where:{id:atomic.token.id},data:{createdAt:new Date(Date.now()-120000)}});const aq=await queue(atomic);
 const atomicInput={userId:atomic.user.id,sessionId:atomic.session.id,expectedPhone:atomic.user.phone};
 await assert.rejects(db.$transaction(async tx=>{await issue(tx,atomicInput);throw new Error('synthetic issuance rollback');}),/synthetic issuance rollback/);
 assert.equal((await db.securityToken.findUniqueOrThrow({where:{id:atomic.token.id}})).usedAt,null);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:aq.id}})).status,'QUEUED');
 await assert.rejects(db.$transaction(tx=>issue(tx,{...atomicInput,expectedPhone:'+8801900000000'})),/PHONE_ACCOUNT_CHANGED/);
 assert.equal(await db.securityToken.count({where:{userId:atomic.user.id}}),1);
 const concurrent=await Promise.allSettled([db.$transaction(tx=>issue(tx,atomicInput)),db.$transaction(tx=>issue(tx,atomicInput))]);
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal(concurrent.filter(x=>x.status==='rejected' && /PHONE_CODE_COOLDOWN/.test(x.reason.message)).length,1);
 assert.equal(await db.securityToken.count({where:{userId:atomic.user.id,usedAt:null}}),1);
 const collision=await fixture();await db.securityToken.update({where:{id:collision.token.id},data:{createdAt:new Date(Date.now()-120000)}});
 await db.securityToken.create({data:{userId:collision.user.id,purpose:'PHONE_VERIFICATION',tokenHash:hashPhoneVerificationCode(collision.user.id,collision.user.phone,'000000'),expiresAt:new Date(Date.now()+60000),createdAt:new Date(Date.now()-120000)}});
 const fixedSource=issuanceSource.replace('import { randomInt } from "node:crypto";', 'const randomInt = () => 0;');
 const fixed=await import(moduleUrl(fixedSource));
 await assert.rejects(db.$transaction(tx=>fixed.issueQueuedPhoneVerification(tx,{userId:collision.user.id,sessionId:collision.session.id,expectedPhone:collision.user.phone})),/PHONE_CODE_GENERATION_FAILED/);
 assert.equal(await db.securityToken.count({where:{userId:collision.user.id,usedAt:null}}),2);
 // Input identity is snapshotted before asynchronous lock acquisition.
 const snapshotActor=await fixture();await db.securityToken.update({where:{id:snapshotActor.token.id},data:{createdAt:new Date(Date.now()-120000)}});
 const mutableRequest={userId:snapshotActor.user.id,sessionId:snapshotActor.session.id,expectedPhone:snapshotActor.user.phone};
 await db.$transaction(tx=>{const pending=issue(tx,mutableRequest);mutableRequest.userId=collision.user.id;mutableRequest.sessionId=collision.session.id;mutableRequest.expectedPhone=collision.user.phone;return pending;});
 assert.equal(await db.securityToken.count({where:{userId:snapshotActor.user.id,usedAt:null}}),1);
 const authAudit=await db.auditLog.findFirstOrThrow({where:{actorId:snapshotActor.user.id,action:'auth.phone_otp_queued'}});assert.deepEqual(Object.keys(authAudit.metadata).sort(),['deliveryStatus','expiresAt']);
 console.log('Durable OTP jobs and queued issuance passed: atomic enqueue/rollback, concurrent one-attempt claims, stale account/session/token rejection, ciphertext purge, uncertain-send no-retry and acceptance distinct from delivery. Real disposable PostgreSQL; simulated sender only.');
} finally {await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();}
