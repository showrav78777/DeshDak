import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { chromium, expect } from "@playwright/test";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get("schema") ?? "")) throw new Error("Read-action verification requires a generated disposable local schema.");
const origin = process.env.TEST_BASE_URL;
if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("A disposable local application is required.");
const db = new PrismaClient(), marker = randomBytes(8).toString("hex");
async function actor(label) {
 const role=await db.role.findUniqueOrThrow({where:{code:"customer_personal"}});
 const user=await db.user.create({data:{email:`read-${label}-${marker}@example.test`,fullName:"Synthetic read customer",passwordHash:"unused",status:"ACTIVE",roles:{create:{roleId:role.id}}}});
 const session=await db.authSession.create({data:{userId:user.id,portal:"customer",expiresAt:new Date(Date.now()+3600000),clientType:"WEB",clientName:"Read action test"}});
 const token=await new SignJWT({email:user.email,name:user.fullName,roles:["customer_personal"]}).setProtectedHeader({alg:"HS256"}).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER??origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
 return {user,token};
}
async function notice(userId,title="Synthetic notice") {
 return db.notification.create({data:{userId,eventType:"TEST_READ",title,body:"Synthetic notification workflow",idempotencyKey:randomUUID(),deliveries:{create:[{channel:"IN_APP",status:"DELIVERED",deliveredAt:new Date(),idempotencyKey:randomUUID()},{channel:"EMAIL",status:"SENT",idempotencyKey:randomUUID()}]}}});
}
const readPath=id=>`/api/v1/notifications/${id}/read`;
async function call(path,token,body,originHeader=origin) {
 const response=await fetch(`${origin}${path}`,{method:"PATCH",headers:{...(token?{Cookie:`crossly_session=${token}`}:{ }),...(originHeader?{Origin:originHeader}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,redirect:"manual"});
 return {response,body:response.headers.get("content-type")?.includes("json") ? await response.json() : null};
}
try {
 const owner=await actor("owner"), other=await actor("other");
 const item=await notice(owner.user.id), foreign=await notice(other.user.id);
 for(const path of [readPath(item.id),"/api/v1/notifications"]){
  assert.equal((await call(path,null,{action:"MARK_ALL_READ"})).response.status,401);
  assert.equal((await call(path,owner.token,{action:"MARK_ALL_READ"},"https://untrusted.invalid")).response.status,403);
  assert.equal((await call(path,owner.token,{action:"MARK_ALL_READ"},null)).response.status,403);
 }
 assert.equal((await call(readPath("invalid"),owner.token)).response.status,422);
 assert.equal((await call(readPath(foreign.id),owner.token)).response.status,404);
 assert.equal((await call("/api/v1/notifications",owner.token,{action:"INVALID"})).response.status,422);
 const results=await Promise.all(Array.from({length:6},()=>call(readPath(item.id),owner.token)));
 for(const r of results){assert.equal(r.response.status,200);assert.match(r.response.headers.get("cache-control"),/no-store/);assert.equal(r.body.data.id,item.id);}
 const first=results[0].body.data.readAt;for(const r of results)assert.equal(r.body.data.readAt,first);
 assert.equal((await call(readPath(item.id),owner.token)).body.data.readAt,first);
 const deliveries=await db.notificationDelivery.findMany({where:{notificationId:item.id}});
 assert.equal(deliveries.find(d=>d.channel==="IN_APP").readAt.toISOString(),first);assert.equal(deliveries.find(d=>d.channel==="EMAIL").status,"SENT");
 assert.equal((await db.notification.findUniqueOrThrow({where:{id:foreign.id}})).readAt,null);
 // Insert a new unread notification between the bulk notification and delivery updates.
 const anchor=await notice(owner.user.id), incomingId=randomUUID(), incomingDelivery=randomUUID();
 const functionName=`read_arrival_${marker}`;
 await db.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${anchor.id}' AND OLD."readAt" IS NULL THEN INSERT INTO "Notification" ("id","userId","eventType","title","body","idempotencyKey") VALUES ('${incomingId}','${owner.user.id}','TEST_READ','Arrived during mark all','Synthetic','${randomUUID()}'); INSERT INTO "NotificationDelivery" ("id","notificationId","channel","status","idempotencyKey","updatedAt") VALUES ('${incomingDelivery}','${incomingId}','IN_APP','DELIVERED','${randomUUID()}',CURRENT_TIMESTAMP); END IF; RETURN NEW; END $$;`);
 await db.$executeRawUnsafe(`CREATE TRIGGER "${functionName}" AFTER UPDATE ON "Notification" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
 const bulk=await call("/api/v1/notifications",owner.token,{action:"MARK_ALL_READ"});assert.equal(bulk.response.status,200);assert.equal(bulk.body.data.updated,1);assert.match(bulk.response.headers.get("cache-control"),/no-store/);
 assert.equal((await db.notification.findUniqueOrThrow({where:{id:incomingId}})).readAt,null);
 assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:incomingDelivery}})).status,"DELIVERED");
 await db.$executeRawUnsafe(`DROP TRIGGER "${functionName}" ON "Notification"`);await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
 assert.equal((await call("/api/v1/notifications",owner.token,{action:"MARK_ALL_READ"})).body.data.updated,1);
 assert.equal((await call("/api/v1/notifications",owner.token,{action:"MARK_ALL_READ"})).body.data.updated,0);
 assert.equal((await db.notification.findUniqueOrThrow({where:{id:item.id}})).readAt.toISOString(),first);
 // A failed delivery update must roll back the notification timestamp as well.
 const rollback=await notice(owner.user.id), fault=`read_fault_${marker}`;
 await db.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."notificationId" = '${rollback.id}' THEN RAISE EXCEPTION 'SYNTHETIC_READ_FAILURE'; END IF; RETURN NEW; END $$;`);
 await db.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE UPDATE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
 try {for(const [path,body] of [[readPath(rollback.id),undefined],["/api/v1/notifications",{action:"MARK_ALL_READ"}]]){assert.equal((await call(path,owner.token,body)).response.status,500);assert.equal((await db.notification.findUniqueOrThrow({where:{id:rollback.id}})).readAt,null);}}
 finally{await db.$executeRawUnsafe(`DROP TRIGGER "${fault}" ON "NotificationDelivery"`);await db.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);}
 await call(readPath(rollback.id),owner.token);
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [1440,390]){
   const target=await notice(owner.user.id,`Read browser ${width}`);await notice(owner.user.id,`Read bulk browser ${width}`);
   const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:"crossly_session",value:owner.token,url:origin}]);
   const page=await context.newPage();await page.goto(`${origin}/notifications`);
   const card=page.locator(".notification-card").filter({hasText:`Read browser ${width}`});const single=card.locator(".notification-read-button");await expect(single).toBeEnabled();
   const head=page.locator(".notification-page-head .notification-action"), all=head.getByRole("button");
   for(const [button,scope,endpoint,bad] of [[single,card,`**${readPath(target.id)}`,{id:foreign.id,readAt:new Date().toISOString()}],[all,head,"**/api/v1/notifications",{updated:-1}]]){
    await page.route(endpoint,route=>route.abort("failed"));await button.click();await expect(scope.getByRole("alert")).toContainText("Could not confirm");await expect(button).toBeEnabled();await page.unroute(endpoint);
    assert.equal((await db.notification.findUniqueOrThrow({where:{id:target.id}})).readAt,null);
    await page.route(endpoint,route=>route.fulfill({json:{data:bad}}));await button.click();await expect(scope.getByRole("alert")).toContainText("Could not confirm");await expect(button).toBeEnabled();await page.unroute(endpoint);
    await page.route(endpoint,route=>route.fulfill({status:403,json:{error:{message:"Test read denied."}}}));await button.click();await expect(scope.getByRole("alert")).toHaveText("Test read denied.");await expect(button).toBeEnabled();await page.unroute(endpoint);
   }
   for(const [button,endpoint] of [[single,`**${readPath(target.id)}`],[all,"**/api/v1/notifications"]]){
    let release;let count=0;const held=new Promise(resolve=>{release=resolve;});await page.route(endpoint,async route=>{count++;await held;await route.continue();});
    const path=button===single?readPath(target.id):"/api/v1/notifications";const completed=page.waitForResponse(r=>r.url()===`${origin}${path}`&&r.request().method()==="PATCH");void completed.catch(()=>{});
    await button.click();await expect(button).toBeDisabled();await expect.poll(()=>count).toBe(1);release();assert.equal((await completed).status(),200);await page.unroute(endpoint);
    if(button===single){await expect(card.getByText("Read",{exact:true})).toBeVisible();}else{await expect(page.locator(".notification-summary b")).toHaveText("0");await expect(all).toBeDisabled();}
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:`/tmp/deshdak-read-actions-${width}-20261111.png`});await context.close();
  }
  await notice(owner.user.id,"No JavaScript read fixture");const context=await browser.newContext({javaScriptEnabled:false});await context.addCookies([{name:"crossly_session",value:owner.token,url:origin}]);const page=await context.newPage();await page.goto(`${origin}/notifications`);await expect(page.getByRole("button",{name:"Mark all as read",exact:true})).toBeDisabled();await expect(page.getByRole("button",{name:"Mark read",exact:true})).toBeDisabled();await context.close();
 }finally{await browser.close();}
 console.log("Notification read actions passed: ownership/origin/authentication, stable concurrent/retry timestamps, bulk arrival isolation, delivery-channel scope and transaction rollback; desktop/mobile error recovery, pending duplicate guards, real successful reads, no-JavaScript disabled controls and no horizontal overflow. PostgreSQL/API were real; browser failure responses were simulated. No external provider was used.");
}finally{await db.$disconnect();}
