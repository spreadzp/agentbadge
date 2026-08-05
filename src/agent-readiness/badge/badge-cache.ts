export interface CacheEntry {
  svg: string;
  generatedAt: string;
  reportId: string;
}

export class BadgeCache {
  private store = new Map<string, CacheEntry>();

  get(scope: string): CacheEntry | undefined {
    return this.store.get(scope);
  }

  set(scope: string, entry: CacheEntry): void {
    this.store.set(scope, entry);
  }

  has(scope: string): boolean {
    return this.store.has(scope);
  }

  invalidate(scope: string): boolean {
    return this.store.delete(scope);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
