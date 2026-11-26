import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  QrCode,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { formatPHP, resolveProductImage } from '../../lib/productAssets';
import { useAppStore } from '../../stores/app-store';
import { useCartStore } from '../../stores/cart-store';
import type { Order, Product } from '../../types/domain';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/StateViews';

interface ShopCatalogMeta {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
  has_more?: boolean;
  categories?: string[];
}

interface ShopAssistance {
  explanation: string;
  products: Product[];
  fallback: boolean;
}

const SHOP_PAGE_SIZE = 8;
type CatalogSort = 'name' | 'newest' | 'oldest' | 'price_asc' | 'price_desc';
const SELECT_STYLE = 'w-full min-w-0 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#334155] focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';

export function OnlineShopView() {
  const queryClient = useQueryClient();
  const {
    items: cartItems,
    cartOpen,
    setCartOpen,
    addItem,
    updateQty,
    removeItem,
    clearCart,
    getTotal,
  } = useCartStore();

  const selectedCategory = useAppStore((s) => s.subTabs.shop);
  const canAsk = useAppStore((s) => s.session?.user.role === 'shareholder');
  const setWorkspaceSubTab = useAppStore((s) => s.setWorkspaceSubTab);
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [aiMode, setAiMode] = useState(false);
  const [questionDraft, setQuestionDraft] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState<{ question: string; category: string } | null>(null);
  const aiSearch = canAsk && aiMode;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<CatalogSort>('name');
  const [orderNotes, setOrderNotes] = useState('');
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [dialogUnitId, setDialogUnitId] = useState<string>('');
  const [dialogQty, setDialogQty] = useState<number>(1);
  const [dialogAdded, setDialogAdded] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const [confirmPreOrderOpen, setConfirmPreOrderOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [selectedCategory]);

  useEffect(() => {
    if (aiSearch) return;
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 180);
    return () => clearTimeout(t);
  }, [aiSearch, searchQuery]);

  function enableAiSearch() {
    setQuestionDraft(searchQuery);
    setAiMode(true);
    searchInput.current?.focus();
  }

  function cancelAiSearch() {
    setAiMode(false);
    setSubmittedQuestion(null);
    searchInput.current?.focus();
  }

  function handleCategoryChange(category: string) {
    setSubmittedQuestion(null);
    setWorkspaceSubTab('shop', category);
    setPage(1);
  }

  function handleSortChange(nextSort: CatalogSort) {
    setSubmittedQuestion(null);
    setSort(nextSort);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openProductDialog(product: Product) {
    const defaultUnit =
      product.units.find((u) => u.is_default) || product.units[0];
    const availableUnit = product.units.find((unit) => unit.conversion_factor <= product.stock_base);
    setDetailProduct(product);
    setDialogUnitId(defaultUnit && defaultUnit.conversion_factor <= product.stock_base ? defaultUnit.id : availableUnit?.id || defaultUnit?.id || '');
    setDialogQty(1);
    setDialogAdded(false);
  }

  const productsQuery = useQuery({
    queryKey: ['shop-products', page, selectedCategory, debouncedSearch, sort],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(SHOP_PAGE_SIZE),
        category: selectedCategory,
        sort,
      });
      if (debouncedSearch) params.set('q', debouncedSearch);
      return apiRequest<Product[]>(`/shop/products?${params.toString()}`);
    },
  });

  const assistanceQuery = useQuery({
    queryKey: ['shop-assistance', submittedQuestion],
    enabled: aiSearch && submittedQuestion !== null,
    queryFn: async ({ signal }) => (await apiRequest<ShopAssistance>('/shop/assistance', {
      method: 'POST',
      signal,
      body: JSON.stringify(submittedQuestion),
    })).data,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aiSearch) {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
      return;
    }

    const question = questionDraft.trim();
    if (!question || assistanceQuery.isFetching) return;
    if (submittedQuestion?.question === question && submittedQuestion.category === selectedCategory) {
      void assistanceQuery.refetch();
    } else {
      setSubmittedQuestion({ question, category: selectedCategory });
    }
  }

  const placeOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          notes: orderNotes,
          items: cartItems.map((c) => ({
            product_id: c.product_id,
            unit_id: c.unit_id,
            quantity: c.quantity,
          })),
        }),
      });
      return res.data;
    },
    onSuccess: (order) => {
      clearCart();
      setConfirmPreOrderOpen(false);
      setCartOpen(false);
      setCheckoutError(null);
      setConfirmedOrder(order);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      setConfirmPreOrderOpen(false);
      setCheckoutError(err instanceof ApiError ? err.message : 'Unable to submit pre-order.');
    },
  });

  const showingAssistance = aiSearch && submittedQuestion !== null;
  const assistance = showingAssistance ? assistanceQuery.data : undefined;
  const showingRecommendations = Boolean(assistance && !assistance.fallback);
  const asking = showingAssistance && assistanceQuery.isFetching;
  const waitingForConnection = assistanceQuery.fetchStatus === 'paused';
  const filtered = showingRecommendations ? assistance!.products : productsQuery.data?.data || [];
  const meta = (productsQuery.data?.meta as ShopCatalogMeta | undefined) || {};
  const categories =
    meta.categories ||
    Array.from(new Set(filtered.map((p) => p.category_name).filter(Boolean) as string[]));
  const totalAvailableCount = typeof meta.total === 'number' ? meta.total : filtered.length;
  const totalPages = typeof meta.total_pages === 'number' ? meta.total_pages : 1;
  const hasMore = Boolean(meta.has_more);
  const startIdx = totalAvailableCount === 0 ? 0 : (page - 1) * SHOP_PAGE_SIZE + 1;
  const endIdx = (page - 1) * SHOP_PAGE_SIZE + filtered.length;
  const totalCartQty = cartItems.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="space-y-6">

      {/* Search Bar & Category Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-[#E2E8E4] bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <form onSubmit={handleSearch} className="w-full space-y-1.5 lg:max-w-lg">
          <label htmlFor="shop-search" className="block text-sm font-semibold text-[#334155]">
            {aiSearch ? 'Ask AI about supplies' : 'Search supplies'}
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              {aiSearch ? (
                <Sparkles aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#15803D]" />
              ) : (
                <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
              )}
              <input id="shop-search" ref={searchInput} type={aiSearch ? 'text' : 'search'} maxLength={400}
                enterKeyHint={aiSearch ? 'send' : 'search'}
                aria-describedby={aiSearch ? 'shop-ai-search-hint' : undefined}
                value={aiSearch ? questionDraft : searchQuery}
                onChange={(event) => {
                  const update = aiSearch ? setQuestionDraft : setSearchQuery;
                  update(event.target.value);
                }}
                placeholder={aiSearch ? 'e.g. What chicken feed is in stock?' : 'Search by name or SKU'}
                className={`min-h-11 w-full rounded-lg border py-2 pl-10 pr-4 text-base sm:text-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 ${aiSearch ? 'border-emerald-400 bg-emerald-50' : 'border-[#CBD5E1] bg-white'}`}
              />
            </div>
            {canAsk && (aiSearch ? (
              <button type="button" onClick={cancelAiSearch} aria-label="Cancel AI search" title="Cancel AI search"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            ) : (
              <button type="button" onClick={enableAiSearch}
                className="min-h-11 shrink-0 rounded-lg bg-[#15803D] px-4 text-sm font-semibold text-white hover:bg-[#166534]">
                Ask AI
              </button>
            ))}
          </div>
          {aiSearch && (
            <>
              <button type="submit" hidden>Send question</button>
              <p id="shop-ai-search-hint" className="text-xs text-[#475569]">Press Enter or Send to ask.</p>
            </>
          )}
        </form>

        <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:flex lg:items-center">
          <select aria-label="Filter by category" className={SELECT_STYLE} value={selectedCategory}
            onChange={(event) => handleCategoryChange(event.target.value)}>
            <option value="all">All Supplies</option>
            {selectedCategory !== 'all' && !categories.includes(selectedCategory) && (
              <option value={selectedCategory}>{selectedCategory}</option>
            )}
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label="Sort by date added" className={SELECT_STYLE}
            value={sort === 'newest' || sort === 'oldest' ? sort : 'name'}
            onChange={(event) => handleSortChange(event.target.value as CatalogSort)}>
            <option value="name">Sort by date</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <select aria-label="Sort by price" className={SELECT_STYLE}
            value={sort === 'price_asc' || sort === 'price_desc' ? sort : 'name'}
            onChange={(event) => handleSortChange(event.target.value as CatalogSort)}>
            <option value="name">Sort by price</option>
            <option value="price_asc">Lowest price first</option>
            <option value="price_desc">Highest price first</option>
          </select>
        </div>
      </div>

      {confirmedOrder ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-[#15803D]" />
              <div>
                <h3 className="font-display text-base font-semibold text-[#14532D]">
                  Pre-Order {confirmedOrder.order_number} Confirmed
                </h3>
                <p className="text-xs text-[#166534]">
                  Present this fulfillment token to any Argivit POS cashier to complete pickup
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 font-mono text-base font-bold text-[#14532D]">
              <QrCode className="h-4 w-4" />
              <span>{confirmedOrder.token_code}</span>
            </div>
          </div>
        </section>
      ) : null}

      {showingAssistance && (
        <section aria-label="AI shop assistance" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-emerald-950">AI shop assistance</h2>
            <button type="button" onClick={cancelAiSearch}
              className="text-sm font-medium text-emerald-900 underline underline-offset-2">
              Show catalog results
            </button>
          </div>
          <p role="status" className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-emerald-950">
            {waitingForConnection && 'Connect to the internet to get shop assistance.'}
            {asking && 'Checking current inventory…'}
            {assistanceQuery.isError && 'Shop assistance is unavailable. You can still search by product name or SKU.'}
            {!waitingForConnection && !asking && !assistanceQuery.isError && assistance?.explanation}
          </p>
        </section>
      )}

      {/* Product Catalog Grid */}
      {asking || (!showingRecommendations && productsQuery.isLoading) ? (
        <LoadingSkeleton rows={6} />
      ) : !showingRecommendations && productsQuery.isError ? (
        <ErrorState
          message={(productsQuery.error as Error).message}
          onRetry={() => productsQuery.refetch()}
        />
      ) : filtered.length === 0 && !showingRecommendations ? (
        <EmptyState
          title={debouncedSearch ? 'No matching supplies found' : 'No supplies in this category'}
          description={
            debouncedSearch
              ? `No supplies matched "${debouncedSearch}". Try clearing the search or switching categories.`
              : 'Select another category to view available cooperative inventory.'
          }
        />
      ) : filtered.length > 0 && (
        <div className="space-y-5">
          {showingRecommendations && <h2 className="font-display text-base font-semibold text-slate-900">Recommended supplies</h2>}
          <section className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {filtered.map((product) => {
              const preferredUnit =
                product.units.find((u) => u.is_default) || product.units[0];
              const defaultUnit = showingRecommendations && preferredUnit && preferredUnit.conversion_factor > product.stock_base
                ? product.units.find((unit) => unit.conversion_factor <= product.stock_base)
                : preferredUnit;

              return (
                <article
                  key={product.id}
                  className="group flex flex-col overflow-hidden rounded-xl border border-[#E2E8E4] bg-white transition-shadow hover:shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => openProductDialog(product)}
                    aria-label={`View details for ${product.name}`}
                    className="flex flex-1 flex-col text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#15803D]"
                  >
                    <div className="h-36 w-full overflow-hidden bg-[#EEF3F0]">
                      <img
                        src={resolveProductImage(product.image_url)}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    </div>
                    <div className="flex-1 p-3.5 pb-2.5">
                      <h3 className="line-clamp-2 font-display text-sm font-semibold text-[#0F172A]">
                        {product.name}
                      </h3>
                      {showingRecommendations && <p className="mt-1 text-xs text-[#475569]">{product.stock_base.toLocaleString('en-PH')} {product.base_unit} in stock</p>}
                    </div>
                  </button>

                  <div className="flex items-center justify-between gap-2 border-t border-[#E2E8E4] px-3.5 py-2.5">
                    <div className="font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                      {defaultUnit ? formatPHP(defaultUnit.selling_price) : '—'}
                    </div>
                    <button
                      type="button"
                      disabled={!defaultUnit || product.stock_base < (defaultUnit?.conversion_factor ?? 0)}
                      onClick={() => {
                        if (!defaultUnit) return;
                        addItem({
                          product_id: product.id,
                          product_name: product.name,
                          sku: product.sku,
                          image_url: product.image_url,
                          unit_id: defaultUnit.id,
                          unit_name: defaultUnit.unit_name,
                          conversion_factor: defaultUnit.conversion_factor,
                          unit_price: defaultUnit.selling_price,
                        });
                      }}
                      className="rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#166534] disabled:opacity-40 whitespace-nowrap"
                    >
                      Add to Bag
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          {/* Pagination Controls */}
          {!showingRecommendations && <nav
            aria-label="Product catalog pagination"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8E4] bg-white px-4 py-3"
          >
            <div className="font-mono text-xs text-[#64748B] tabular-nums">
              Showing {startIdx}–{endIdx} of {totalAvailableCount} supplies (Page {page} of {totalPages})
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1 || productsQuery.isFetching}
                onClick={() => handlePageChange(Math.max(1, page - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Previous</span>
              </button>

              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                  disabled={productsQuery.isFetching}
                  onClick={() => handlePageChange(p)}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-medium transition-colors tabular-nums ${
                    p === page
                      ? 'border-[#15803D] bg-[#15803D] text-white'
                      : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F7F9F8]'
                  }`}
                >
                  {p}
                </button>
              ))}

              <button
                type="button"
                disabled={!hasMore || productsQuery.isFetching}
                onClick={() => handlePageChange(page + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </nav>}
        </div>
      )}

      {/* Product Detail Dialog */}
      {detailProduct ? (
        (() => {
          const activeUnit =
            detailProduct.units.find((u) => u.id === dialogUnitId) ||
            detailProduct.units.find((u) => u.is_default) ||
            detailProduct.units[0];
          const maxQty = activeUnit
            ? Math.max(0, Math.floor(detailProduct.stock_base / activeUnit.conversion_factor))
            : 0;
          const canAdd = Boolean(activeUnit) && maxQty >= dialogQty && dialogQty >= 1;

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="fixed inset-0 bg-slate-900/50"
                onClick={() => setDetailProduct(null)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="product-dialog-title"
                className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-[#E2E8E4] bg-white shadow-xl"
              >
                <button
                  type="button"
                  aria-label="Close product details"
                  onClick={() => setDetailProduct(null)}
                  className="absolute right-3 top-3 z-10 rounded-lg bg-white/90 p-1.5 text-[#334155] shadow-sm hover:bg-white"
                >
                  <X className="h-5 w-5" />
                </button>

                <div className="aspect-[16/10] w-full overflow-hidden bg-[#EEF3F0]">
                  <img
                    src={resolveProductImage(detailProduct.image_url)}
                    alt={detailProduct.name}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="space-y-4 p-5 sm:p-6">
                  <div>
                    <div className="text-xs text-[#64748B]">
                      {detailProduct.category_name} ·{' '}
                      <span className="font-mono">{detailProduct.sku}</span>
                    </div>
                    <h2
                      id="product-dialog-title"
                      className="mt-1 font-display text-lg font-bold text-[#0F172A]"
                    >
                      {detailProduct.name}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-[#475569]">
                      {detailProduct.description}
                    </p>
                  </div>

                  <div className="space-y-3 border-t border-[#E2E8E4] pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {detailProduct.units.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setDialogUnitId(u.id);
                            setDialogAdded(false);
                          }}
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                            activeUnit?.id === u.id
                              ? 'border-[#15803D] bg-[#F0FDF4] text-[#15803D]'
                              : 'border-[#E2E8E4] bg-white text-[#475569] hover:bg-[#F7F9F8]'
                          }`}
                        >
                          {u.unit_name}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                          {activeUnit ? formatPHP(activeUnit.selling_price) : '—'}
                        </div>
                        <div className="font-mono text-xs text-[#64748B] tabular-nums">
                          Available: {detailProduct.stock_base.toLocaleString()}{' '}
                          {detailProduct.base_unit}
                        </div>
                      </div>

                      <div className="inline-flex items-center rounded-lg border border-[#CBD5E1]">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => {
                            setDialogQty((q) => Math.max(1, q - 1));
                            setDialogAdded(false);
                          }}
                          className="px-2.5 py-1.5 text-[#334155] hover:bg-[#F7F9F8]"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="px-3 font-mono text-xs font-semibold tabular-nums">
                          {dialogQty}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          onClick={() => {
                            setDialogQty((q) => (maxQty > 0 ? Math.min(maxQty, q + 1) : q + 1));
                            setDialogAdded(false);
                          }}
                          className="px-2.5 py-1.5 text-[#334155] hover:bg-[#F7F9F8]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        disabled={!canAdd}
                        onClick={() => {
                          if (!activeUnit) return;
                          addItem(
                            {
                              product_id: detailProduct.id,
                              product_name: detailProduct.name,
                              sku: detailProduct.sku,
                              image_url: detailProduct.image_url,
                              unit_id: activeUnit.id,
                              unit_name: activeUnit.unit_name,
                              conversion_factor: activeUnit.conversion_factor,
                              unit_price: activeUnit.selling_price,
                            },
                            dialogQty
                          );
                          setDialogAdded(true);
                        }}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#15803D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534] disabled:opacity-40"
                      >
                        {dialogAdded ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Added to Bag</span>
                          </>
                        ) : (
                          <span>Add to Bag</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      ) : null}

      {/* Slide-Over Pre-Order Bag Drawer */}
      {cartOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setCartOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col justify-between bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E2E8E4] px-5 py-4">
              <h2 className="font-display text-base font-semibold text-[#0F172A]">
                Pre-Order Bag ({totalCartQty})
              </h2>
              <button
                type="button"
                aria-label="Close bag"
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F7F9F8]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {checkoutError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-[#991B1B]">
                  {checkoutError}
                </div>
              ) : null}

              {cartItems.length === 0 ? (
                <EmptyState
                  title="Your pre-order bag is empty"
                  description="Add agricultural supplies from the storefront catalog to reserve stock for pickup."
                />
              ) : (
                <div className="divide-y divide-[#E2E8E4]">
                  {cartItems.map((item) => (
                    <div key={`${item.product_id}-${item.unit_id}`} className="py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-[#0F172A]">{item.product_name}</div>
                          <div className="font-mono text-xs text-[#64748B]">
                            {item.unit_name} · {formatPHP(item.unit_price)}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${item.product_name}`}
                          onClick={() => removeItem(item.product_id, item.unit_id)}
                          className="text-[#64748B] hover:text-[#DC2626]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="inline-flex items-center rounded-lg border border-[#CBD5E1]">
                          <button
                            type="button"
                            onClick={() => updateQty(item.product_id, item.unit_id, item.quantity - 1)}
                            className="px-2.5 py-1 hover:bg-[#F7F9F8]"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="px-3 font-mono text-xs font-semibold tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQty(item.product_id, item.unit_id, item.quantity + 1)}
                            className="px-2.5 py-1 hover:bg-[#F7F9F8]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {formatPHP(item.quantity * item.unit_price)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cartItems.length > 0 ? (
                <div>
                  <label htmlFor="order-notes" className="block text-xs font-medium text-[#334155]">
                    Pickup Instructions (Optional)
                  </label>
                  <input
                    id="order-notes"
                    type="text"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="e.g. Pickup tomorrow morning at Gate 2"
                    className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
              ) : null}
            </div>

            {cartItems.length > 0 ? (
              <div className="border-t border-[#E2E8E4] p-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[#475569]">Pre-Order Total</span>
                  <span className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                    {formatPHP(getTotal())}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={placeOrderMutation.isPending}
                  onClick={() => setConfirmPreOrderOpen(true)}
                  className="w-full rounded-lg bg-[#15803D] py-3 text-sm font-semibold text-white hover:bg-[#166534] disabled:opacity-50"
                >
                  {placeOrderMutation.isPending
                    ? 'Confirming Pre-Order...'
                    : 'Confirm Pre-Order & Generate Token'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmPreOrderOpen}
        title="Confirm Online Pre-Order"
        description="Reserve these cooperative supplies for counter pickup and generate a fulfillment token."
        details={[
          { label: 'Total Quantity', value: `${totalCartQty} unit(s)` },
          { label: 'Pre-Order Total', value: formatPHP(getTotal()) },
          ...(orderNotes.trim() ? [{ label: 'Pickup Notes', value: orderNotes.trim() }] : []),
        ]}
        confirmLabel="Confirm Pre-Order"
        isPending={placeOrderMutation.isPending}
        onConfirm={() => placeOrderMutation.mutate()}
        onCancel={() => setConfirmPreOrderOpen(false)}
      />
    </div>
  );
}
