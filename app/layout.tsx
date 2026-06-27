import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "LectureForge",
  description:
    "Create searchable lecture notes from audio, video, and board photos."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
