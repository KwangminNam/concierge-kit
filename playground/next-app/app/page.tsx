import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1 id="title">conciergekit playground</h1>
      <ul>
        <li>
          <Link href="/action">server action</Link>
        </li>
        <li>
          <Link href="/render-guard">render guard</Link>
        </li>
      </ul>
    </main>
  );
}
