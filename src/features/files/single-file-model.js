import { store } from "../../state/store.js";

// Tek kaynak: regions.custom. importedFiles eski modelini runtime'da tamamen yok say.
function sanitizeState() {
  const state = store.get();
  if (Object.prototype.hasOwnProperty.call(state, "importedFiles")) delete state.importedFiles;
}

function cleanSnapshot(snapshot) {
  if (snapshot && typeof snapshot === "object") delete snapshot.importedFiles;
  return snapshot;
}

const originalSet = store.set.bind(store);
store.set = (patch = {}) => {
  const next = { ...patch };
  delete next.importedFiles;
  originalSet(next);
  sanitizeState();
};

const originalUpdate = store.update.bind(store);
store.update = (section, patch = {}) => {
  if (section === "importedFiles") return;
  originalUpdate(section, patch);
  sanitizeState();
};

const originalReplaceData = store.replaceData.bind(store);
store.replaceData = (data = {}, options = {}) => {
  const next = { ...data };
  delete next.importedFiles;
  originalReplaceData(next, options);
  sanitizeState();
};

const originalUndo = store.undo.bind(store);
store.undo = () => {
  const result = originalUndo();
  sanitizeState();
  return result;
};

const originalRedo = store.redo.bind(store);
store.redo = () => {
  const result = originalRedo();
  sanitizeState();
  return result;
};

const originalSnapshot = store.dataSnapshot.bind(store);
store.dataSnapshot = () => cleanSnapshot(originalSnapshot());

const originalLoadPersisted = store.loadPersisted.bind(store);
store.loadPersisted = (remoteState = {}) => {
  const data = { ...remoteState };
  delete data.importedFiles;
  originalLoadPersisted(data);
  sanitizeState();
};

sanitizeState();
