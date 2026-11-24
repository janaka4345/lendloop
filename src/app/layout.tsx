import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "LendLoop — Neighborhood Tool Lending",
  description:
    "Browse available neighborhood tools, coordinate conflict-free borrow dates, and stay on top of returns.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground min-h-screen antialiased">{children}</body>
    </html>
  );
}
