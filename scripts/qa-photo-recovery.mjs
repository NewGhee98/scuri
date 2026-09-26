// Synthetic, isolated recovery acceptance. Never uses existing browser storage
// or connects to live services. SCURI_BROWSER_RUNTIME contains playwright + sharp.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(process.env.SCURI_BROWSER_RUNTIME ? path.join(process.env.SCURI_BROWSER_RUNTIME, "package.json") : import.meta.url);
const { chromium } = require("playwright"), sharp = require("sharp");
const output = path.resolve(process.argv[2] ?? "artifacts/photo-recovery");
await mkdir(output, { recursive: true });
const origin = "http://localhost:3026";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await context.newPage(), errors = [], external = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || url.protocol === "blob:" || url.protocol === "data:") return route.continue();
  external.push(url.origin); return route.abort();
});
// Exercise Retry after the actual analysis client has disposed a failed worker.
await page.addInitScript(() => {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    postMessage(message, ...args) {
      if (message.kind === "analyse" && !sessionStorage.getItem("synthetic-worker-failed")) {
        sessionStorage.setItem("synthetic-worker-failed", "yes");
        queueMicrotask(() => this.dispatchEvent(new ErrorEvent("error", { message: "Synthetic analysis-worker failure" })));
        return;
      }
      return super.postMessage(message, ...args);
    }
  };
});
const report = { browser: "Desktop Chrome, isolated profile", syntheticPhotos: 87, physicalIPad: false };
const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("layouts.projects.v1") ?? '{"projects":[]}').projects[0]);
const activity = () => page.getByRole("dialog", { name: "Backups and activity", exact: true });
const openActivity = () => page.getByRole("button", { name: /Photos backed up:/ }).click();
const closeActivity = () => activity().getByRole("button", { name: "Close", exact: true }).click();
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "+ New project", exact: true }).click();
  await page.getByRole("button", { name: /Instagram Post/ }).click();
  await page.getByRole("dialog", { name: "Project photos", exact: true }).waitFor();
  const photos = [];
  for (let i = 0; i < 87; i++) {
    const width = i === 0 ? 6000 : 900 + i, height = i === 0 ? 4000 : 600;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g"><stop stop-color="hsl(${i * 31 % 360},55%,45%)"/><stop offset="1" stop-color="#eee"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="300" cy="300" r="${80 + i}" fill="#555"/></svg>`;
    photos.push({ name: `Photo-${String(i).padStart(3, "0")}.jpg`, mimeType: "image/jpeg", buffer: await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer() });
  }
  await page.locator("dialog input[type=file]").first().setInputFiles(photos);
  await openActivity();
  await page.waitForFunction(() => /87\/87 finished/.test(document.body.innerText), null, { timeout: 120000 });
  await activity().getByRole("button", { name: "Retry analysis", exact: true }).click({ timeout: 120000 });
  await page.waitForFunction(() => /87\/87 analysed/.test(document.body.innerText), null, { timeout: 120000 });
  report.failedWorkerRecoveredByRetry = true;
  const before = await read();
  assert.equal(before.photoLibrary.length, 87);
  const missingKeys = before.photoLibrary.slice(34).map(photo => photo.blobKey);
  await closeActivity();
  // Delete only this disposable test project's last 53 originals and all of
  // their derived previews/analysis. Keep every project/library record.
  await page.evaluate(async keys => {
    const edit = (name, storeName, operation) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(storeName, "readwrite");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
        operation(tx.objectStore(storeName));
      };
    });
    await edit("layouts-local-photos", "photos", store => keys.forEach(key => store.delete(key)));
    await edit("scuri-photo-cache-v1", "derived", store => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        if (keys.some(key => String(cursor.key).includes(key))) cursor.delete();
        cursor.continue();
      };
    });
  }, missingKeys);
  await page.reload();
  await page.locator(".project-library-open").first().click();
  await page.getByRole("button", { name: "Open Project photos", exact: true }).click();
  await openActivity();
  await page.waitForFunction(() => /34\/87 analysed/.test(document.body.innerText), null, { timeout: 120000 });
  await activity().getByRole("button", { name: "Retry analysis", exact: true }).waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(output, "34-of-87-before-recovery.png") });
  report.reproducedMissingOriginals = 53;
  // An unrelated file deliberately reuses a missing photo's name. Recovery
  // must reject it while safely restoring the entire exact batch.
  const wrong = { ...photos[0], name: photos[34].name, buffer: await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } }).jpeg().toBuffer() };
  await activity().getByLabel("Reselect original photos").setInputFiles([...photos, wrong]);
  await page.waitForFunction(() => /87\/87 analysed/.test(document.body.innerText) && /Nothing was added or replaced/.test(document.body.textContent), null, { timeout: 120000 });
  const after = await read();
  assert.deepEqual(after.photoLibrary, before.photoLibrary);
  assert.deepEqual(after.pages, before.pages);
  const savedHashes = await page.evaluate(async () => {
    const project = JSON.parse(localStorage.getItem("layouts.projects.v1")).projects[0];
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("layouts-local-photos"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const hashes = [];
    for (const photo of project.photoLibrary) {
      const blob = await new Promise((resolve, reject) => { const tx = db.transaction("photos"), request = tx.objectStore("photos").get(photo.blobKey); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      hashes.push(`sha256:${blob.size}:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`);
    }
    db.close(); return hashes;
  });
  assert.deepEqual(savedHashes, before.photoLibrary.map(photo => photo.fingerprint));
  report.allOriginalsRestoredByteForByte = true;
  report.libraryIdentitiesAndPagesPreserved = true;
  report.unrelatedSameNameFileRejected = true;
  await closeActivity();
  await page.getByRole("searchbox", { name: "Search photo filenames" }).fill("Photo-034");
  await page.waitForFunction(() => [...document.querySelectorAll(".library-photo-card img")].some(img => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, "restored-preview-without-reload.png") });
  report.previewRefreshedWithoutReload = true;
  await page.reload();
  assert.deepEqual((await read()).photoLibrary, before.photoLibrary);
  assert.equal(errors.length, 0, errors.join("\n")); assert.equal(external.length, 0, external.join("\n"));
  report.errors = errors; report.externalRequests = external; report.result = "PASS";
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  await writeFile(path.join(output, "failure.txt"), String(error) + "\n" + await page.locator("body").innerText());
  throw error;
} finally { await browser.close(); }
