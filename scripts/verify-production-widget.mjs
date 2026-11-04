import assert from "node:assert/strict";
import {chromium} from "@playwright/test";

const origin=new URL(process.env.WIDGET_BASE_URL??"http://127.0.0.1:3000");
if(!["localhost","127.0.0.1"].includes(origin.hostname)||origin.username||origin.password)throw Error("Widget checks require a disposable local production runtime.");
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext();
  const config=await context.request.get(new URL('/api/v1/auth/human-verification',origin).href);
  assert.equal(config.status(),200);assert.match(config.headers()['cache-control'],/no-store/);
  const {data}=await config.json();assert(data.siteKey);assert.deepEqual(Object.keys(data),['siteKey']);
  const page=await context.newPage();
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:`window.turnstile={render(element,options){element.dataset.rendered='true';element.dataset.action=options.action;window.__widgetSiteKey=options.sitekey;const input=document.createElement('input');input.type='hidden';input.name='cf-turnstile-response';input.value='synthetic-challenge-only';element.append(input);return 'synthetic-widget';},remove(){}};`}));
  for(const [path,action]of [['/login','login'],['/register','registration']]){
    await page.goto(new URL(path,origin).href);
    await page.locator(`[data-human-verification="${action}"][data-rendered="true"]`).waitFor({state:'attached'});
    assert.equal(await page.evaluate(()=>window.__widgetSiteKey),data.siteKey);
    assert.equal(await page.locator('input[name="cf-turnstile-response"]').count(),1);
  }
  await context.close();
  console.log('Production browser passed runtime CAPTCHA configuration and widget initialization. Provider script was mocked; no real CAPTCHA was solved.');
}finally{await browser.close();}
