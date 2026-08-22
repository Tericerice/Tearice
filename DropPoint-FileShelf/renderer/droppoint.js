const instanceId = Number(new URLSearchParams(window.location.search).get("id"));
const { appendUniqueEntries, createDragParams, createEntry, removeEntry } =
  window.DropPointFileShelf;

let filelist = [];

const holder = document.querySelector("#droppoint");
const grid = document.querySelector(".file-grid");
const itemCount = document.querySelector(".item-count");
const clearAllButton = document.querySelector(".clear-all");

const revokePreview = (entry) => {
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
};

const renderFileCards = () => {
  grid.replaceChildren();

  for (const entry of filelist) {
    const card = document.createElement("article");
    card.className = "file-card";
    card.draggable = true;
    card.tabIndex = 0;
    card.title = entry.name;
    card.setAttribute("aria-label", `拖动 ${entry.name}`);

    card.addEventListener("dragstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.add("is-dragging");
      window.electron.dragOutListener(createDragParams(entry, instanceId));
    });

    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));

    const visual = document.createElement("div");
    visual.className = "file-card-visual";

    const image = document.createElement("img");
    image.alt = "";
    image.src = entry.previewUrl || `./media/${entry.fileType}.png`;
    if (entry.previewUrl) image.className = "preview";
    visual.append(image);

    const name = document.createElement("div");
    name.className = "file-card-name";
    name.textContent = entry.name;

    const removeButton = document.createElement("button");
    removeButton.className = "card-remove";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.title = `移除 ${entry.name}`;
    removeButton.setAttribute("aria-label", `移除 ${entry.name}`);
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      revokePreview(entry);
      filelist = removeEntry(filelist, entry.filepath);
      renderFileCards();
    });

    card.append(visual, name, removeButton);
    grid.append(card);
  }

  const hasFiles = filelist.length > 0;
  holder.classList.toggle("has-files", hasFiles);
  itemCount.textContent = `${filelist.length} 个项目`;
  clearAllButton.disabled = !hasFiles;
};

holder.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.stopPropagation();
  holder.classList.add("dragged");
});

holder.addEventListener("dragenter", (event) => {
  event.preventDefault();
  event.stopPropagation();
  holder.classList.add("dragged");
});

holder.addEventListener("dragleave", (event) => {
  event.preventDefault();
  event.stopPropagation();
  holder.classList.remove("dragged");
});

holder.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  holder.classList.remove("dragged");

  const incomingEntries = Array.from(event.dataTransfer.files, (file) => {
    const filepath = window.electron.getPathForFile(file);
    const isDirectory = window.electron.isDirectoryPath(filepath);
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    return createEntry({
      filepath,
      name: file.name,
      mimeType: file.type,
      isDirectory,
      previewUrl,
    });
  });

  const nextFilelist = appendUniqueEntries(filelist, incomingEntries);
  const acceptedEntries = new Set(nextFilelist);
  for (const entry of incomingEntries) {
    if (!acceptedEntries.has(entry)) revokePreview(entry);
  }
  filelist = nextFilelist;
  renderFileCards();
});

document.querySelector(".window-close").addEventListener("click", () => window.close());

clearAllButton.addEventListener("click", () => {
  filelist.forEach(revokePreview);
  filelist = [];
  renderFileCards();
});

window.addEventListener("beforeunload", () => filelist.forEach(revokePreview));

renderFileCards();
