import React from 'react';
import './Components.css';

export default function RiskScoreBadge({ score }) {
    const numericScore = typeof score === 'number' && Number.isFinite(score) ? score : null;
    
    let colorClass = 'risk-unavailable';
    if (numericScore !== null) colorClass = numericScore > 60 ? 'risk-red' : numericScore >= 30 ? 'risk-yellow' : 'risk-green';

    return (
        <span className={`risk-badge ${colorClass}`} aria-label={numericScore === null ? 'Risk score unavailable' : `Risk score ${numericScore} out of 100`}>
            {numericScore === null ? '—' : `${numericScore}/100`}
        </span>
    );
}
