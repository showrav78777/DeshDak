import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import sharp from 'sharp';
const database=new URL(process.env.DATABASE_URL??'postgresql://invalid/invalid'),origin=process.env.TEST_BASE_URL;
if(!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get('schema')??'')||!origin||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Requires a disposable local schema/application.');
const db=new PrismaClient(),users=[],marker=randomBytes(8).toString('hex');
const photo=await sharp({create:{width:8,height:8,channels:3,background:'#176780'}}).jpeg().toBuffer();
const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(process.env.KYC_DOCUMENT_ENCRYPTION_KEY,'base64'),iv);
const document={documentPhotoCiphertext:Buffer.concat([cipher.update(photo),cipher.final()]).toString('base64'),documentPhotoIv:iv.toString('base64'),documentPhotoTag:cipher.getAuthTag().toString('base64'),documentPhotoMimeType:'image/jpeg',documentPhotoSha256:createHash('sha256').update(photo).digest('hex'),documentPhotoSizeBytes:photo.length};
async function actor(code='compliance',portal='compliance'){
 const role=await db.role.findUniqueOrThrow({where:{code}}),user=await db.user.create({data:{email:`review-${randomBytes(4).toString('hex')}-${marker}@example.test`,fullName:'Synthetic review actor',passwordHash:'unused',status:'ACTIVE',kycStatus:'PENDING',roles:{create:{roleId:role.id}}}});users.push(user.id);
 const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3600000),mfaVerifiedAt:portal==='compliance'?new Date():null,clientType:'WEB',clientName:'Identity review test'}});
 const token=await new SignJWT({roles:[code]}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setJti(session.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));return {user,session,token};
}
const submission=(tx,userId)=>tx.identityVerification.create({data:{userId,documentType:'PASSPORT',issuingCountryCode:'BD',documentNumberLast4:'A123',...document}});
async function review(person,id,decision='VERIFIED',version=1,trusted=true){return fetch(`${origin}/api/v1/compliance/identity-verifications/${id}`,{method:'PATCH',headers:{Cookie:`crossly_session=${person.token}`,Origin:trusted?origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({decision,version,note:'Synthetic review decision'})});}
async function delayed(person,record,change,lockUserId=person.user.id){
 let release,locked;const hold=new Promise(r=>release=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${lockUserId} FOR UPDATE`;locked();await hold;await change(tx);},{timeout:20000});await hasLock;
 const response=review(person,record.id);
 try{let waiting=false;const deadline=Date.now()+10000;while(Date.now()<deadline){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%'`;if(rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(waiting,'Review did not reach final authorization lock.');}finally{release();await blocker;}
 return response;
}
try {
 for(const scenario of ['revoked','role','mfa','pending']){
  const person=await actor(),customer=await actor('customer_personal','customer'),record=await submission(db,customer.user.id);
  const response=await delayed(person,record,async tx=>{if(scenario==='revoked')await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});if(scenario==='role')await tx.userRole.deleteMany({where:{userId:person.user.id}});if(scenario==='mfa')await tx.authSession.update({where:{id:person.session.id},data:{mfaVerifiedAt:null}});if(scenario==='pending')await tx.user.update({where:{id:person.user.id},data:{status:'PENDING_VERIFICATION'}});});
  assert.equal(response.status,403,scenario);assert.equal((await db.identityVerification.findUniqueOrThrow({where:{id:record.id}})).status,'PENDING');assert.equal((await db.user.findUniqueOrThrow({where:{id:customer.user.id}})).kycStatus,'PENDING');assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'identity_verification.review_denied'}}),1);assert.equal(await db.auditLog.count({where:{entityId:record.id,action:'identity_verification.verified'}}),0);
 }
 const first=await actor(),second=await actor(),customer=await actor('customer_personal','customer');
 let record=await submission(db,customer.user.id);
 assert.equal((await review(first,record.id,'VERIFIED',1,false)).status,403,'Untrusted review origin accepted.');
 assert.equal((await review(customer,record.id)).status,403,'Customer reviewed own identity.');
 const decisions=await Promise.all([review(first,record.id),review(second,record.id,'REJECTED')]);assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
 const saved=await db.identityVerification.findUniqueOrThrow({where:{id:record.id}});assert.equal(saved.version,2);assert.equal((await db.user.findUniqueOrThrow({where:{id:customer.user.id}})).kycStatus,saved.status);assert.equal(await db.auditLog.count({where:{entityId:record.id,action:{in:['identity_verification.verified','identity_verification.rejected']}}}),1);
 // Model the same customer-first replacement transaction used by upload intake.
 await db.user.update({where:{id:customer.user.id},data:{kycStatus:'PENDING'}});record=await submission(db,customer.user.id);let replacement;
 const stale=await delayed(first,record,async tx=>{await tx.identityVerification.update({where:{id:record.id},data:{status:'REJECTED',reviewNote:'Superseded by a newer customer submission.'}});replacement=await submission(tx,customer.user.id);await tx.user.update({where:{id:customer.user.id},data:{kycStatus:'PENDING'}});},customer.user.id);
 assert.equal(stale.status,409,'Review of replaced submission succeeded.');assert.equal((await db.user.findUniqueOrThrow({where:{id:customer.user.id}})).kycStatus,'PENDING');assert.equal((await db.identityVerification.findUniqueOrThrow({where:{id:replacement.id}})).status,'PENDING');assert.equal(await db.auditLog.count({where:{entityId:record.id,action:'identity_verification.verified'}}),0);
 // A normal rejection remains available after the conflict.
 assert.equal((await review(first,replacement.id,'REJECTED')).status,200);assert.equal((await db.user.findUniqueOrThrow({where:{id:customer.user.id}})).kycStatus,'REJECTED');
 console.log('Identity review authorization passed: in-flight revocation/role/MFA/account changes deny atomically; concurrent decisions have one winner; replacement conflicts preserve pending customer state; trusted valid review and origin/role boundaries remain intact. Synthetic documents only.');
}finally{
 await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.identityVerification.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
}
