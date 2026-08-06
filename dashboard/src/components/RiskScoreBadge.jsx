import React from 'react';
import './Components.css';

export default function RiskScoreBadge({ score }) {
    // Treat undefined or null as 0
    const numericScore = typeof score === 'number' ? score : 0;
    
    let colorClass = 'risk-green';
    if (numericScore >= 30 && numericScore <= 60) colorClass = 'risk-yellow';
    if (numericScore > 60) colorClass = 'risk-red';

    return (
        <span className={`risk-badge ${colorClass}`}>
            {numericScore}/100
        </span>
    );
}