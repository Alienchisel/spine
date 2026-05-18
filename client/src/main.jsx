import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Library from './pages/Library.jsx';
import BookDetail from './pages/BookDetail.jsx';
import BookForm from './pages/BookForm.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import Author from './pages/Author.jsx';
import AuthorsIndex from './pages/AuthorsIndex.jsx';
import TagsIndex from './pages/TagsIndex.jsx';
import Readlist from './pages/Readlist.jsx';
import Loved from './pages/Loved.jsx';
import Lists from './pages/Lists.jsx';
import ListDetail from './pages/ListDetail.jsx';
import Diary from './pages/Diary.jsx';
import Stats from './pages/Stats.jsx';
import Collage from './pages/Collage.jsx';
import ShelfManager from './pages/ShelfManager.jsx';
import ShelfView from './pages/ShelfView.jsx';
import RouteError from './components/RouteError.jsx';
import './index.css';

function NotFound() {
  return <div className="text-center py-32 text-neutral-600 text-sm">Page not found.</div>;
}

// Data router (vs. <BrowserRouter>) so BookForm and any future page can use
// useBlocker, loaders, actions, etc. The router instance lives at module
// scope so HMR doesn't re-create it on every reload. App.jsx becomes a
// layout route (it renders its shell + <Outlet/>); page-level routes are
// nested under it.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />} errorElement={<RouteError />}>
      {/* Pathless wrapper with errorElement so a thrown route still
          renders inside App's chrome (Nav stays put) instead of being
          replaced wholesale by the default React Router crash screen.
          The outer errorElement on the layout route catches the rarer
          case of App / Nav itself throwing, which would otherwise
          bubble past the inner boundary. */}
      <Route errorElement={<RouteError />}>
        <Route index                        element={<Library />} />
        <Route path="books/new"             element={<BookForm />} />
        <Route path="books/:id"             element={<BookDetail />} />
        <Route path="books/:id/edit"        element={<BookForm />} />
        <Route path="browse/:field/:value"  element={<BrowsePage />} />
        <Route path="authors"               element={<AuthorsIndex />} />
        <Route path="authors/:id"           element={<Author />} />
        <Route path="tags"                  element={<TagsIndex />} />
        <Route path="readlist"              element={<Readlist />} />
        <Route path="loved"                 element={<Loved />} />
        <Route path="lists"                 element={<Lists />} />
        <Route path="lists/:id"             element={<ListDetail />} />
        <Route path="diary"                 element={<Diary />} />
        <Route path="stats"                 element={<Stats />} />
        <Route path="collage"               element={<Collage />} />
        <Route path="shelf"                 element={<ShelfManager />} />
        <Route path="shelf-view"            element={<ShelfView />} />
        <Route path="*"                     element={<NotFound />} />
      </Route>
    </Route>
  )
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
