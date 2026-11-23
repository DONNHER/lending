import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, FileCheck2, ShieldCheck, Upload, Wallet, X } from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { formatDateTime, formatPHP } from '../../lib/productAssets';
import { downloadVerificationDocument, uploadVerificationDocument } from '../../lib/verificationDocuments';
import { useAppStore } from '../../stores/app-store';
import type {
  ShareCapitalAccount,
  ShareCapitalPayment,
  ShareholderDocument,
  ShareholderProfile,
} from '../../types/domain';
import { ConfirmDialog, type ConfirmDetailRow } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton, StatusLabel } from '../../components/ui/StateViews';

type PendingShareholderTx =
  | { kind: 'verify_membership'; shId: string; memberName: string; membershipNumber: string }
  | { kind: 'review_doc'; docId: string; docType: string; fileName: string; decision: 'approved' | 'rejected' }
  | { kind: 'verify_capital_pay'; payId: string; reference: string; amount: number; method: string }
  | { kind: 'upload_doc'; documentType: ShareholderDocument['document_type']; file: File }
  | { kind: 'submit_pay' };

interface MeShareholderResponse {
  profile: ShareholderProfile;
  capital_account: ShareCapitalAccount;
  capital_payments: ShareCapitalPayment[];
  documents: ShareholderDocument[];
}

interface DirectoryShareholder extends ShareholderProfile {
  email: string;
  user_name: string;
  capital_account: ShareCapitalAccount | null;
  capital_payments: ShareCapitalPayment[];
  documents: ShareholderDocument[];
}

export function ShareholdersView() {
  const queryClient = useQueryClient();
  const role = useAppStore((s) => s.session?.user.role);
  const isStaff = role === 'admin' || role === 'manager';

  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [selectedShId, setSelectedShId] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingShareholderTx | null>(null);

  // Shareholder self-service states
  const [docType, setDocType] = useState<ShareholderDocument['document_type']>('government_id');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const [payAmount, setPayAmount] = useState('5000');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank_transfer' | 'gcash'>('gcash');
  const [payRef, setPayRef] = useState(`CAP-${Date.now().toString().slice(-6)}`);

  const meQuery = useQuery({
    queryKey: ['shareholder-me'],
    enabled: !isStaff,
    queryFn: async () => (await apiRequest<MeShareholderResponse | null>('/shareholders/me')).data,
  });

  const directoryQuery = useQuery({
    queryKey: ['shareholders-directory'],
    enabled: isStaff,
    queryFn: async () => (await apiRequest<DirectoryShareholder[]>('/shareholders')).data,
  });

  const uploadDocMutation = useMutation({
    mutationFn: ({ documentType, file }: Extract<PendingShareholderTx, { kind: 'upload_doc' }>) =>
      uploadVerificationDocument(documentType, file),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      setDocumentFile(null);
      if (documentInput.current) documentInput.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['shareholder-me'] });
      queryClient.invalidateQueries({ queryKey: ['shareholders-directory'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.errors?.file?.[0] || err.message : 'Upload failed.' });
    },
  });

  const downloadDocMutation = useMutation({
    mutationFn: downloadVerificationDocument,
    onError: (error) => {
      setFeedback({ tone: 'red', text: error instanceof ApiError ? error.message : 'Could not download this document.' });
    },
  });

  function downloadButton(doc: ShareholderDocument) {
    if (!doc.has_file) return null;

    return (
      <button
        type="button"
        aria-label={`Download ${doc.file_name}`}
        onClick={() => downloadDocMutation.mutate(doc)}
        disabled={downloadDocMutation.isPending}
        className="rounded border border-[#CBD5E1] p-1.5 text-[#334155] hover:bg-[#F1F5F9] disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    );
  }

  const submitPayMutation = useMutation({
    mutationFn: async () =>
      apiRequest('/share-capital/payments', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(payAmount),
          payment_method: payMethod,
          reference: payRef,
        }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      setPayRef(`CAP-${Date.now().toString().slice(-6)}`);
      queryClient.invalidateQueries({ queryKey: ['shareholder-me'] });
      queryClient.invalidateQueries({ queryKey: ['shareholders-directory'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Payment submission failed.' });
    },
  });

  const reviewDocMutation = useMutation({
    mutationFn: async (params: { docId: string; decision: 'approved' | 'rejected'; remarks?: string }) =>
      apiRequest(`/documents/${params.docId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision: params.decision, remarks: params.remarks }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['shareholders-directory'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Document review failed.' });
    },
  });

  const verifyMembershipMutation = useMutation({
    mutationFn: async (params: { shId: string; decision: 'approved' | 'rejected' }) =>
      apiRequest(`/shareholders/${params.shId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ decision: params.decision }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['shareholders-directory'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Verification failed.' });
    },
  });

  const verifyCapitalPayMutation = useMutation({
    mutationFn: async (params: { payId: string; decision: 'verified' | 'rejected' }) =>
      apiRequest(`/share-capital/${params.payId}/verify-payment`, {
        method: 'POST',
        body: JSON.stringify({ decision: params.decision }),
      }),
    onSuccess: (res) => {
      setFeedback({ tone: 'green', text: res.message });
      queryClient.invalidateQueries({ queryKey: ['shareholders-directory'] });
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
    },
    onError: (err) => {
      setFeedback({ tone: 'red', text: err instanceof ApiError ? err.message : 'Payment verification failed.' });
    },
  });

  let confirmConfig: {
    title: string;
    description: string;
    details: ConfirmDetailRow[];
    confirmLabel: string;
    tone: 'green' | 'amber' | 'red';
    onConfirm: () => void;
  } | null = null;

  if (pendingTx?.kind === 'verify_membership') {
    confirmConfig = {
      title: 'Confirm Membership Approval',
      description: 'Approve this shareholder membership and unlock cooperative member privileges.',
      details: [
        { label: 'Shareholder', value: pendingTx.memberName },
        { label: 'Membership #', value: pendingTx.membershipNumber },
      ],
      confirmLabel: 'Confirm & Approve',
      tone: 'green',
      onConfirm: () => {
        verifyMembershipMutation.mutate(
          { shId: pendingTx.shId, decision: 'approved' },
          { onSettled: () => setPendingTx(null) }
        );
      },
    };
  } else if (pendingTx?.kind === 'review_doc') {
    const isApprove = pendingTx.decision === 'approved';
    confirmConfig = {
      title: isApprove ? 'Confirm Document Approval' : 'Confirm Document Rejection',
      description: isApprove
        ? 'Mark this verification document as approved.'
        : 'Reject this verification document and request a clearer submission.',
      details: [
        { label: 'Document Type', value: pendingTx.docType.replace('_', ' ') },
        { label: 'Filename', value: pendingTx.fileName },
      ],
      confirmLabel: isApprove ? 'Confirm Approval' : 'Confirm Rejection',
      tone: isApprove ? 'green' : 'red',
      onConfirm: () => {
        reviewDocMutation.mutate(
          {
            docId: pendingTx.docId,
            decision: pendingTx.decision,
            remarks: isApprove ? 'Verified by cooperative manager.' : 'Please upload a clearer scan.',
          },
          { onSettled: () => setPendingTx(null) }
        );
      },
    };
  } else if (pendingTx?.kind === 'verify_capital_pay') {
    confirmConfig = {
      title: 'Confirm Share Capital Verification',
      description: 'Verify this share capital payment and credit it toward the member fixed share capital.',
      details: [
        { label: 'Reference', value: pendingTx.reference },
        { label: 'Amount', value: formatPHP(pendingTx.amount) },
        { label: 'Method', value: pendingTx.method.replace('_', ' ') },
      ],
      confirmLabel: 'Confirm & Verify Payment',
      tone: 'green',
      onConfirm: () => {
        verifyCapitalPayMutation.mutate(
          { payId: pendingTx.payId, decision: 'verified' },
          { onSettled: () => setPendingTx(null) }
        );
      },
    };
  } else if (pendingTx?.kind === 'upload_doc') {
    confirmConfig = {
      title: 'Confirm Document Submission',
      description: 'Submit this verification document to cooperative management for review.',
      details: [
        { label: 'Document Type', value: pendingTx.documentType.replaceAll('_', ' ') },
        { label: 'Filename', value: pendingTx.file.name },
      ],
      confirmLabel: 'Confirm & Submit',
      tone: 'green',
      onConfirm: () => {
        uploadDocMutation.mutate(pendingTx, { onSettled: () => setPendingTx(null) });
      },
    };
  } else if (pendingTx?.kind === 'submit_pay') {
    confirmConfig = {
      title: 'Confirm Share Capital Payment',
      description: 'Submit this share capital contribution for cooperative verification.',
      details: [
        { label: 'Reference', value: payRef },
        { label: 'Amount', value: formatPHP(Number(payAmount)) },
        { label: 'Method', value: payMethod.replace('_', ' ') },
      ],
      confirmLabel: 'Confirm Payment',
      tone: 'green',
      onConfirm: () => {
        submitPayMutation.mutate(undefined, { onSettled: () => setPendingTx(null) });
      },
    };
  }

  const anyPending =
    uploadDocMutation.isPending ||
    submitPayMutation.isPending ||
    reviewDocMutation.isPending ||
    verifyMembershipMutation.isPending ||
    verifyCapitalPayMutation.isPending;

  if (isStaff) {
    if (directoryQuery.isLoading) return <LoadingSkeleton rows={5} />;
    if (directoryQuery.isError) {
      return (
        <ErrorState
          message={(directoryQuery.error as Error).message}
          onRetry={() => directoryQuery.refetch()}
        />
      );
    }

    const list = directoryQuery.data || [];
    const activeMember = list.find((m) => m.id === selectedShId) || list[0] || null;

    return (
      <div className="space-y-5">
        {feedback ? (
          <div
            role="status"
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
              feedback.tone === 'green'
                ? 'border-emerald-200 bg-emerald-50 text-[#14532D]'
                : 'border-red-200 bg-red-50 text-[#991B1B]'
            }`}
          >
            <span>{feedback.text}</span>
            <button type="button" onClick={() => setFeedback(null)} className="text-xs underline">
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Member Directory */}
          <div className="rounded-xl border border-[#E2E8E4] bg-white lg:col-span-5">
            <div className="border-b border-[#E2E8E4] px-5 py-4">
              <h2 className="font-display text-base font-semibold text-[#0F172A]">
                Shareholder Members ({list.length})
              </h2>
              <p className="text-xs text-[#64748B]">
                Select a member to verify identity documents and fixed share capital payments
              </p>
            </div>
            <div className="divide-y divide-[#E2E8E4]">
              {list.map((sh) => {
                const selected = activeMember?.id === sh.id;
                return (
                  <button
                    key={sh.id}
                    type="button"
                    onClick={() => setSelectedShId(sh.id)}
                    className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
                      selected ? 'bg-[#F0FDF4]' : 'hover:bg-[#F7F9F8]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-[#0F172A]">
                        {sh.first_name} {sh.last_name}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-[#64748B]">
                        {sh.membership_number} · Capital:{' '}
                        {formatPHP(sh.capital_account?.paid_amount ?? 0)}
                      </div>
                    </div>
                    <StatusLabel
                      tone={
                        sh.verification_status === 'approved'
                          ? 'green'
                          : sh.verification_status === 'rejected'
                          ? 'red'
                          : 'amber'
                      }
                      label={sh.verification_status.replace('_', ' ')}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Member Verification & Capital Detail */}
          <div className="space-y-5 lg:col-span-7">
            {!activeMember ? (
              <EmptyState
                title="No shareholders registered"
                description="Shareholder profiles will appear here for manager verification."
              />
            ) : (
              <>
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs text-[#15803D]">
                        {activeMember.membership_number}
                      </div>
                      <h3 className="font-display text-lg font-semibold text-[#0F172A]">
                        {activeMember.first_name} {activeMember.last_name}
                      </h3>
                      <p className="text-xs text-[#64748B]">
                        {activeMember.email} · {activeMember.contact_number || 'No phone'} ·{' '}
                        {activeMember.address || 'No address'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {activeMember.verification_status !== 'approved' ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPendingTx({
                              kind: 'verify_membership',
                              shId: activeMember.id,
                              memberName: `${activeMember.first_name} ${activeMember.last_name}`,
                              membershipNumber: activeMember.membership_number,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#166534]"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Approve Membership
                        </button>
                      ) : (
                        <StatusLabel tone="green" label="Membership Approved" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Documents Queue */}
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-3">
                  <h4 className="font-display text-sm font-semibold text-[#0F172A]">
                    Submitted Verification Documents
                  </h4>
                  {activeMember.documents.length === 0 ? (
                    <p className="text-xs text-[#64748B]">No documents uploaded yet.</p>
                  ) : (
                    <div className="divide-y divide-[#E2E8E4]">
                      {activeMember.documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-3"
                        >
                          <div>
                            <div className="text-sm font-medium text-[#0F172A] capitalize">
                              {doc.document_type.replace('_', ' ')}
                            </div>
                            <div className="font-mono text-xs text-[#64748B]">{doc.file_name}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {downloadButton(doc)}
                            <StatusLabel
                              tone={
                                doc.review_status === 'approved'
                                  ? 'green'
                                  : doc.review_status === 'rejected'
                                  ? 'red'
                                  : 'amber'
                              }
                              label={doc.review_status}
                            />
                            {doc.review_status === 'pending' ? (
                              <>
                                <button
                                  type="button"
                                  aria-label={`Approve ${doc.file_name}`}
                                  onClick={() =>
                                    setPendingTx({
                                      kind: 'review_doc',
                                      docId: doc.id,
                                      docType: doc.document_type,
                                      fileName: doc.file_name,
                                      decision: 'approved',
                                    })
                                  }
                                  className="rounded border border-emerald-300 bg-emerald-50 p-1.5 text-[#15803D] hover:bg-emerald-100"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Reject ${doc.file_name}`}
                                  onClick={() =>
                                    setPendingTx({
                                      kind: 'review_doc',
                                      docId: doc.id,
                                      docType: doc.document_type,
                                      fileName: doc.file_name,
                                      decision: 'rejected',
                                    })
                                  }
                                  className="rounded border border-red-300 bg-red-50 p-1.5 text-[#DC2626] hover:bg-red-100"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fixed Initial Share Capital Ledger */}
                <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-display text-sm font-semibold text-[#0F172A]">
                        Fixed Share Capital Ledger
                      </h4>
                      <p className="text-xs text-[#64748B]">
                        Paid amount is strictly computed from verified immutable payment records
                      </p>
                    </div>
                    {activeMember.capital_account ? (
                      <div className="text-right font-mono text-xs tabular-nums">
                        <div className="font-semibold text-[#0F172A]">
                          {formatPHP(activeMember.capital_account.paid_amount)} /{' '}
                          {formatPHP(activeMember.capital_account.required_amount)}
                        </div>
                        <div className="text-[#64748B] capitalize">
                          Status: {activeMember.capital_account.status}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="divide-y divide-[#E2E8E4]">
                    {activeMember.capital_payments.map((pay) => (
                      <div
                        key={pay.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div>
                          <div className="font-mono font-semibold text-[#0F172A]">
                            {pay.reference} · {formatPHP(pay.amount)}
                          </div>
                          <div className="text-[#64748B] capitalize">
                            {pay.payment_method.replace('_', ' ')} · {formatDateTime(pay.created_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusLabel
                            tone={
                              pay.status === 'verified'
                                ? 'green'
                                : pay.status === 'rejected'
                                ? 'red'
                                : 'amber'
                            }
                            label={pay.status}
                          />
                          {pay.status === 'pending' ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingTx({
                                  kind: 'verify_capital_pay',
                                  payId: pay.id,
                                  reference: pay.reference,
                                  amount: pay.amount,
                                  method: pay.payment_method,
                                })
                              }
                              className="rounded-lg bg-[#15803D] px-3 py-1.5 font-medium text-white hover:bg-[#166534]"
                            >
                              Verify Payment
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={Boolean(confirmConfig)}
          title={confirmConfig?.title || ''}
          description={confirmConfig?.description || ''}
          details={confirmConfig?.details || []}
          confirmLabel={confirmConfig?.confirmLabel}
          tone={confirmConfig?.tone || 'green'}
          isPending={anyPending}
          onCancel={() => setPendingTx(null)}
          onConfirm={() => confirmConfig?.onConfirm()}
        />
      </div>
    );
  }

  // Shareholder Self-Service Membership & Share Capital View
  if (meQuery.isLoading) return <LoadingSkeleton rows={5} />;
  if (meQuery.isError) {
    return (
      <ErrorState message={(meQuery.error as Error).message} onRetry={() => meQuery.refetch()} />
    );
  }

  const me = meQuery.data;
  if (!me) {
    return (
      <EmptyState
        title="No shareholder profile attached"
        description="Sign in with a shareholder account to manage membership verification and fixed share capital."
      />
    );
  }

  const { profile, capital_account, capital_payments, documents } = me;

  function handleDocSubmit(e: FormEvent) {
    e.preventDefault();
    if (!documentFile) return;
    if (documentFile.size > 5 * 1024 * 1024) {
      setFeedback({ tone: 'red', text: 'Choose a document of 5 MB or smaller.' });
      return;
    }
    setPendingTx({ kind: 'upload_doc', documentType: docType, file: documentFile });
  }

  function handlePaySubmit(e: FormEvent) {
    e.preventDefault();
    setPendingTx({ kind: 'submit_pay' });
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'green'
              ? 'border-emerald-200 bg-emerald-50 text-[#14532D]'
              : 'border-red-200 bg-red-50 text-[#991B1B]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Membership Summary Strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="text-xs font-medium text-[#64748B]">Membership Number</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A]">
            {profile.membership_number}
          </div>
          <div className="mt-2">
            <StatusLabel
              tone={profile.verification_status === 'approved' ? 'green' : 'amber'}
              label={`Verification: ${profile.verification_status.replace('_', ' ')}`}
            />
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="text-xs font-medium text-[#64748B]">Fixed Share Capital Paid</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-[#15803D] tabular-nums">
            {formatPHP(capital_account.paid_amount)}
          </div>
          <div className="mt-1 font-mono text-xs text-[#64748B] tabular-nums">
            Required: {formatPHP(capital_account.required_amount)} · Status: {capital_account.status}
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5">
          <div className="text-xs font-medium text-[#64748B]">Loan Credit Multiplier</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-[#0F172A] tabular-nums">
            {profile.verification_status === 'approved' && capital_account.status === 'paid'
              ? formatPHP(capital_account.paid_amount * 6)
              : 'Locked'}
          </div>
          <div className="mt-1 text-xs text-[#64748B]">6 × verified share capital upon approval</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Document Uploads */}
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-[#15803D]" />
            <h3 className="font-display text-base font-semibold text-[#0F172A]">
              Membership Documents
            </h3>
          </div>

          <form onSubmit={handleDocSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              aria-label="Document type"
              value={docType}
              onChange={(e) => setDocType(e.target.value as ShareholderDocument['document_type'])}
              className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
            >
              <option value="government_id">Government ID</option>
              <option value="farm_registration">Farm Registration</option>
              <option value="proof_of_residency">Proof of Residency</option>
              <option value="membership_form">Membership Form</option>
            </select>
            <input
              ref={documentInput}
              type="file"
              required
              aria-label="Verification document file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              disabled={uploadDocMutation.isPending}
              onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
              className="min-w-0 rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={uploadDocMutation.isPending || !documentFile}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#15803D] px-3 py-2 text-xs font-medium text-white hover:bg-[#166534]"
            >
              <Upload className="h-3.5 w-3.5" />
              Submit Doc
            </button>
          </form>
          <p className="text-xs text-[#64748B]">PDF, JPG, or PNG up to 5 MB.</p>

          <div className="divide-y divide-[#E2E8E4]">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <div className="font-medium text-[#0F172A] capitalize">
                    {doc.document_type.replace('_', ' ')}
                  </div>
                  <div className="font-mono text-[#64748B]">{doc.file_name}</div>
                </div>
                <div className="flex items-center gap-2">
                  {downloadButton(doc)}
                  <StatusLabel
                    tone={
                      doc.review_status === 'approved'
                        ? 'green'
                        : doc.review_status === 'rejected'
                        ? 'red'
                        : 'amber'
                    }
                    label={doc.review_status}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Share Capital Payment Submissions */}
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[#15803D]" />
            <h3 className="font-display text-base font-semibold text-[#0F172A]">
              Share Capital Payment Ledger
            </h3>
          </div>

          {capital_account.status !== 'paid' ? (
            <form onSubmit={handlePaySubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="number"
                min="1"
                required
                aria-label="Capital payment amount"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-xs"
              />
              <select
                aria-label="Capital payment method"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as 'cash' | 'bank_transfer' | 'gcash')}
                className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
              >
                <option value="gcash">GCash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash Counter</option>
              </select>
              <button
                type="submit"
                disabled={submitPayMutation.isPending}
                className="rounded-lg bg-[#15803D] px-3 py-2 text-xs font-medium text-white hover:bg-[#166534]"
              >
                Submit Payment
              </button>
            </form>
          ) : null}

          <div className="divide-y divide-[#E2E8E4]">
            {capital_payments.map((pay) => (
              <div key={pay.id} className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <div className="font-mono font-semibold text-[#0F172A]">
                    {pay.reference} · {formatPHP(pay.amount)}
                  </div>
                  <div className="text-[#64748B] capitalize">
                    {pay.payment_method.replace('_', ' ')} · {formatDateTime(pay.created_at)}
                  </div>
                </div>
                <StatusLabel
                  tone={
                    pay.status === 'verified' ? 'green' : pay.status === 'rejected' ? 'red' : 'amber'
                  }
                  label={pay.status}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmConfig)}
        title={confirmConfig?.title || ''}
        description={confirmConfig?.description || ''}
        details={confirmConfig?.details || []}
        confirmLabel={confirmConfig?.confirmLabel}
        tone={confirmConfig?.tone || 'green'}
        isPending={anyPending}
        onCancel={() => setPendingTx(null)}
        onConfirm={() => confirmConfig?.onConfirm()}
      />
    </div>
  );
}
