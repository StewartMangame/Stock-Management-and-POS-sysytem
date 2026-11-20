export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-gradient-to-br from-ace-band via-white to-ace-zebra p-4 sm:p-6">
      {children}
    </main>
  );
}
