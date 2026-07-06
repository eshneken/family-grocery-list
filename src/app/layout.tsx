import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Family Grocery List",
  description: "Shared family grocery list with requestor and shopper flows",
  // Safari reads these fields when a family member saves the app to their Home Screen.
  appleWebApp: {
    capable: true,
    title: "Grocery",
    statusBarStyle: "default"
  },
  icons: {
    icon: { url: "/icon", sizes: "512x512", type: "image/png" },
    apple: { url: "/apple-icon", sizes: "180x180", type: "image/png" }
  }
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  viewportFit: "cover"
};

export const dynamic = "force-dynamic";

/** Supplies the document shell, PWA metadata, and shared authenticated application frame. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
