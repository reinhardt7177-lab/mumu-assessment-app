"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="auth-page"><section className="setup-card"><p className="kicker">연결을 확인하고 있어요</p><h1>지금은 기록을 불러오지 못했습니다.</h1><p>저장에 성공했다고 표시하지 않았습니다. 작성 중이던 화면은 닫지 말고 연결을 확인해 주세요.</p><button className="primary-button" onClick={reset}>다시 불러오기</button></section></main>;
}
