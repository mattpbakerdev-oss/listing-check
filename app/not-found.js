export const metadata = { title: "Not found · Listing Check" };

export default function NotFound() {
  return (
    <>
      <header className="top">
        <div className="top-inner">
          <h1>Listing Check</h1>
        </div>
      </header>
      <main className="layout single notfound">
        <section className="card">
          <h2>There is nothing at this address</h2>
          <p className="muted">The checker is one page, and this is not it.</p>
          <p><a href="/">Back to the checker</a></p>
        </section>
      </main>
    </>
  );
}
