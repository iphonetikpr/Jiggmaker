/**
 * String key/value seam used by presets.
 * The browser implementation is localStorage. A server backend can implement the same methods later
 * without changing preset logic.
 */
export interface StringStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export function memoryStore(seed: Record<string, string> = {}): StringStore {
  const data = { ...seed };
  return {
    read(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    write(key, value) {
      data[key] = value;
    },
  };
}

export function browserStore(storage: Pick<Storage, "getItem" | "setItem"> | null = globalThis.localStorage ?? null): StringStore {
  return {
    read(key) {
      try {
        return storage ? storage.getItem(key) : null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      if (!storage) throw new Error("No storage");
      storage.setItem(key, value);
    },
  };
}
