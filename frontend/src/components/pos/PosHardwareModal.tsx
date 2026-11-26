import { useEffect } from 'react';
import { Printer, ScanBarcode, Usb, Volume2, VolumeX, X } from 'lucide-react';
import {
  isWebSerialSupported,
  isWebUsbSupported,
  type ConnectedThermalPrinter,
} from '../../lib/posHardware';

export interface PosHardwareSettings {
  hidWedgeArmed: boolean;
  scannerSound: boolean;
  serialBaudRate: number;
}

interface PosHardwareModalProps {
  open: boolean;
  settings: PosHardwareSettings;
  connectedPrinter: ConnectedThermalPrinter | null;
  serialScannerConnected: boolean;
  isBusy: boolean;
  onUpdateSettings: (patch: Partial<PosHardwareSettings>) => void;
  onConnectUsbPrinter: () => void;
  onConnectSerialPrinter: () => void;
  onDisconnectPrinter: () => void;
  onConnectSerialScanner: () => void;
  onDisconnectSerialScanner: () => void;
  onPreviewReceipt: () => void;
  onClose: () => void;
}

export function PosHardwareModal({
  open,
  settings,
  connectedPrinter,
  serialScannerConnected,
  isBusy,
  onUpdateSettings,
  onConnectUsbPrinter,
  onConnectSerialPrinter,
  onDisconnectPrinter,
  onConnectSerialScanner,
  onDisconnectSerialScanner,
  onPreviewReceipt,
  onClose,
}: PosHardwareModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const serialSupported = isWebSerialSupported();
  const usbSupported = isWebUsbSupported();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-hardware-modal-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#E2E8E4] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[#E2E8E4] px-5 py-4">
          <div>
            <h2
              id="pos-hardware-modal-title"
              className="font-display text-base font-semibold text-[#0F172A]"
            >
              Wired 1D Barcode Scanner & 80mm Printer Setup
            </h2>
            <p className="text-xs text-[#64748B]">
              Configure wired USB HID / Serial scanner input and 80mm thermal receipt output
            </p>
          </div>
          <button
            type="button"
            aria-label="Close POS hardware setup"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F7F9F8] hover:text-[#0F172A]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5 text-sm">
          {/* 1D Barcode Scanner Section */}
          <section className="rounded-xl border border-[#E2E8E4] bg-[#F7F9F8] p-4 space-y-3">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-[#0F172A]">
              <ScanBarcode className="h-4 w-4 text-[#15803D]" />
              <h3>Wired 1D Barcode Scanner</h3>
            </div>
            <p className="text-xs leading-relaxed text-[#475569]">
              Standard wired USB 1D scanners work immediately in USB HID Keyboard Wedge mode—scan any
              product barcode (e.g. <span className="font-mono">480001001001</span>) or pre-order
              pickup token (<span className="font-mono">ARG-ORD-...</span>) anywhere on the POS
              register.
            </p>

            <div className="space-y-2 pt-1">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-[#E2E8E4] bg-white px-3 py-2.5 text-xs">
                <div>
                  <div className="font-medium text-[#0F172A]">
                    Global USB HID Wedge Listener
                  </div>
                  <div className="text-[#64748B]">
                    Capture wired 1D scans even when the barcode input is not focused
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.hidWedgeArmed}
                  onChange={(e) => onUpdateSettings({ hidWedgeArmed: e.target.checked })}
                  className="h-4 w-4 accent-[#15803D]"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-[#E2E8E4] bg-white px-3 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  {settings.scannerSound ? (
                    <Volume2 className="h-3.5 w-3.5 text-[#15803D]" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5 text-[#64748B]" />
                  )}
                  <div>
                    <div className="font-medium text-[#0F172A]">Audio Scan Beep</div>
                    <div className="text-[#64748B]">
                      Play short tone when a barcode is matched or unrecognized
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.scannerSound}
                  onChange={(e) => onUpdateSettings({ scannerSound: e.target.checked })}
                  className="h-4 w-4 accent-[#15803D]"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-[#64748B]">
                Optional RS-232 / Virtual COM Scanner:
              </span>
              {serialScannerConnected ? (
                <button
                  type="button"
                  onClick={onDisconnectSerialScanner}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-[#DC2626] hover:bg-red-100"
                >
                  Disconnect Serial Scanner
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!serialSupported || isBusy}
                  onClick={onConnectSerialScanner}
                  className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D] disabled:opacity-45"
                >
                  {serialSupported ? 'Pair Serial COM Scanner' : 'Web Serial Unavailable'}
                </button>
              )}
            </div>
          </section>

          {/* 80mm Thermal Printer Section */}
          <section className="rounded-xl border border-[#E2E8E4] bg-[#F7F9F8] p-4 space-y-3">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-[#0F172A]">
              <Printer className="h-4 w-4 text-[#15803D]" />
              <h3>80mm Thermal Receipt Printer</h3>
            </div>
            <p className="text-xs leading-relaxed text-[#475569]">
              Preview or download an 80mm receipt as a PDF. The printer pairing controls are available for setup.
            </p>

            <div className="rounded-lg border border-[#E2E8E4] bg-white p-3 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-[#0F172A]">Direct ESC/POS Hardware Link</div>
                  <div className="font-mono text-[11px] text-[#64748B]">
                    {connectedPrinter ? `Paired: ${connectedPrinter.label}` : 'No printer paired'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="escpos-baud" className="text-[#64748B]">
                    Baud:
                  </label>
                  <select
                    id="escpos-baud"
                    value={settings.serialBaudRate}
                    onChange={(e) => onUpdateSettings({ serialBaudRate: Number(e.target.value) })}
                    className="rounded border border-[#CBD5E1] bg-white px-2 py-1 font-mono text-xs"
                  >
                    <option value={9600}>9600</option>
                    <option value={19200}>19200</option>
                    <option value={38400}>38400</option>
                    <option value={115200}>115200</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {connectedPrinter ? (
                  <button
                    type="button"
                    onClick={onDisconnectPrinter}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-[#DC2626] hover:bg-red-100"
                  >
                    Unpair Direct Printer
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!usbSupported || isBusy}
                      onClick={onConnectUsbPrinter}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D] disabled:opacity-45"
                    >
                      <Usb className="h-3.5 w-3.5" />
                      {usbSupported ? 'Pair USB 80mm Printer' : 'WebUSB Unavailable'}
                    </button>
                    <button
                      type="button"
                      disabled={!serialSupported || isBusy}
                      onClick={onConnectSerialPrinter}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:border-[#15803D] hover:text-[#15803D] disabled:opacity-45"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {serialSupported ? 'Pair Serial 80mm Printer' : 'Web Serial Unavailable'}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={onPreviewReceipt}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#166534]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Preview 80mm Receipt
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-[#E2E8E4] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E293B]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
