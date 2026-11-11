import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(url.searchParams.get("schema")??"")) throw new Error("Phone-code binding tests require a generated disposable local schema.");
if (process.env.NODE_ENV!=="development" || process.env.ALLOW_DEV_AUTH_LINKS!=="true") throw new Error("Explicit development-only code mode is required. Never run against live SMS.");
const origin=process.env.TEST_BASE_URL;if(!origin || !["localhost","127.0.0.1"].includes(new URL(origin).hostname))throw new Error("A disposable local application is required.");
const source=(await readFile(new URL("../src/lib/security-secrets.ts",import.meta.url),"utf8")).replace('import "server-only";',"");
const {hashPhoneVerificationCode,hashSecurityToken,hashRateLimitKey}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const db=new PrismaClient(), marker=randomBytes(8).toString("hex");
const phone=()=>`+88017${BigInt(`0x${randomBytes(6).toString("hex")}`).toString().padStart(8,"0").slice(-8)}`;
async function actor(label){
 const role=await db.role.findUniqueOrThrow({where:{code:"customer_personal"}});
 const user=await db.user.create({data:{email:`phone-${label}-${marker}@example.test`,fullName:"Synthetic phone customer",phone:phone(),status:"ACTIVE",passwordHash:"unused",roles:{create:{roleId:role.id}}}});
 const session=await db.authSession.create({data:{userId:user.id,portal:"customer",expiresAt:new Date(Date.now()+3600000),lastSeenAt:new Date(),clientType:"WEB",clientName:"Phone binding test"}});
 const token=await new SignJWT({email:user.email,name:user.fullName,roles:["customer_personal"]}).setProtectedHeader({alg:"HS256"}).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
 return {user,session,token};
}
async function call(path,person,body){
 const response=await fetch(`${origin}${path}`,{method:path==="/api/v1/users/me"?"PATCH":"POST",headers:{Cookie:`crossly_session=${person.token}`,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body??{}),redirect:"manual"});
 return {response,body:response.headers.get("content-type")?.includes("json")?await response.json():null};
}
const confirm=(person,code)=>call("/api/v1/account/phone-verification/confirm",person,{code});
const updatePhone=(person,number)=>call("/api/v1/users/me",person,{fullName:person.user.fullName,phone:number,residenceCountryCode:"BD",locale:"en",preferredCurrency:"BDT",accountType:"PERSONAL"});
async function issue(person){const result=await call("/api/v1/account/phone-verification/request",person);assert.equal(result.response.status,200);assert.equal(result.body.data.deliveryStatus,"DEVELOPMENT_ONLY");assert.match(result.body.data.developmentCode,/^\d{6}$/);return result.body.data.developmentCode;}
async function fixtureCode(person,number,code,expiresAt=new Date(Date.now()+60000)){return db.securityToken.create({data:{userId:person.user.id,purpose:"PHONE_VERIFICATION",tokenHash:hashPhoneVerificationCode(person.user.id,number,code),expiresAt}});}
async function waitForAccountLock(){
 const deadline=Date.now()+3000;
 while(Date.now()<deadline){const rows=await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%'`;if(rows[0].n>0)return;await new Promise(r=>setTimeout(r,25));}
 throw new Error("The synthetic request did not reach its account lock.");
}
try{
 const owner=await actor("owner"),other=await actor("other");
 const firstCode=await issue(owner);
 const firstToken=await db.securityToken.findUniqueOrThrow({where:{tokenHash:hashPhoneVerificationCode(owner.user.id,owner.user.phone,firstCode)}});
 assert.notEqual(firstToken.tokenHash,hashSecurityToken("PHONE_VERIFICATION",firstCode));
 assert.notEqual(hashPhoneVerificationCode(owner.user.id,owner.user.phone,firstCode),hashPhoneVerificationCode(other.user.id,other.user.phone,firstCode));
 await fixtureCode(other,other.user.phone,firstCode);
 const passwordToken=await db.securityToken.create({data:{userId:owner.user.id,purpose:"PASSWORD_RESET",tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
 // A rejected duplicate number must roll back token invalidation too.
 const duplicate=await updatePhone(owner,other.user.phone);assert.equal(duplicate.response.status,409);
 assert.equal((await db.securityToken.findUniqueOrThrow({where:{id:firstToken.id}})).usedAt,null);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:owner.user.id}})).phone,owner.user.phone);
 const secondPhone=phone();assert.equal((await updatePhone(owner,secondPhone)).response.status,200);
 assert((await db.securityToken.findUniqueOrThrow({where:{id:firstToken.id}})).usedAt);
 assert.equal((await db.securityToken.findUniqueOrThrow({where:{id:passwordToken.id}})).usedAt,null);
 assert.equal((await confirm(owner,firstCode)).response.status,422);
 // Even a still-unused token bound to the old number cannot verify the new one.
 const oldCode=firstCode==="654321"?"654320":"654321";await fixtureCode(owner,owner.user.phone,oldCode);
 assert.equal((await confirm(owner,oldCode)).response.status,422);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:owner.user.id}})).phoneVerifiedAt,null);
 assert.equal((await updatePhone(owner,owner.user.phone)).response.status,200);
 assert.equal((await confirm(owner,firstCode)).response.status,422);
 const legacyCode=firstCode==="987654"?"987653":"987654";
 await db.securityToken.create({data:{userId:owner.user.id,purpose:"PHONE_VERIFICATION",tokenHash:hashSecurityToken("PHONE_VERIFICATION",legacyCode),expiresAt:new Date(Date.now()+60000)}});
 assert.equal((await confirm(owner,legacyCode)).response.status,422);
 const freshCode=await issue(owner);const pair=await Promise.all([confirm(owner,freshCode),confirm(owner,freshCode)]);
 assert.deepEqual(pair.map(r=>r.response.status).sort(),[200,422]);
 assert((await db.user.findUniqueOrThrow({where:{id:owner.user.id}})).phoneVerifiedAt);
 // A concurrent number change either follows successful verification and clears it,
 // or precedes confirmation and causes the old-number code to be rejected.
 assert.equal((await updatePhone(owner,secondPhone)).response.status,200);const racingCode=await issue(owner);
 const raced=await Promise.all([confirm(owner,racingCode),updatePhone(owner,owner.user.phone)]);
 assert([200,422].includes(raced[0].response.status));assert.equal(raced[1].response.status,200);
 const after=await db.user.findUniqueOrThrow({where:{id:owner.user.id}});assert.equal(after.phone,owner.user.phone);assert.equal(after.phoneVerifiedAt,null);
 // Expiry must be evaluated after the request obtains its account lock.
 const expired=await actor("expiry"),expCode="135790";await fixtureCode(expired,expired.user.phone,expCode,new Date(Date.now()+1000));let expRequest;
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${expired.user.id} FOR UPDATE`;
  expRequest=confirm(expired,expCode);await waitForAccountLock();await new Promise(r=>setTimeout(r,1100));
 },{timeout:8000});assert.equal((await expRequest).response.status,422);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:expired.user.id}})).phoneVerifiedAt,null);
 // A request authenticated before revocation must recheck the session after waiting.
 for(const action of ["confirm","profile","request"]){
  const person=await actor(`revoked-${action}`),code="246802";const token=await fixtureCode(person,person.user.phone,code);let pending;
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${person.user.id} FOR UPDATE`;
   pending=action==="confirm"?confirm(person,code):action==="profile"?updatePhone(person,phone()):call("/api/v1/account/phone-verification/request",person);
   await waitForAccountLock();await tx.authSession.update({where:{id:person.session.id},data:{revokedAt:new Date()}});
  },{timeout:8000});const result=await pending;assert.equal(result.response.status,action==="confirm"?422:403);
  const unchanged=await db.user.findUniqueOrThrow({where:{id:person.user.id}});assert.equal(unchanged.phone,person.user.phone);assert.equal(unchanged.phoneVerifiedAt,null);assert.equal((await db.securityToken.findUniqueOrThrow({where:{id:token.id}})).usedAt,null);
 }
 // A healthy IP counter cannot bypass an exhausted account counter.
 const limited=await actor("account-limit"),limitedCode="357913";const limitedToken=await fixtureCode(limited,limited.user.phone,limitedCode);
 await db.securityRateLimit.deleteMany({where:{scope:"phone-verification-confirm:ip"}});
 await db.securityRateLimit.create({data:{scope:"phone-verification-confirm:account",keyHash:hashRateLimitKey("phone-verification-confirm:account",limited.user.id),attempts:10,blockedUntil:new Date(Date.now()+900000)}});
 const blocked=await confirm(limited,limitedCode);assert.equal(blocked.response.status,429);assert(Number(blocked.response.headers.get("retry-after"))>0);
 assert.equal((await db.securityToken.findUniqueOrThrow({where:{id:limitedToken.id}})).usedAt,null);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:limited.user.id}})).phoneVerifiedAt,null);
 const audit=JSON.stringify(await db.auditLog.findMany({where:{actorId:owner.user.id}}));assert(!audit.includes(firstToken.tokenHash));
 console.log("Phone binding passed with real PostgreSQL/API: account/number-bound hashes, phone-change invalidation, old/unbound code denial, change-back denial, one-time concurrent confirmation, profile/verification race, expiry after lock wait, mid-request session revocation and independent account-attempt limits. Password-reset tokens stayed unchanged. Production SMS remains disabled; no SMS or external provider used.");
}finally{await db.$disconnect();}
