import { serviceToken } from '@benzene/abstractions';

/**
 * The stand-in "data store" the consumer's handlers write to, so a fire-and-forget Kafka consumer (which
 * returns no response over the wire) can still be observed end-to-end. The real deployable would use a
 * database; this mirrors the .NET example's `InMemoryOrderDbClient`.
 */
export interface Order {
  id: string;
  status: string;
  name: string;
}

export interface IOrderStore {
  add(order: Order): void;
  remove(id: string): void;
  readonly orders: readonly Order[];
}

export const IOrderStore = serviceToken<IOrderStore>('IOrderStore');

export class InMemoryOrderStore implements IOrderStore {
  private readonly store: Order[] = [];

  add(order: Order): void {
    this.store.push(order);
  }

  remove(id: string): void {
    const index = this.store.findIndex((o) => o.id === id);
    if (index >= 0) {
      this.store.splice(index, 1);
    }
  }

  get orders(): readonly Order[] {
    return this.store;
  }
}
