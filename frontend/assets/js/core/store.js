// Session state shared across views.
const state = { user: null, devMailbox: false, unread: 0 };
const subs = new Set();

export const session = {
  get user() { return state.user; },
  get devMailbox() { return state.devMailbox; },
  get unread() { return state.unread; },
  set(patch) {
    Object.assign(state, patch);
    subs.forEach((fn) => fn(state));
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  hasRole(min) {
    const rank = { user: 0, admin: 1, owner: 2 };
    return !!state.user && rank[state.user.role] >= rank[min];
  },
};
