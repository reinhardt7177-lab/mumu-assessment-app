import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { databaseConfigured, getRepository } from "../db/connection";
import { authConfigured, requireTeacher } from "../lib/teacher-auth";
import { AppError } from "../lib/assessment-domain";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  let message = "";
  const storageReady = databaseConfigured();
  const loginReady = authConfigured();
  let owner: string | null = null;
  if (loginReady) {
    try { owner = await requireTeacher(); }
    catch (error) { if (error instanceof AppError) message = error.message; else throw error; }
  }
  const header = <header className="workspace-header"><Link href={owner ? "/curriculum" : "/"} className="workspace-brand"><span>M</span><strong>Mumu 평가</strong></Link>{owner ? <nav aria-label="교사 워크스페이스"><Link href="/curriculum">교육과정 성장 평가</Link><Link className="active" href="/">평가 문항·QR</Link></nav> : null}<div><Link href="/demo">디자인 데모</Link>{loginReady && <UserButton />}</div></header>;
  if (!storageReady || !owner) return <main className="real-workspace">{header}<section className="setup-card"><p className="kicker">실제 평가 워크스페이스</p><h1>답안이 남는 평가,<br />근거가 보이는 피드백.</h1><p>선생님이 만든 평가를 QR로 배포하고, 제출된 답안을 다시 열어 검토하는 공간입니다.</p><ul className="setup-checks"><li><span>{storageReady ? "연결됨" : "연결 필요"}</span>답안·평가 결과 저장소</li><li><span>{loginReady ? "연결됨" : "연결 필요"}</span>교사 로그인</li><li><span>{owner ? "승인됨" : "승인 필요"}</span>교사 계정 접근 권한</li></ul>{message && <p className="wizard-guide">{message}</p>}<p className="ai-generation-error">운영 연결이 완료되기 전에는 실제 학생 답안을 수집하지 않습니다. 예시 화면은 ‘디자인 데모’에 따로 보존했습니다.</p>{loginReady && !owner && <Link className="primary-button button-link" href="/sign-in">교사 로그인</Link>}<p className="setup-small">운영자는 저장소와 교사 로그인 연결을 완료하고 승인된 교사 계정을 등록해야 합니다.</p></section></main>;
  const assessments = await getRepository().list(owner);
  return <main className="real-workspace">{header}<Workspace initialAssessments={assessments} /></main>;
}
