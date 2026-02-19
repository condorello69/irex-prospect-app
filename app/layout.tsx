import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IREX Prospect Generator",
  description: "Genera liste prospect irrigazione per Europa – Scarabelli Group",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="bg-gray-50">{children}</body>
    </html>
  );
}
