import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "./redesign.css";
import "./wacrm-blue.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "wacrm",
    template: "%s — wacrm",
  },
  description: "Self-hostable CRM template for WhatsApp.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#102229",
  colorScheme: "dark light",
};

/*
 * Before React paints we resolve appearance. The one-time product migration
 * below moves existing installations from the historical violet/dark default
 * to the new WACRM Blue/light identity. After that first migration users are
 * free to change theme or mode again and their choices remain respected.
 */
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MIGRATION_KEY = 'wacrm.design.identity.v2';
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var MODES = ${JSON.stringify(MODES)};

    if (localStorage.getItem(MIGRATION_KEY) !== 'done') {
      localStorage.setItem(THEME_KEY, THEME_DEFAULT);
      localStorage.setItem(MODE_KEY, MODE_DEFAULT);
      localStorage.setItem(MIGRATION_KEY, 'done');
    }

    var savedTheme = localStorage.getItem(THEME_KEY);
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
