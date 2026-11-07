import assert from "node:assert/strict";
import { randomBytes,createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire,stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
const url=new URL(process.env.DATABASE_URL??"postgresql://invalid/invalid");
if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(url.searchParams.get("schema")??""))throw new Error("Photo binding checks require a generated disposable local schema.");
const require=createRequire(import.meta.url);
async function source(file,replacements={}){let code=(await readFile(new URL(file,import.meta.url),"utf8")).replace('import "server-only";',"");for(const name of ["zod","@aws-sdk/client-s3"])code=code.replace(`from "${name}"`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);for(const [name,value]of Object.entries(replacements))code=code.replace(`from "${name}"`,`from ${JSON.stringify(value)}`);return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;}
const photos=await source("../src/modules/private-storage/photos.ts");
const {createPrivatePhotoLinks}=await import(await source("../src/modules/private-storage/record-links.ts",{"./photos":photos}));
const db=new PrismaClient(),users=[],warehouses=[],orders=[],packages=[];const marker=randomBytes(8).toString("hex"),namespace=randomBytes(32).toString("hex");
const links=createPrivatePhotoLinks(db,namespace);
const sha=createHash("sha256").update("SYNTHETIC_SCAN_VERIFIED_PHOTO").digest("hex");
async function actor(label,role,portal){const assigned=await db.role.findUniqueOrThrow({where:{code:role}});const user=await db.user.create({data:{email:`binding-${label}-${marker}@example.test`,fullName:"Synthetic binding actor",status:"ACTIVE",passwordHash:"not-used",roles:{create:{roleId:assigned.id}}}});users.push(user.id);const session=await db.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3_600_000),clientType:"WEB",clientName:"Synthetic photo binding"}});return{user,session};}
async function upload(actor,purpose,scanned=true){const key=`private/v1/${purpose}/${randomBytes(32).toString("hex")}`;const reference={format:1,purpose,key,versionId:`synthetic-${randomBytes(8).toString("hex")}`,iv:randomBytes(12).toString("base64"),plaintextSha256:sha,ciphertextSha256:randomBytes(32).toString("base64"),sizeBytes:29,mimeType:"image/png"};const row=await db.privatePhotoUpload.create({data:{actorId:actor.user.id,purpose,idempotencyKey:`binding:${randomBytes(12).toString("hex")}`,fingerprint:randomBytes(32).toString("hex"),storageNamespace:namespace,status:"STORED",preparedReference:reference,storedReference:reference}});if(scanned)await db.privatePhotoUpload.update({where:{id:row.id},data:{originalScanSha256:sha,originalScanVerifiedAt:row.createdAt,scanVerifiedSha256:sha,scanVerifiedAt:new Date(row.createdAt.getTime()+1)}});return row;}
async function identity(actor){return db.identityVerification.create({data:{userId:actor.user.id,documentType:"PASSPORT",issuingCountryCode:"BD",documentNumberLast4:"A123",documentPhotoCiphertext:"synthetic-encrypted-photo",documentPhotoIv:randomBytes(12).toString("base64"),documentPhotoTag:randomBytes(16).toString("base64"),documentPhotoSha256:sha,documentPhotoMimeType:"image/png",documentPhotoSizeBytes:29}});}
async function evidence(actor,packageId){return db.inspectionEvidence.create({data:{uploadedById:actor.user.id,packageId,mediaKind:"PHOTO",mimeType:"image/png",sizeBytes:29,sha256:sha,ciphertext:"synthetic-encrypted-photo",iv:randomBytes(12).toString("base64"),authTag:randomBytes(16).toString("base64")}});}
const denied=error=>error.message==="PRIVATE_PHOTO_BINDING_DENIED";
try{
 const customer=await actor("customer","customer_personal","customer"),other=await actor("other","customer_personal","customer"),inspector=await actor("inspector","inspector","inspector"),admin=await actor("admin","admin","admin");
 for(const label of ["A","B"]){const row=await db.warehouse.create({data:{name:`Binding ${label} ${marker}`,country:"CN",type:"ORIGIN"}});warehouses.push(row.id);}
 const assignment=await db.warehouseStaffAssignment.create({data:{userId:inspector.user.id,warehouseId:warehouses[0],assignedById:admin.user.id}});
 const order=await db.order.create({data:{customerId:customer.user.id,orderNumber:`ORD-${randomBytes(12).toString("hex").toUpperCase()}`,status:"WAREHOUSE_RECEIVED",grandTotal:0}});orders.push(order.id);
 for(const warehouseId of warehouses){const row=await db.package.create({data:{orderId:order.id,warehouseId,packageCode:`PKG-${randomBytes(6).toString("hex").toUpperCase()}`,status:"RECEIVED"}});packages.push(row.id);}
 const photo=await upload(customer,"identity"),record=await identity(customer),foreign=await identity(other);
 const input={sessionId:customer.session.id,uploadId:photo.id,kind:"identity",subjectId:record.id};
 await assert.rejects(()=>links.link({...input,subjectId:foreign.id}),denied);
 await assert.rejects(()=>links.link({...input,sessionId:other.session.id}),denied);
 await assert.rejects(()=>createPrivatePhotoLinks(db,randomBytes(32).toString("hex")).link(input),denied);
 const [first,replay]=await Promise.all([links.link(input),links.link(input)]);assert.equal(first.id,replay.id);
 assert.equal(await db.privatePhotoLink.count({where:{uploadId:photo.id}}),1);assert.equal(await db.auditLog.count({where:{entityId:first.id,action:"private_photo.linked"}}),1);
 assert(!JSON.stringify(first).includes("private/v1/"));assert(!JSON.stringify(first).includes("uploadId"));
 assert.equal((await db.identityVerification.findUniqueOrThrow({where:{id:record.id}})).documentPhotoCiphertext,"synthetic-encrypted-photo");
 const secondRecord=await identity(customer);await assert.rejects(()=>links.link({...input,subjectId:secondRecord.id}),error=>error.message==="PRIVATE_PHOTO_BINDING_CONFLICT");
 const unscanned=await upload(customer,"identity",false);await assert.rejects(()=>links.link({...input,uploadId:unscanned.id,subjectId:secondRecord.id}),denied);
 await assert.rejects(()=>db.privatePhotoLink.create({data:{uploadId:unscanned.id,identityVerificationId:secondRecord.id,linkedById:customer.user.id}}));
 await assert.rejects(()=>db.privatePhotoLink.update({where:{id:first.id},data:{identityVerificationId:secondRecord.id}}));
 const missingOriginal=await upload(customer,"identity");await db.privatePhotoUpload.update({where:{id:missingOriginal.id},data:{originalScanSha256:null,originalScanVerifiedAt:null}});
 await assert.rejects(()=>links.link({...input,uploadId:missingOriginal.id,subjectId:secondRecord.id}),denied);
 await assert.rejects(()=>db.privatePhotoLink.create({data:{uploadId:missingOriginal.id,identityVerificationId:secondRecord.id,linkedById:customer.user.id}}));
 const futureOriginal=await upload(customer,"identity");await db.privatePhotoUpload.update({where:{id:futureOriginal.id},data:{originalScanVerifiedAt:new Date(Date.now()+600_000)}});
 await assert.rejects(()=>links.link({...input,uploadId:futureOriginal.id,subjectId:secondRecord.id}),denied);
 await assert.rejects(()=>db.privatePhotoLink.create({data:{uploadId:futureOriginal.id,identityVerificationId:secondRecord.id,linkedById:customer.user.id}}));
 const incorrect=await upload(customer,"identity");await db.privatePhotoUpload.update({where:{id:incorrect.id},data:{scanVerifiedSha256:"0".repeat(64)}});await assert.rejects(()=>links.link({...input,uploadId:incorrect.id,subjectId:secondRecord.id}),denied);
 const staffPhoto=await upload(inspector,"inspection"),staffEvidence=await evidence(inspector,packages[0]),wrongWarehouse=await evidence(inspector,packages[1]);
 const staffInput={sessionId:inspector.session.id,uploadId:staffPhoto.id,kind:"inspection",subjectId:staffEvidence.id};
 await assert.rejects(()=>links.link({...staffInput,subjectId:wrongWarehouse.id}),denied);
 const linked=await links.link(staffInput);assert.equal(linked.kind,"inspection");
 await db.warehouseStaffAssignment.update({where:{id:assignment.id},data:{isActive:false}});await assert.rejects(()=>links.link(staffInput),denied);await db.warehouseStaffAssignment.update({where:{id:assignment.id},data:{isActive:true}});
 const warehouseActor=await actor("warehouse","warehouse_worker","warehouse"),logisticsActor=await actor("logistics","logistics_worker","logistics");
 await db.warehouseStaffAssignment.create({data:{userId:warehouseActor.user.id,warehouseId:warehouses[0],assignedById:admin.user.id}});
 const warehousePhoto=await upload(warehouseActor,"inspection"),warehouseEvidence=await evidence(warehouseActor,packages[0]);
 assert.equal((await links.link({sessionId:warehouseActor.session.id,uploadId:warehousePhoto.id,kind:"inspection",subjectId:warehouseEvidence.id})).kind,"inspection");
 const logisticsPhoto=await upload(logisticsActor,"inspection"),logisticsEvidence=await evidence(logisticsActor,packages[0]);
 await assert.rejects(()=>links.link({sessionId:logisticsActor.session.id,uploadId:logisticsPhoto.id,kind:"inspection",subjectId:logisticsEvidence.id}),denied);
 const revokedRole=await db.role.findUniqueOrThrow({where:{code:"inspector"}});
 await db.userRole.deleteMany({where:{userId:inspector.user.id,roleId:revokedRole.id}});await assert.rejects(()=>links.link(staffInput),denied);
 await db.userRole.create({data:{userId:inspector.user.id,roleId:revokedRole.id}});
 const expired=await db.authSession.create({data:{userId:customer.user.id,portal:"customer",expiresAt:new Date(Date.now()-1000),clientType:"WEB",clientName:"Synthetic expired binding"}});
 await assert.rejects(()=>links.link({...input,sessionId:expired.id}),denied);
 const wrongPortal=await db.authSession.create({data:{userId:customer.user.id,portal:"admin",expiresAt:new Date(Date.now()+60_000),clientType:"WEB",clientName:"Synthetic wrong portal"}});
 await assert.rejects(()=>links.link({...input,sessionId:wrongPortal.id}),denied);
 const foreignUpload=await upload(customer,"identity");
 await assert.rejects(()=>db.privatePhotoLink.create({data:{uploadId:foreignUpload.id,identityVerificationId:foreign.id,linkedById:customer.user.id}}));
 const adminPhoto=await upload(admin,"inspection"),adminEvidence=await evidence(admin,packages[0]);const adminInput={sessionId:admin.session.id,uploadId:adminPhoto.id,kind:"inspection",subjectId:adminEvidence.id};
 await assert.rejects(()=>links.link(adminInput),denied);await db.authSession.update({where:{id:admin.session.id},data:{mfaVerifiedAt:new Date()}});assert.equal((await links.link(adminInput)).kind,"inspection");
 await db.authSession.update({where:{id:inspector.session.id},data:{revokedAt:new Date()}});await assert.rejects(()=>links.link(staffInput),denied);
 await db.user.update({where:{id:customer.user.id},data:{status:"SUSPENDED"}});await assert.rejects(()=>links.link(input),denied);
 const audit=JSON.stringify(await db.auditLog.findMany({where:{action:"private_photo.linked",actorId:{in:users}}}));for(const value of ["private/v1/","storedReference","ciphertextSha256",namespace])assert(!audit.includes(value));
 console.log("Private photo binding checks passed: verified scan/digest/owner/purpose checks, fresh session and assignment/MFA authorization, immutable unique links, concurrent replay, private audits, database-trigger enforcement and unchanged legacy evidence. No S3 or scanner was contacted; attestations were synthetic fixtures.");
}finally{
 if(users.length){await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.privatePhotoLink.deleteMany({where:{linkedById:{in:users}}});await db.privatePhotoUpload.deleteMany({where:{actorId:{in:users}}});await db.identityVerification.deleteMany({where:{userId:{in:users}}});await db.inspectionEvidence.deleteMany({where:{uploadedById:{in:users}}});await db.warehouseStaffAssignment.deleteMany({where:{userId:{in:users}}});}
 if(packages.length)await db.package.deleteMany({where:{id:{in:packages}}});if(orders.length)await db.order.deleteMany({where:{id:{in:orders}}});if(warehouses.length)await db.warehouse.deleteMany({where:{id:{in:warehouses}}});if(users.length){await db.authSession.deleteMany({where:{userId:{in:users}}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});}await db.$disconnect();
}
