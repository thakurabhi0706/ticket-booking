/**
 * qrService.js — QR code PNG generation using the `qrcode` package.
 * Falls back to a data URL placeholder if generation fails.
 */
import QRCode from 'qrcode';

export async function generateQR(payload) {
  try {
    return await QRCode.toBuffer(payload, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#FFFFFF' },
    });
  } catch (err) {
    console.error('[qr] Generation failed:', err.message);
    return null;
  }
}

export async function generateQRDataURL(payload) {
  try {
    return await QRCode.toDataURL(payload, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#FFFFFF' },
    });
  } catch (err) {
    console.error('[qr] DataURL generation failed:', err.message);
    return null;
  }
}
