import { HingeError } from "./errors.js";

export interface HingeStorage {
  exists(key: string): Promise<boolean>;
  readText(key: string): Promise<string | undefined>;
  writeText(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface SecretStore {
  setSecret(key: string, secret: string): Promise<void>;
  getSecret(key: string): Promise<string | undefined>;
}

export class MemoryStorage implements HingeStorage, SecretStore {
  private readonly values = new Map<string, string>();

  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }

  async readText(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async writeText(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async setSecret(key: string, secret: string): Promise<void> {
    this.values.set(`secret:${key}`, secret);
  }

  async getSecret(key: string): Promise<string | undefined> {
    return this.values.get(`secret:${key}`);
  }
}

export class BrowserStorage implements HingeStorage {
  constructor(private readonly prefix = "hinge-ts:") {}

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  private getLocalStorage(): Storage {
    if (typeof globalThis.localStorage === "undefined") {
      throw new HingeError("unsupported_runtime", "localStorage is not available");
    }
    return globalThis.localStorage;
  }

  async exists(key: string): Promise<boolean> {
    return this.getLocalStorage().getItem(this.key(key)) !== null;
  }

  async readText(key: string): Promise<string | undefined> {
    return this.getLocalStorage().getItem(this.key(key)) ?? undefined;
  }

  async writeText(key: string, value: string): Promise<void> {
    this.getLocalStorage().setItem(this.key(key), value);
  }

  async remove(key: string): Promise<void> {
    this.getLocalStorage().removeItem(this.key(key));
  }
}

export class BrowserSecretStore implements SecretStore {
  constructor(private readonly storage = new BrowserStorage("hinge-ts-secret:")) {}

  async setSecret(key: string, secret: string): Promise<void> {
    await this.storage.writeText(key, secret);
  }

  async getSecret(key: string): Promise<string | undefined> {
    return this.storage.readText(key);
  }
}
