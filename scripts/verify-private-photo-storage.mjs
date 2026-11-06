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
const objects=new Map();let mode="normal",calls=0;const captured=[];
const server=createServer(async(req,res)=>{
 calls++;const url=new URL(req.url,"http://localhost");const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
 captured.push({method:req.method,path:url.pathname,headers:req.headers,query:url.searchParams,bytes});
 assert.match(req.headers.authorization,/^AWS4-HMAC-SHA256 Credential=SYNTHETIC_PRIVATE_STORAGE\//);
 assert.match(req.headers.authorization,/\/us-east-1\/s3\/aws4_request/);
 assert.equal(req.headers["x-amz-expected-bucket-owner"],config.expectedOwner);
 assert.match(url.pathname,/^\/deshdak-private-test\/private\/v1\/(identity|inspection)\/[a-f0-9]{64}$/);
 const respond=(status,body="")=>{res.writeHead(status,{"Content-Type":"application/xml"});res.end(body);};
 if(mode==="forbidden"){respond(403,"<Error><Code>AccessDenied</Code><Message>PRIVATE_PROVIDER_DIAGNOSTIC</Message></Error>");return;}
 if(req.method==="PUT"){
  assert.equal(req.headers["if-none-match"],"*");assert.equal(req.headers["x-amz-server-side-encryption"],"aws:kms");assert.equal(req.headers["x-amz-server-side-encryption-aws-kms-key-id"],config.kmsKeyArn);
  assert.equal(req.headers["content-type"],"application/octet-stream");assert.equal(req.headers["x-amz-acl"],undefined);
  if(objects.has(url.pathname)){respond(412,"<Error><Code>PreconditionFailed</Code></Error>");return;}
  const value={bytes,checksum:req.headers["x-amz-checksum-sha256"],version:`synthetic-version-${objects.size+1}`};objects.set(url.pathname,value);
  if(mode!=="unversioned")res.setHeader("x-amz-version-id",value.version);
  res.setHeader("x-amz-server-side-encryption",mode==="wrong-encryption"?"AES256":"aws:kms");res.setHeader("x-amz-server-side-encryption-aws-kms-key-id",config.kmsKeyArn);res.setHeader("x-amz-checksum-sha256",value.checksum);respond(200);return;
 }
 const value=objects.get(url.pathname);if(!value){respond(404,"<Error><Code>NoSuchKey</Code></Error>");return;}
 if(req.method==="HEAD"){
  res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Length":value.bytes.length,"x-amz-version-id":value.version,"x-amz-server-side-encryption":"aws:kms","x-amz-server-side-encryption-aws-kms-key-id":config.kmsKeyArn,"x-amz-checksum-sha256":value.checksum});res.end();return;
 }
 assert.equal(url.searchParams.get("versionId"),value.version);
 if(req.method==="DELETE"){objects.delete(url.pathname);respond(204);return;}
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
 // A lying adapter stream must still be bounded, independent of HTTP parsing.
 let destroyed=false;const oversized=Readable.from([new Uint8Array(plaintext.length+17)]);oversized.on("close",()=>{destroyed=true;});
 const fake={send:async()=>({Body:oversized,VersionId:reference.versionId,ContentLength:reference.sizeBytes+16,ContentType:"application/octet-stream",ServerSideEncryption:"aws:kms",SSEKMSKeyId:config.kmsKeyArn,ChecksumSHA256:reference.ciphertextSha256})};
 await assert.rejects(()=>createPrivatePhotoStore({config,keys,client:fake}).read(reference),safeFailure);await new Promise(resolve=>setImmediate(resolve));assert(destroyed);
 mode="stalled";await assert.rejects(()=>store.read(reference),safeFailure);
 mode="normal";await store.remove(reference);assert.equal(objects.has(captured.at(-1).path),false);
 const removal=captured.at(-1);assert.equal(removal.method,"DELETE");assert.equal(removal.query.get("versionId"),reference.versionId);
 console.log("Private photo storage checks passed: SDK-signed local requests, opaque conditional writes, application encryption plus KMS, exact object versions, owner checks, integrity/tamper rejection, bounded/stalled reads, scoped deletion and redacted failures. S3/KMS responses were simulated; no AWS account was contacted.");
}finally{client.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
