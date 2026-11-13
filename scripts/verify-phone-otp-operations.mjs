import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
const url=new URL(process.env.DATABASE_URL??'postgresql://invalid/invalid');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(url.searchParams.get('schema')??''))throw new Error('Requires a disposable local schema.');
const origin=process.env.TEST_BASE_URL;if(!origin||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Requires a disposable local app.');
const source=(await readFile(new URL('../src/modules/notifications/phone-otp-operations.ts',import.meta.url),'utf8')).replace('import "server-only";','').replace('from "zod"',`from "${pathToFileURL(createRequire(import.meta.url).resolve('zod')).href}"`);
const {purgeObsoletePhoneOtpJobs:purge,phoneOtpJobLabel:label}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const summarySource=(await readFile(new URL('../src/modules/maintenance/security-cleanup-summary.ts',import.meta.url),'utf8')).replace('import "server-only";','');
const {formatSecurityCleanupSummary:formatSummary}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(summarySource)).toString('base64')}`);
assert.equal(formatSummary({phoneOtpPayloadsPurged:2,privateNote:'never render'}),'SMS payloads removed: 2');
assert.equal(formatSummary({phoneOtpPayloadsPurged:-1}),'No recognized cleanup counts recorded.');
const db=new PrismaClient(),marker=randomBytes(8).toString('hex'),sensitive=`PRIVATE_OTP_${marker}`;let admin,customer,browser;
const path='/admin/notifications/sms';
async function jwt(user,portal,mfa){const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3600000),mfaVerifiedAt:mfa?new Date():null,clientType:'WEB',clientName:'SMS operations acceptance'}});return new SignJWT({email:user.email,name:user.fullName,roles:[portal==='admin'?'admin':'customer_personal']}).setProtectedHeader({alg:'HS256'}).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));}
const request=(query='',token)=>fetch(`${origin}${path}${query}`,{headers:token?{Cookie:`crossly_session=${token}`}:{},redirect:'manual'});
async function job(status='QUEUED',attempts=0,reference=null,tokenId=null){const n=await db.notification.create({data:{userId:customer.id,eventType:'PHONE_OTP_DISPATCH',category:'SECURITY',priority:'HIGH',title:sensitive,body:sensitive,entityType:'SecurityToken',entityId:tokenId,idempotencyKey:randomUUID(),deliveries:{create:{channel:'SMS',status,attempts,providerReference:reference,idempotencyKey:randomUUID(),securePayloadCiphertext:attempts?null:sensitive,securePayloadIv:attempts?null:'A'.repeat(16),securePayloadTag:attempts?null:'A'.repeat(24),nextAttemptAt:new Date()}}},select:{deliveries:{select:{id:true}}}});return n.deliveries[0].id;}
try{
 const role=await db.role.findUniqueOrThrow({where:{code:'admin'}});
 admin=await db.user.create({data:{email:`sms-admin-${marker}@example.test`,fullName:'Synthetic SMS operator',status:'ACTIVE',passwordHash:'unused',roles:{create:{roleId:role.id}}}});
 customer=await db.user.create({data:{email:`private-recipient-${marker}@example.test`,fullName:sensitive,status:'ACTIVE',passwordHash:'unused'}});
 const token=await jwt(admin,'admin',true),unverified=await jwt(admin,'admin',false),wrongPortal=await jwt(admin,'customer',true),forgedRole=await jwt(customer,'admin',true);
 for(const t of [undefined,unverified,wrongPortal,forgedRole])assert.notEqual((await request('',t)).status,200,'SMS operations leaked without Admin MFA');
 const empty=await request('',token);assert.equal(empty.status,200);assert.match(await empty.text(),/No SMS jobs match this filter/);
 const unknown=await job('SENT',1),accepted=await job('SENT',1,'synthetic-provider-accepted');
 const reference='a'.repeat(20);await db.auditLog.create({data:{action:'auth.phone_otp_claimed',entityType:'NotificationDelivery',entityId:unknown,metadata:{clientReference:reference,unexpectedSecret:sensitive}}});
 for(let i=0;i<51;i++)await job();
 const first=await request('',token),html=await first.text();assert.equal(first.status,200);assert.ok(html.includes(reference));assert.ok(html.includes('Unconfirmed attempt'));assert.ok(!html.includes(sensitive));assert.ok(!html.includes(customer.email));
 const acceptedPage=await request('?state=accepted',token);assert.match(await acceptedPage.text(),/Accepted — delivery unconfirmed/);
 const all=await request('?state=all',token);assert.match(await all.text(),/Next page/);
 const invalid=await request('?page=-1&state=bogus',token);assert.match(await invalid.text(),/Invalid filter/);
 assert.equal(label({status:'QUEUED',attempts:1,providerReference:null}),'Unconfirmed attempt — reconcile');
 assert.equal(label({status:'DELIVERED',attempts:1,providerReference:'x'}),'Unexpected state — review required');
 const {chromium}=await import('@playwright/test');browser=await chromium.launch({headless:true});
 for(const width of [390,1440]){const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'crossly_session',value:token,url:origin}]);const page=await context.newPage();await page.goto(`${origin}${path}?state=all`);await page.getByRole('heading',{name:'SMS verification review.'}).waitFor();await page.getByRole('navigation',{name:'Administrator navigation'}).waitFor({state:'attached'});await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`/tmp/deshdak-sms-operations-${width}.png`,fullPage:false});await context.close();}
 // Investigation acknowledgements are immutable and never alter send state.
 const reviewPath=id=>`${origin}/api/v1/admin/notifications/sms/${id}/investigation`;
 const review=(id,credential=token,body={reviewed:true},sourceOrigin=origin)=>fetch(reviewPath(id),{method:'POST',headers:{Cookie:`crossly_session=${credential}`,Origin:sourceOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const credential of [unverified,wrongPortal,forgedRole])assert.equal((await review(unknown,credential)).status,403);
 assert.equal((await review(unknown,token,{reviewed:true},'https://untrusted.example')).status,403);
 assert.equal((await review(unknown,token,{reviewed:false})).status,422);
 assert.equal((await review(unknown,token,{reviewed:true,delivered:true})).status,422);
 assert.equal((await review(accepted)).status,409);
 const beforeReview=await db.notificationDelivery.findUniqueOrThrow({where:{id:unknown}});
 const reviews=await Promise.all([review(unknown),review(unknown),review(unknown)]);for(const r of reviews)assert.equal(r.status,200);
 const results=await Promise.all(reviews.map(r=>r.json()));assert.equal(results.filter(r=>r.data.replayed===false).length,1);
 assert.equal(await db.auditLog.count({where:{entityId:unknown,action:'auth.phone_otp_investigation_acknowledged'}}),1);
 assert.deepEqual(await db.notificationDelivery.findUniqueOrThrow({where:{id:unknown}}),beforeReview);
 const ack=await db.auditLog.findFirstOrThrow({where:{entityId:unknown,action:'auth.phone_otp_investigation_acknowledged'}});assert.equal(ack.actorId,admin.id);assert.deepEqual(ack.metadata,{reviewed:true,outcome:'INVESTIGATION_ONLY'});
 // Acceptance committed while a review waits must win over a stale page.
 const racingJob=await job('SENT',1);let unlockReview,jobLocked;
 const heldReview=new Promise(r=>unlockReview=r),hasJobLock=new Promise(r=>jobLocked=r);
 const acceptance=db.$transaction(async tx=>{await tx.notificationDelivery.update({where:{id:racingJob},data:{providerReference:'synthetic-racing-acceptance'}});jobLocked();await heldReview;});
 await hasJobLock;const staleReview=review(racingJob);await new Promise(r=>setTimeout(r,30));unlockReview();await acceptance;assert.equal((await staleReview).status,409);assert.equal(await db.auditLog.count({where:{entityId:racingJob,action:'auth.phone_otp_investigation_acknowledged'}}),0);
 const uiJob=await job('SENT',1),reviewContext=await browser.newContext({viewport:{width:390,height:1000}});await reviewContext.addCookies([{name:'crossly_session',value:token,url:origin}]);
 const reviewPage=await reviewContext.newPage();await reviewPage.goto(`${origin}${path}?state=unconfirmed`);
 await reviewPage.getByRole('navigation',{name:'Administrator navigation'}).waitFor({state:'attached'});
 const card=reviewPage.locator('#admin-main-content .sms-otp-list > article:visible').filter({hasText:uiJob});await card.getByRole('checkbox').check();await card.screenshot({path:'/tmp/deshdak-sms-investigation-390.png'});
 await reviewPage.route('**/api/v1/admin/notifications/sms/*/investigation',route=>route.abort());await card.getByRole('button',{name:'Acknowledge investigation'}).click();await card.getByRole('alert').waitFor();assert.ok(await card.getByRole('button',{name:'Acknowledge investigation'}).isEnabled());
 await reviewPage.unroute('**/api/v1/admin/notifications/sms/*/investigation');await card.getByRole('button',{name:'Acknowledge investigation'}).click();await card.getByText('Investigation acknowledged',{exact:true}).waitFor();
 assert.equal(await db.auditLog.count({where:{entityId:uiJob,action:'auth.phone_otp_investigation_acknowledged'}}),1);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:uiJob}})).status,'SENT');await reviewContext.close();
 const active=await db.securityToken.create({data:{userId:customer.id,purpose:'PHONE_VERIFICATION',tokenHash:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+300000)}});
 const expired=await db.securityToken.create({data:{userId:customer.id,purpose:'PHONE_VERIFICATION',tokenHash:randomBytes(32).toString('hex'),expiresAt:new Date(0)}});
 const used=await db.securityToken.create({data:{userId:customer.id,purpose:'PHONE_VERIFICATION',tokenHash:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+300000),usedAt:new Date()}});
 const activeJob=await job('QUEUED',0,null,active.id),expiredJob=await job('QUEUED',0,null,expired.id),usedJob=await job('QUEUED',0,null,used.id);
 const cleanups=await Promise.all([purge(db,500),purge(db,500)]);assert.equal(cleanups.reduce((n,x)=>n+x.purged,0),53);assert.equal(await db.auditLog.count({where:{action:'auth.phone_otp_payload_purged'}}),53);
 for(const id of [expiredJob,usedJob]){const row=await db.notificationDelivery.findUniqueOrThrow({where:{id}});assert.equal(row.status,'FAILED');assert.equal(row.securePayloadCiphertext,null);}
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:activeJob}})).status,'QUEUED');
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:accepted}})).providerReference,'synthetic-provider-accepted');
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:unknown}})).status,'SENT');
 assert.equal((await purge(db,500)).purged,0);await assert.rejects(purge(db,501),/Invalid OTP cleanup batch size/);
 // The existing authenticated maintenance paths now execute OTP retention.
 const pendingCleanup=await job('QUEUED',0,null,expired.id);
 const maintenancePath='/api/v1/internal/maintenance/security-cleanup';
 for(const secret of [undefined,'wrong-maintenance-key']) {
  const result=await fetch(`${origin}${maintenancePath}`,{method:'POST',headers:secret?{Authorization:`Bearer ${secret}`}:{}});assert.equal(result.status,401);
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:pendingCleanup}})).status,'QUEUED');
 }
 for(const deniedToken of [unverified,wrongPortal,forgedRole]) {
  const rejected=await fetch(`${origin}/api/v1/admin/maintenance/run`,{method:'POST',headers:{Cookie:`crossly_session=${deniedToken}`,Origin:origin}});assert.equal(rejected.status,403);
  const rejectedConfiguration=await fetch(`${origin}/api/v1/admin/maintenance/configuration`,{headers:{Cookie:`crossly_session=${deniedToken}`}});assert.equal(rejectedConfiguration.status,403);
 }
 const wrongOrigin=await fetch(`${origin}/api/v1/admin/maintenance/run`,{method:'POST',headers:{Cookie:`crossly_session=${token}`,Origin:'https://untrusted.example'}});assert.equal(wrongOrigin.status,403);
 const cleanupResponse=await fetch(`${origin}${maintenancePath}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.MAINTENANCE_JOB_SECRET}`}});assert.equal(cleanupResponse.status,200);
 const cleanupResult=await cleanupResponse.json();assert.equal(cleanupResult.data.summary.phoneOtpPayloadsPurged,1);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:pendingCleanup}})).securePayloadCiphertext,null);
 const runHistory=await db.maintenanceJobRun.findUniqueOrThrow({where:{id:cleanupResult.data.runId}});assert.equal(runHistory.status,'SUCCEEDED');assert.equal(runHistory.summary.phoneOtpPayloadsPurged,1);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:unknown}})).status,'SENT');
 const manualPayload=await job('QUEUED',0,null,expired.id);
 const manualResponse=await fetch(`${origin}/api/v1/admin/maintenance/run`,{method:'POST',headers:{Cookie:`crossly_session=${token}`,Origin:origin}});assert.equal(manualResponse.status,200);assert.equal((await manualResponse.json()).data.summary.phoneOtpPayloadsPurged,1);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:manualPayload}})).status,'FAILED');
 const maintenanceContext=await browser.newContext({viewport:{width:390,height:1000}});await maintenanceContext.addCookies([{name:'crossly_session',value:token,url:origin}]);
 const maintenancePage=await maintenanceContext.newPage();
 let releaseScripts;const scriptsReady=new Promise(resolve=>releaseScripts=resolve);
 const holdScripts=async route=>{if(route.request().resourceType()==='script')await scriptsReady;await route.continue();};
 await maintenancePage.route('**/_next/**',holdScripts);
 try {
  await maintenancePage.goto(`${origin}/admin/system-maintenance`,{waitUntil:'commit'});await maintenancePage.getByRole('heading',{name:'Protected cleanup operations.'}).waitFor();
  assert.ok(await maintenancePage.getByRole('button',{name:'Run cleanup now'}).isDisabled(),'Cleanup was clickable before hydration.');
  assert.ok(await maintenancePage.getByRole('button',{name:'Save policy'}).isDisabled(),'Policy save was clickable before hydration.');
 }finally{releaseScripts();}
 await maintenancePage.getByRole('button',{name:'Run cleanup now'}).waitFor();

 assert.match(await maintenancePage.content(),/SMS payloads removed: 1/);
 await maintenancePage.route('**/api/v1/admin/maintenance/run',route=>route.abort());
 maintenancePage.once('dialog',dialog=>dialog.accept());const failedCleanupRequest=maintenancePage.waitForRequest(request=>request.url()===`${origin}/api/v1/admin/maintenance/run`&&request.method()==='POST');await maintenancePage.getByRole('button',{name:'Run cleanup now'}).click();await failedCleanupRequest;await maintenancePage.getByText('The cleanup request could not be confirmed. Check recent run history before retrying.').waitFor();assert.ok(await maintenancePage.getByRole('button',{name:'Run cleanup now'}).isEnabled());
 await maintenancePage.route('**/api/v1/admin/maintenance/configuration',route=>route.fulfill({status:502,contentType:'text/html',body:'upstream unavailable'}));
 await maintenancePage.getByRole('button',{name:'Save policy'}).click();await maintenancePage.getByText('The settings request could not be confirmed. Reload the saved policy before retrying.').waitFor();assert.ok(await maintenancePage.getByRole('button',{name:'Save policy'}).isEnabled());
 await maintenancePage.route('**/api/v1/admin/maintenance/run',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 maintenancePage.once('dialog',dialog=>dialog.accept());await maintenancePage.getByRole('button',{name:'Run cleanup now'}).click();await maintenancePage.getByText('The cleanup request could not be confirmed. Check recent run history before retrying.').waitFor();assert.ok(await maintenancePage.getByRole('button',{name:'Run cleanup now'}).isEnabled());
 await maintenanceContext.close();
 console.log('SMS operations passed: Admin/MFA/portal gates, safe projections, filters/pagination/empty states, 390/1440px browser overflow checks and concurrent obsolete-payload cleanup. No SMS sent.');
}finally{await browser?.close();if(customer)await db.user.delete({where:{id:customer.id}});if(admin)await db.user.delete({where:{id:admin.id}});await db.$disconnect();}
