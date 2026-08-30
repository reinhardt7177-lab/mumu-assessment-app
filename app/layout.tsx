import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mumu 평가 | 증거 중심 학생 평가",
  description: "학생의 글, 사진, 말, 대화를 루브릭 근거와 연결하고 교사가 최종 확정하는 평가 워크스페이스",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
