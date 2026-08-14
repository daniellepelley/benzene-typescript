import { serviceToken } from '@benzenejs/abstractions';

/**
 * The in-memory order store the HTTP handlers read/write — the example's stand-in for a database (the
 * .NET example's `InMemoryOrderDbClient`). Registered in `StartUp` and injected into the handlers.
 */
export interface Order {
  id: string;
  name: string;
}

export interface IOrderStore {
  add(order: Order): void;
  readonly orders: readonly Order[];
}

export const IOrderStore = serviceToken<IOrderStore>('IOrderStore');

export class InMemoryOrderStore implements IOrderStore {
  private readonly store: Order[] = [];

  add(order: Order): void {
    this.store.push(order);
  }

  get orders(): readonly Order[] {
    return this.store;
  }
}
