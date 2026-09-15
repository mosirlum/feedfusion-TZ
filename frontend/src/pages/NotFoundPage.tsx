import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <img src="/logo.png" alt="Feed Fusion Tanzania" className="h-16 w-16 object-contain opacity-80" />
      <h1 className="text-4xl font-extrabold text-slate-800 dark:text-[#eef3ef]">404</h1>
      <p className="text-slate-500 dark:text-[#97a49b]">This page doesn't exist.</p>
      <Link to="/">
        <Button>Back home</Button>
      </Link>
    </div>
  );
}
