import type { Metadata } from "next";
import "./globals.css";
import AppBackground from "@/components/AppBackground";

export const metadata: Metadata = {
  title: "Arc Relief Markets",
  description: "Disaster relief prediction markets with automated NGO payouts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <style dangerouslySetInnerHTML={{
          __html: `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@200..700&display=swap');`
        }} />
      </head>
      <body className="antialiased" style={{ fontFamily: '"Oswald", sans-serif' }}>
        <AppBackground />
        {children}
      </body>
    </html>
  );
}
