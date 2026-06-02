/**
 * Playwright fetch helper - runs as a Node.js child process.
 * Bun cannot connect to Playwright's CDP on Windows, so we spawn Node.js
 * to do the actual browser-based fetch.
 *
 * Usage: node playwright-fetch-helper.cjs <url> <timeoutMs>
 * Output: JSON on stdout { html, pageTitle } or empty for failure
 */
const { chromium } = require("playwright-core")

async function main() {
  const url = process.argv[2]
  const timeoutMs = parseInt(process.argv[3] || "60000", 10)

  if (!url) {
    console.log(JSON.stringify(null))
    process.exit(1)
  }

  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 30000,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    })

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    })
    const page = await context.newPage()

    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    })

    const status = response?.status() ?? 0
    if (status < 200 || status >= 400) {
      // Got non-success - still return the HTML (might be useful for debugging)
      const html = await page.content()
      const pageTitle = await page.title()
      await context.close()
      console.log(JSON.stringify({ html, pageTitle, status }))
      process.exit(0)
    }

    const html = await page.content()
    const pageTitle = await page.title()
    await context.close()
    console.log(JSON.stringify({ html, pageTitle, status }))
  } catch (e) {
    console.log(JSON.stringify(null))
    process.exit(1)
  } finally {
    if (browser) await browser.close()
  }
}

main()
