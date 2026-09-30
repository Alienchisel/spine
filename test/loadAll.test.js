// Defends fetchAllPages, the loop behind "Load all" on Library / Browse /
// ListDetail. The old loop read hasNextPage off the render-time query
// object — which never updates — so once the last page was in it spun
// forever on an immediately-resolving fetchNextPage() and froze the tab.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from '../client/src/hooks/useLoadAll.js';

// Mimics a TanStack infinite-query observer: the object handed to the
// caller is a frozen snapshot; fetchNextPage() resolves with a NEW result.
function fakeQuery(totalPages, { failOnPage } = {}) {
  const state = { pages: 1, t: 1, calls: 0 };
  const snapshot = () => ({
    hasNextPage: state.pages < totalPages,
    dataUpdatedAt: state.t,
    isError: false,
    fetchNextPage,
  });
  async function fetchNextPage() {
    state.calls += 1;
    if (state.calls > 100) throw new Error('runaway loop');
    if (failOnPage && state.pages + 1 === failOnPage) {
      return { ...snapshot(), isError: true, error: new Error('page failed') };
    }
    if (state.pages < totalPages) { state.pages += 1; state.t += 1; }
    return snapshot();
  }
  return { initial: snapshot(), state };
}

describe('fetchAllPages', () => {
  it('stops after the last page even though the initial snapshot never updates', async () => {
    const { initial, state } = fakeQuery(4);
    await fetchAllPages(initial);
    assert.equal(state.pages, 4);
    assert.equal(state.calls, 3, 'one fetch per remaining page, then stop');
    assert.equal(initial.hasNextPage, true, 'the frozen snapshot still says true — the old loop spun on this');
  });

  it('bails out when a fetch makes no progress instead of spinning', async () => {
    let calls = 0;
    const stuck = {
      hasNextPage: true, dataUpdatedAt: 5, isError: false,
      fetchNextPage: async () => { calls += 1; return stuck; },
    };
    await fetchAllPages(stuck);
    assert.equal(calls, 1);
  });

  it('stops when the caller goes stale (tab switch / unmount)', async () => {
    const { initial, state } = fakeQuery(10);
    let stale = false;
    const origFetch = initial.fetchNextPage;
    initial.fetchNextPage = async () => { const r = await origFetch(); stale = true; return r; };
    await fetchAllPages(initial, () => stale);
    assert.equal(state.calls, 1);
  });

  it('throws the page error so the caller can surface it', async () => {
    const { initial } = fakeQuery(5, { failOnPage: 3 });
    await assert.rejects(() => fetchAllPages(initial), /page failed/);
  });
});
