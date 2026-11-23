import { apiRequest } from './api';
import type { Product } from '../types/domain';

export async function fetchOnlinePosCatalog(signal?: AbortSignal): Promise<Product[]> {
  const response = await apiRequest<Product[]>('/products', { signal });
  return response.data;
}
