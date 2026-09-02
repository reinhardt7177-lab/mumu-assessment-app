import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

type Area = "home" | "classes" | "assessments" | "curriculum";

export default function TeacherHeader({ active }: { active: Area }) {
  const items: Array<{ key: Area; href: string; label: string }> = [
    { key: "home", href: "/", label: "오늘" },
    { key: "classes", href: "/classes", label: "학급" },
    { key: "assessments", href: "/assessments", label: "평가 문항" },
    { key: "curriculum", href: "/curriculum", label: "교육과정" },
  ];
  return <header className="workspace-header teacher-header">
    <Link href="/" className="workspace-brand"><span>M</span><strong>Mumu 평가</strong></Link>
    <nav aria-label="교사 워크스페이스">
      {items.map(item => <Link className={active === item.key ? "active" : undefined} href={item.href} key={item.key}>{item.label}</Link>)}
    </nav>
    <div className="teacher-header-tools"><Link className="header-help-link" href="/demo">사용 예시</Link><UserButton /></div>
  </header>;
}
