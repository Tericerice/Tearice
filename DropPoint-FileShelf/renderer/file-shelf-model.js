(function exposeFileShelfModel(root) {
  const supportedTypes = new Set(["audio", "image", "text", "video"]);

  const toFileType = (mimeType) => {
    const primaryType = mimeType.split("/")[0];
    return supportedTypes.has(primaryType) ? primaryType : "file";
  };

  const createEntry = ({ filepath, name, mimeType, isDirectory = false, previewUrl = null }) => ({
    filepath,
    name,
    fileType: isDirectory ? "folder" : toFileType(mimeType),
    previewUrl,
  });

  const appendUniqueEntries = (entries, incomingEntries) => {
    const knownPaths = new Set(entries.map((entry) => entry.filepath));
    return entries.concat(
      incomingEntries.filter((entry) => {
        if (knownPaths.has(entry.filepath)) return false;
        knownPaths.add(entry.filepath);
        return true;
      }),
    );
  };

  const createDragParams = (entry, instanceId) => ({
    filelist: [{ filepath: entry.filepath, fileType: entry.fileType }],
    instanceId,
  });

  const removeEntry = (entries, filepath) =>
    entries.filter((entry) => entry.filepath !== filepath);

  const model = { appendUniqueEntries, createDragParams, createEntry, removeEntry };

  if (typeof module !== "undefined" && module.exports) module.exports = model;
  root.DropPointFileShelf = model;
})(globalThis);
