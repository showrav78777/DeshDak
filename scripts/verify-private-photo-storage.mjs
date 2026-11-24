import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
const require=createRequire(import.meta.url);
let source=(await readFile(new URL("../src/modules/private-storage/photos.ts",import.meta.url),"utf8")).replace('import "server-only";',"");
for(const name of ["@aws-sdk/client-s3","zod"])source=source.replace(`from "${name}"`,`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
const {createPrivatePhotoStore,privateStorageConfigSchema}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const config={bucket:"deshdak-private-test",region:"us-east-1",expectedOwner:"123456789012",kmsKeyArn:"arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111"};
const keys={identity:randomBytes(32),inspection:randomBytes(32)};
const objects=new Map(),versions=new Map();let mode="normal",calls=0;const captured=[];
const server=createServer(async(req,res)=>{
 calls++;const url=new URL(req.url,"http://localhost");const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
 captured.push({method:req.method,path:url.pathname,headers:req.headers,query:url.searchParams,bytes});
 assert.match(req.headers.authorization,/^AWS4-HMAC-SHA256 Credential=SYNTHETIC_PRIVATE_STORAGE\//);
 assert.match(req.headers.authorization,/\/us-east-1\/s3\/aws4_request/);
 assert.equal(req.headers["x-amz-expected-bucket-owner"],config.expectedOwner);
 if(req.method==="HEAD" && /^\/deshdak-private-test\/?$/.test(url.pathname)){res.writeHead(mode==="bucket-forbidden"?403:mode==="bucket-missing"?404:200,{"x-amz-bucket-region":mode==="bucket-region"?"us-west-2":config.region});res.end();return;}
 assert.match(url.pathname,/^\/deshdak-private-test\/private\/v1\/(identity|inspection)\/[a-f0-9]{64}$/);
 const respond=(status,body="")=>{res.writeHead(status,{"Content-Type":"application/xml"});res.end(body);};
 if(mode==="forbidden"){respond(403,"<Error><Code>AccessDenied</Code><Message>PRIVATE_PROVIDER_DIAGNOSTIC</Message></Error>");return;}
 if(req.method==="PUT"){
  assert.equal(req.headers["if-none-match"],"*");assert.equal(req.headers["x-amz-server-side-encryption"],"aws:kms");assert.equal(req.headers["x-amz-server-side-encryption-aws-kms-key-id"],config.kmsKeyArn);
  assert.equal(req.headers["content-type"],"application/octet-stream");assert.equal(req.headers["x-amz-acl"],undefined);
  if(objects.has(url.pathname)){respond(412,"<Error><Code>PreconditionFailed</Code></Error>");return;}
  const value={bytes,checksum:req.headers["x-amz-checksum-sha256"],version:`synthetic-version-${objects.size+1}`};objects.set(url.pathname,value);versions.set(`${url.pathname}\n${value.version}`,value);
  if(mode!=="unversioned")res.setHeader("x-amz-version-id",value.version);
  res.setHeader("x-amz-server-side-encryption",mode==="wrong-encryption"?"AES256":"aws:kms");res.setHeader("x-amz-server-side-encryption-aws-kms-key-id",config.kmsKeyArn);res.setHeader("x-amz-checksum-sha256",value.checksum);respond(200);return;
 }
 const value=url.searchParams.has("versionId")?versions.get(`${url.pathname}\n${url.searchParams.get("versionId")}`):objects.get(url.pathname);if(!value){respond(404,"<Error><Code>NoSuchKey</Code></Error>");return;}
 if(req.method==="HEAD"){
  if(url.searchParams.has("versionId")) assert.equal(url.searchParams.get("versionId"),value.version);
  if(mode!=="delete-no-etag")res.setHeader("etag",mode==="delete-wildcard"?'"*"':'"synthetic-etag"');
  if(mode==="delete-marker")res.setHeader("x-amz-delete-marker","true");
  if(mode==="delete-hold")res.setHeader("x-amz-object-lock-legal-hold","ON");
  if(mode==="delete-retention"){res.setHeader("x-amz-object-lock-mode","GOVERNANCE");res.setHeader("x-amz-object-lock-retain-until-date",new Date(Date.now()+86400000).toISOString());}
  res.writeHead(200,{"Content-Type":mode==="delete-mime"?"image/png":"application/octet-stream","Content-Length":value.bytes.length,"x-amz-version-id":mode==="delete-version"?"unconfirmed-version":value.version,"x-amz-server-side-encryption":"aws:kms","x-amz-server-side-encryption-aws-kms-key-id":config.kmsKeyArn,"x-amz-checksum-sha256":mode==="delete-checksum"?Buffer.alloc(32,9).toString("base64"):value.checksum});res.end();return;
 }
 assert.equal(url.searchParams.get("versionId"),value.version);
 if(req.method==="DELETE"){
  assert.equal(req.headers["if-match"],'"synthetic-etag"');assert.equal(req.headers["x-amz-bypass-governance-retention"],undefined);
  if(mode==="delete-etag-race"){respond(412,"<Error><Code>PreconditionFailed</Code></Error>");return;}
  if(!["delete-retained","delete-status"].includes(mode)){versions.delete(`${url.pathname}\n${value.version}`);if(objects.get(url.pathname)?.version===value.version)objects.delete(url.pathname);}
  if(mode!=="delete-no-version")res.setHeader("x-amz-version-id",mode==="delete-ack-version"?"unconfirmed-version":value.version);
  if(mode==="delete-ack-marker")res.setHeader("x-amz-delete-marker","true");
  if(mode==="delete-lost-ack"){respond(500,"<Error><Code>InternalError</Code><Message>PRIVATE_PROVIDER_DIAGNOSTIC</Message></Error>");return;}
  respond(mode==="delete-status"?200:204);return;
 }
 assert.equal(req.method,"GET");assert.equal(req.headers["x-amz-checksum-mode"],"ENABLED");
 res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Length":value.bytes.length,"x-amz-version-id":mode==="wrong-version"?"another-version":value.version,"x-amz-server-side-encryption":"aws:kms","x-amz-server-side-encryption-aws-kms-key-id":config.kmsKeyArn,"x-amz-checksum-sha256":value.checksum});
 if(mode==="stalled"){res.flushHeaders();return;}
 if(mode==="tampered"){const bad=Buffer.from(value.bytes);bad[0]^=255;res.end(bad);return;}
 res.end(value.bytes);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const client=new S3Client({region:config.region,endpoint:`http://127.0.0.1:${server.address().port}`,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:"SYNTHETIC_PRIVATE_STORAGE",secretAccessKey:randomBytes(32).toString("hex")},requestChecksumCalculation:"WHEN_REQUIRED",responseChecksumValidation:"WHEN_REQUIRED"});
const store=createPrivatePhotoStore({config,keys,client});
function safeFailure(error){assert.equal(error.message,"Private photo storage could not be confirmed. Use the controlled recovery process.");return true;}
try{
 for(const patch of [{bucket:"public/../bucket"},{bucket:"127.0.0.1"},{expectedOwner:"wrong"},{region:"us-west-2"},{kmsKeyArn:"arn:aws:kms:us-east-1:999999999999:key/11111111-1111-4111-8111-111111111111"}])assert(!privateStorageConfigSchema.safeParse({...config,...patch}).success);
 assert.throws(()=>createPrivatePhotoStore({config,keys:{identity:keys.identity,inspection:keys.identity},client}));
 const plaintext=Buffer.from("SYNTHETIC_PRIVATE_PHOTO_CONTENT");const prepared=store.prepare("identity",plaintext,"image/png");
 assert(!prepared.encryptedBody.includes(plaintext));assert(!prepared.reference.key.includes("PHOTO"));
 const reference=await store.write(prepared);assert.match(reference.versionId,/^synthetic-version-/);assert.deepEqual(await store.read(reference),plaintext);
 assert(captured[0].headers.authorization.includes("x-amz-server-side-encryption"));
 const before=calls;await assert.rejects(()=>store.read({...reference,key:"../../private"}),safeFailure);assert.equal(calls,before);
 await assert.rejects(()=>store.read({...reference,purpose:"inspection"}),safeFailure);
 await assert.rejects(()=>store.read({...reference,iv:randomBytes(12).toString("base64")}),safeFailure);
 await assert.rejects(()=>store.read({...reference,plaintextSha256:"0".repeat(64)}),safeFailure);
 await assert.rejects(()=>store.write(prepared),safeFailure);assert.deepEqual(await store.read(reference),plaintext,"Conditional retry overwrote the object.");
 for(const state of ["wrong-version","tampered","forbidden"]){mode=state;await assert.rejects(()=>store.read(reference),safeFailure);}
 for(const state of ["unversioned","wrong-encryption"]){mode=state;await assert.rejects(()=>store.write(store.prepare("inspection",plaintext,"image/jpeg")),safeFailure);}
 mode="normal";assert.deepEqual(await store.confirm(prepared),reference,"Conditional write recovery did not retain the exact version.");
 const lost=store.prepare("inspection",plaintext,"image/webp");mode="unversioned";await assert.rejects(()=>store.write(lost),safeFailure);mode="normal";
 const recovered=await store.confirm(lost);assert.deepEqual(await store.read(recovered),plaintext);await store.remove(recovered);
 const unmatched={...prepared,reference:{...prepared.reference,ciphertextSha256:randomBytes(32).toString("base64")}};await assert.rejects(()=>store.confirm(unmatched),safeFailure);
 mode="normal";const unchanged=calls;await assert.rejects(()=>store.remove({...reference,versionId:"null"}),safeFailure);assert.equal(calls,unchanged);
 // A missing or uncertain response must never become an unverified deletion receipt.
 mode="normal";const deletes=()=>captured.filter(call=>call.method==="DELETE").length;
 const readOnlyBefore=deletes();await assert.rejects(()=>store.confirmRemoval(reference),safeFailure);assert.equal(deletes(),readOnlyBefore);
 for(const state of ["delete-no-etag","delete-wildcard","delete-marker","delete-hold","delete-retention","delete-mime","delete-version","delete-checksum","forbidden"]){mode=state;const count=deletes();await assert.rejects(()=>store.remove(reference),safeFailure);assert.equal(deletes(),count,`${state} must block DELETE`);}
 mode="delete-etag-race";await assert.rejects(()=>store.remove(reference),safeFailure);mode="normal";assert.deepEqual(await store.read(reference),plaintext);
 for(const state of ["delete-retained","delete-status","delete-no-version","delete-ack-version","delete-ack-marker","delete-lost-ack","bucket-forbidden","bucket-missing","bucket-region"]){
  mode="normal";const candidate=await store.write(store.prepare("inspection",plaintext,"image/png"));mode=state;await assert.rejects(()=>store.remove(candidate),safeFailure);
  const count=deletes();mode="normal";
  if(["delete-retained","delete-status"].includes(state))assert.deepEqual(await store.read(candidate),plaintext);
  else assert.deepEqual(await store.confirmRemoval(candidate),{versionId:candidate.versionId,versionAbsent:true});
  assert.equal(deletes(),count,"Reconciliation must never repeat DELETE");
 }
 // Removing one historical version must preserve a newer version at the same key.
 const old=await store.write(store.prepare("identity",plaintext,"image/png"));const path=`/${config.bucket}/${old.key}`,oldValue=objects.get(path),newer={...oldValue,version:`${oldValue.version}-newer`};objects.set(path,newer);versions.set(`${path}\n${newer.version}`,newer);
 assert.deepEqual(await store.remove(old),{versionId:old.versionId,versionAbsent:true});assert.deepEqual(await store.read({...old,versionId:newer.version}),plaintext);assert.equal(objects.get(path).version,newer.version);
 const uncertain=deletes();mode="forbidden";await assert.rejects(()=>store.confirmRemoval(old),safeFailure);mode="normal";assert.equal(deletes(),uncertain);
 const invalidBefore=calls;await assert.rejects(()=>store.confirmRemoval({...reference,versionId:"null"}),safeFailure);assert.equal(calls,invalidBefore);
 // A lying adapter stream must still be bounded, independent of HTTP parsing.
 let destroyed=false;const oversized=Readable.from([new Uint8Array(plaintext.length+17)]);oversized.on("close",()=>{destroyed=true;});
 const fake={send:async()=>({Body:oversized,VersionId:reference.versionId,ContentLength:reference.sizeBytes+16,ContentType:"application/octet-stream",ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:reference.ciphertextSha256})};
 await assert.rejects(()=>createPrivatePhotoStore({config,keys,client:fake}).read(reference),safeFailure);await new Promise(resolve=>setImmediate(resolve));assert(destroyed);
 mode="stalled";await assert.rejects(()=>store.read(reference),safeFailure);
 mode="normal";assert.deepEqual(await store.remove(reference),{versionId:reference.versionId,versionAbsent:true});
 const removal=captured.filter(call=>call.method==="DELETE").at(-1);assert.equal(objects.has(removal.path),false);assert.equal(removal.method,"DELETE");assert.equal(removal.query.get("versionId"),reference.versionId);
 console.log("Private photo storage checks passed: SDK-signed local requests, opaque conditional writes, application encryption plus KMS, exact object versions, owner checks, integrity/tamper rejection, bounded/stalled reads, verified exact-version conditional deletion, read-only uncertainty reconciliation, retention/hold preservation and redacted failures. S3/KMS responses were simulated; no AWS account was contacted.");
}finally{client.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
