import assert from "node:assert/strict";
import { randomBytes,createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes,createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
const database=new URL(process.env.DATABASE_URL??"postgresql://invalid/invalid");
if(!["localhost","127.0.0.1","[::1]"].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema")??""))throw new Error("Scanned intake verification requires a generated disposable local schema.");
const require=createRequire(import.meta.url);
async function source(file,replacements={}){let text=(await readFile(new URL(file,import.meta.url),"utf8")).replace('import "server-only";',"");for(const name of ["zod","sharp","@aws-sdk/client-s3","next/server"])text=text.replace(`from "${name}"`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);for(const [name,value]of Object.entries(replacements))text=text.replace(`from "${name}"`,`from ${JSON.stringify(value)}`);return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`;}
const photosUrl=await source("../src/modules/private-storage/photos.ts"),ledgerUrl=await source("../src/modules/private-storage/upload-ledger.ts"),processingUrl=await source("../src/modules/private-storage/photo-processing.ts");
const {createPrivatePhotoStore}=await import(photosUrl);
const {createPrivatePhotoScanner}=await import(await source("../src/modules/private-storage/photo-scanner.ts"));
const linksUrl=await source("../src/modules/private-storage/record-links.ts",{"./photos":photosUrl});
const accountUrl=await source("../src/modules/auth/account-mutation.ts");
const rolesUrl=await source("../src/lib/roles.ts");
const authorizationUrl=await source("../src/modules/private-storage/upload-authorization.ts",{"@/modules/auth/account-mutation":accountUrl,"@/lib/roles":rolesUrl});
const intakeUrl=await source("../src/modules/private-storage/scanned-intake.ts",{"./photo-processing":processingUrl,"./upload-ledger":ledgerUrl});
const submissionsUrl=await source("../src/modules/private-storage/submissions.ts",{"./photos":photosUrl,"./scanned-intake":intakeUrl,"./record-links":linksUrl,"./upload-authorization":authorizationUrl});
const {createPrivatePhotoSubmissions}=await import(submissionsUrl);
const {createPrivatePhotoDelivery}=await import(await source("../src/modules/private-storage/photo-delivery.ts",{"./photos":photosUrl}));
const db=new PrismaClient(),users=[],orders=[],warehouses=[];const marker=randomBytes(8).toString("hex");let mode="normal",scanCalls=0,puts=0, revokeSession=null;const objects=new Map();
const config={bucket:"deshdak-private-test",region:"us-east-1",expectedOwner:"123456789012",kmsKeyArn:"arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111"};
const store=createPrivatePhotoStore({config,keys:{identity:randomBytes(32),inspection:randomBytes(32)},client:{send:async command=>{
 const data=command.input;if(command.constructor.name==="PutObjectCommand"){puts++;assert(!objects.has(data.Key));const value={bytes:Buffer.from(data.Body),checksum:data.ChecksumSHA256,version:`synthetic-${objects.size+1}`};objects.set(data.Key,value);if(mode==="lost")throw new Error("Lost response");return{VersionId:value.version,ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:value.checksum};}
 const value=objects.get(data.Key);if(!value)throw new Error("NoSuchKey");const metadata={VersionId:value.version,ContentLength:value.bytes.length,ContentType:"application/octet-stream",ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:value.checksum};return command.constructor.name==="HeadObjectCommand"?metadata:{...metadata,Body:Readable.from([value.bytes])};
}}});
const scanner=createPrivatePhotoScanner({url:"https://private-scanner.example.test/scan",token:randomBytes(32).toString("hex")},async(url,options)=>{
 if(revokeSession){await db.authSession.update({where:{id:revokeSession},data:{revokedAt:new Date()}});revokeSession=null;}
 scanCalls++;const sha=createHash("sha256").update(options.body).digest("hex");assert.equal(options.headers["X-Deshdak-Scan-Sha256"],sha);
 if(mode==="infect-original"||mode==="infect-normalized"&&scanCalls===2)return Response.json({status:"infected"},{status:422});
 if(mode==="wrong-digest")return Response.json({status:"clean",sha256:"0".repeat(64)});
 return Response.json({status:"clean",sha256:sha});
});
const submissions=createPrivatePhotoSubmissions(db,{store,scan:scanner});
async function actor(label,roleCode,portal){
 const role=await db.role.findUniqueOrThrow({where:{code:roleCode}});
 const user=await db.user.create({data:{email:`photo-http-${label}-${marker}@example.test`,fullName:"Synthetic photo workflow",status:"ACTIVE",passwordHash:"unused",roles:{create:{roleId:role.id}}}});users.push(user.id);
 const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3600000),mfaVerifiedAt:portal==="compliance"?new Date():null,clientType:"WEB",clientName:"Synthetic photo workflow"}});
 return {user,session};
}
const details={documentType:"PASSPORT",issuingCountryCode:"BD",documentNumberLast4:"AB12"};
try{
 const customer=await actor("customer","customer_personal","customer"),compliance=await actor("compliance","compliance","compliance"),staff=await actor("staff","inspector","inspector");
 const original=await sharp({create:{width:12,height:8,channels:3,background:"#135f78"}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const file=new File([original],"SYNTHETIC_PRIVATE_PHOTO.jpg",{type:"image/jpeg"});
 const input={kind:"identity",details,actorId:customer.user.id,sessionId:customer.session.id,requestKey:`submit-${marker}-identity`,file};
 const first=await submissions.submit(input);
 const record=await db.identityVerification.findUniqueOrThrow({where:{id:first.subjectId}});
 assert.equal(record.documentPhotoCiphertext,null);assert.equal(record.status,"PENDING");
 const writes=puts;
 const replay=await submissions.submit(input);assert.equal(replay.subjectId,first.subjectId);assert.equal(replay.replayed,true);assert.equal(puts,writes);
 assert.equal(await db.identityVerification.count({where:{userId:customer.user.id}}),1);
 assert.equal(await db.auditLog.count({where:{actorId:customer.user.id,action:"identity_verification.submitted"}}),1);
 await assert.rejects(()=>submissions.submit({...input,details:{...details,documentNumberLast4:"ZZ99"}}),error=>error.message==="PRIVATE_PHOTO_CONFLICT");
 const delivery=createPrivatePhotoDelivery(db,store);
 const delivered=await delivery.read({sessionId:compliance.session.id,kind:"identity",subjectId:first.subjectId});
 assert.equal((await sharp(delivered.bytes).metadata()).exif,undefined);
 await assert.rejects(()=>delivery.read({sessionId:customer.session.id,kind:"identity",subjectId:first.subjectId}));
 mode="infect-original";
 await assert.rejects(()=>submissions.submit({...input,requestKey:`submit-${marker}-infected`}));mode="normal";
 assert.equal(await db.identityVerification.count({where:{userId:customer.user.id}}),1);
 const warehouse=await db.warehouse.create({data:{name:`Photo workflow ${marker}`,country:"CN",type:"ORIGIN"}});warehouses.push(warehouse.id);
 await db.warehouseStaffAssignment.create({data:{userId:staff.user.id,warehouseId:warehouse.id,assignedById:compliance.user.id}});
 const order=await db.order.create({data:{customerId:customer.user.id,orderNumber:`PHOTO-${marker}`,grandTotal:0,status:"WAREHOUSE_RECEIVED"}});orders.push(order.id);
 const parcel=await db.package.create({data:{orderId:order.id,warehouseId:warehouse.id,status:"RECEIVED",packageCode:`PKG-${marker.toUpperCase()}`}});
 const evidenceInput={kind:"inspection",packageId:parcel.id,actorId:staff.user.id,sessionId:staff.session.id,requestKey:`submit-${marker}-inspection`,file};
 const captured=await submissions.submit(evidenceInput);
 assert.equal((await db.inspectionEvidence.findUniqueOrThrow({where:{id:captured.subjectId}})).ciphertext,null);
 assert.equal((await submissions.submit(evidenceInput)).subjectId,captured.subjectId);
 const evidence=await delivery.read({sessionId:customer.session.id,kind:"inspection",subjectId:captured.subjectId});assert(evidence.bytes.length>0);
 await db.warehouseStaffAssignment.updateMany({where:{userId:staff.user.id},data:{isActive:false}});
 await assert.rejects(()=>submissions.submit({...evidenceInput,requestKey:`submit-${marker}-unassigned`}));
 await db.warehouseStaffAssignment.updateMany({where:{userId:staff.user.id},data:{isActive:true}});
 revokeSession=staff.session.id;
 await assert.rejects(()=>submissions.submit({...evidenceInput,requestKey:`submit-${marker}-revoked`}),error=>error.message==="PRIVATE_PHOTO_ACCESS_CHANGED");
 assert.equal(await db.inspectionEvidence.count({where:{uploadedById:staff.user.id}}),1);
 // The domain mutation and object binding must both roll back if success auditing fails.
 const trigger=`photo_failure_${marker}`;
 await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger AS $$ BEGIN IF NEW."actorId" = '${customer.user.id}' AND NEW."action" = 'identity_verification.submitted' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 try{
  await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
  try{await assert.rejects(()=>submissions.submit({...input,requestKey:`submit-${marker}-audit`}));}
  finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);}
 }finally{await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
 assert.equal(await db.identityVerification.count({where:{userId:customer.user.id}}),1);
 assert.equal((await db.identityVerification.findUniqueOrThrow({where:{id:first.subjectId}})).status,"PENDING");
 // Execute the actual multipart route with the synthetic storage boundary.
 // Normal server/session/CSRF regressions run separately against the local app.
 const routeCustomer=await actor("route-customer","customer_personal","customer");
 const fixtureKey=`__photoRoute_${marker}`;
 globalThis[fixtureKey]={db,runtime:{store,scan:scanner},session:{userId:routeCustomer.user.id,sessionId:routeCustomer.session.id,roles:["customer_personal"],portal:"customer"}};
 const fixtureSource=`const fixture=globalThis[${JSON.stringify(fixtureKey)}]; export const prisma=fixture.db; export const privatePhotoRuntime=()=>fixture.runtime; export const privatePhotoStorageConfigured=()=>true; export const getRequestSession=async()=>fixture.session; export const hasTrustedMutationOrigin=()=>true; export const consumeSecurityRateLimit=async()=>({allowed:true}); export const requestIp=()=>"synthetic"; export const identityDocumentUploadsEnabled=()=>false; export const encryptUploadedIdentityDocument=()=>{throw new Error("Legacy intake selected");};`;
 const fixtureUrl=`data:text/javascript;base64,${Buffer.from(fixtureSource).toString("base64")}`;
 const apiUrl=await source("../src/lib/api.ts");
 const submissionResponseUrl=await source("../src/modules/private-storage/submission-response.ts",{"@/lib/api":apiUrl,"./submissions":submissionsUrl});
 const multipartUrl=await source("../src/lib/uploads/bounded-multipart.ts");
 const route=await import(await source("../src/app/api/v1/account/identity-verifications/route.ts",{
  "@/modules/private-storage/runtime":fixtureUrl,"@/modules/private-storage/submissions":submissionsUrl,"@/modules/private-storage/submission-response":submissionResponseUrl,
  "@/modules/private-storage/upload-authorization":authorizationUrl,"@/lib/uploads/bounded-multipart":multipartUrl,"@/lib/api":apiUrl,
  "@/lib/mfa-session":fixtureUrl,"@/lib/prisma":fixtureUrl,"@/lib/request-session":fixtureUrl,"@/lib/roles":rolesUrl,
  "@/modules/auth/rate-limit":fixtureUrl,"@/modules/compliance/identity-document":fixtureUrl,
 }));
 const savedFlag=process.env.PRIVATE_PHOTO_STORAGE_ENABLED;process.env.PRIVATE_PHOTO_STORAGE_ENABLED="true";
 try{
  const form=()=>{const data=new FormData();for(const [key,value]of Object.entries(details))data.set(key,value);data.set("documentPhoto",file);return data;};
  const request=key=>new Request("http://localhost/api/v1/account/identity-verifications",{method:"POST",headers:key?{"Idempotency-Key":key}:{},body:form()});
  assert.equal((await route.POST(request())).status,422);
  const routeKey=`route-${marker}-identity`;
  const response=await route.POST(request(routeKey));assert.equal(response.status,201);
  const body=await response.json();assert(body.data.submission.id);assert(!JSON.stringify(body).includes("private/v1/"));assert(!JSON.stringify(body).includes("documentPhotoCiphertext"));
  const repeat=await route.POST(request(routeKey));assert.equal(repeat.status,200);assert.equal((await repeat.json()).data.submission.id,body.data.submission.id);
  assert.equal(await db.identityVerification.count({where:{userId:routeCustomer.user.id}}),1);
 }finally{if(savedFlag===undefined)delete process.env.PRIVATE_PHOTO_STORAGE_ENABLED;else process.env.PRIVATE_PHOTO_STORAGE_ENABLED=savedFlag;delete globalThis[fixtureKey];}
 console.log("Object photo submission workflow passed: actual multipart handler with synthetic storage, missing-key rejection and retry DTO; scanned/encrypted identity and inspection records, exact retry, metadata conflict, protected delivery, scanner rejection, fresh warehouse/session checks and atomic audit rollback. PostgreSQL and encryption real; S3/scanner synthetic.");
}finally{
 await db.auditLog.deleteMany({where:{actorId:{in:users}}});
 await db.privatePhotoLink.deleteMany({where:{linkedById:{in:users}}});
 await db.privatePhotoUpload.deleteMany({where:{actorId:{in:users}}});
 await db.inspectionEvidence.deleteMany({where:{uploadedById:{in:users}}});
 await db.package.deleteMany({where:{orderId:{in:orders}}});
 await db.order.deleteMany({where:{id:{in:orders}}});
 await db.warehouseStaffAssignment.deleteMany({where:{userId:{in:users}}});
 await db.warehouse.deleteMany({where:{id:{in:warehouses}}});
 await db.identityVerification.deleteMany({where:{userId:{in:users}}});
 await db.user.deleteMany({where:{id:{in:users}}});
 await db.$disconnect();
}
