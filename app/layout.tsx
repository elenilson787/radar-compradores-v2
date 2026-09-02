import type { Metadata } from "next";
import "./globals.css";
import "./cloud.css";

export const metadata: Metadata = {
  title: "Radar de Compradores V2",
  description: "Monitoramento pessoal de intenção pública de compra",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
