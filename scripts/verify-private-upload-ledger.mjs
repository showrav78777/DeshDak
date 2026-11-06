import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { createRequire,stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
const database=new URL(process.env.DATABASE_URL??"postgresql://invalid/invalid");
if(!["localhost","127.0.0.1","[::1]"].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema")??""))throw new Error("Photo ledger checks require a generated disposable local schema.");
const require=createRequire(import.meta.url);
async function load(file){let source=(await readFile(new URL(file,import.meta.url),"utf8")).replace('import "server-only";',"");for(const name of ["zod","@aws-sdk/client-s3"])source=source.replace(`from "${name}"`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);}
const {createPrivatePhotoStore}=await load("../src/modules/private-storage/photos.ts");
const {createPrivateUploadLedger}=await load("../src/modules/private-storage/upload-ledger.ts");
const db=new PrismaClient(),users=[];const marker=randomBytes(8).toString("hex");let mode="normal",puts=0,heads=0,release;
const objects=new Map();
const config={bucket:"deshdak-private-test",region:"us-east-1",expectedOwner:"123456789012",kmsKeyArn:"arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111"};
const keys={identity:randomBytes(32),inspection:randomBytes(32)};
const client={send:async command=>{
 const input=command.input;const name=command.constructor.name;
 if(name==="PutObjectCommand"){
  puts++;if(mode==="offline")throw new Error("SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC");
  assert(!objects.has(input.Key),"Duplicate PUT overwrote the object.");
  const stored={bytes:Buffer.from(input.Body),checksum:input.ChecksumSHA256,version:`synthetic-${objects.size+1}`};objects.set(input.Key,stored);
  if(mode==="lost-response")throw new Error("Lost response after storage accepted bytes");
  if(mode==="paused")await new Promise(resolve=>{release=resolve;});
  return{VersionId:stored.version,ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:stored.checksum};
 }
 const stored=objects.get(input.Key);if(!stored)throw new Error("NoSuchKey");
 const metadata={VersionId:stored.version,ContentLength:stored.bytes.length,ContentType:"application/octet-stream",ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:stored.checksum};
 if(name==="HeadObjectCommand"){heads++;return metadata;}
 assert.equal(name,"GetObjectCommand");assert.equal(input.VersionId,stored.version);
 const bytes=Buffer.from(stored.bytes);if(mode==="corrupt")bytes[0]^=255;
 return{...metadata,Body:Readable.from([bytes])};
}};
const store=createPrivatePhotoStore({config,keys,client}),ledger=createPrivateUploadLedger(db,store);
const bytes=Buffer.from("SYNTHETIC_NORMALIZED_SCANNED_PHOTO");
async function actor(label){const user=await db.user.create({data:{email:`ledger-${label}-${marker}@example.test`,fullName:"Synthetic upload actor",status:"ACTIVE",passwordHash:"not-used"}});users.push(user.id);return user.id;}
async function row(actorId,idempotencyKey){return db.privatePhotoUpload.findUniqueOrThrow({where:{actorId_idempotencyKey:{actorId,idempotencyKey}}});}
try{
 const actorId=await actor("one"),otherActor=await actor("two");
 const input={actorId,purpose:"identity",idempotencyKey:`photo:${marker}:success`,mimeType:"image/png",bytes};
 const failedDatabase={ $transaction:async()=>{throw new Error("SYNTHETIC_DATABASE_SECRET_DIAGNOSTIC");} };
 await assert.rejects(()=>createPrivateUploadLedger(failedDatabase,store).storePhoto(input),error=>error.message==="PRIVATE_UPLOAD_UNAVAILABLE");
 const successful=await ledger.storePhoto(input);assert.equal(successful.state,"STORED");
 let saved=await row(actorId,input.idempotencyKey);assert.equal(saved.status,"STORED");assert.equal(saved.encryptedBody,null);assert.equal(saved.leaseToken,null);
 const count=puts;assert.deepEqual(await ledger.storePhoto(input),successful);assert.equal(puts,count);
 await assert.rejects(()=>ledger.storePhoto({...input,bytes:Buffer.from("different")}),error=>error.message==="PRIVATE_UPLOAD_CONFLICT");
 const independent=await ledger.storePhoto({...input,actorId:otherActor});assert.equal(independent.state,"STORED");assert.notEqual(independent.uploadId,successful.uploadId);
 const changed=createPrivateUploadLedger(db,createPrivatePhotoStore({config,keys:{...keys,identity:randomBytes(32)},client}));
 await assert.rejects(()=>changed.storePhoto(input),error=>error.message==="PRIVATE_UPLOAD_CONFLICT");
 mode="lost-response";const uncertain={...input,idempotencyKey:`photo:${marker}:lost`};
 const review=await ledger.storePhoto(uncertain);assert.equal(review.state,"REVIEW_REQUIRED");saved=await row(actorId,uncertain.idempotencyKey);assert(saved.encryptedBody);assert(!Buffer.from(saved.encryptedBody).includes(bytes));
 const once=puts;mode="normal";const recovered=await ledger.storePhoto(uncertain);assert.equal(recovered.state,"STORED");assert.equal(puts,once);assert(heads>0);assert.equal((await row(actorId,uncertain.idempotencyKey)).encryptedBody,null);
 mode="offline";const unavailable={...input,idempotencyKey:`photo:${marker}:offline`};const initial=puts;for(let i=0;i<7;i++)assert.equal((await ledger.storePhoto(unavailable)).state,"REVIEW_REQUIRED");assert.equal(puts,initial+1);assert.equal((await row(actorId,unavailable.idempotencyKey)).attempts,5);
 mode="corrupt";assert.equal((await ledger.storePhoto({...input,idempotencyKey:`photo:${marker}:corrupt`})).state,"REVIEW_REQUIRED");
 mode="paused";const racing={...input,idempotencyKey:`photo:${marker}:race`};const pending=ledger.storePhoto(racing);
 let raceRow;for(let i=0;i<200;i++){raceRow=await db.privatePhotoUpload.findUnique({where:{actorId_idempotencyKey:{actorId,idempotencyKey:racing.idempotencyKey}}});if(release)break;await new Promise(resolve=>setTimeout(resolve,10));}assert(release&&raceRow);
 assert.equal((await ledger.storePhoto(racing)).state,"BUSY");
 await db.privatePhotoUpload.update({where:{id:raceRow.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});
 mode="normal";const winner=await ledger.storePhoto(racing);assert.equal(winner.state,"STORED");release();assert.equal((await pending).state,"BUSY");
 assert.equal(await db.auditLog.count({where:{entityId:raceRow.id,action:"private_photo.stored"}}),1);
 for(const upload of await db.privatePhotoUpload.findMany({where:{actorId:{in:users}}}))assert.equal(await db.auditLog.count({where:{entityId:upload.id,action:"private_photo.prepared"}}),1);
 await assert.rejects(()=>db.privatePhotoUpload.update({where:{id:raceRow.id},data:{attempts:6}}));
 await assert.rejects(()=>db.privatePhotoUpload.update({where:{id:raceRow.id},data:{status:"UNSUPPORTED"}}));
 await db.user.update({where:{id:actorId},data:{status:"SUSPENDED"}});const blockedPuts=puts;
 await assert.rejects(()=>ledger.storePhoto(input),error=>error.message==="PRIVATE_UPLOAD_UNAVAILABLE");assert.equal(puts,blockedPuts);
 await db.user.update({where:{id:actorId},data:{status:"ACTIVE"}});
 const audit=JSON.stringify(await db.auditLog.findMany({where:{actorId:{in:users}}}));for(const secret of ["SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC","encryptedBody",config.bucket,"private/v1/"])assert(!audit.includes(secret));
 console.log("Private upload ledger checks passed: durable encrypted reservations, scoped idempotency, one write, storage/key namespace fencing, verified recovery, bounded attempts, corruption rejection, concurrent lease fencing, payload purge after confirmation and private audit evidence. PostgreSQL was real; S3 was simulated.");
}finally{release?.();if(users.length){await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.privatePhotoUpload.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});}await db.$disconnect();}
