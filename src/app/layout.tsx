import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";
import { A11yBootstrap } from "@/components/A11yBootstrap";
import { BackButton } from "@/components/BackButton";

const montserrat = Montserrat({
  variable: "--font-sane-title",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const inter = Inter({
  variable: "--font-sane-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SANE+",
  description: "Sua voz por um saneamento melhor.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${montserrat.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <A11yBootstrap />
        <BackButton className="fixed left-4 bottom-4 z-50" />
        <div id="conteudo" tabIndex={-1} className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
