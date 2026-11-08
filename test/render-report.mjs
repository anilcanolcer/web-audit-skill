import { chromium } from 'playwright-chromium';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEB_AUDIT_CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.argv[4] || 1280), height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(process.argv[2])).href);
  await page.screenshot({ path: resolve(process.argv[3]), fullPage: true });
  console.log(JSON.stringify({ title: await page.title(), heading: await page.locator('h1').textContent(), cards: await page.locator('.card').count(), fixes: await page.locator('.fix').count(), width: await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth })) }));
} finally { await browser.close(); }
