import Link from "next/link";

export default function NotFound() {
  return (
    <main className="max-w-xl mx-auto px-4 py-20 text-center">
      <h1 className="text-3xl font-bold mb-2">404</h1>
      <p className="text-muted mb-6">Ticker not found or not in current scan.</p>
      <Link href="/" className="text-accent hover:underline">
        ← Back to screener
      </Link>
    </main>
  );
}
