import React, { useState } from 'react';

export default function AudioEvidence({ src, ...props }) {
    const [failedSrc, setFailedSrc] = useState(null);
    return <div>
        <audio {...props} src={src} preload="metadata" onError={() => setFailedSrc(src)} />
        {failedSrc === src && <p role="status">Audio could not load. Refresh your login and retry; ask the examiner to check the evidence file.</p>}
    </div>;
}
