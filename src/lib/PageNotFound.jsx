import { Link } from 'react-router';

export default function PageNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100 px-4">
      <div className="bg-white rounded-3xl shadow-md p-8 text-center max-w-sm w-full">
        <h1 className="text-3xl font-bold text-neutral-900">404</h1>
        <p className="mt-2 text-neutral-500">Diese Seite wurde nicht gefunden.</p>
        <Link to="/" className="mt-6 inline-flex px-5 py-3 rounded-xl bg-neutral-900 text-white font-bold">
          Zur Startseite
        </Link>
      </div>
    </div>
  );
}
