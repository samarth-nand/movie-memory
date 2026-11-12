import type { Metadata } from "next";
import { Big_Shoulders, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Google merged "Big Shoulders Display" into "Big Shoulders" with an optical-size
// axis; the font-marquee utility sets opsz 72, which is the Display cut.
const bigShoulders = Big_Shoulders({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  variable: "--font-big-shoulders",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-instrument-sans",
});

export const metadata: Metadata = {
  title: "Movie Memory",
  description: "Your favorite movie, and a fact about it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bigShoulders.variable} ${instrumentSans.variable}`}>
      <body className="min-h-dvh bg-screen font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
