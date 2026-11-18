import type { Metadata } from "next";
import Nav from "@/components/Nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = { title: "Vietnam Market Intelligence", description: "Market breadth and technical dashboard for Vietnamese equities" };

// Runs before first paint: saved choice, else the OS preference, else dark. Prevents a light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.classList.toggle('dark',t==='dark')}catch(e){document.documentElement.classList.add('dark')}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><ThemeProvider><Nav />{children}</ThemeProvider></body>
    </html>
  );
}
