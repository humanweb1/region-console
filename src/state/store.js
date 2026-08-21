const initialState = {
  auth: {
    status: "unknown",
    session: null,
    user: null
  },
  cloud: {
    status: "idle",
    version: null,
    error: null
  },
  regions: {
    countries: [],
    custom: [],
    selectedId: null
  },
  map: {
    drawing: false,
    layer: "map"
  },
  ui: {
    theme: "dark",
    activeTool: "draw"
  }
};

let state = structuredClone(initialState);
const listeners = new Set();

export const store = {
  get() {
    return state;
  },

  set(patch) {
    state = {
      ...state,
      ...patch
    };
    listeners.forEach((listener) => listener(state));
  },

  update(key, patch) {
    state = {
      ...state,
      [key]: {
        ...state[key],
        ...patch
      }
    };
    listeners.forEach((listener) => listener(state));
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  reset() {
    state = structuredClone(initialState);
    listeners.forEach((listener) => listener(state));
  }
};
