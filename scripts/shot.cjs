const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto(process.env.URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(process.env.WAIT || 2500));
  const actions = (process.env.ACTIONS || '').split(';').filter(Boolean);
  for (const a of actions) {
    const [kind, arg, arg2] = a.split('|');
    if (kind === 'click') await page.click(arg);
    if (kind === 'text') await page.getByText(arg, { exact: false }).first().click();
    if (kind === 'wait') await page.waitForTimeout(Number(arg));
    if (kind === 'key') await page.keyboard.press(arg);
    if (kind === 'shot') await page.screenshot({ path: arg, fullPage: false });
    if (kind === 'mouse') await page.mouse.click(Number(arg), Number(arg2));
  }
  await page.screenshot({ path: process.env.OUT || '/tmp/claude-0/shot.png' });
  console.log(logs.slice(-30).join('\n'));
  await browser.close();
})();
