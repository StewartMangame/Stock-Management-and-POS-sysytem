export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ace-band via-white to-ace-zebra p-4">
      {children}
    </main>
  );
}
