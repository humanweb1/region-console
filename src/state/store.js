const initialState = {
  auth: {
    status: "unknown",
    session: null,
    user: null
  },
  cloud: {
    status: "idle",
    version: null,
    error: null,
    updatedAt: null
  },
  regions: {
    countries: [],
    custom: [],
    selectedId: null
  },
  map: {
    drawing: false,
    layer: "standard"
  },
  history: {
    entries: [],
    cursor: -1
  },
  campaigns: [],
  ui: {
    theme: "dark",
    activeTool: "draw"
  }
};

let state = structuredClone(initialState);
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(state));
}

function snapshotData() {
  return structuredClone({
    regions: state.regions,
    campaigns: state.campaigns
  });
}

export const store = {
  get() {
    return state;
  },

  set(patch) {
    state = { ...state, ...patch };
    notify();
  },

  update(key, patch) {
    state = {
      ...state,
      [key]: {
        ...state[key],
        ...patch
      }
    };
    notify();
  },

  replaceData(data, { recordHistory = false, label = "Güncelleme" } = {}) {
    const before = snapshotData();
    state = {
      ...state,
      regions: structuredClone(data.regions || state.regions),
      campaigns: structuredClone(data.campaigns || state.campaigns)
    };
    if (recordHistory) {
      this.recordHistory(label, before, snapshotData());
    } else {
      notify();
    }
  },

  recordHistory(label, before, after) {
    const entries = state.history.entries.slice(0, state.history.cursor + 1);
    entries.push({
      id: crypto.randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      before: structuredClone(before),
      after: structuredClone(after)
    });
    const trimmed = entries.slice(-50);
    state = {
      ...state,
      history: {
        entries: trimmed,
        cursor: trimmed.length - 1
      }
    };
    notify();
  },

  undo() {
    const entry = state.history.entries[state.history.cursor];
    if (!entry) return false;
    state = {
      ...state,
      regions: structuredClone(entry.before.regions),
      campaigns: structuredClone(entry.before.campaigns),
      history: { ...state.history, cursor: state.history.cursor - 1 }
    };
    notify();
    return true;
  },

  redo() {
    const next = state.history.entries[state.history.cursor + 1];
    if (!next) return false;
    state = {
      ...state,
      regions: structuredClone(next.after.regions),
      campaigns: structuredClone(next.after.campaigns),
      history: { ...state.history, cursor: state.history.cursor + 1 }
    };
    notify();
    return true;
  },

  dataSnapshot() {
    return snapshotData();
  },

  loadPersisted(remoteState) {
    const data = remoteState || {};
    state = {
      ...state,
      regions: {
        countries: Array.isArray(data.countries) ? data.countries : [],
        custom: Array.isArray(data.custom) ? data.custom : [],
        selectedId: null
      },
      campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      history: {
        entries: Array.isArray(data.history) ? data.history.slice(-50) : [],
        cursor: Array.isArray(data.history) ? data.history.length - 1 : -1
      }
    };
    notify();
  },

  reset() {
    state = structuredClone(initialState);
    notify();
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
