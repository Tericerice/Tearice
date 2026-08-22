const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron, expect, test } = require("@playwright/test");

const APP_ROOT = path.join(__dirname, "..");
let electronApp;
let fixtureDirectory;
let shelf;

test.beforeEach(async () => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "droppoint-cards-"));
  fs.writeFileSync(path.join(fixtureDirectory, "landscape.png"), "png fixture");
  fs.writeFileSync(path.join(fixtureDirectory, "portrait.txt"), "text fixture");

  electronApp = await electron.launch({
    args: [APP_ROOT, "--no-sandbox", "--disable-gpu"],
  });
  await expect
    .poll(() => electronApp.windows().map((window) => window.url()))
    .toContainEqual(expect.stringContaining("/static/index.html"));

  shelf = electronApp.windows().find((window) => window.url().includes("/static/index.html"));
  await shelf.waitForLoadState("domcontentloaded");

  await shelf.locator("body").evaluate((body) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.dataset.testFilePicker = "";
    input.hidden = true;
    body.append(input);
  });
});

test.afterEach(async () => {
  const electronProcess = electronApp.process();
  const exited = new Promise((resolve) => electronProcess.once("exit", resolve));
  electronProcess.kill("SIGKILL");
  await exited;
  fs.rmSync(fixtureDirectory, { force: true, recursive: true });
});

const dropFixtureFiles = async () => {
  const picker = shelf.locator("input[data-test-file-picker]");
  await picker.setInputFiles([
    path.join(fixtureDirectory, "landscape.png"),
    path.join(fixtureDirectory, "portrait.txt"),
  ]);
  await picker.evaluate((input) => {
    const transfer = new DataTransfer();
    for (const file of input.files) transfer.items.add(file);
    document.querySelector("#droppoint").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
};

test("renders every dropped file as a separate card", async () => {
  // Given: a real DropPoint window with two files selected by Chromium.

  // When: both files are dropped into the shelf.
  await dropFixtureFiles();

  // Then: each file has its own visible card and filename.
  await expect(shelf.locator(".file-card")).toHaveCount(2);
  await expect(shelf.locator(".file-card-name")).toHaveText([
    "landscape.png",
    "portrait.txt",
  ]);
});

test("drags one card without removing either shelf entry", async () => {
  // Given: two cards and an IPC observer in place of the native OS drag.
  await dropFixtureFiles();
  await electronApp.evaluate(({ ipcMain }) => {
    globalThis.__lastFileShelfDrag = null;
    ipcMain.removeAllListeners("ondragstart");
    ipcMain.on("ondragstart", (_event, params) => {
      globalThis.__lastFileShelfDrag = params;
    });
  });

  // When: the first card starts a drag.
  await shelf.locator(".file-card").first().dispatchEvent("dragstart");

  // Then: IPC receives one file and both cards remain visible.
  await expect
    .poll(() => electronApp.evaluate(() => globalThis.__lastFileShelfDrag))
    .toMatchObject({
      filelist: [{ fileType: "image" }],
    });
  await expect(shelf.locator(".file-card")).toHaveCount(2);
});

test("removes only the chosen card", async () => {
  // Given: two independent cards in the shelf.
  await dropFixtureFiles();

  // When: the first card's remove control is pressed.
  const firstCard = shelf.locator(".file-card").first();
  await firstCard.hover();
  await firstCard.locator(".card-remove").click();

  // Then: only the other filename remains.
  await expect(shelf.locator(".file-card-name")).toHaveText(["portrait.txt"]);
});

test("clears every card when clear all is pressed", async () => {
  // Given: two independent cards in the shelf.
  await dropFixtureFiles();

  // When: the user presses the clear-all control.
  await shelf.locator(".clear-all").click();

  // Then: the shelf returns to its empty state.
  await expect(shelf.locator(".file-card")).toHaveCount(0);
  await expect(shelf.locator(".empty-state")).toBeVisible();
});
