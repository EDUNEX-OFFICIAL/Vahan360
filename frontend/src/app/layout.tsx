import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SpyBot Dashboard',
  description: 'Khanan Data Scraping & Analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-[#05070a] text-slate-300 min-h-screen flex selection:bg-blue-500/30`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
