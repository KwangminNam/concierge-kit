import type { ReactNode } from 'react';

export const metadata = { title: 'concierge-kit playground' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
