import Link from "next/link";

export default function ResearchPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <nav className="mb-6">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          &larr; Home
        </Link>
      </nav>
      <h1 className="text-2xl font-bold mb-4">Company Research</h1>
      <div className="card p-8 text-center text-muted">
        <p className="text-lg mb-2">Coming Soon</p>
        <p className="text-sm">Deep dive into fundamentals, earnings, and financials.</p>
      </div>
    </main>
  );
}
