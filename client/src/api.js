async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getBooks: (status) => request(`/books${status ? `?status=${status}` : ''}`),
  getLovedBooks: () => request('/books?loved=true'),
  getBookLists: (bookId) => request(`/books/${bookId}/lists`),
  getBook: (id) => request(`/books/${id}`),
  createBook: (data) => request('/books', { method: 'POST', body: JSON.stringify(data) }),
  updateBook: (id, data) => request(`/books/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  searchBooks: (q) => request(`/search?${new URLSearchParams({ q })}`),
  fetchBookDescription: (key) => request(`/search/description?${new URLSearchParams({ key })}`),
  patchBook: (id, data) => request(`/books/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBook: (id) => request(`/books/${id}`, { method: 'DELETE' }),
  uploadCover: (file) => {
    const fd = new FormData();
    fd.append('cover', file);
    return fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
  },
  fetchCover: (url) => request('/upload/fetch', { method: 'POST', body: JSON.stringify({ url }) }),
  getReadlist: () => request('/readlist'),
  reorderReadlist: (ids) => request('/readlist/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  getDiary: () => request('/diary'),
  deleteDiaryEntry: (id) => request(`/diary/${id}`, { method: 'DELETE' }),
  getLists: () => request('/lists'),
  getList: (id) => request(`/lists/${id}`),
  createList: (name) => request('/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id, name) => request(`/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteList: (id) => request(`/lists/${id}`, { method: 'DELETE' }),
  addToList: (listId, bookId) => request(`/lists/${listId}/books`, { method: 'POST', body: JSON.stringify({ book_id: bookId }) }),
  removeFromList: (listId, bookId) => request(`/lists/${listId}/books/${bookId}`, { method: 'DELETE' }),
};
