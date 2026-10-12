import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Descripto",
  description: "Edit video by editing text. Transcript-driven editing with an agentic core.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
