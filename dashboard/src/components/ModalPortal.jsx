import { useEffect } from 'react';
import { createPortal } from 'react-dom';

let openPortalCount = 0;
let previousOverflow = '';

export default function ModalPortal({ children }) {
    useEffect(() => {
        if (openPortalCount === 0) {
            previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        openPortalCount += 1;
        return () => {
            openPortalCount = Math.max(0, openPortalCount - 1);
            if (openPortalCount === 0) {
                document.body.style.overflow = previousOverflow;
            }
        };
    }, []);

    if (typeof document === 'undefined') return null;
    return createPortal(children, document.body);
}
