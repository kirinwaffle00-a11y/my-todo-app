import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusTodo — My Personal Space",
  description: "A beautiful, premium dark mode task tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "FocusTodo",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
