const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright");

const APP_ROOT = path.join(__dirname, "..");
const OUTPUT_DIRECTORY = path.join(APP_ROOT, "test-results", "visual-qa");

const pngMetadata = (filename) => {
  const data = fs.readFileSync(filename);
  return {
    filename: path.basename(filename),
    pngSignature: data.subarray(1, 4).toString("ascii") === "PNG",
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    alphaChannel: data[25] === 4 || data[25] === 6,
    bytes: data.length,
  };
};

const capture = async (page, name) => {
  const filename = path.join(OUTPUT_DIRECTORY, name);
  await page.screenshot({ path: filename, omitBackground: true });
  return pngMetadata(filename);
};

const addFixtureFiles = async (page, fixturePaths) => {
  await page.locator("body").evaluate((body) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.dataset.visualQaPicker = "";
    input.hidden = true;
    body.append(input);
  });

  const picker = page.locator("input[data-visual-qa-picker]");
  await picker.setInputFiles(fixturePaths);
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

const findShelfWindow = async (electronApp) => {
  const existing = electronApp.windows().find((window) => window.url().includes("index.html"));
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      electronApp.off("window", inspect);
      reject(new Error("Timed out waiting for the FileShelf window"));
    }, 30_000);

    const inspect = (window) => {
      const acceptShelf = () => {
        if (!window.url().includes("index.html")) return;
        clearTimeout(deadline);
        electronApp.off("window", inspect);
        resolve(window);
      };
      acceptShelf();
      window.on("framenavigated", acceptShelf);
    };

    electronApp.on("window", inspect);
    electronApp.windows().forEach(inspect);
  });
};

const main = async () => {
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fileshelf-visual-"));
  const textPath = path.join(fixtureDirectory, "campaign-notes.txt");
  const pdfPath = path.join(fixtureDirectory, "brief-v3.pdf");
  const audioPath = path.join(fixtureDirectory, "voice-note.mp3");
  fs.writeFileSync(textPath, "Independent card visual fixture.");
  fs.writeFileSync(pdfPath, "%PDF-1.4 visual fixture");
  fs.writeFileSync(audioPath, "audio fixture");

  const electronApp = await electron.launch({
    args: [APP_ROOT, "--no-sandbox", "--disable-gpu"],
  });

  try {
    const shelf = await findShelfWindow(electronApp);
    await shelf.waitForLoadState("domcontentloaded");

    const captures = [await capture(shelf, "01-empty.png")];
    await addFixtureFiles(shelf, [
      path.join(APP_ROOT, "static", "media", "droppoint-social-cover.jpg"),
      path.join(APP_ROOT, "static", "media", "text.png"),
      textPath,
      pdfPath,
      audioPath,
    ]);
    await shelf.locator(".file-card").first().waitFor();
    captures.push(await capture(shelf, "02-populated-rest.png"));

    await shelf.locator(".file-card").first().hover();
    captures.push(await capture(shelf, "03-card-hover-mid.png"));
    await shelf.waitForFunction(
      () => getComputedStyle(document.querySelector(".card-remove")).opacity === "1",
    );
    captures.push(await capture(shelf, "04-card-hover-settled.png"));

    await shelf.mouse.move(220, 28);
    await shelf.waitForFunction(
      () => getComputedStyle(document.querySelector(".card-remove")).opacity === "0",
    );
    await shelf.locator(".file-card").nth(1).focus();
    await shelf.waitForFunction(
      () => getComputedStyle(document.querySelectorAll(".card-remove")[1]).opacity === "1",
    );
    captures.push(await capture(shelf, "05-keyboard-focus.png"));

    await electronApp.evaluate(({ ipcMain }) => {
      globalThis.__visualQaDrag = null;
      ipcMain.removeAllListeners("ondragstart");
      ipcMain.on("ondragstart", (_event, params) => {
        globalThis.__visualQaDrag = params;
      });
    });
    await shelf.mouse.move(220, 28);
    await shelf.evaluate(() => document.activeElement.blur());
    await shelf.waitForFunction(() =>
      Array.from(document.querySelectorAll(".card-remove")).every(
        (button) => getComputedStyle(button).opacity === "0",
      ),
    );
    await shelf.locator(".file-card").first().dispatchEvent("dragstart");
    captures.push(await capture(shelf, "06-single-card-drag.png"));

    const report = {
      capturedAt: new Date().toISOString(),
      cardCount: await shelf.locator(".file-card").count(),
      dragParams: await electronApp.evaluate(() => globalThis.__visualQaDrag),
      captures,
    };
    fs.writeFileSync(
      path.join(OUTPUT_DIRECTORY, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    const electronProcess = electronApp.process();
    const exited = new Promise((resolve) => electronProcess.once("exit", resolve));
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exited;
    fs.rmSync(fixtureDirectory, { force: true, recursive: true });
  }
};

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
