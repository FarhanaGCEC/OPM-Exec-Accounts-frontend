import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';

export type StatementApprovalOffer =
    | {
          mode: 'edit';
          resourceId: string;
          statementMonth: string;
          payload: Record<string, unknown>;
          hasAttachment?: boolean;
          attachmentFile?: File;
          note?: string;
      }
    | { mode: 'delete_attachment'; resourceId: string; statementMonth: string }
    | { mode: 'success'; message: string };

type StatementApprovalModalContextValue = {
    offer: StatementApprovalOffer | null;
    modalError: string | null;
    submitting: boolean;
    openApproval: (offer: StatementApprovalOffer) => void;
    closeApproval: () => void;
    setModalError: (message: string | null) => void;
    setSubmitting: (value: boolean) => void;
    showSuccess: (message: string) => void;
    registerSubmitHandler: (handler: (() => void) | null) => void;
};

const StatementApprovalModalContext = createContext<StatementApprovalModalContextValue | null>(
    null
);

function StatementApprovalModalLayer({
    offer,
    modalError,
    submitting,
    onClose,
    onSubmit,
}: {
    offer: StatementApprovalOffer;
    modalError: string | null;
    submitting: boolean;
    onClose: () => void;
    onSubmit: () => void;
}) {
    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/80 p-4"
            style={{ zIndex: 2147483000 }}
            role="presentation"
            data-statement-approval-overlay
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="statement-approval-title"
                className="w-full max-w-md rounded-lg border bg-white p-6 shadow-xl"
            >
                <h2
                    id="statement-approval-title"
                    className="text-lg font-semibold leading-none tracking-tight"
                >
                    {offer.mode === 'success' ? 'Request submitted' : 'Admin approval required'}
                </h2>
                {offer.mode === 'success' ? (
                    <p className="mt-4 text-sm font-medium leading-relaxed text-green-800">
                        {offer.message}
                    </p>
                ) : (
                    <>
                        <p className="mt-4 text-sm leading-relaxed text-gray-600">
                            {offer.mode === 'delete_attachment'
                                ? 'Your account cannot remove this statement PDF directly. Submit a request so an admin can review and remove it?'
                                : offer.mode === 'edit' &&
                                    (offer.hasAttachment ||
                                        offer.payload.attachmentFilename != null ||
                                        offer.payload.attachment_filename != null)
                                  ? 'Your account cannot upload statement files directly. The file will be sent with your request for admin approval.'
                                  : 'Your account cannot edit statement amounts directly. Submit these changes for an admin to review and apply?'}
                        </p>
                        {modalError ? (
                            <p className="mt-3 text-sm font-medium text-red-600">{modalError}</p>
                        ) : null}
                    </>
                )}
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0">
                    {offer.mode === 'success' ? (
                        <Button
                            type="button"
                            className="w-full bg-[#f7c46d] text-black hover:bg-[#c9a82f] sm:w-auto"
                            onClick={onClose}
                        >
                            Done
                        </Button>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                className="sm:mr-2"
                                onClick={onClose}
                                disabled={submitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                className="bg-[#f7c46d] text-black hover:bg-[#c9a82f]"
                                onClick={onSubmit}
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                                        Submitting…
                                    </>
                                ) : (
                                    'Submit request'
                                )}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

export function StatementApprovalModalProvider({ children }: { children: ReactNode }) {
    const [offer, setOffer] = useState<StatementApprovalOffer | null>(null);
    const [modalError, setModalError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const submitHandlerRef = useRef<(() => void) | null>(null);

    const registerSubmitHandler = useCallback((handler: (() => void) | null) => {
        submitHandlerRef.current = handler;
    }, []);

    const openApproval = useCallback((next: StatementApprovalOffer) => {
        setModalError(null);
        setSubmitting(false);
        setOffer(next);
    }, []);

    const closeApproval = useCallback(() => {
        setOffer(null);
        setModalError(null);
        setSubmitting(false);
    }, []);

    const showSuccess = useCallback((message: string) => {
        setModalError(null);
        setSubmitting(false);
        setOffer({ mode: 'success', message });
    }, []);

    useEffect(() => {
        if (!offer) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [offer]);

    return (
        <StatementApprovalModalContext.Provider
            value={{
                offer,
                modalError,
                submitting,
                openApproval,
                closeApproval,
                setModalError,
                setSubmitting,
                showSuccess,
                registerSubmitHandler,
            }}
        >
            {children}
            {offer && typeof document !== 'undefined' ? (
                <StatementApprovalModalLayer
                    offer={offer}
                    modalError={modalError}
                    submitting={submitting}
                    onClose={closeApproval}
                    onSubmit={() => submitHandlerRef.current?.()}
                />
            ) : null}
        </StatementApprovalModalContext.Provider>
    );
}

export function useStatementApprovalModal() {
    const ctx = useContext(StatementApprovalModalContext);
    if (!ctx) {
        throw new Error('useStatementApprovalModal must be used within StatementApprovalModalProvider');
    }
    return ctx;
}

export function useRegisterStatementApprovalSubmit(handler: () => void) {
    const { registerSubmitHandler } = useStatementApprovalModal();
    useEffect(() => {
        registerSubmitHandler(handler);
        return () => registerSubmitHandler(null);
    }, [registerSubmitHandler, handler]);
}
