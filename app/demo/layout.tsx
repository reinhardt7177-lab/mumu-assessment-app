import Link from "next/link";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <><div className="demo-warning" role="note">디자인 데모 · 예시 데이터이며 답안·채점 결과는 저장되지 않습니다. <Link href="/">실제 평가 워크스페이스로</Link></div>{children}</>;
}
