import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
const database=new URL(process.env.DATABASE_URL??'postgresql://invalid/invalid');
if(!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||!/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get('schema')??''))throw new Error('Session authorization tests require a generated disposable local schema.');
const origin=process.env.TEST_BASE_URL;if(!origin||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Requires a disposable local app.');
const db=new PrismaClient(),marker=randomBytes(8).toString('hex'),users=[],roles=[];
const moduleUrl=code=>`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString('base64')}`;
const roleUrl=moduleUrl(await readFile(new URL('../src/lib/roles.ts',import.meta.url),'utf8'));
let firstRead;
const binding=`__sessionAuthorization_${marker}`;
globalThis[binding]={authSession:{findUnique:async args=>{const value=await db.authSession.findUnique(args);firstRead?.(value);firstRead=null;return value;},updateMany:db.authSession.updateMany.bind(db.authSession)}};
const code=(await readFile(new URL('../src/lib/session.ts',import.meta.url),'utf8')).replace('from "jose"',`from "${pathToFileURL(createRequire(import.meta.url).resolve('jose')).href}"`).replace('import { prisma } from "@/lib/prisma";',`const prisma=globalThis[${JSON.stringify(binding)}];`).replace('from "@/lib/roles"',`from "${roleUrl}"`);
const {verifySession}=await import(moduleUrl(code));delete globalThis[binding];
async function actor(){const r=await db.role.findUniqueOrThrow({where:{code:'admin'}}),c=await db.role.findUniqueOrThrow({where:{code:'customer_personal'}});const user=await db.user.create({data:{email:`session-authorization-${randomBytes(4).toString('hex')}-${marker}@example.test`,fullName:'Synthetic session authorization',status:'ACTIVE',passwordHash:'unused',roles:{create:[{roleId:r.id},{roleId:c.id}]}}});users.push(user.id);return user;}
async function session(user,portal='admin',mfa=true){const row=await db.authSession.create({data:{userId:user.id,portal,mfaVerifiedAt:mfa?new Date():null,expiresAt:new Date(Date.now()+3600000),lastSeenAt:new Date(Date.now()-120000),clientType:'WEB',clientName:'Authorization test'}});const token=await new SignJWT({roles:['admin'],name:'Untrusted JWT name'}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setJti(row.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET));return {row,token};}
async function heartbeatRace(change) {
 const person=await actor(),current=await session(person);let unlock,locked;
 const hold=new Promise(r=>unlock=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${current.row.id} FOR UPDATE`;locked();await hold;await change(tx,current.row,person);});
 await hasLock;let observed;const read=new Promise(r=>observed=r);firstRead=()=>observed();
 const verification=verifySession(current.token);await read;unlock();await blocker;return verification;
}
try{
 const user=await actor(),current=await session(user);
 assert.deepEqual((await verifySession(current.token)).roles,['admin']);
 await db.user.update({where:{id:user.id},data:{status:'PENDING_VERIFICATION'}});assert.equal(await verifySession(current.token),null);
 assert.equal((await fetch(`${origin}/api/v1/users/me`,{headers:{Cookie:`crossly_session=${current.token}`}})).status,401);
 assert.equal((await fetch(`${origin}/api/v1/admin/countries`,{headers:{Cookie:`crossly_session=${current.token}`}})).status,403);
 await db.user.update({where:{id:user.id},data:{status:'ACTIVE'}});
 const unknown=await db.role.create({data:{code:`unknown_${marker}`,description:'Synthetic unknown role'}});roles.push(unknown.id);await db.userRole.create({data:{userId:user.id,roleId:unknown.id}});
 const customer=await session(user,'customer');assert.deepEqual((await verifySession(customer.token)).roles,['customer_personal']);
 const noMfa=await session(user,'admin',false);assert.deepEqual((await verifySession(noMfa.token)).roles,[]);
 // Revocation commits while the resolver is waiting to update lastSeenAt.
 const racingUser=await actor(),racing=await session(racingUser);let unlock,locked;const held=new Promise(r=>unlock=r),hasLock=new Promise(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${racing.row.id} FOR UPDATE`;locked();await held;await tx.authSession.update({where:{id:racing.row.id},data:{revokedAt:new Date()}});});
 await hasLock;let observed;const read=new Promise(r=>observed=r);firstRead=value=>{assert.equal(value.revokedAt,null);observed();};const verification=verifySession(racing.token);await read;unlock();await blocker;assert.equal(await verification,null);
 const roleChanged=await heartbeatRace((tx,row,person)=>tx.userRole.deleteMany({where:{userId:person.id,role:{code:'admin'}}}));assert.deepEqual(roleChanged.roles,[]);
 const mfaChanged=await heartbeatRace((tx,row)=>tx.authSession.update({where:{id:row.id},data:{mfaVerifiedAt:null}}));assert.deepEqual(mfaChanged.roles,[]);assert.equal(mfaChanged.mfaRequired,true);
 assert.equal(await heartbeatRace((tx,row)=>tx.authSession.update({where:{id:row.id},data:{expiresAt:new Date(0)}})),null);
 // A concurrent healthy heartbeat may win; that must not revoke a valid session.
 const healthy=await session(user);await Promise.all([verifySession(healthy.token),verifySession(healthy.token)]).then(values=>values.forEach(value=>assert.deepEqual(value.roles,['admin'])));
 await db.user.update({where:{id:user.id},data:{status:'SUSPENDED'}});assert.equal(await verifySession(healthy.token),null);
 console.log('Session authorization passed: active-account gate, pending/suspended denial, forged/unknown role isolation, MFA scope, revocation/expiry/role/MFA changes during heartbeat waits and concurrent healthy refresh. Real disposable PostgreSQL; no live services.');
}finally{firstRead=null;await db.user.deleteMany({where:{id:{in:users}}});await db.role.deleteMany({where:{id:{in:roles}}});await db.$disconnect();}
