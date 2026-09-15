import React, { useState, useEffect } from 'react';
import { uploadPaper, getExams } from '../services/api';
import './Components.css';

export default function PaperUploader() {
    const [examId, setExamId] = useState('');
    const [file, setFile] = useState(null);
    const [status, setStatus] = useState({ type: '', message: '' });
    const [loading, setLoading] = useState(false);
    const [exams, setExams] = useState([]);

    const fetchExams = () => {
        getExams().then(res => setExams(res.data)).catch(console.error);
    };

    useEffect(() => {
        fetchExams();
    }, []);

    const handleFileChange = (e) => {
        setStatus({ type: '', message: '' });
        const selectedFile = e.target.files[0];
        
        if (selectedFile) {
            const ext = selectedFile.name.split('.').pop().toLowerCase();
            if (ext !== 'pdf' && ext !== 'docx') {
                setStatus({ type: 'error', message: 'Invalid file type. Only PDF and DOCX are allowed.' });
                setFile(null);
                e.target.value = ''; // Reset input
                return;
            }
            setFile(selectedFile);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!examId.trim()) {
            setStatus({ type: 'error', message: 'Exam ID is required.' });
            return;
        }
        if (!file) {
            setStatus({ type: 'error', message: 'Please select a valid PDF or DOCX file.' });
            return;
        }

        setLoading(true);
        setStatus({ type: '', message: '' });

        try {
            await uploadPaper(examId, file);
            setStatus({ type: 'success', message: `Paper uploaded successfully for exam ${examId}` });
            setExamId('');
            setFile(null);
            e.target.reset(); // Clear file input visually
            fetchExams(); // Refresh list
        } catch (err) {
            console.error("Upload error:", err);
            const errMsg = err.response?.data?.error || "Upload failed due to network or server error.";
            setStatus({ type: 'error', message: errMsg });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="paper-uploader">
            <h3>Upload Exam Paper</h3>
            <form onSubmit={handleSubmit} className="uploader-form">
                <div className="form-group">
                    <label>Exam ID:</label>
                    <input 
                        type="text" 
                        value={examId} 
                        onChange={(e) => setExamId(e.target.value)} 
                        placeholder="e.g. EXAM-101"
                        disabled={loading}
                    />
                </div>
                <div className="form-group">
                    <label>Paper File (PDF/DOCX):</label>
                    <input 
                        type="file" 
                        accept=".pdf,.docx" 
                        onChange={handleFileChange}
                        disabled={loading}
                    />
                </div>
                <button type="submit" disabled={loading || !file || !examId.trim()}>
                    {loading ? 'Uploading...' : 'Upload Paper'}
                </button>
            </form>
            {status.message && (
                <div className={`status-message ${status.type}`}>
                    {status.message}
                </div>
            )}

            <div className="active-exams-section" style={{ marginTop: '30px' }}>
                <h3>Created Exams</h3>
                {exams.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '14px' }}>No exams created yet.</p>
                ) : (
                    <table className="student-table" style={{ marginTop: '10px' }}>
                        <thead>
                            <tr>
                                <th>Exam ID</th>
                                <th>Paper Filename</th>
                                <th>Created At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {exams.map(ex => (
                                <tr key={ex._id}>
                                    <td className="mono" style={{ fontWeight: '600' }}>{ex.examId}</td>
                                    <td>{ex.paperFilename}</td>
                                    <td style={{ color: '#64748b' }}>{new Date(ex.createdAt).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}