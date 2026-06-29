import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title:
    "Онлайн Раскрой и Развёртка металлопроката — калькулятор для инженеров",
  description:
    "Бесплатный онлайн-калькулятор раскроя и развёртки металлопроката: расчёт длины развёртки L-профиля, U-профиля, швеллера, уголка, Z-профиля по нейтральной оси с K-фактором по таблице R/S. Расчёт веса и длины арматуры, трубы, двутавра, прутка, листа, шестигранника из стали, алюминия, меди, латуни. Экспорт SVG и DXF для лазерной резки.",
  keywords: [
    "развёртка металлопроката онлайн",
    "раскрой металла калькулятор",
    "расчёт развёртки листового металла",
    "развёртка уголка",
    "развёртка швеллера",
    "развёртка L профиля",
    "развёртка U профиля",
    "развёртка Z профиля",
    "калькулятор веса металлопроката",
    "расчёт веса трубы",
    "расчёт веса арматуры",
    "расчёт веса двутавра",
    "K-фактор гибки",
    "припуск на гиб",
    "вычет на гиб",
    "экспорт DXF лазерная резка",
  ],
  authors: [{ name: "гибка-раскрой.рф" }],
  alternates: {
    canonical: "https://гибка-раскрой.рф/",
  },
  openGraph: {
    title:
      "Онлайн Раскрой и Развёртка металлопроката — калькулятор для инженеров",
    description:
      "Расчёт развёртки и веса металлопроката: уголок, швеллер, L/U/Z-профиль, труба, двутавр, лист. Экспорт SVG/DXF. K-фактор по таблице R/S.",
    url: "https://гибка-раскрой.рф/",
    siteName: "гибка-раскрой.рф",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title:
      "Онлайн Раскрой и Развёртка металлопроката — калькулятор для инженеров",
    description:
      "Расчёт развёртки и веса металлопроката: уголок, швеллер, L/U/Z-профиль, труба, двутавр, лист. Экспорт SVG/DXF.",
  },
  icons: {
    icon: "/logo.svg",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#d97706",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Yandex.Metrica — замените XXXXXXXX на ваш счётчик */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
              m[i].l=1*new Date();
              for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
              k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
              (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
              ym(XXXXXXXX, "init", {
                  clickmap:true,
                  trackLinks:true,
                  accurateTrackBounce:true,
                  webvisor:true
              });
            `,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
