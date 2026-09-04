"use client";

export default function PrintReportButton() {
  return <button type="button" className="primary-button report-print-button" onClick={() => window.print()}>PDF 저장·인쇄</button>;
}