import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import sharp from "sharp";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
const origin = new URL(process.env.TEST_BASE_URL ?? "http://invalid").origin;
if (![database.hostname, new URL(origin).hostname].every(host => ["localhost","127.0.0.1","[::1]"].includes(host)) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Private upload workflow requires a generated disposable local schema.");
if (process.env.ALLOW_DEV_KYC_DOCUMENT_UPLOADS !== "true") throw new Error("Enable development identity intake only on the isolated runner.");
const prisma = new PrismaClient(); const marker = randomBytes(10).toString("hex"); const users=[]; const records=[];
const endpoint = `${origin}/api/v1/account/identity-verifications`;
try {
  async function user(label, role) {
    const assigned = await prisma.role.findUniqueOrThrow({where:{code:role}});
    const user = await prisma.user.create({data:{email:`private-upload-${label}-${marker}@example.test`,fullName:`Synthetic ${label}`,passwordHash:"not-used",status:"ACTIVE",roles:{create:{roleId:assigned.id}}}});users.push(user.id);return user;
  }
  async function session(user,portal) {
    const row=await prisma.authSession.create({data:{userId:user.id,portal,expiresAt:new Date(Date.now()+3_600_000),clientType:"WEB",clientName:"Synthetic private upload"}});
    const token=await new SignJWT({email:user.email,name:user.fullName,roles:[]}).setProtectedHeader({alg:"HS256"}).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    return `crossly_session=${token}; __Host-crossly_session=${token}`;
  }
  const customer=await user("customer","customer_personal"), stranger=await user("stranger","customer_personal"), compliance=await user("reviewer","compliance");
  const [cookie, otherCookie, complianceCookie]=await Promise.all([session(customer,"customer"),session(stranger,"customer"),session(compliance,"compliance")]);
  const photo=await sharp({create:{width:16,height:8,channels:3,background:"#135f78"}}).jpeg().withMetadata({orientation:6}).toBuffer();
  function form(duplicate=false) { const data=new FormData();data.set("documentType","PASSPORT");data.set("issuingCountryCode","BD");data.set("documentNumberLast4","A123");data.set("documentPhoto",new Blob([photo],{type:"image/jpeg"}),"PRIVATE_DOCUMENT_FILENAME.jpg");if(duplicate)data.append("documentPhoto",new Blob([photo],{type:"image/jpeg"}),"second.jpg");return data; }
  async function submit(auth=cookie,body=form(),trusted=true) { return fetch(endpoint,{method:"POST",headers:{...(auth?{Cookie:auth}:{}),Origin:trusted?origin:"https://untrusted.invalid"},body}); }
  assert.equal((await submit(null)).status,403);assert.equal((await submit(cookie,form(),false)).status,403);
  assert.equal((await submit(otherCookie,form(true))).status,422,"Duplicate identity files were accepted.");
  const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5*1024*1024+128*1024+1));controller.close();}});
  const tooLarge=await fetch(endpoint,{method:"POST",headers:{Cookie:otherCookie,Origin:origin,"Content-Type":"multipart/form-data; boundary=synthetic"},body:oversized,duplex:"half"});
  assert.equal(tooLarge.status,413,"Chunked oversized identity upload was accepted.");
  const malformed=form();malformed.set("documentPhoto",new Blob([Buffer.from([0xff,0xd8,0xff,0,0])],{type:"image/jpeg"}),"truncated.jpg");
  assert.equal((await submit(otherCookie,malformed)).status,422,"Undecodable signature-only photo was accepted.");
  const verified=await user("verified","customer_personal");await prisma.user.update({where:{id:verified.id},data:{kycStatus:"VERIFIED"}});
  assert.equal((await submit(await session(verified,"customer"))).status,409,"Verified identity was overwritten.");
  assert.equal(await prisma.identityVerification.count({where:{userId:verified.id}}),0);
  const first=await submit();assert.equal(first.status,201);const firstBody=await first.json();records.push(firstBody.data.submission.id);
  const serialized=JSON.stringify(firstBody);
  for(const name of ["Ciphertext","PhotoIv","PhotoTag","Sha256","userId","PRIVATE_DOCUMENT_FILENAME"]) assert(!serialized.includes(name),`Identity response exposed ${name}`);
  const concurrent=await Promise.all([submit(),submit()]);for(const response of concurrent){assert.equal(response.status,201);records.push((await response.json()).data.submission.id);}
  const saved=await prisma.identityVerification.findMany({where:{userId:customer.id}});
  assert.equal(saved.length,3);assert.equal(saved.filter(record=>record.status==="PENDING").length,1,"Concurrent identity submissions left multiple pending reviews.");
  assert.equal(saved.filter(record=>record.status==="REJECTED").length,2);
  assert.equal(await prisma.auditLog.count({where:{actorId:customer.id,action:"identity_verification.submitted"}}),3);
  const latest=saved.find(record=>record.status==="PENDING");
  assert.notEqual(latest.documentPhotoCiphertext,photo.toString("base64"));
  const documentUrl=`${origin}/api/v1/compliance/identity-verifications/${latest.id}/document`;
  assert.equal((await fetch(documentUrl,{headers:{Cookie:cookie}})).status,403);
  assert.equal((await fetch(documentUrl,{headers:{Cookie:otherCookie}})).status,403);
  assert.equal((await fetch(documentUrl,{headers:{Cookie:complianceCookie}})).status,403,"Compliance accessed a document before MFA.");
  await prisma.authSession.updateMany({where:{userId:compliance.id,portal:"compliance"},data:{mfaVerifiedAt:new Date()}});
  const viewed=await fetch(documentUrl,{headers:{Cookie:complianceCookie}});assert.equal(viewed.status,200);assert.match(viewed.headers.get("cache-control"),/no-store/);
  const clean=await sharp(Buffer.from(await viewed.arrayBuffer())).metadata();assert.equal(clean.exif,undefined);assert.equal(clean.orientation,undefined);assert.equal(clean.width,8);assert.equal(clean.height,16);
  const own=await fetch(endpoint,{headers:{Cookie:cookie}});assert.equal(own.status,200);const ownBody=await own.json();assert.equal(ownBody.data.submissions.length,3);assert(!JSON.stringify(ownBody).includes("Ciphertext"));
  const other=await fetch(endpoint,{headers:{Cookie:otherCookie}});assert.equal((await other.json()).data.submissions.length,0);
  console.log("Private identity workflow passed: actual chunked upload bounds, duplicate rejection, customer/Compliance isolation, encrypted storage, metadata-free authorized viewing, safe response fields and serialized concurrent submissions. Synthetic documents only.");
} finally {
  if(users.length){await prisma.auditLog.deleteMany({where:{OR:[{actorId:{in:users}},{entityId:{in:records}}]}});await prisma.identityVerification.deleteMany({where:{userId:{in:users}}});await prisma.authSession.deleteMany({where:{userId:{in:users}}});await prisma.userRole.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});}
  await prisma.$disconnect();
}
