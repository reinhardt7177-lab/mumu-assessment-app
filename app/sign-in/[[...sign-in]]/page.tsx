import { SignIn } from "@clerk/nextjs";
import { authConfigured } from "../../../lib/teacher-auth";
import Link from "next/link";
export default function Page() { return <main className="auth-page">{authConfigured() ? <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/" /> : <div className="setup-card"><h1>교사 로그인 연결 준비 중</h1><p>아직 계정 정보를 입력받지 않습니다.</p><Link href="/">돌아가기</Link></div>}</main>; }
