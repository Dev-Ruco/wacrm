import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Toaster } from "sonner";
import "./globals.css";
import "./redesign.css";
import "./wacrm-blue.css";

export const metadata: Metadata = {
  title: "WACRM",
  description: "WhatsApp CRM",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const cookieStore = await cookies();
  const mode = cookieStore.get("wacrm-mode")?.value;
  const theme = cookieStore.get("wacrm-theme")?.value;

  return (
    <html
      lang={locale}
      data-mode={mode === "light" ? "light" : "dark"}
      data-theme={theme ?? "wacrm"}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var mode = localStorage.getItem('wacrm:mode');
                var theme = localStorage.getItem('wacrm:theme');
                if (mode === 'light' || mode === 'dark') {
                  document.documentElement.dataset.mode = mode;
                }
                if (theme) {
                  document.documentElement.dataset.theme = theme;
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster richColors position="top-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
