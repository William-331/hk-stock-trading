import { COMPLIANCE_NOTICES } from '../../compliance/notices';

export function ValuationNoticeBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-900" role="note">
      <span className="mr-1 font-semibold">估值提示：</span>
      {COMPLIANCE_NOTICES.valuation}
    </div>
  );
}

export function IntentActionNotice() {
  return (
    <div className="border-b border-blue-100 bg-blue-50/80 px-3 py-2 text-[10px] leading-4 text-blue-800" role="note">
      {COMPLIANCE_NOTICES.intent}
    </div>
  );
}

export function HolderNotice() {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-5 text-amber-900" role="note">
      <p className="mb-1 font-semibold">持有人须知</p>
      <p>{COMPLIANCE_NOTICES.holder}</p>
    </div>
  );
}

interface ComplianceAcknowledgementModalProps {
  submitting: boolean;
  error: string;
  onAcknowledge: () => void;
}

export function ComplianceAcknowledgementModal({ submitting, error, onAcknowledge }: ComplianceAcknowledgementModalProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="compliance-dialog-title"
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="border-b border-red-100 bg-red-50 px-5 py-4">
          <p className="text-[10px] font-semibold tracking-widest text-red-500">重要合规声明</p>
          <h2 id="compliance-dialog-title" className="mt-1 text-base font-bold text-gray-900">使用前请阅读并确认</h2>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-sm leading-7 text-gray-700">
          {COMPLIANCE_NOTICES.acknowledgement}
        </div>
        <div className="border-t border-gray-100 px-5 py-4">
          {error && <p className="mb-2 text-center text-xs text-red-500">{error}</p>}
          <button
            type="button"
            autoFocus
            disabled={submitting}
            onClick={onAcknowledge}
            className="w-full rounded-lg bg-[#1a5ce0] py-3 text-sm font-semibold text-white transition hover:bg-[#154ec5] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 disabled:opacity-50"
          >
            {submitting ? '确认中...' : '已知晓'}
          </button>
        </div>
      </section>
    </div>
  );
}
