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
  getBookCounts: () => request('/books/counts'),
  getLovedBooks: () => request('/books?loved=true'),
  getBookLists: (bookId) => request(`/books/${bookId}/lists`),
  getBookLog: (bookId) => request(`/books/${bookId}/log`),
  getBook: (id) => request(`/books/${id}`),
  createBook: (data) => request('/books', { method: 'POST', body: JSON.stringify(data) }),
  updateBook: (id, data) => request(`/books/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  searchBooks: (q) => request(`/search?${new URLSearchParams({ q })}`),
  fetchBookDescription: (key) => request(`/search/description?${new URLSearchParams({ key })}`),
  patchBook: (id, data) => request(`/books/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBook: (id) => request(`/books/${id}`, { method: 'DELETE' }),
  fetchBookCover: (id) => request(`/books/${id}/fetch-cover`, { method: 'POST' }),
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
  reorderList: (listId, ids) => request(`/lists/${listId}/order`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  getShelfTree: () => request('/shelf/tree'),
  getBuildings: () => request('/shelf/buildings'),
  createBuilding: (data) => request('/shelf/buildings', { method: 'POST', body: JSON.stringify(data) }),
  updateBuilding: (id, data) => request(`/shelf/buildings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBuilding: (id) => request(`/shelf/buildings/${id}`, { method: 'DELETE' }),
  getBuildingRooms: (id) => request(`/shelf/buildings/${id}/rooms`),
  createRoom: (data) => request('/shelf/rooms', { method: 'POST', body: JSON.stringify(data) }),
  updateRoom: (id, data) => request(`/shelf/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoom: (id) => request(`/shelf/rooms/${id}`, { method: 'DELETE' }),
  getRoomUnits: (id) => request(`/shelf/rooms/${id}/units`),
  createUnit: (data) => request('/shelf/units', { method: 'POST', body: JSON.stringify(data) }),
  updateUnit: (id, data) => request(`/shelf/units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUnit: (id) => request(`/shelf/units/${id}`, { method: 'DELETE' }),
  getUnitShelves: (id) => request(`/shelf/units/${id}/shelves`),
  createShelf: (data) => request('/shelf/shelves', { method: 'POST', body: JSON.stringify(data) }),
  updateShelf: (id, data) => request(`/shelf/shelves/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteShelf: (id) => request(`/shelf/shelves/${id}`, { method: 'DELETE' }),
  getShelfBooks: (shelfId) => request(`/shelf/shelves/${shelfId}/books`),
  getUnshelfedBooks: () => request('/shelf/unshelfed'),
  getShelfLocation: (bookId) => request(`/shelf/location/${bookId}`),
  getStats: () => request('/stats'),
  getSettings: () => request('/settings'),
  setSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
};
