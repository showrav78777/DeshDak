import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
const database=new URL(process.env.DATABASE_URL??'postgresql://invalid/invalid'),origin=process.env.TEST_BASE_URL;
if(!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get('schema')??'')||!origin||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Requires a disposable local schema/application.');
const db=new PrismaClient(),users=[],screenings=[],marker=randomBytes(8).toString('hex');let browser;
async function actor(portal='compliance'){
 const code=portal==='customer'?'customer_personal':portal,role=await db.role.findUniqueOrThrow({where:{code}});
 const user=await db.user.create({data:{email:`screening-${randomBytes(4).toString('hex')}-${marker}@example.test`,fullName:'Synthetic screening actor',passwordHash:'unused',status:'ACTIVE',roles:{create:{roleId:role.id}}}});users.push(user.id);
 const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3600000),mfaVerifiedAt:portal==='customer'?null:new Date(),clientType:'WEB',clientName:'Screening review test'}});
 const token=await new SignJWT({roles:[code]}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setJti(session.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));return {user,session,token,portal};
}
async function submission(customer){const row=await db.complianceScreeningAttempt.create({data:{customerId:customer.user.id,subject:'SOURCING_REQUEST',inputHash:randomBytes(32).toString('hex'),outcome:'REVIEW_REQUIRED',originCountryCode:'CN',destinationCountryCode:'BD'}});screenings.push(row.id);return row;}
const prefix=portal=>portal==='admin'?'/api/v1/admin/compliance/screenings':'/api/v1/compliance/screenings';
async function review(person,id,decision='APPROVED',version=1,trusted=true){return fetch(`${origin}${prefix(person.portal)}/${id}`,{method:'PATCH',headers:{Cookie:`crossly_session=${person.token}`,Origin:trusted?origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({decision,version,note:'Synthetic screening evidence'})});}
async function delayed(person,record,change){
 let release,locked;const hold=new Promise(r=>release=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${person.user.id} FOR UPDATE`;locked();await hold;await change(tx);},{timeout:20000});await hasLock;
 const response=review(person,record.id);
 try{let waiting=false;const deadline=Date.now()+10000;while(Date.now()<deadline){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%'`;if(rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(waiting,'Review did not reach final authorization lock.');}finally{release();await blocker;}
 return response;
}
try{
 const customer=await actor('customer');
 for(const portal of ['admin','compliance'])for(const scenario of ['revoked','role','mfa','pending','expired']){
  const person=await actor(portal),record=await submission(customer);
  const response=await delayed(person,record,async tx=>{if(scenario==='revoked')await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});if(scenario==='role')await tx.userRole.deleteMany({where:{userId:person.user.id}});if(scenario==='mfa')await tx.authSession.update({where:{id:person.session.id},data:{mfaVerifiedAt:null}});if(scenario==='pending')await tx.user.update({where:{id:person.user.id},data:{status:'PENDING_VERIFICATION'}});if(scenario==='expired')await tx.authSession.update({where:{id:person.session.id},data:{expiresAt:new Date(Date.now()-1000)}});});
  assert.equal(response.status,403,`${portal}/${scenario}`);const saved=await db.complianceScreeningAttempt.findUniqueOrThrow({where:{id:record.id}});assert.equal(saved.outcome,'REVIEW_REQUIRED');assert.equal(saved.version,1);assert.equal(saved.reviewedById,null);assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'compliance.screening_review_denied'}}),1);assert.equal(await db.auditLog.count({where:{entityId:record.id,action:'compliance.screening_approved'}}),0);
 }
 const admin=await actor('admin'),compliance=await actor('compliance'),record=await submission(customer);
 assert.equal((await review(admin,record.id,'APPROVED',1,false)).status,403);
 assert.equal((await review(customer,record.id)).status,403);
 assert.equal((await fetch(`${origin}${prefix('admin')}/${record.id}`,{method:'PATCH',headers:{Cookie:`crossly_session=${compliance.token}`,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({decision:'APPROVED',version:1,note:'Synthetic evidence'})})).status,403);
 assert.equal((await review(compliance,randomUUID())).status,404);
 assert.equal((await review(compliance,record.id,'APPROVED',2)).status,409);
 const decisions=await Promise.all([review(admin,record.id),review(compliance,record.id,'REJECTED')]);assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
 const saved=await db.complianceScreeningAttempt.findUniqueOrThrow({where:{id:record.id}});assert.equal(saved.version,2);assert.equal(await db.auditLog.count({where:{entityId:record.id,action:{in:['compliance.screening_approved','compliance.screening_rejected']}}}),1);assert.equal((await review(admin,record.id)).status,409);
 const {chromium}=await import('@playwright/test');browser=await chromium.launch({headless:true});
 for(const person of [admin,compliance])for(const width of [390,1440]){
  const customer=await actor('customer'),record=await submission(customer),path=person.portal==='admin'?'/admin/compliance':'/compliance';
  const cookie={name:'crossly_session',value:person.token,url:origin};
  const noJs=await browser.newContext({javaScriptEnabled:false});await noJs.addCookies([cookie]);const noJsPage=await noJs.newPage();await noJsPage.goto(`${origin}${path}`);
  assert.ok(await noJsPage.locator('article').filter({hasText:customer.user.personCode}).getByRole('button',{name:'Record decision',exact:true}).isDisabled());await noJs.close();
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([cookie]);const page=await context.newPage();await page.goto(`${origin}${path}`);
  const card=page.locator('article').filter({hasText:customer.user.personCode}),form=card.locator('form');await form.getByRole('textbox',{name:'Review note'}).fill('Synthetic restricted-goods evidence');
  const endpoint=`${origin}${prefix(person.portal)}/${record.id}`;
  for(const mode of ['abort','html','empty','wrong-id']){
   const handler=route=>mode==='abort'?route.abort():route.fulfill({status:mode==='html'?502:200,contentType:mode==='html'?'text/html':'application/json',body:mode==='html'?'upstream unavailable':mode==='empty'?'{}':JSON.stringify({data:{screening:{id:'another-record',outcome:'APPROVED'}}})});await page.route(endpoint,handler);
   await form.getByRole('button',{name:'Record decision',exact:true}).click();await form.getByRole('alert').filter({hasText:'Could not confirm this decision.'}).waitFor();assert.ok(await form.getByRole('button',{name:'Record decision',exact:true}).isEnabled());assert.equal((await db.complianceScreeningAttempt.findUniqueOrThrow({where:{id:record.id}})).outcome,'REVIEW_REQUIRED');await page.unroute(endpoint,handler);
  }
  let release;const held=new Promise(resolve=>release=resolve);const holdRefresh=async route=>{if(route.request().headers().rsc==='1')await held;await route.continue();};await page.route(`**${path}?**`,holdRefresh);
  try{const refreshed=page.waitForRequest(request=>new URL(request.url()).pathname===path&&request.headers().rsc==='1');await form.getByRole('button',{name:'Record decision',exact:true}).click();await refreshed;assert.ok(await form.getByRole('button',{name:'Saving…'}).isDisabled());assert.equal((await db.complianceScreeningAttempt.findUniqueOrThrow({where:{id:record.id}})).outcome,'APPROVED');}finally{release();}
  await card.waitFor({state:'detached'});await context.close();
 }
 console.log('Screening review passed: Admin/Compliance in-flight session/MFA/role/account/expiry races, version/state/origin/portal guards and concurrent single-winner decisions; 390/1440px failure recovery, malformed-success rejection, no-JavaScript disabled controls and pending state through real queue refresh. Synthetic data only; no provider called.');
}finally{
 await browser?.close();await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.complianceScreeningAttempt.deleteMany({where:{id:{in:screenings}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
}
