const puppeteer = require("puppeteer");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const EXTENSION_PATH = resolve(__dirname, "../Users/paolo/excat/glow/dist/extension");
const BMW_INDEX_PATH = resolve(__dirname, "../Users/paolo/excat/glow/data/www.bmwusa.com-demo.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    protocolTimeout: 60000,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=/tmp/glow-inplace-${Date.now()}`,
    ],
  });

  const swTarget = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().includes("service-worker"),
    { timeout: 10000 },
  );
  const extId = swTarget.url().match(/chrome-extension:\/\/([^/]+)/)[1];

  // Setup: import index and set API key
  const setupPage = await browser.newPage();
  await setupPage.goto(`chrome-extension://${extId}/panel/panel.html`, { waitUntil: "domcontentloaded" });
  await sleep(500);
  await setupPage.evaluate(`chrome.storage.local.set({ cerebras_api_key: "csk-hd95yw8mc843685x2rnfpekdkvkfppyfmvy253y6k5cctcdj" })`);
  const indexStr = readFileSync(BMW_INDEX_PATH, "utf8");
  await setupPage.evaluate(`new Promise(r => chrome.runtime.sendMessage({ type: "IMPORT_INDEX", index: ${indexStr} }, r))`);
  console.log("Index imported");

  // Navigate to bmwusa.com
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto("https://www.bmwusa.com/", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("BMW loaded");

  // Get original text
  const origText = await page.evaluate(() => {
    const h1 = document.querySelector("#container-6789079d29 .cmp-title__text");
    const p = document.querySelector("#container-6789079d29 .cmp-text__paragraph");
    return { h1: h1 ? h1.textContent.trim() : null, p: p ? p.textContent.trim().substring(0, 80) : null };
  });
  console.log("Original text:", JSON.stringify(origText));

  // Interact to generate signals
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
  await sleep(500);
  await page.mouse.move(400, 300);
  await sleep(600);
  await page.mouse.move(400, 400);
  await sleep(600);

  // Wait for signal processing + Cerebras generation
  await sleep(8000);

  // Check what happened
  const result = await page.evaluate(() => {
    const container = document.querySelector("#container-6789079d29");
    if (!container) return { error: "container not found" };
    const h1 = container.querySelector(".cmp-title__text");
    const p = container.querySelector(".cmp-text__paragraph");
    const overlay = container.querySelector(".glow-block-overlay");
    const badge = container.querySelector(".glow-badge");
    const modified = container.querySelectorAll("[data-glow-modified]");

    return {
      hasOverlay: overlay !== null,
      hasBadge: badge !== null,
      modifiedCount: modified.length,
      glowInjected: container.getAttribute("data-glow-injected"),
      currentH1: h1 ? h1.textContent.trim().substring(0, 80) : null,
      currentP: p ? p.textContent.trim().substring(0, 80) : null,
    };
  });
  console.log("Result:", JSON.stringify(result, null, 2));

  if (result.hasOverlay) {
    console.log("PROBLEM: Overlay div was injected (old behavior)");
  } else if (result.modifiedCount > 0) {
    console.log("SUCCESS: In-place text replacement working!");
  } else {
    console.log("No modifications detected — blocks may not have been generated");
  }

  await setupPage.close();
  await sleep(2000);
  await browser.close();
})();
