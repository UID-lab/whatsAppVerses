import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Renders `value` as a QR code (used so desktop visitors can open the WhatsApp link on their phone). */
export function QrImage({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2 }).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={label} /> : <div className="qr qr-loading" style={{ width: size, height: size }} />;
}
