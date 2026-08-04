import React from 'react';
import StudentList from '../components/StudentList';
import AlertFeed from '../components/AlertFeed';
import EvidenceViewer from '../components/EvidenceViewer';
import RiskScoreBadge from '../components/RiskScoreBadge';
import PaperUploader from '../components/PaperUploader';

export default function Dashboard() {
  return (
    <div>
      <h1>Examiner Dashboard</h1>
      <StudentList />
      <AlertFeed />
      <EvidenceViewer />
      <RiskScoreBadge />
      <PaperUploader />
    </div>
  );
}
