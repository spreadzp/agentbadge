export declare abstract class Repository<T, TCreate = Omit<T, "id">, TUpdate = Partial<TCreate>> {
    abstract findById(id: string): Promise<T | null>;
    abstract list(opts?: {
        limit?: number;
        offset?: number;
    }): Promise<T[]>;
    abstract create(data: TCreate): Promise<T>;
    abstract update(id: string, data: TUpdate): Promise<T | null>;
    abstract delete(id: string): Promise<boolean>;
}
