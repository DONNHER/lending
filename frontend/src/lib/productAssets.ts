import heroImg from '../assets/images/argivit_hero_agristore_1794568258202.jpg';
import fertilizerImg from '../assets/images/product_fertilizer_sack_1794568258436.jpg';
import seedsImg from '../assets/images/product_hybrid_seeds_1794568258581.jpg';
import feedImg from '../assets/images/product_organic_feed_1794568263601.jpg';

export const STORE_HERO_IMAGE = heroImg;

const PRODUCT_IMAGES: Record<string, string> = {
  fertilizer: fertilizerImg,
  seeds: seedsImg,
  feed: feedImg,
};

export function resolveProductImage(key?: string | null): string {
  if (!key) return fertilizerImg;
  return PRODUCT_IMAGES[key] || fertilizerImg;
}

export function formatPHP(amount: number): string {
  return `PHP ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatShortDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
