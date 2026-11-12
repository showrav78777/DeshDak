import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import sharp from 'sharp';
const database=new URL(process.env.DATABASE_URL??'postgresql://invalid/invalid'),origin=process.env.TEST_BASE_URL;
if(!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get('schema')??'')||!origin||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Requires a disposable local schema/application.');
if(process.env.ALLOW_DEV_KYC_DOCUMENT_UPLOADS!=='true'||process.env.ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS!=='true')throw new Error('Explicit isolated development intake required.');
const db=new PrismaClient(),marker=randomBytes(8).toString('hex'),users=[],warehouses=[],orders=[],parcels=[];
const photo=await sharp({create:{width:8,height:8,channels:3,background:'#176780'}}).jpeg().toBuffer();
async function actor(code,portal){const role=await db.role.findUniqueOrThrow({where:{code}}),user=await db.user.create({data:{email:`download-auth-${randomBytes(4).toString('hex')}-${marker}@example.test`,fullName:'Synthetic download actor',passwordHash:'unused',status:'ACTIVE',roles:{create:{roleId:role.id}}}});users.push(user.id);const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3600000),mfaVerifiedAt:['admin','compliance'].includes(portal)?new Date():null,clientType:'WEB',clientName:'Download authorization test'}});const token=await new SignJWT({roles:[code]}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setJti(session.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));return {user,session,token};}
async function parcel(owner){const a=await db.warehouse.create({data:{name:`Upload A ${marker}`,country:'CN',type:'ORIGIN'}}),b=await db.warehouse.create({data:{name:`Upload B ${marker}`,country:'CN',type:'ORIGIN'}});warehouses.push(a.id,b.id);const order=await db.order.create({data:{orderNumber:`ORD-${randomBytes(10).toString('hex').toUpperCase()}`,customerId:owner.id,status:'WAREHOUSE_RECEIVED',grandTotal:100}});orders.push(order.id);const pkg=await db.package.create({data:{orderId:order.id,warehouseId:a.id,packageCode:`PKG-${randomBytes(10).toString('hex').toUpperCase()}`,status:'RECEIVED'}});parcels.push(pkg.id);return {pkg,a,b};}

function encrypted(key) {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);return {ciphertext:Buffer.concat([cipher.update(photo),cipher.final()]).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),sha:createHash('sha256').update(photo).digest('hex')};}
async function read(person,path){return fetch(`${origin}${path}`,{headers:{Cookie:`crossly_session=${person.token}`}});}
async function delayed(person,path,change){
 let release,locked;const hold=new Promise(r=>release=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${person.user.id} FOR UPDATE`;locked();await hold;await change(tx);},{timeout:20000});await hasLock;
 const response=read(person,path);
 try{let waiting=false;const deadline=Date.now()+10000;while(Date.now()<deadline){const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%'`;if(rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(waiting,'Download did not reach final authorization lock.');}finally{release();await blocker;}
 return response;
}
const digest=createHash('sha256').update(photo).digest('hex');
async function checkDenied(response,person,kind){assert.equal(response.status,403);assert.match(response.headers.get('content-type'),/json/);assert(!(await response.text()).includes(photo.toString('base64')));assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:kind==='identity'?'identity_verification.document_viewed':'inspection.evidence_viewed'}}),0);assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'private_photo.legacy_view_blocked'}}),1);}
try {
 const owner=await actor('customer_personal','customer'), other=await actor('customer_personal','customer');
 const e=encrypted(process.env.KYC_DOCUMENT_ENCRYPTION_KEY);
 const record=await db.identityVerification.create({data:{userId:owner.user.id,documentType:'PASSPORT',issuingCountryCode:'BD',documentNumberLast4:'A123',documentPhotoCiphertext:e.ciphertext,documentPhotoIv:e.iv,documentPhotoTag:e.tag,documentPhotoSha256:e.sha,documentPhotoMimeType:'image/jpeg',documentPhotoSizeBytes:photo.length}});
 const identityPath=`/api/v1/compliance/identity-verifications/${record.id}/document`;
 const positive=await actor('compliance','compliance');const ok=await read(positive,identityPath);assert.equal(ok.status,200);assert.deepEqual(Buffer.from(await ok.arrayBuffer()),photo);assert.match(ok.headers.get('cache-control'),/no-store/);
 for(const scenario of ['revoked','role','mfa','pending']){const person=await actor('compliance','compliance');await checkDenied(await delayed(person,identityPath,async tx=>{if(scenario==='revoked')await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});if(scenario==='role')await tx.userRole.deleteMany({where:{userId:person.user.id}});if(scenario==='mfa')await tx.authSession.update({where:{id:person.session.id},data:{mfaVerifiedAt:null}});if(scenario==='pending')await tx.user.update({where:{id:person.user.id},data:{status:'PENDING_VERIFICATION'}});}),person,'identity');}
 for(const scenario of ['revoked','role','assignment','moved','owner']){
  const person= scenario==='owner'? await actor('customer_personal','customer'):await actor('inspector','inspector');
  const p=await parcel(scenario==='owner'?person.user:owner.user);await db.warehouseStaffAssignment.create({data:{userId:person.user.id,warehouseId:p.a.id}});
  const e=encrypted(process.env.INSPECTION_EVIDENCE_ENCRYPTION_KEY);
  const evidence=await db.inspectionEvidence.create({data:{packageId:p.pkg.id,uploadedById:positive.user.id,mediaKind:'PHOTO',mimeType:'image/jpeg',sizeBytes:photo.length,sha256:digest,ciphertext:e.ciphertext,iv:e.iv,authTag:e.tag}});
  const path=`/api/v1/operations/inspection-evidence/${evidence.id}`;
  await checkDenied(await delayed(person,path,async tx=>{if(scenario==='revoked')await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});if(scenario==='role')await tx.userRole.deleteMany({where:{userId:person.user.id}});if(scenario==='assignment')await tx.warehouseStaffAssignment.updateMany({where:{userId:person.user.id},data:{isActive:false}});if(scenario==='moved')await tx.package.update({where:{id:p.pkg.id},data:{warehouseId:p.b.id}});if(scenario==='owner')await tx.order.update({where:{id:p.pkg.orderId},data:{customerId:other.user.id}});}),person,'inspection');
 }
 console.log('Legacy private download authorization passed: valid encrypted viewing; in-flight session/role/MFA/account/assignment/package/ownership changes return JSON denial without file bytes or success audits. Synthetic media only.');
} finally {
 await db.inspectionEvidence.deleteMany({where:{packageId:{in:parcels}}});await db.package.deleteMany({where:{id:{in:parcels}}});await db.order.deleteMany({where:{id:{in:orders}}});await db.warehouseStaffAssignment.deleteMany({where:{userId:{in:users}}});await db.warehouse.deleteMany({where:{id:{in:warehouses}}});await db.identityVerification.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
}
