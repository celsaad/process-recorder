import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Process Recorder",
  description: "Turn a screen recording into an editable test script.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <LiveRegionProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </LiveRegionProvider>
      </body>
    </html>
  );
}
