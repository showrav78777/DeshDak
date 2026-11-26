import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Deletion review verification requires a generated disposable local schema.");
const origin = process.env.TEST_BASE_URL; if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("A disposable local test server is required.");
const require = createRequire(import.meta.url);
async function source(file, replacements = {}) { let code = (await readFile(new URL(file, import.meta.url), "utf8")).replace('import "server-only";', "").replace('from "zod"', `from ${JSON.stringify(pathToFileURL(require.resolve("zod")).href)}`); for (const [a, b] of Object.entries(replacements)) code = code.replace(`from "${a}"`, `from ${JSON.stringify(b)}`); return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`; }
const photos = await source("../src/modules/private-storage/photos.ts", { "@aws-sdk/client-s3": pathToFileURL(require.resolve("@aws-sdk/client-s3")).href });
const eligibility = await source("../src/modules/private-storage/eligibility.ts"), quarantine = await source("../src/modules/private-storage/quarantine.ts");
const { createMediaLifecycle } = await import(await source("../src/modules/private-storage/lifecycle.ts", { "./quarantine": quarantine, "./eligibility": eligibility, "./photos": photos }));
const db = new PrismaClient(), controls = createMediaLifecycle(db), marker = randomBytes(8).toString("hex"), now = Date.now(), day = 86400000, ago = days => new Date(now - days * day), hash = "a".repeat(64);
async function actor(label, codes = ["customer_personal"], mfa = true) {
 const roles = await db.role.findMany({ where: { code: { in: codes } } });
 const user = await db.user.create({ data: { email: `retention-${label}-${marker}@example.test`, fullName: "Synthetic retention actor", passwordHash: "unused", status: "ACTIVE", roles: { create: roles.map(r => ({ roleId: r.id })) } } });
 const session = await db.authSession.create({ data: { userId: user.id, portal: codes.includes("admin") ? "admin" : "customer", mfaVerifiedAt: mfa ? new Date() : null, expiresAt: new Date(now + 3600000), clientType: "WEB", clientName: "Synthetic retention" } });
 const token = await new SignJWT({ roles: codes, email: user.email, name: user.fullName }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
 return { user, session, token, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
}
async function photo(owner) {
 const reference = { format: 1, purpose: "identity", key: `private/v1/identity/${randomBytes(32).toString("hex")}`, versionId: randomUUID(), iv: Buffer.alloc(12).toString("base64"), plaintextSha256: hash, ciphertextSha256: Buffer.alloc(32).toString("base64"), mimeType: "image/png", sizeBytes: 20 };
 return db.privatePhotoUpload.create({ data: { actorId: owner.user.id, purpose: "identity", idempotencyKey: randomUUID(), fingerprint: hash, storageNamespace: "b".repeat(64), status: "STORED", preparedReference: {}, storedReference: reference, createdAt: ago(500), updatedAt: ago(498), originalScanSha256: hash, originalScanVerifiedAt: ago(499), scanVerifiedSha256: hash, scanVerifiedAt: ago(499) } });
}
const caseReference="SEC-DELETION-001", root=`${origin}/api/v1/admin/private-media/deletion-reviews`;
async function post(who,path,body,key=randomUUID(),originHeader=origin) {
 const response=await fetch(root+path,{method:"POST",headers:{Cookie:who.cookie,Origin:originHeader,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
try {
 const author=await actor("requester",["admin","compliance"]), reviewer=await actor("reviewer",["admin","compliance"]), basic=await actor("basic",["admin"]), customer=await actor("owner"), noMfa=await actor("no-mfa",["admin"],false);
 let sequence=(await db.privateMediaPolicy.findFirst({orderBy:{sequence:"desc"}}))?.sequence??0;
 if(!sequence){await controls.savePolicy(author.session.id,{expectedSequence:0,identityDays:90,inspectionDays:180,abandonedHours:24,caseReference,confirmed:true,idempotencyKey:randomUUID()});sequence=1;}
 const requestBody=id=>({uploadId:id,expectedPolicySequence:sequence,caseReference,confirmed:true});
 const decide=(decision="APPROVED")=>({decision,caseReference,confirmed:true});
 const item=await photo(customer), body=requestBody(item.id), key=randomUUID();
 for(const who of [customer,noMfa]) assert.equal((await post(who,"",body)).status,403);
 assert.equal((await fetch(root)).status,403);
 assert.equal((await post(author,"",body,randomUUID(),"https://untrusted.invalid")).status,403);
 assert.equal((await post(author,"",body,"")).status,422);
 assert.equal((await post(author,"",{...body,confirmed:false})).status,422);
 assert.equal((await post(author,"",{...body,deleteNow:true})).status,422);
 assert.equal((await fetch(root+"?page=0",{headers:{Cookie:author.cookie}})).status,422);
 const pair=await Promise.all([post(author,"",body,key),post(author,"",body,key)]);assert.deepEqual(pair.map(r=>r.status),[200,200]);
 const saved=await db.privateMediaDeletionRequest.findUniqueOrThrow({where:{id:pair[0].data.data.id}});assert.equal(saved.expiresAt.getTime()-saved.createdAt.getTime(),day,"Database controls the 24-hour review lifetime");
 const id=pair[0].data.data.id;assert.equal(pair[1].data.data.id,id);assert.equal(pair[0].data.data.deletionEnabled,false);
 assert.equal(await db.privateMediaDeletionRequest.count({where:{uploadId:item.id}}),1);
 assert.equal(await db.auditLog.count({where:{actorId:author.user.id,action:"private_media.deletion_review_requested",entityId:id}}),1);
 assert.equal((await post(author,"",{...body,caseReference:"SEC-DELETION-CHANGED"},key)).status,409);
 assert.equal((await post(author,"",body)).status,409);
 assert.equal((await post(author,`/${id}/decision`,decide())).status,403);
 assert.equal((await post(basic,`/${id}/decision`,decide())).status,403);
 const complianceRole=await db.role.findUniqueOrThrow({where:{code:"compliance"}});
 await db.userRole.delete({where:{userId_roleId:{userId:reviewer.user.id,roleId:complianceRole.id}}});
 assert.equal((await post(reviewer,`/${id}/decision`,decide())).status,403,"Current Compliance role is required despite a previously valid session");
 await db.userRole.create({data:{userId:reviewer.user.id,roleId:complianceRole.id}});
 const decisionKey=randomUUID();const approved=await post(reviewer,`/${id}/decision`,decide(),decisionKey);assert.equal(approved.status,200);assert.equal(approved.data.data.decision,"APPROVED");assert.equal(approved.data.data.deletionEnabled,false);
 assert.equal((await post(reviewer,`/${id}/decision`,decide(),decisionKey)).status,200);
 assert.equal((await post(reviewer,`/${id}/decision`,decide("REJECTED"),decisionKey)).status,409);
 assert.equal(await db.auditLog.count({where:{actorId:reviewer.user.id,action:"private_media.deletion_review_decided",entityId:id}}),1);
 await assert.rejects(()=>db.privateMediaDeletionRequest.update({where:{id},data:{caseReference:"SEC-CHANGED-001"}}));
 await assert.rejects(()=>db.privateMediaDeletionRequest.delete({where:{id}}));
 await assert.rejects(()=>db.privateMediaDeletionDecision.update({where:{requestId:id},data:{decision:"REJECTED"}}));
 await assert.rejects(()=>db.privateMediaDeletionDecision.delete({where:{requestId:id}}));
 async function requestItem(){const upload=await photo(customer);const res=await post(author,"",requestBody(upload.id));assert.equal(res.status,200);return {upload,id:res.data.data.id};}
 const raced=await requestItem(), anotherReviewer=await actor("race-reviewer",["admin","compliance"]);
 const decisions=await Promise.all([post(reviewer,`/${raced.id}/decision`,decide()),post(anotherReviewer,`/${raced.id}/decision`,decide("REJECTED"))]);assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);assert.equal(await db.privateMediaDeletionDecision.count({where:{requestId:raced.id}}),1);
 const invalidReference=await photo(customer);await db.privatePhotoUpload.update({where:{id:invalidReference.id},data:{storedReference:{...invalidReference.storedReference,versionId:"null"},updatedAt:invalidReference.updatedAt}});assert.equal((await post(author,"",requestBody(invalidReference.id))).status,503);assert.equal(await db.privateMediaDeletionRequest.count({where:{uploadId:invalidReference.id}}),0);
 const held=await requestItem();const hold=await controls.placeHold(author.session.id,{scope:"UPLOAD",targetId:held.upload.id,caseReference,confirmed:true,idempotencyKey:randomUUID()});
 assert.equal((await post(reviewer,`/${held.id}/decision`,decide())).status,409);
 assert.equal((await post(reviewer,`/${held.id}/decision`,decide("REJECTED"))).status,200);
 await controls.releaseHold(reviewer.session.id,hold.id,{caseReference,confirmed:true,idempotencyKey:randomUUID()});
 assert.equal((await post(basic,"",requestBody(held.upload.id))).status,200,"Admin can request a replacement after independent rejection");
 const changed=await requestItem();await db.privatePhotoUpload.update({where:{id:changed.upload.id},data:{storedReference:{...changed.upload.storedReference,versionId:randomUUID()},updatedAt:changed.upload.updatedAt}});
 assert.equal((await post(reviewer,`/${changed.id}/decision`,decide())).status,409,"Changed exact version must invalidate the review snapshot");
 const stale=await requestItem();await controls.savePolicy(author.session.id,{expectedSequence:sequence,identityDays:90,inspectionDays:180,abandonedHours:24,caseReference,confirmed:true,idempotencyKey:randomUUID()});sequence++;
 assert.equal((await post(reviewer,`/${stale.id}/decision`,decide())).status,409);assert.equal((await post(reviewer,`/${stale.id}/decision`,decide("REJECTED"))).status,200);
 const expiry=await requestItem();const clockDb=new Proxy(db,{get(target,property){if(property==="$transaction")return callback=>target.$transaction(tx=>callback(new Proxy(tx,{get(txTarget,key){if(key==="$queryRaw")return(strings,...values)=>strings[0].includes("clock_timestamp()")?Promise.resolve([{now:new Date(Date.now()+2*day)}]):txTarget.$queryRaw(strings,...values);const value=Reflect.get(txTarget,key);return typeof value==="function"?value.bind(txTarget):value;}})));const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;}});
 // Advancing database time expires the one-hour session as well as the review.
 await assert.rejects(()=>createMediaLifecycle(clockDb).decideDeletionReview(reviewer.session.id,expiry.id,{...decide(),idempotencyKey:randomUUID()}),/MEDIA_LIFECYCLE_DENIED/);
 const expirySession=await db.authSession.findUniqueOrThrow({where:{id:reviewer.session.id}});
 try {
   await db.authSession.update({where:{id:reviewer.session.id},data:{expiresAt:new Date(Date.now()+3*day)}});
   await assert.rejects(()=>createMediaLifecycle(clockDb).decideDeletionReview(reviewer.session.id,expiry.id,{...decide(),idempotencyKey:randomUUID()}),/MEDIA_LIFECYCLE_CONFLICT/);
 } finally { await db.authSession.update({where:{id:reviewer.session.id},data:{expiresAt:expirySession.expiresAt}}); }
 await assert.rejects(()=>db.privateMediaDeletionDecision.create({data:{requestId:expiry.id,actorId:author.user.id,decision:"APPROVED",caseReference,idempotencyKey:randomUUID()}}));
 const guarded=await requestItem();await db.ticket.create({data:{reference:`REVIEW-${marker}`,idempotencyKey:randomUUID(),customerId:customer.user.id,category:"GENERAL",subject:"Synthetic preservation case",status:"OPEN",slaDueAt:new Date(now+day)}});
 assert.equal((await post(reviewer,`/${guarded.id}/decision`,decide())).status,409);
 assert.equal((await post(reviewer,`/${guarded.id}/decision`,decide("REJECTED"))).status,200);
 const ticket=await db.ticket.findUniqueOrThrow({where:{reference:`REVIEW-${marker}`}});await db.ticket.update({where:{id:ticket.id},data:{status:"CLOSED",resolvedAt:ago(400),updatedAt:ago(400)}});
 const fault=`deletion_review_fault_${marker}`;await db.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" IN ('private_media.deletion_review_requested','private_media.deletion_review_decided') THEN RAISE EXCEPTION 'SYNTHETIC_DELETION_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;`);await db.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
 try{const upload=await photo(customer);assert.equal((await post(author,"",requestBody(upload.id))).status,503);assert.equal(await db.privateMediaDeletionRequest.count({where:{uploadId:upload.id}}),0);assert.equal((await post(reviewer,`/${expiry.id}/decision`,decide("REJECTED"))).status,503);assert.equal(await db.privateMediaDeletionDecision.count({where:{requestId:expiry.id}}),0);}finally{await db.$executeRawUnsafe(`DROP TRIGGER "${fault}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);}
 const response=await fetch(root+"?state=all",{headers:{Cookie:reviewer.cookie}});assert.equal(response.status,200);assert.match(response.headers.get("cache-control"),/no-store/);const text=await response.text();for(const hidden of ["snapshotDigest","storedReference","storageNamespace","idempotencyKey","actorId",customer.user.email])assert(!text.includes(hidden));
 const contract=JSON.parse(await readFile(new URL("../public/openapi.yaml",import.meta.url),"utf8"));for(const [method,path] of [["get","/admin/private-media/deletion-reviews"],["post","/admin/private-media/deletion-reviews"],["post","/admin/private-media/deletion-reviews/{requestId}/decision"]])assert.deepEqual(contract.paths[path][method].security,[{cookieSession:[]}]);
 const {chromium,expect}=await import("@playwright/test");const browser=await chromium.launch({headless:true});
 try{for(const width of [1440,390]){const browserPhoto=await photo(customer);const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:"crossly_session",value:author.token,url:origin}]);const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));await page.goto(`${origin}/admin/private-media/deletion-reviews`);const panel=page.locator("#admin-main-content:visible");await expect(panel.getByRole("heading",{name:"Deletion review requests",exact:true})).toBeVisible();const form=panel.locator("form").filter({has:page.getByRole("button",{name:"Request independent review",exact:true})});await form.getByLabel("Upload reference",{exact:true}).fill(browserPhoto.id);await form.getByLabel("Controlled case reference").fill(caseReference);await form.getByRole("checkbox").check();const retryKeys=[];let dropped=false;if(width===1440)await page.route("**/api/v1/admin/private-media/deletion-reviews",async route=>{retryKeys.push(route.request().headers()["idempotency-key"]);if(!dropped){dropped=true;await route.fetch();await route.abort("failed");}else await route.continue();});await form.getByRole("button",{name:"Request independent review",exact:true}).click();if(width===1440){await expect(form.getByRole("alert")).toContainText("could not be confirmed");await form.getByRole("button",{name:"Request independent review",exact:true}).click();}await expect(panel.getByRole("status").filter({hasText:"Review recorded"})).toBeVisible();
 assert.equal(await db.privateMediaDeletionRequest.count({where:{uploadId:browserPhoto.id}}),1);if(width===1440){assert.equal(retryKeys.length,2);assert.equal(retryKeys[0],retryKeys[1]);}
 const record=await db.privateMediaDeletionRequest.findFirstOrThrow({where:{uploadId:browserPhoto.id}});await context.clearCookies();await context.addCookies([{name:"crossly_session",value:reviewer.token,url:origin}]);await page.goto(`${origin}/admin/private-media/deletion-reviews?state=all`);const card=panel.locator(".private-photo-list article").filter({hasText:record.id});await card.locator("summary").click();await card.getByLabel("Controlled case reference").fill(caseReference);await card.getByRole("checkbox").check();await card.getByRole("button",{name:"Record independent decision",exact:true}).click();await expect(card.getByRole("heading",{name:"Review approved — cleanup disabled",exact:true})).toBeVisible();await page.reload();await expect(panel.getByText("Review approved — cleanup disabled",{exact:true}).first()).toBeVisible();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await panel.getByRole("button",{name:/delete files|execute|run cleanup/i}).count(),0);await page.waitForLoadState("networkidle");await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`/tmp/deshdak-deletion-review-${width}-20261124.png`});assert.deepEqual(errors,[]);await context.close();}}finally{await browser.close();}
 await db.authSession.update({where:{id:reviewer.session.id},data:{revokedAt:new Date()}});await assert.rejects(()=>controls.deletionReviews(reviewer.session.id,{}),/MEDIA_LIFECYCLE_DENIED/);
 console.log("Deletion reviews passed: independent Admin/Compliance/MFA, ready/version-bound requests, holds/cases/policy/version/expiry conflicts, replay/concurrency, immutable SQL constraints, atomic audit rollback, redacted history and desktop/mobile request/decision forms. Clock-expiry injection and scan/storage references were synthetic. No storage, provider or deletion executor was contacted.");
}finally{await db.$disconnect();}
