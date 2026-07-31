// Cartridge save data, namespaced per game in localStorage.
// Private browsing and blocked storage are treated as "the battery is dead":
// the game keeps working, it just forgets.

const PREFIX = 'handheld:';

function backing() {
  try {
    const probe = `${PREFIX}__probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export class Save {
  constructor(namespace) {
    this.key = PREFIX + namespace;
    this.store = backing();
    this.data = this.read();
  }

  read() {
    if (!this.store) return {};
    try {
      return JSON.parse(this.store.getItem(this.key) || '{}');
    } catch {
      return {};
    }
  }

  get(field, fallback = null) {
    return field in this.data ? this.data[field] : fallback;
  }

  set(field, value) {
    this.data[field] = value;
    this.flush();
    return value;
  }

  update(fields) {
    Object.assign(this.data, fields);
    this.flush();
  }

  clear() {
    this.data = {};
    if (this.store) this.store.removeItem(this.key);
  }

  flush() {
    if (!this.store) return;
    try {
      this.store.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* out of quota: keep playing, just do not persist */
    }
  }

  /** True when saves actually persist; the UI mentions it if they do not. */
  get persistent() {
    return this.store !== null;
  }
}
