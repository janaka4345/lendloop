import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { validateRuntimeConfig } from "@/lib/runtime-config";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LendLoop — Neighborhood Tool Lending",
  description:
    "Browse available neighborhood tools, coordinate conflict-free borrow dates, and stay on top of returns.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const validated = validateRuntimeConfig(process.env);
  const publicConfig = validated.ok ? validated.publicConfig : null;

  return (
    <html lang="en">
      <body className="bg-background text-foreground min-h-screen antialiased">
        <AppProviders config={publicConfig}>{children}</AppProviders>
      </body>
    </html>
  );
}
