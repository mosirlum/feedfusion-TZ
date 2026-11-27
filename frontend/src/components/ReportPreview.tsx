import { useEffect, useRef } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { Button, Modal } from './ui';
import { saveBlob } from '../lib/saveBlob';

/**
 * The generated report PDF, shown in a dialog before anyone downloads or
 * prints it (CLAUDE.md #103). Shared by Reports → Generate Report and by the
 * Feedy assistant ("generate last month's report"), so both behave the same.
 */
export interface ReportPreviewData {
  blob: Blob;
  url: string;
  filename: string;
}

export function makeReportPreview(blob: Blob, from: string, to: string): ReportPreviewData {
  return { blob, url: URL.createObjectURL(blob), filename: `Feed-Fusion-Report-${from}-to-${to}.pdf` };
}

// Phones/tablets can't render a PDF inside an iframe, so there the dialog
// offers Open / Download / Print buttons instead of an embedded view.
const isTouchDevice = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function ReportPreviewModal({ preview, onClose }: { preview: ReportPreviewData | null; onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const touch = isTouchDevice();

  // Free the blob URL when the dialog closes or is replaced.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview?.url]);

  function print() {
    if (!preview) return;
    // Desktop: print the embedded PDF. If the browser blocks that (or this is
    // a touch device), open the PDF in its own tab, where the viewer has its
    // own Print button. This runs inside a tap, so it is not a blocked pop-up.
    if (!touch) {
      try {
        const win = frameRef.current?.contentWindow;
        if (win) {
          win.focus();
          win.print();
          return;
        }
      } catch {
        /* fall through to opening a tab */
      }
    }
    window.open(preview.url, '_blank', 'noopener');
  }

  return (
    <Modal
      open={!!preview}
      onClose={onClose}
      title="Report preview"
      size="xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" variant="secondary" icon={<Printer size={14} />} onClick={print}>
            Print
          </Button>
          <Button type="button" icon={<Download size={14} />} onClick={() => preview && saveBlob(preview.blob, preview.filename)}>
            Download
          </Button>
        </>
      }
    >
      {preview && !touch && (
        <iframe
          ref={frameRef}
          src={preview.url}
          title="Generated report"
          className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white dark:border-white/10"
        />
      )}
      {preview && touch && (
        <div className="space-y-3 py-4 text-center text-sm text-slate-600 dark:text-[#b6c2ba]">
          <FileText size={40} className="mx-auto text-green-600 dark:text-lime-300" />
          <p>Your report is ready. Open it to read it, or choose Download or Print below.</p>
          <Button type="button" variant="secondary" onClick={() => window.open(preview.url, '_blank', 'noopener')}>
            Open report
          </Button>
        </div>
      )}
    </Modal>
  );
}
