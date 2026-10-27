import { redirect } from 'next/navigation';

/** Root "/" redirects to the dashboard. Middleware handles auth. */
export default function RootPage() {
  redirect('/dashboard');
}
