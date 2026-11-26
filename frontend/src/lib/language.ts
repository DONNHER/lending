import { create } from 'zustand';

export type Language = 'en' | 'fil';

const FILIPINO = {
  Language: 'Wika',
  Workspace: 'Lugar ng trabaho',
  Dashboard: 'Buod',
  'POS Terminal': 'Terminal ng POS',
  'POS Register': 'Kaha ng POS',
  'Sales & Returns': 'Benta at Pagsasauli',
  'Online Shop': 'Tindahan Online',
  'All Supplies': 'Lahat ng Suplay',
  'Crop Care & Inputs': 'Pangangalaga sa Pananim',
  'Fertilizers & Soil': 'Pataba at Lupa',
  'Livestock Feed': 'Pakain sa Hayop',
  'Seeds & Planting': 'Binhi at Pagtatanim',
  Orders: 'Mga Order',
  'All Orders': 'Lahat ng Order',
  Confirmed: 'Nakumpirma',
  Fulfilled: 'Naibigay na',
  Cancelled: 'Kinansela',
  'Products & Inventory': 'Produkto at Imbentaryo',
  'Stock Balances': 'Natitirang Stock',
  'Ledger Movements': 'Galaw ng Stock',
  'Receive Stock': 'Tumanggap ng Stock',
  Adjustment: 'Pagwawasto',
  'New Product': 'Bagong Produkto',
  'Import / Export': 'Mag-import / Mag-export',
  Shareholders: 'Mga Miyembro',
  Shareholder: 'Miyembro',
  Loans: 'Mga Pautang',
  Loan: 'Pautang',
  Membership: 'Pagkamiyembro',
  Reports: 'Mga Ulat',
  'Settings & Admin': 'Mga Setting at Admin',
  'Users & Roles': 'Mga User at Tungkulin',
  'Capital & Loan Policy': 'Patakaran sa Kapital at Pautang',
  'Offline Sync & Conflicts': 'Offline Sync at Mga Salungatan',
  'Audit Logs': 'Talaan ng mga Pagbabago',
  'Data & Backups': 'Datos at mga Backup',
  Profile: 'Profile',
  'Active Workspace': 'Kasalukuyang Lugar ng Trabaho',
  'Close navigation menu': 'Isara ang menu',
  'Open navigation menu': 'Buksan ang menu',
  'Collapse sidebar to icon rail': 'Ipakita ang mga icon lamang sa sidebar',
  'Collapse sidebar': 'Paliitin ang sidebar',
  'Expand sidebar': 'Palawakin ang sidebar',
  'Expand full sidebar': 'Ipakita ang buong sidebar',
  'Close mini sidebar': 'Isara ang maliit na sidebar',
  'Switch shareholder workspace': 'Lumipat ng lugar ng trabaho ng miyembro',
  'Workspace navigation': 'Menu ng mga lugar ng trabaho',
  'Workspace icon rail': 'Mga icon ng lugar ng trabaho',
  'Online Shop mode': 'Buksan ang tindahan online',
  'Loan mode': 'Buksan ang pahina ng pautang',
  'Open profile page': 'Buksan ang profile',
  'Sub-directory': 'Mga seksiyon',
  'Pin Full Sidebar': 'Panatilihing bukas ang sidebar',
  'Toggle {item} sub-directory': 'Buksan o isara ang mga seksiyon ng {item}',
  '{item} sub-directory': 'Mga seksiyon ng {item}',
  '{item} mini sidebar': 'Maliit na sidebar ng {item}',
  'Open {item}': 'Buksan ang {item}',
  '{count} offline queued': '{count} bentang offline na naghihintay',
  '{role} Portal': 'Portal ng {role}',
  'Impersonating {user} ({role}) · Admin: {admin}': 'Tinitingnan bilang {user} ({role}) · Admin: {admin}',
  admin: 'admin',
  manager: 'tagapamahala',
  cashier: 'kahera',
  shareholder: 'miyembro',
  'Exit Impersonation': 'Bumalik sa Admin',
  'Current subtotal': 'Kasalukuyang subtotal',
  'Pre-Order Bag ({count})': 'Mga Paunang Order ({count})',
  'Bag ({count})': 'Bag ({count})',
  'Checkout Register': 'Kaha',
  '1D Scanner & 80mm Printer': '1D Scanner at 80mm Printer',
  'Offline · Cash only': 'Offline · Cash lamang',
  Online: 'Online',
  syncing: 'sini-sync',
  'pending sync': 'naghihintay ng sync',
  'Connect once to download the product catalog before taking offline sales.': 'Kumonekta muna para ma-download ang katalogo bago magbenta nang offline.',
  Dismiss: 'Isara',
  'Wired 1D Barcode Scanner': 'Wired na 1D Barcode Scanner',
  'Scan 1D product barcode (e.g. 480001001001) or pickup token (ARG-ORD-...) to auto-add to cart': 'I-scan ang barcode ng produkto (hal. 480001001001) o pickup code (ARG-ORD-...).',
  'USB HID Wedge: Armed': 'Handa ang USB scanner',
  'Input Focus Only': 'Sa scan field lamang',
  'Wired 1D barcode scanner input': 'Lalagyan ng code mula sa 1D barcode scanner',
  'Focus here or pull wired 1D scanner trigger (480001001001)...': 'Ilagay ang cursor dito o gamitin ang scanner (480001001001)...',
  'Scan / Add': 'I-scan / Idagdag',
  'Product & Barcode Search': 'Maghanap ng Produkto o Barcode',
  'Indexed lookup by SKU prefix, exact barcode, or product name (max 10 results)': 'Maghanap ayon sa simula ng SKU, eksaktong barcode, o pangalan (hanggang 10 resulta).',
  'Search POS products by name, SKU, or barcode': 'Maghanap ayon sa pangalan, SKU, o barcode',
  'Search SKU (AGR-FERT), barcode (480001001001), or product name...': 'Ilagay ang SKU (AGR-FERT), barcode (480001001001), o pangalan...',
  'Start typing to search catalog': 'Mag-type para maghanap sa katalogo',
  'Enter at least 1 character of a product name, SKU prefix, or scan a barcode.': 'Mag-type ng pangalan o SKU, o i-scan ang barcode.',
  'No matching products': 'Walang tumugmang produkto',
  'No active inventory items matched "{query}". Try searching "AGR", "Fertilizer", or "Seeds".': 'Walang aktibong produkto para sa "{query}". Subukang hanapin ang "AGR", "Fertilizer", o "Seeds".',
  'Online Pre-Order Token Fulfillment': 'Pag-release ng Online na Paunang Order',
  'Scan or enter a shareholder pickup token (e.g. ARG-ORD-8821) to convert an online pre-order into a POS sale': 'I-scan o ilagay ang pickup code ng miyembro (hal. ARG-ORD-8821) para maitala ang paunang order bilang benta.',
  'Pre-order fulfillment token': 'Code ng paunang order',
  'Enter token code (e.g. ARG-ORD-8821)': 'Ilagay ang code (hal. ARG-ORD-8821)',
  'Checking...': 'Sinusuri...',
  'Retrieve Order': 'Hanapin ang Order',
  Clear: 'Alisin',
  'Fulfilling...': 'Ipinoproseso ang order...',
  'Fulfill & Deduct Stock': 'I-release at Bawasan ang Stock',
  'Current Transaction': 'Kasalukuyang Transaksyon',
  'Clear Cart': 'Alisin Lahat sa Cart',
  'Select a product unit on the left to begin checkout.': 'Pumili ng yunit ng produkto sa kaliwa para magsimulang mag-checkout.',
  'Remove {product}': 'Alisin ang {product}',
  'Decrease quantity for {product}': 'Bawasan ang dami ng {product}',
  'Increase quantity for {product}': 'Dagdagan ang dami ng {product}',
  'Payment Method': 'Paraan ng Pagbabayad',
  'Total Due': 'Kabuuang Babayaran',
  cash: 'cash',
  gcash: 'GCash',
  'bank transfer': 'lipat sa bangko',
  'Posting Transaction...': 'Itinatala ang transaksyon...',
  'Save Cash Sale': 'I-save ang Cash Sale',
  'Complete Sale': 'Tapusin ang Benta',
  '80mm Thermal Receipt': '80mm na Resibo',
  'Offline Receipt': 'Resibong Offline',
  Posted: 'Naitala na',
  'Preview Receipt': 'Tingnan ang Resibo',
  'POS Sales & Returns Ledger': 'Talaan ng Benta at Pagsasauli',
  'Process returns to refund customers and restore base-unit inventory balances': 'Iproseso ang pagsasauli para maibalik ang bayad at stock.',
  'Sale #': 'Numero ng Benta',
  Source: 'Pinagmulan',
  Items: 'Mga Item',
  Status: 'Katayuan',
  Total: 'Kabuuan',
  Date: 'Petsa',
  Action: 'Gagawin',
  completed: 'tapos na',
  partially_returned: 'bahagyang isinauli',
  returned: 'isinauli',
  '80mm Receipt': '80mm na Resibo',
  Return: 'Isauli',
  Returned: 'Isinauli',
  Cancel: 'Kanselahin',
  'Confirm Return for {sale} ({total})': 'Kumpirmahin ang pagsasauli para sa {sale} ({total})',
  'Reason for return': 'Dahilan ng pagsasauli',
  'Processing...': 'Ipinoproseso...',
  'Confirm Refund & Restore Stock': 'Kumpirmahin ang Refund at Ibalik ang Stock',
  'Confirm Offline Cash Sale': 'Kumpirmahin ang Offline na Cash Sale',
  'Confirm POS Checkout Sale': 'Kumpirmahin ang Benta sa POS',
  'Save this transaction to the local offline outbox queue for later synchronization.': 'I-save ang bentang ito sa computer. Isi-sync ito kapag may koneksyon na.',
  'Complete this sale, record payment, and deduct stock from central warehouse balances.': 'Tapusin ang benta, itala ang bayad, at bawasan ang stock sa bodega.',
  'Line Items': 'Mga Item sa Benta',
  '{count} line(s)': '{count} na item',
  'Save Offline Sale': 'I-save ang Bentang Offline',
  'Confirm Pre-Order Fulfillment': 'Kumpirmahin ang Pag-release ng Order',
  'Convert this confirmed shareholder pre-order into a completed POS sale and deduct stock.': 'Itala ang paunang order ng miyembro bilang benta at bawasan ang stock.',
  'Order Number': 'Numero ng Order',
  Token: 'Code',
  'Confirm Sale Return & Refund': 'Kumpirmahin ang Pagsasauli at Refund',
  'Refund this sale and restore the sold base-unit quantities back into inventory.': 'Ibalik ang bayad at ang dami ng naibentang produkto sa imbentaryo.',
  'Sale Number': 'Numero ng Benta',
  'Refund Total': 'Kabuuang Ibabalik na Bayad',
  Reason: 'Dahilan',
  'Confirm Refund': 'Kumpirmahin ang Refund',
  'Cash sale saved on this computer. It will sync when the server is reachable.': 'Naka-save sa computer ang cash sale. Isi-sync ito kapag may koneksyon na sa server.',
  'Sale {sale} completed.': 'Tapos na ang bentang {sale}.',
  'Checkout failed.': 'Hindi nakumpleto ang benta.',
  'Loaded pre-order {order} ({member}).': 'Nahanap ang paunang order na {order} ({member}).',
  'Unable to find pre-order token.': 'Hindi nahanap ang code ng paunang order.',
  'Pre-order fulfilled as POS sale {sale}.': 'Naitala ang paunang order bilang bentang {sale}.',
  'Unable to fulfill pre-order.': 'Hindi na-release ang paunang order.',
  'Return processed ({total} refunded and stock restored).': 'Tapos na ang pagsasauli ({total} ang ibinalik at naidagdag muli ang stock).',
  'Return failed.': 'Hindi naiproseso ang pagsasauli.',
  'Each item must have a positive quantity at the supported precision.': 'Maglagay ng daming mas mataas sa zero para sa bawat item.',
  'Reconnect to fulfill pre-orders.': 'Kumonekta muli para ma-release ang mga paunang order.',
  'Reconnect to process returns.': 'Kumonekta muli para maproseso ang mga pagsasauli.',
  'Reconnect to look up pre-orders.': 'Kumonekta muli para mahanap ang mga paunang order.',
  'No active product matched scanned 1D barcode "{code}".': 'Walang aktibong produkto para sa na-scan na barcode na "{code}".',
  '{product} has no selling unit configured.': 'Walang nakatakdang yunit ng pagbebenta para sa {product}.',
  '1D Scan: Added 1 × {unit} {product} ({code}).': 'Na-scan at naidagdag ang 1 × {unit} {product} ({code}).',
  'The register could not save the sale. The cart is still open.': 'Hindi na-save ng kaha ang benta. Bukas pa rin ang cart.',
  'Server unavailable. Reconnect to finish this non-cash transaction.': 'Hindi maabot ang server. Kumonekta muli para matapos ang transaksyong hindi cash.',
  'There isn’t enough stock in the saved catalog for {product}.': 'Kulang ang stock ng {product} sa naka-save na katalogo.',
  '{count} offline sale(s) need manager review in Settings → Offline Sync & Conflicts.': 'Kailangang suriin ng tagapamahala ang {count} bentang offline sa Mga Setting → Offline Sync at Mga Salungatan.',
  '{count} offline sale(s) synced.': 'Na-sync na ang {count} bentang offline.',
  'Sales reached the server, but the register could not update its queue.': 'Nakarating ang mga benta sa server, pero hindi na-update ang pila sa kaha.',
  'Sign in again to sync saved sales.': 'Mag-sign in muli para ma-sync ang mga naka-save na benta.',
  'Sales are still saved on this computer. Sync will retry when the server responds.': 'Naka-save pa rin dito ang mga benta. Susubukan ulit ang sync kapag sumagot ang server.',
} satisfies Record<string, string>;

export type MessageKey = keyof typeof FILIPINO;
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
const LANGUAGE_KEY = 'argivit_ui_language';

function initialLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'fil' ? 'fil' : 'en';
  } catch {
    return 'en';
  }
}

function applyDocumentLanguage(language: Language) {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

const initial = initialLanguage();
applyDocumentLanguage(initial);

export const useLanguage = create<{ language: Language; setLanguage: (language: Language) => void }>((set) => ({
  language: initial,
  setLanguage(language) {
    set({ language });
    applyDocumentLanguage(language);
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // The current tab can still use the selected language.
    }
  },
}));

const translators: Record<Language, Translate> = {
  en: (key, values) => interpolate(key, values),
  fil: (key, values) => interpolate(FILIPINO[key], values),
};

function interpolate(text: string, values?: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values?.[name] ?? placeholder));
}

export function useTranslate(): Translate {
  return useLanguage((state) => translators[state.language]);
}
