export interface PrintLedger {
  id: string;
  headers: string[];
  rows: Array<Array<number | string>>;
}

export function printReport(source: HTMLElement, title: string, period: string, ledger: PrintLedger | null): boolean {
  const popup = window.open('', '_blank', 'popup,width=900,height=750');
  if (!popup) return false;

  popup.opener = null;
  const doc = popup.document;
  doc.documentElement.lang = 'en';
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = `
    @page {
      size: A4 portrait;
      margin: 15mm;
      @bottom-left { content: 'Agrivit Store'; color: #475569; font: 9pt sans-serif; }
      @bottom-right { content: 'Page ' counter(page) ' of ' counter(pages); color: #475569; font: 9pt sans-serif; }
    }
    body { margin: 0; font: 10pt system-ui, sans-serif; color: #0f172a; }
    header { margin-bottom: 16px; border-bottom: 2px solid #166534; padding-bottom: 12px; }
    header strong { color: #166534; }
    h1 { font-size: 20pt; margin: 6px 0; }
    h3 { margin-bottom: 6px; }
    main > :first-child, main section { margin: 12px 0; }
    main :is(.grid) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
    main .grid > div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; break-inside: avoid; }
    main .grid > div .grid { margin: 0; }
    [data-report-control] { display: none; }
    table { border-collapse: collapse; width: 100%; font-size: 8pt; }
    th, td { border-bottom: 1px solid #d1d5db; padding: 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { color: #14532d; background: #eef5ef; }
    tr { break-inside: avoid; }
    svg { max-width: 100%; height: auto; }
    .recharts-responsive-container { max-height: 210px; overflow: hidden; }
    .recharts-tooltip-wrapper { display: none; }
    @media screen { body { max-width: 780px; margin: 24px auto; padding: 0 14px; } }
  `;
  doc.head.append(style);

  const header = doc.createElement('header');
  const brand = doc.createElement('strong');
  brand.textContent = 'Agrivit Store';
  const heading = doc.createElement('h1');
  heading.textContent = title;
  const metadata = doc.createElement('div');
  metadata.textContent = `${period} · Generated ${new Date().toLocaleString('en-PH')}`;
  header.append(brand, heading, metadata);

  const content = doc.importNode(source, true);
  content.querySelectorAll('[data-report-control]').forEach((element) => element.remove());
  if (ledger) {
    const section = content.querySelector(`#${ledger.id}`);
    if (section && ledger.rows.length > 0) {
      section.querySelector('table')?.parentElement?.remove();
      const table = doc.createElement('table');
      const headerRow = table.createTHead().insertRow();
      ledger.headers.forEach((label) => {
        const cell = doc.createElement('th');
        cell.scope = 'col';
        cell.textContent = label;
        headerRow.append(cell);
      });
      const body = table.createTBody();
      ledger.rows.forEach((values) => {
        const row = body.insertRow();
        values.forEach((value) => { row.insertCell().textContent = String(value); });
      });
      section.append(table);
    }
  }
  const main = doc.createElement('main');
  main.append(content);
  doc.body.replaceChildren(header, main);

  popup.focus();
  popup.print();
  return true;
}
