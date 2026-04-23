import { Routes, Route } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import Library from './pages/Library.jsx';
import BookDetail from './pages/BookDetail.jsx';
import BookForm from './pages/BookForm.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import Readlist from './pages/Readlist.jsx';
import Loved from './pages/Loved.jsx';
import Lists from './pages/Lists.jsx';
import ListDetail from './pages/ListDetail.jsx';
import Diary from './pages/Diary.jsx';
import Stats from './pages/Stats.jsx';
import ShelfManager from './pages/ShelfManager.jsx';
import ShelfView from './pages/ShelfView.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/books/new" element={<BookForm />} />
          <Route path="/books/:id" element={<BookDetail />} />
          <Route path="/books/:id/edit" element={<BookForm />} />
          <Route path="/browse/:field/:value" element={<BrowsePage />} />
          <Route path="/readlist" element={<Readlist />} />
          <Route path="/loved" element={<Loved />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:id" element={<ListDetail />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/shelf" element={<ShelfManager />} />
          <Route path="/shelf-view" element={<ShelfView />} />
        </Routes>
      </main>
    </div>
  );
}
