import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Tablet Transcriber",
  description: "Upload an audio or video file and transcribe it with OpenAI."
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
