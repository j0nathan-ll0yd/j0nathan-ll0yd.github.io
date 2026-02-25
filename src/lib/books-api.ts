import { getToken, getApiUrl } from '../scripts/auth';

export interface BookUpdatePayload {
  asin: string;
  title?: string;
  series?: string | null;
  seriesNumber?: number | null;
  seriesTotal?: number | null;
  description?: string | null;
  publicationDate?: string | null;
  publicationYear?: number | null;
  category?: string | null;
}

export async function updateBookMetadata(payload: BookUpdatePayload): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();
  if (!apiUrl || !token) throw new Error('Not authenticated');

  const res = await fetch(`${apiUrl}/books/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${text}`);
  }
}
