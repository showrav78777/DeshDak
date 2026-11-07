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
async function source(file,replacements={}){let text=(await readFile(new URL(file,import.meta.url),"utf8")).replace('import "server-only";',"");for(const name of ["zod","sharp","@aws-sdk/client-s3"])text=text.replace(`from "${name}"`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);for(const [name,value]of Object.entries(replacements))text=text.replace(`from "${name}"`,`from ${JSON.stringify(value)}`);return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`;}
const photosUrl=await source("../src/modules/private-storage/photos.ts"),ledgerUrl=await source("../src/modules/private-storage/upload-ledger.ts"),processingUrl=await source("../src/modules/private-storage/photo-processing.ts");
const {createPrivatePhotoStore}=await import(photosUrl),{normalizePrivatePhoto}=await import(processingUrl);
const {createPrivatePhotoScanner}=await import(await source("../src/modules/private-storage/photo-scanner.ts"));
const {createScannedPrivateIntake}=await import(await source("../src/modules/private-storage/scanned-intake.ts",{"./photo-processing":processingUrl,"./upload-ledger":ledgerUrl}));
const {createPrivatePhotoLinks}=await import(await source("../src/modules/private-storage/record-links.ts",{"./photos":photosUrl}));
const db=new PrismaClient(),users=[];const marker=randomBytes(8).toString("hex");let mode="normal",scanCalls=0,puts=0;const objects=new Map();
const config={bucket:"deshdak-private-test",region:"us-east-1",expectedOwner:"123456789012",kmsKeyArn:"arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111"};
const store=createPrivatePhotoStore({config,keys:{identity:randomBytes(32),inspection:randomBytes(32)},client:{send:async command=>{
 const data=command.input;if(command.constructor.name==="PutObjectCommand"){puts++;assert(!objects.has(data.Key));const value={bytes:Buffer.from(data.Body),checksum:data.ChecksumSHA256,version:`synthetic-${objects.size+1}`};objects.set(data.Key,value);if(mode==="lost")throw new Error("Lost response");return{VersionId:value.version,ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:value.checksum};}
 const value=objects.get(data.Key);if(!value)throw new Error("NoSuchKey");const metadata={VersionId:value.version,ContentLength:value.bytes.length,ContentType:"application/octet-stream",ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:value.checksum};return command.constructor.name==="HeadObjectCommand"?metadata:{...metadata,Body:Readable.from([value.bytes])};
}}});
const scanner=createPrivatePhotoScanner({url:"https://private-scanner.example.test/scan",token:randomBytes(32).toString("hex")},async(url,options)=>{
 scanCalls++;const sha=createHash("sha256").update(options.body).digest("hex");assert.equal(options.headers["X-Deshdak-Scan-Sha256"],sha);
 if(mode==="infect-original"||mode==="infect-normalized"&&scanCalls===2)return Response.json({status:"infected"},{status:422});
 if(mode==="wrong-digest")return Response.json({status:"clean",sha256:"0".repeat(64)});
 return Response.json({status:"clean",sha256:sha});
});
const intake=createScannedPrivateIntake(db,store,scanner);
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
try{
 const role=await db.role.findUniqueOrThrow({where:{code:"customer_personal"}});
 const actor=await db.user.create({data:{email:`scanned-intake-${marker}@example.test`,fullName:"Synthetic intake actor",status:"ACTIVE",passwordHash:"not-used",roles:{create:{roleId:role.id}}}});users.push(actor.id);
 const original=await sharp({create:{width:12,height:8,channels:3,background:"#135f78"}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const file=new File([original],"PRIVATE_DOCUMENT_FILENAME.jpg",{type:"image/jpeg"});const input={actorId:actor.id,purpose:"identity",idempotencyKey:`intake:${marker}:good`,file};
 const result=await intake.intake(input);assert.equal(result.state,"STORED");assert.equal(scanCalls,2);assert(!JSON.stringify(result).includes("private/v1/"));assert(!JSON.stringify(result).includes("reference"));
 const saved=await db.privatePhotoUpload.findUniqueOrThrow({where:{id:result.uploadId}});assert.equal(saved.originalScanSha256,hash(original));assert(saved.originalScanVerifiedAt);assert(saved.scanVerifiedAt>=saved.createdAt);assert.notEqual(saved.originalScanSha256,saved.scanVerifiedSha256);
 const normalized=await store.read(saved.storedReference);assert.equal(saved.scanVerifiedSha256,hash(normalized));const metadata=await sharp(normalized).metadata();assert.equal(metadata.width,8);assert.equal(metadata.height,12);assert.equal(metadata.exif,undefined);
 const before=puts;await intake.intake(input);assert.equal(puts,before);assert.equal(await db.auditLog.count({where:{entityId:saved.id,action:"private_photo.scan_verified"}}),1);
 // Same pixels with a different original comment must not replace the proof.
 const comment=Buffer.from("Synthetic changed original comment");const segment=Buffer.alloc(4);segment[0]=255;segment[1]=254;segment.writeUInt16BE(comment.length+2,2);const alternate=Buffer.concat([original.subarray(0,2),segment,comment,original.subarray(2)]);
 assert((await normalizePrivatePhoto(alternate,"image/jpeg","identity")).equals(normalized));
 await assert.rejects(()=>intake.intake({...input,file:new File([alternate],"changed.jpg",{type:"image/jpeg"})}),error=>error.message==="PRIVATE_PHOTO_INTAKE_FAILED");assert.equal((await db.privatePhotoUpload.findUniqueOrThrow({where:{id:saved.id}})).originalScanSha256,hash(original));
 for(const state of ["infect-original","infect-normalized","wrong-digest"]){mode=state;scanCalls=0;const count=await db.privatePhotoUpload.count({where:{actorId:actor.id}});const writes=puts;await assert.rejects(()=>intake.intake({...input,idempotencyKey:`intake:${marker}:${state}`}),error=>error.message==="PRIVATE_PHOTO_INTAKE_FAILED");assert.equal(puts,writes);assert.equal(await db.privatePhotoUpload.count({where:{actorId:actor.id}}),count);}
 mode="normal";scanCalls=0;await assert.rejects(()=>intake.intake({...input,idempotencyKey:`intake:${marker}:invalid`,file:new File([Buffer.from([255,216,255,0,0])],"bad.jpg",{type:"image/jpeg"})}));assert.equal(scanCalls,1);
 mode="lost";const uncertain={...input,idempotencyKey:`intake:${marker}:uncertain`};const review=await intake.intake(uncertain);assert.equal(review.state,"REVIEW_REQUIRED");assert.equal((await db.privatePhotoUpload.findUniqueOrThrow({where:{id:review.uploadId}})).scanVerifiedAt,null);
 const written=puts;mode="normal";assert.equal((await intake.intake(uncertain)).state,"STORED");assert.equal(puts,written);
 const session=await db.authSession.create({data:{userId:actor.id,portal:"customer",expiresAt:new Date(Date.now()+3_600_000),clientType:"WEB",clientName:"Synthetic attested binding"}});
 const subject=await db.identityVerification.create({data:{userId:actor.id,documentType:"PASSPORT",issuingCountryCode:"BD",documentNumberLast4:"A123",documentPhotoSha256:hash(normalized),documentPhotoMimeType:"image/jpeg",documentPhotoSizeBytes:normalized.length}});
 assert.equal((await createPrivatePhotoLinks(db,store.namespace).link({sessionId:session.id,uploadId:saved.id,kind:"identity",subjectId:subject.id})).subjectId,subject.id);
 await db.user.update({where:{id:actor.id},data:{status:"SUSPENDED"}});scanCalls=0;await assert.rejects(()=>intake.intake(input));assert.equal(scanCalls,0);
 console.log("Scanned private intake passed: digest-bound original and normalized scans, metadata stripping, no writes on scan/decode failure, durable proof/replay, conflicting-original rejection, uncertain-write recovery, active-account guard and downstream photo binding. PostgreSQL/encryption were real; scanner and S3 responses were simulated.");
}finally{if(users.length){await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.privatePhotoLink.deleteMany({where:{linkedById:{in:users}}});await db.privatePhotoUpload.deleteMany({where:{actorId:{in:users}}});await db.identityVerification.deleteMany({where:{userId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});}await db.$disconnect();}
