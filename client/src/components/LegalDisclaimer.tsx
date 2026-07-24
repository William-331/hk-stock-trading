import { COMPLIANCE_NOTICES } from '../compliance/notices';

export default function LegalDisclaimer() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 py-4 text-center text-[10px] leading-4 text-gray-400">
      {COMPLIANCE_NOTICES.globalFooter}
    </footer>
  );
}
