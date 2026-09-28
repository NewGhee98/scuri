// Isolated local acceptance: synthetic photos only, all external origins blocked.
// Start the production build on port 3005. SCURI_BROWSER_RUNTIME contains playwright and sharp.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(process.env.SCURI_BROWSER_RUNTIME ? path.join(process.env.SCURI_BROWSER_RUNTIME, "package.json") : import.meta.url);
const { chromium } = require("playwright"), sharp = require("sharp");
const output = path.resolve(process.argv[2] ?? "artifacts/multi-photo-sidebar");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await context.newPage(), errors = [], external = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  if (["localhost", "127.0.0.1"].includes(url.hostname) || ["blob:", "data:"].includes(url.protocol)) return route.continue();
  external.push(url.origin); return route.abort();
});
const report = { browser: "Isolated desktop Chrome with touch support", physicalIPad: false, checks: [] };
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("layouts.projects.v1") ?? '{"projects":[]}').projects[0]);
const card = index => page.locator(".library-photo-card").filter({ has: page.locator(".library-photo-name", { hasText: `Batch-${index}.jpg` }) });
const names = () => page.locator(".library-photo-name").allTextContents();
const footer = () => page.getByRole("region", { name: "Add selected photos", exact: true });
const toggle = index => card(index).getByRole("button", { name: new RegExp(`^Select Batch-${index}\\.jpg`) }).tap();
const waitSaved = async predicate => {
  for (let i = 0; i < 80; i++) { const value = await saved(); if (value && predicate(value)) return value; await page.waitForTimeout(100); }
  throw Error("Saved project did not reach expected state");
};
const inspect = async index => { await card(index).locator("button").first().click(); await page.getByRole("complementary", { name: "Photo categories" }).waitFor(); };
const showControls = async () => {
  if (!await page.getByRole("complementary", { name: "Editing controls", exact: true }).count()) await page.getByRole("button", { name: "Controls", exact: true }).click();
  await page.getByRole("complementary", { name: "Editing controls", exact: true }).waitFor();
};
const lockControls = async () => {
  await showControls();
  const button = page.getByRole("button", { name: "Lock controls", exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
};
const tapFrame = async frame => {
  const rect = await page.getByRole("application").boundingBox();
  assert(rect);
  const points = { 1: [.5, .3], 2: [.25, .81], 3: [.75, .81] };
  await page.mouse.click(rect.x + rect.width * points[frame][0], rect.y + rect.height * points[frame][1]);
};
const openScuri = async () => {
  await page.getByRole("button", { name: "Scuri photos", exact: true }).click();
  await footer().waitFor();
};
const confirmSelection = async count => {
  await footer().getByRole("button", { name: `Add ${count} photo${count === 1 ? "" : "s"}`, exact: true }).click();
  await page.locator(".photo-library-dialog[open]").waitFor({ state: "hidden" });
};
const hashes = keys => page.evaluate(async keys => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("layouts-local-photos");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const result = {};
  try {
    for (const key of keys) {
      const blob = await new Promise((resolve, reject) => {
        const request = db.transaction("photos", "readonly").objectStore("photos").get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (!blob) throw Error(`Original missing: ${key}`);
      result[key] = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    }
    return result;
  } finally { db.close(); }
}, keys);

try {
  await page.goto("http://localhost:3005");
  await page.getByRole("button", { name: "+ New project", exact: true }).click();
  await page.getByRole("button", { name: /Instagram Post/ }).click();
  await page.getByRole("dialog", { name: "Project photos", exact: true }).waitFor();
  const photos = [];
  for (let i = 0; i < 5; i++) photos.push({ name: `Batch-${i}.jpg`, mimeType: "image/jpeg", buffer: await sharp({ create: {
    width: 600, height: 800, channels: 3, background: { r: 30 + i * 42, g: 75 + i * 12, b: 190 - i * 25 },
  } }).jpeg().toBuffer() });
  await page.locator("dialog input[type=file]").first().setInputFiles(photos);
  const imported = await waitSaved(project => project.photoLibrary?.length === 5);
  await page.waitForFunction(() => document.querySelectorAll(".library-photo-card img").length === 5);
  const originalHashes = await hashes(imported.photoLibrary.map(photo => photo.blobKey));
  const key = index => imported.photoLibrary.find(photo => photo.sourceName === `Batch-${index}.jpg`).blobKey;

  for (const index of [0, 1, 3]) {
    await inspect(index);
    if (index < 2) await page.getByRole("button", { name: "Hero", exact: true }).click();
    if (index !== 1) {
      await page.getByRole("combobox", { name: "Add a label", exact: true }).fill("travel");
      await page.getByRole("combobox", { name: "Add a label", exact: true }).press("Enter");
    }
    await page.getByRole("button", { name: "Back to photos", exact: true }).click();
  }
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("dialog", { name: "Filters", exact: true }).getByRole("button", { name: "Untagged", exact: true }).click();
  await page.getByRole("dialog", { name: "Filters", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  assert.deepEqual((await names()).sort(), ["Batch-1.jpg", "Batch-2.jpg", "Batch-4.jpg"]);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("dialog", { name: "Filters", exact: true }).getByRole("button", { name: "Hero", exact: true }).click();
  await page.getByRole("dialog", { name: "Filters", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  assert.deepEqual(await names(), ["Batch-1.jpg"]);
  report.checks.push("Untagged means no custom labels, includes ranked photos and combines with rank filters");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  const libraryBefore = (await waitSaved(project => project.photoLibrary.find(photo => photo.blobKey === key(3))?.labels?.includes("travel"))).photoLibrary;
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: /^\+ Add page/ }).click();
  await page.getByRole("button", { name: /^Hero trio/ }).click();
  await lockControls();
  await tapFrame(1); await openScuri();
  await toggle(2); await toggle(0);
  assert.match(await footer().innerText(), /2 of 3 selected/);
  await page.getByRole("searchbox", { name: "Search photo filenames" }).fill("Batch-1");
  assert.match(await footer().innerText(), /0 of 3 selected/);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await toggle(2);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual((await saved()).pages[0].photos, {});
  await tapFrame(1); await openScuri();
  assert.match(await footer().innerText(), /0 of 3 selected/);
  report.checks.push("Filter changes and cancel/reopen clear pending selection without changing the page");

  for (const index of [2, 0, 4]) await toggle(index);
  assert.match(await footer().innerText(), /3 of 3 selected/);
  await toggle(1);
  assert.match(await footer().innerText(), /3 of 3 selected/);
  assert.equal(await card(1).getByRole("button", { name: /^Select Batch-1\.jpg/ }).getAttribute("aria-pressed"), "false", "selection stops at page capacity");
  await page.screenshot({ path: path.join(output, "multi-photo-picker.png") });
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("dialog", { name: "View", exact: true }).getByLabel(/Thumbnails/).selectOption("small");
  await page.getByRole("dialog", { name: "View", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Custom order", exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(output, "multi-photo-picker-small-custom.png") });
  const smallImage = await card(0).locator(".library-photo-image").boundingBox();
  assert(smallImage && smallImage.height >= 48, "Small thumbnails keep a usable image above preview and order controls");
  assert(await card(0).getByRole("button", { name: "Preview Batch-0.jpg", exact: true }).isVisible());
  await page.getByRole("button", { name: "Custom order", exact: true }).click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("dialog", { name: "View", exact: true }).getByLabel(/Thumbnails/).selectOption("medium");
  await page.getByRole("dialog", { name: "View", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  const pickerFooter = await footer().boundingBox();
  assert(pickerFooter && pickerFooter.x >= 0 && pickerFooter.x + pickerFooter.width <= 391 && pickerFooter.y + pickerFooter.height <= 845);
  assert(await footer().getByRole("button", { name: "Add 3 photos", exact: true }).isVisible());
  await page.screenshot({ path: path.join(output, "multi-photo-picker-phone.png") });
  await page.setViewportSize({ width: 1180, height: 820 });
  await confirmSelection(3);
  const placed = await waitSaved(project => Object.keys(project.pages[0].photos).length === 3);
  assert.deepEqual(Object.fromEntries(Object.entries(placed.pages[0].photos).map(([id, photo]) => [id, photo.blobKey])), {
    "photo-1": key(2), "photo-2": key(0), "photo-3": key(4),
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await waitSaved(project => Object.keys(project.pages[0].photos).length === 0);
  report.checks.push("Three photos add in tap order, capacity is enforced and one Undo removes the full batch");

  await tapFrame(1); await openScuri(); await toggle(4); await confirmSelection(1);
  await waitSaved(project => project.pages[0].photos["photo-1"]?.blobKey === key(4));
  await lockControls();
  const zoom = page.getByRole("textbox", { name: "Photo zoom percentage", exact: true });
  await zoom.fill("-20"); await zoom.press("Enter");
  const cropped = await waitSaved(project => project.pages[0].photos["photo-1"]?.crop.zoom === .8);
  const retained = cropped.pages[0].photos["photo-1"];
  await tapFrame(3); await openScuri();
  assert.match(await footer().innerText(), /0 of 2 selected/);
  await toggle(2); await toggle(0); await confirmSelection(2);
  const wrapped = await waitSaved(project => Object.keys(project.pages[0].photos).length === 3);
  assert.deepEqual(wrapped.pages[0].photos["photo-1"], retained);
  assert.equal(wrapped.pages[0].photos["photo-3"].blobKey, key(2));
  assert.equal(wrapped.pages[0].photos["photo-2"].blobKey, key(0));
  assert.deepEqual(wrapped.photoLibrary, libraryBefore);
  report.checks.push("Batch starts at the tapped frame, wraps into empty frames and preserves occupied photo and crop");

  const composition = (await saved()).pages;
  await lockControls();
  for (const viewport of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(250);
    const panel = await page.getByRole("complementary", { name: "Editing controls", exact: true }).boundingBox();
    const stage = await page.locator(".canvas-viewport-stage").boundingBox();
    const canvas = await page.getByRole("application").boundingBox();
    assert(panel && stage && canvas);
    if (viewport.width >= 700) assert(stage.x + stage.width <= panel.x + 2, "docked controls must not cover the canvas stage");
    else assert(stage.y + stage.height <= panel.y + 2, "phone controls dock below the canvas stage");
    assert(canvas.x >= stage.x - 1 && canvas.x + canvas.width <= stage.x + stage.width + 1, "Fit must follow the docked canvas width");
    assert(canvas.y >= stage.y - 1 && canvas.y + canvas.height <= stage.y + stage.height + 1, "Fit must follow the docked canvas height");
    assert(panel.x >= 0 && panel.x + panel.width <= viewport.width + 1);
    await page.screenshot({ path: path.join(output, `docked-sidebar-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(250);
  await tapFrame(1);
  assert(await page.getByRole("complementary", { name: "Editing controls", exact: true }).isVisible());
  await page.keyboard.press("Escape");
  assert(await page.getByRole("complementary", { name: "Editing controls", exact: true }).isVisible());
  const narrow = await page.locator(".canvas-viewport-stage").boundingBox();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.waitForTimeout(250);
  const wide = await page.locator(".canvas-viewport-stage").boundingBox();
  assert(wide.width > narrow.width + 200);
  assert.deepEqual((await saved()).pages, composition);
  await showControls();
  assert.equal(await page.getByRole("button", { name: "Lock controls", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Lock controls", exact: true }).click();
  await tapFrame(1);
  await page.getByRole("complementary", { name: "Editing controls", exact: true }).waitFor({ state: "hidden" });
  await lockControls();
  await page.getByRole("button", { name: "← Pages", exact: true }).click();
  await page.locator(".project-page-card").first().getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Lock controls", exact: true }).getAttribute("aria-pressed"), "true");
  report.checks.push("Docked controls reserve space at desktop/iPad/phone sizes; Fit follows available space; locked controls persist, unlocked stage tap hides, explicit Hide reclaims space");

  const beforeReload = await saved();
  await page.reload();
  await page.locator(".project-library-open").first().click();
  await page.locator(".project-page-card").first().getByRole("button", { name: "Edit", exact: true }).click();
  const afterReload = await saved();
  assert.deepEqual(afterReload.pages, beforeReload.pages);
  assert.deepEqual(afterReload.photoLibrary, beforeReload.photoLibrary);
  assert.deepEqual(await hashes(imported.photoLibrary.map(photo => photo.blobKey)), originalHashes);
  report.checks.push("Reload retains assignments, crop, ranks and labels; all original image SHA-256 hashes remain unchanged");
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  report.errors = errors; report.externalRequests = external;
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  console.error(error); console.error({ errors, external }); process.exitCode = 1;
} finally { await browser.close(); }
