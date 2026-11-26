import { ApiError, apiRequest, getStoredToken } from './api';
import type { LandPaperType, ShareholderDocument } from '../types/domain';

export function uploadVerificationDocument(documentType: LandPaperType, file: File) {
  const body = new FormData();
  body.set('document_type', documentType);
  body.set('file', file);
  return apiRequest('/shareholder-documents', { method: 'POST', body });
}

export async function downloadVerificationDocument(doc: ShareholderDocument) {
  const token = getStoredToken();
  const response = await fetch(`/api/v1/documents/${encodeURIComponent(doc.id)}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  if (!response.ok) {
    const error: { message?: string } | null = await response.json().catch(() => null);
    throw new ApiError(error?.message || 'Could not download this document.', response.status);
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.file_name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
