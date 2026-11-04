import {test,expect} from "./fixtures";
test.use({trace:"off",screenshot:"off"});

test.beforeEach(async({page})=>{
  await page.route('**/api/v1/auth/human-verification',route=>route.fulfill({json:{data:{siteKey:'synthetic-public-site-key'}}}));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'application/javascript',body:`window.__captchaResets=0;window.turnstile={render(element){element.dataset.rendered='true';const input=document.createElement('input');input.name='cf-turnstile-response';input.type='hidden';input.value='synthetic-challenge';element.append(input);return 'fixture-widget';},reset(){window.__captchaResets++;},remove(){}};`}));
});

test('Customer authentication sign-in recovers from connection and malformed responses',async({page})=>{
  await page.goto('/login');
  await page.locator('[data-human-verification="login"][data-rendered="true"]').waitFor({state:'attached'});
  await page.getByLabel('Email address',{exact:true}).fill('connection-fixture@example.test');
  await page.getByLabel('Password',{exact:true}).fill('Synthetic-password-only-123!');
  await page.route('**/api/v1/auth/login',route=>route.abort('failed'));
  const button=page.getByRole('button',{name:'Sign in securely',exact:true});
  await button.click();await expect(page.locator('form.customer-auth-card').getByRole('alert')).toContainText('Check your connection');await expect(button).toBeEnabled();
  await expect(page.getByLabel('Email address',{exact:true})).toHaveValue('connection-fixture@example.test');
  expect(await page.evaluate(()=>(window as Window&{__captchaResets:number}).__captchaResets)).toBeGreaterThan(0);
  await page.unroute('**/api/v1/auth/login');
  await page.route('**/api/v1/auth/login',route=>route.fulfill({status:502,contentType:'text/html',body:'Synthetic gateway failure'}));
  await button.click();await expect(page.locator('form.customer-auth-card').getByRole('alert')).toContainText('Check your connection');await expect(button).toBeEnabled();
});

test('Customer authentication signup handles lost response and verification interruption',async({page})=>{
  await page.goto('/register');
  await page.locator('[data-human-verification="registration"][data-rendered="true"]').waitFor({state:'attached'});
  await page.getByLabel('Full name',{exact:true}).fill('Synthetic connection customer');
  await page.getByLabel('Email address',{exact:true}).fill('signup-fixture@example.test');
  await page.getByLabel('Phone number',{exact:true}).fill('+8801700000000');
  await page.getByLabel('Create password',{exact:true}).fill('Synthetic-password-only-123!');
  await page.route('**/api/v1/auth/register',route=>route.abort('failed'));
  const button=page.getByRole('button',{name:'Create account',exact:true});
  await button.click();await expect(page.locator('form.customer-auth-card').getByRole('alert')).toContainText('Account creation could not be confirmed');await expect(button).toBeEnabled();
  await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Synthetic connection customer');
  expect(await page.evaluate(()=>(window as Window&{__captchaResets:number}).__captchaResets)).toBeGreaterThan(0);
  await page.unroute('**/api/v1/auth/register');
  await page.route('**/api/v1/auth/register',route=>route.fulfill({status:201,json:{data:{developmentVerificationUrl:'http://localhost/verify-email#token=synthetic-verification'}}}));
  await page.route('**/api/v1/auth/email-verification/confirm',route=>route.abort('failed'));
  await button.click();await expect(page.locator('form.customer-auth-card').getByRole('alert')).toContainText('do not register again');await expect(button).toBeEnabled();
});
