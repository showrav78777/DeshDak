import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

const require = createRequire(import.meta.url);
const loadCode = async (relative) => (await readFile(new URL(relative, import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const { getPhoneVerificationMode } = await load(stripTypeScriptTypes(await loadCode("../src/modules/auth/phone-verification-mode.ts")));
for (const env of [{}, {NODE_ENV:"production",ALLOW_DEV_AUTH_LINKS:"true",SMS_PROVIDER_API_KEY:"synthetic",SMS_PROVIDER_SENDER_ID:"TEST"}, {NODE_ENV:"development"}, {NODE_ENV:"test",ALLOW_DEV_AUTH_LINKS:"false"}, {NODE_ENV:"staging",ALLOW_DEV_AUTH_LINKS:"true"}]) assert.equal(getPhoneVerificationMode(env), "UNAVAILABLE");
for (const NODE_ENV of ["development", "test"]) assert.equal(getPhoneVerificationMode({NODE_ENV,ALLOW_DEV_AUTH_LINKS:"true"}), "DEVELOPMENT_ONLY");
const state = { session: {userId:"test-user"}, trusted:true, verified:false, allowed:true, mutations:0, token:null, notification:null, mode:"UNAVAILABLE" };
const deps = {
 z,
 randomInt: () => 12345,
 apiError: (code,message,status) => Response.json({error:{code,message}},{status}),
 apiSuccess: (data,init) => Response.json({data},init),
 hashSecurityToken: (purpose,code) => `TEST_HASH_${purpose}_${code}`,
 hasTrustedMutationOrigin: () => state.trusted,
 getRequestSession: async () => state.session,
 getPhoneVerificationMode: () => state.mode,
 consumeIdentityRequestLimit: async () => ({allowed:state.allowed,retryAfterSeconds:60}),
 consumeConfirmationLimit: async () => ({allowed:state.allowed,retryAfterSeconds:60}),
 recordUserEvent: async () => {},
 prisma: {
  user:{findUnique:async()=>({id:"test-user",phone:"+8801700000000",locale:"en",phoneVerifiedAt:state.verified ? new Date() : null})},
  $transaction:async callback=>{ state.mutations++; return callback({
   securityToken:{updateMany:async()=>({count:1}),create:async({data})=>{state.token={id:"test-token",...data};return state.token;},findUnique:async()=>state.token},
   notification:{create:async({data})=>{state.notification=data;}},
   user:{update:async()=>{state.verified=true;}}, auditLog:{create:async()=>{}}
  });}
 }
};
const symbol = Symbol.for("deshdak-phone-test-deps"); globalThis[symbol] = deps;
async function handler(relative) {
 const source=stripTypeScriptTypes(await loadCode(relative));
 return (await load(`const {${Object.keys(deps).join(",")}}=globalThis[Symbol.for("deshdak-phone-test-deps")];\n${source}`)).POST;
}
try {
 const requestCode=await handler("../src/app/api/v1/account/phone-verification/request/route.ts");
 const confirmCode=await handler("../src/app/api/v1/account/phone-verification/confirm/route.ts");
 const request=()=>new Request("https://app.example.test/api/v1/account/phone-verification/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:"012345"})});
 for (const handler of [requestCode,confirmCode]) {
  state.session=null; assert.equal((await handler(request())).status,401); state.session={userId:"test-user"};
  state.trusted=false; assert.equal((await handler(request())).status,403); state.trusted=true;
  const response=await handler(request()); assert.equal(response.status,503); assert.equal((await response.json()).error.code,"SMS_PROVIDER_NOT_CONFIGURED");
 }
 assert.equal(state.mutations,0);assert.equal(state.token,null);assert.equal(state.notification,null);
 state.verified=true;assert.equal((await requestCode(request())).status,200);state.verified=false;
 state.mode="DEVELOPMENT_ONLY";
 const badCode = new Request("https://app.example.test/api/v1/account/phone-verification/confirm", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:"wrong"})});
 assert.equal((await confirmCode(badCode)).status,422);assert.equal(state.mutations,0);
 state.allowed=false;
 assert.equal((await confirmCode(request())).status,429);assert.equal(state.mutations,0);
 const limited=await requestCode(request());assert.equal(limited.status,429);assert.equal(limited.headers.get("Retry-After"),"60");assert.equal(state.mutations,0);
 state.allowed=true;
 const generated=await requestCode(request());assert.equal(generated.status,200);assert.match(generated.headers.get("Cache-Control"),/no-store/);
 const {data}=await generated.json();assert.equal(data.developmentCode,"012345");assert.equal(data.deliveryStatus,"DEVELOPMENT_ONLY");
 assert(!JSON.stringify(state.token).includes('"012345"'));assert.match(state.notification.body,/No SMS was sent/);
 assert.deepEqual(state.notification.deliveries.create.map(({channel})=>channel),["IN_APP"]);
 state.token={...state.token,userId:"test-user",purpose:"PHONE_VERIFICATION",usedAt:null,expiresAt:new Date(Date.now()+60000)};
 assert.equal((await confirmCode(request())).status,200);assert.equal(state.verified,true);
 // Even an outstanding local token cannot be confirmed after delivery becomes unavailable.
 state.mode="UNAVAILABLE";const prior=state.mutations;assert.equal((await confirmCode(request())).status,503);assert.equal(state.mutations,prior);
 const componentSource=await readFile(new URL("../src/components/identity-verification-panel.tsx",import.meta.url),"utf8");
 let js=ts.transpileModule(componentSource,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace('from "react/jsx-runtime"',`from ${JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)}`).replace('from "react"',`from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)}`).replace(/import \{ useRouter \} from "next\/navigation";/,'const useRouter=()=>({refresh(){}});').replace(/import \{ useClientReady \} from "@\/components\/use-client-ready";/,'const useClientReady=()=>false;');
 const {IdentityVerificationPanel}=await load(js);
 const props={phone:"+8801700000000",phoneVerifiedAt:null,kycStatus:"NOT_REQUIRED",submissions:[],residenceCountryCode:"BD"};
 const unavailable=renderToStaticMarkup(React.createElement(IdentityVerificationPanel,{...props,phoneVerificationMode:"UNAVAILABLE"}));
 assert.match(unavailable,/Phone verification is temporarily unavailable/);assert(!unavailable.includes('name="code"'));assert(!unavailable.includes("Generate development code"));
 const local=renderToStaticMarkup(React.createElement(IdentityVerificationPanel,{...props,phoneVerificationMode:"DEVELOPMENT_ONLY"}));assert.match(local,/No text message will be sent/);assert.match(local,/Generate development code/);
 console.log("Phone verification availability passed: production cannot activate from keys/dev flag; protected request and confirm reject without writes; explicit local code, no SMS queue, rate limits, no-store and unavailable/development UI states. Route dependencies were simulated; no SMS sent.");
} finally { delete globalThis[symbol]; }
