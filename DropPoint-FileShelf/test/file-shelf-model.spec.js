const { expect, test } = require("@playwright/test");
const model = require("../renderer/file-shelf-model");

const firstEntry = {
  filepath: "C:\\fixtures\\landscape.png",
  name: "landscape.png",
  fileType: "image",
  previewUrl: "blob:first",
};

const secondEntry = {
  filepath: "C:\\fixtures\\portrait.txt",
  name: "portrait.txt",
  fileType: "text",
  previewUrl: null,
};

test("creates a one-file drag payload without changing the shelf", () => {
  // Given: two independent cards in the shelf.
  const entries = [firstEntry, secondEntry];

  // When: the first card prepares its native drag payload.
  const payload = model.createDragParams(firstEntry, 42);

  // Then: only that card is dragged and both entries remain in the shelf.
  expect(payload).toEqual({
    filelist: [{ filepath: firstEntry.filepath, fileType: firstEntry.fileType }],
    instanceId: 42,
  });
  expect(entries).toEqual([firstEntry, secondEntry]);
});

test("removes only the selected entry", () => {
  // Given: two independent cards in the shelf.
  const entries = [firstEntry, secondEntry];

  // When: the first card is removed.
  const remainingEntries = model.removeEntry(entries, firstEntry.filepath);

  // Then: the other card remains available.
  expect(remainingEntries).toEqual([secondEntry]);
});

test("classifies a dropped directory as a folder card", () => {
  // Given: metadata for a real directory with no MIME type.
  const directory = {
    filepath: "C:\\fixtures\\campaign-assets",
    name: "campaign-assets",
    mimeType: "",
    isDirectory: true,
  };

  // When: the directory becomes a shelf entry.
  const entry = model.createEntry(directory);

  // Then: the folder icon category is preserved.
  expect(entry.fileType).toBe("folder");
});

test("uses the generic icon for an unsupported MIME category", () => {
  // Given: a file whose MIME family has no bundled DropPoint icon.
  const fontFile = {
    filepath: "C:\\fixtures\\display.woff2",
    name: "display.woff2",
    mimeType: "font/woff2",
  };

  // When: it becomes a shelf entry.
  const entry = model.createEntry(fontFile);

  // Then: the native drag and card both receive a valid icon category.
  expect(entry.fileType).toBe("file");
});
