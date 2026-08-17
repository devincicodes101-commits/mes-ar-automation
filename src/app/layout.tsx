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
    <html lang="en">
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
