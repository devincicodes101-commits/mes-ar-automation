import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { SessionProvider, ToastProvider } from "@/lib/session";

export const metadata: Metadata = {
  title: "MES AR Automation",
  description:
    "Upload driven AR reconciliation, reminders and collections for MES Group dormitory accounts receivable.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The theme somebody chose, applied before the first paint so a dark
            screen does not flash light on every load. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('mes-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
      </head>
      <body>
        <SessionProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
