import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import sharp from 'sharp';
const database=new URL(process.env.DATABASE_URL??'postgresql://invalid/invalid'),origin=process.env.TEST_BASE_URL;
if(!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get('schema')??'')||!origin||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Requires a disposable local schema/application.');
if(process.env.ALLOW_DEV_KYC_DOCUMENT_UPLOADS!=='true'||process.env.ALLOW_DEV_INSPECTION_EVIDENCE_UPLOADS!=='true')throw new Error('Explicit isolated development intake required.');
const db=new PrismaClient(),marker=randomBytes(8).toString('hex'),users=[],warehouses=[],orders=[],parcels=[],testIp='203.0.113.117';
const hash=(scope,key)=>createHmac('sha256',process.env.AUTH_SECRET).update(`crossly:rate-limit:${scope}:${key}`).digest('hex');
const photo=await sharp({create:{width:8,height:8,channels:3,background:'#176780'}}).jpeg().toBuffer();
async function actor(code,portal){const role=await db.role.findUniqueOrThrow({where:{code}}),user=await db.user.create({data:{email:`upload-auth-${randomBytes(4).toString('hex')}-${marker}@example.test`,fullName:'Synthetic upload actor',passwordHash:'unused',status:'ACTIVE',roles:{create:{roleId:role.id}}}});users.push(user.id);const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3600000),mfaVerifiedAt:portal==='admin'?new Date():null,clientType:'WEB',clientName:'Upload authorization test'}});const token=await new SignJWT({roles:[code]}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setJti(session.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));return {user,session,token};}
async function parcel(owner){const a=await db.warehouse.create({data:{name:`Upload A ${marker}`,country:'CN',type:'ORIGIN'}}),b=await db.warehouse.create({data:{name:`Upload B ${marker}`,country:'CN',type:'ORIGIN'}});warehouses.push(a.id,b.id);const order=await db.order.create({data:{orderNumber:`ORD-${randomBytes(10).toString('hex').toUpperCase()}`,customerId:owner.id,status:'WAREHOUSE_RECEIVED',grandTotal:100}});orders.push(order.id);const pkg=await db.package.create({data:{orderId:order.id,warehouseId:a.id,packageCode:`PKG-${randomBytes(10).toString('hex').toUpperCase()}`,status:'RECEIVED'}});parcels.push(pkg.id);return {pkg,a,b};}
async function delayed(person,kind,change,parcelId){
 let release,locked;const hold=new Promise(r=>release=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${person.user.id} FOR UPDATE`;locked();await hold;await change(tx);},{timeout:20000});
 await hasLock;
 const form=new FormData();if(kind==='identity'){form.set('documentType','PASSPORT');form.set('issuingCountryCode','BD');form.set('documentNumberLast4','A123');}form.set(kind==='identity'?'documentPhoto':'media',new Blob([photo],{type:'image/jpeg'}),'synthetic.jpg');
 const path=kind==='identity'?'/api/v1/account/identity-verifications':`/api/v1/operations/packages/${parcelId}/inspection-evidence`;
 const scope=kind==='identity'?'identity-document:account':'inspection-evidence:staff';
 const response=fetch(`${origin}${path}`,{method:'POST',headers:{Cookie:`crossly_session=${person.token}`,Origin:origin,'x-forwarded-for':testIp},body:form});
 try{
  const deadline=Date.now()+10000;let authorized=false;
  while(Date.now()<deadline){if(await db.securityRateLimit.findUnique({where:{scope_keyHash:{scope,keyHash:hash(scope,person.user.id)}}})){authorized=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert.ok(authorized,'Request did not pass initial authorization.');
 }finally{release();await blocker;}
 return response;
}
try{
 for(const scenario of ['revoked','pending','role']){
  const person=await actor('customer_personal','customer');
  const response=await delayed(person,'identity',async tx=>{if(scenario==='revoked')await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});if(scenario==='pending')await tx.user.update({where:{id:person.user.id},data:{status:'PENDING_VERIFICATION'}});if(scenario==='role')await tx.userRole.deleteMany({where:{userId:person.user.id}});});
  assert.equal(response.status,403,scenario);assert.equal(await db.identityVerification.count({where:{userId:person.user.id}}),0);assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'private_upload.commit_denied'}}),1);assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'identity_verification.submitted'}}),0);
 }
 const owner=await actor('customer_personal','customer');
 for(const scenario of ['revoked','role','assignment','moved','expected','inactive']){
  const person=await actor('inspector','inspector'),p=await parcel(owner.user);await db.warehouseStaffAssignment.create({data:{userId:person.user.id,warehouseId:p.a.id}});
  const response=await delayed(person,'inspection',async tx=>{
   if(scenario==='revoked')await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});
   if(scenario==='role')await tx.userRole.deleteMany({where:{userId:person.user.id}});
   if(scenario==='assignment')await tx.warehouseStaffAssignment.updateMany({where:{userId:person.user.id},data:{isActive:false}});
   if(scenario==='moved')await tx.package.update({where:{id:p.pkg.id},data:{warehouseId:p.b.id}});
   if(scenario==='expected')await tx.package.update({where:{id:p.pkg.id},data:{status:'EXPECTED'}});
   if(scenario==='inactive')await tx.package.update({where:{id:p.pkg.id},data:{isOutboundActive:false}});
  },p.pkg.id);
  assert.equal(response.status,403,scenario);assert.equal(await db.inspectionEvidence.count({where:{packageId:p.pkg.id}}),0);assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'private_upload.commit_denied'}}),1);assert.equal(await db.auditLog.count({where:{actorId:person.user.id,action:'inspection.evidence_uploaded'}}),0);
 }
 console.log('Private upload authorization passed: actual multipart requests held before commit reject revoked/inactive/role-changed customers and revoked/unassigned/moved/ineligible inspection targets without persisting files or success audits. Synthetic development media only.');
}finally{
 await db.inspectionEvidence.deleteMany({where:{packageId:{in:parcels}}});await db.package.deleteMany({where:{id:{in:parcels}}});await db.order.deleteMany({where:{id:{in:orders}}});await db.warehouseStaffAssignment.deleteMany({where:{userId:{in:users}}});await db.warehouse.deleteMany({where:{id:{in:warehouses}}});await db.identityVerification.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});
 const keys=users.flatMap(id=>['identity-document:account','inspection-evidence:staff'].map(scope=>({scope,keyHash:hash(scope,id)}))).concat(['identity-document:ip','inspection-evidence:ip'].map(scope=>({scope,keyHash:hash(scope,testIp)})));await db.securityRateLimit.deleteMany({where:{OR:keys}});await db.$disconnect();
}
