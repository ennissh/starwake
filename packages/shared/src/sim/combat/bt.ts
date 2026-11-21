/** A tiny behaviour-tree kit (PLAN §1.5: one tree per hull class). Deterministic, allocation-light. */
export type Status = 'success' | 'failure' | 'running';
export type BtNode<C> = (c: C) => Status;

/** First child that doesn't fail wins. */
export const selector =
  <C>(...children: BtNode<C>[]): BtNode<C> =>
  (c) => {
    for (const n of children) {
      const s = n(c);
      if (s !== 'failure') return s;
    }
    return 'failure';
  };

/** Children in order until one doesn't succeed. */
export const sequence =
  <C>(...children: BtNode<C>[]): BtNode<C> =>
  (c) => {
    for (const n of children) {
      const s = n(c);
      if (s !== 'success') return s;
    }
    return 'success';
  };

export const condition =
  <C>(f: (c: C) => boolean): BtNode<C> =>
  (c) =>
    f(c) ? 'success' : 'failure';

export const action =
  <C>(f: (c: C) => Status): BtNode<C> =>
  (c) =>
    f(c);
