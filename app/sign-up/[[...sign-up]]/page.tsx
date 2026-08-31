import { SignUp } from "@clerk/nextjs";
import { authConfigured } from "../../../lib/teacher-auth";
import Link from "next/link";
export default function Page() { return <main className="auth-page">{authConfigured() ? <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/" /> : <div className="setup-card"><h1>교사 계정 연결 준비 중</h1><Link href="/">돌아가기</Link></div>}</main>; }
