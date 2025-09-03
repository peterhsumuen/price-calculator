import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { initializeApp } from 'firebase/app';
import './App.css';
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    addDoc,
    onSnapshot,
    query,
    orderBy,
    where,
    doc,
    setDoc,
    deleteDoc,
    serverTimestamp
} from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Moved outside component to prevent re-declaration on every render and fix dependency warnings.
const PRICING_RULES = {
    'Full gut': (sf) => {
        const parsedSF = parseFloat(sf);
        if (isNaN(parsedSF)) return 0;
        return parsedSF >= 700 ? 250 * parsedSF : 300 * parsedSF;
    },
    'Additional building/ new construction': (sf) => 600 * parseFloat(sf || 0),
    'Structural Wall removal': (sf) => (parseFloat(sf || 0) <= 700 ? 45000 : 0),
    '2nd Structural Wall removal': (sf) => (parseFloat(sf || 0) <= 700 ? 6000 : 0),
    'Kitchen': (sf) => (500 * parseFloat(sf || 0)) + 20000,
    'Bathroom': (sf) => (500 * parseFloat(sf || 0)) + 20000,
    'Living room': (sf) => (parseFloat(sf || 0) <= 700 ? 300 * parseFloat(sf || 0) : 0),
    'Garage': (sf) => 465 * parseFloat(sf || 0),
    'Bedroom': (sf) => (parseFloat(sf || 0) > 700 ? 0 : 300 * parseFloat(sf || 0)),
    'Landscape': () => 0,
};

// Price Calculator Component
function PriceCalculator({ user, onLogout, onPageChange, initialData, scopeOfWork }) {
    const [items, setItems] = useState([{ id: uuidv4(), type: 'Full gut', sf: '' }]);
    const [totalPrice, setTotalPrice] = useState(0);
    const [projectName, setProjectName] = useState('');
    const [address, setAddress] = useState('');
    const [clientName, setClientName] = useState('');
    const [scopeOfWorkText, setScopeOfWorkText] = useState('');
    const [saveStatus, setSaveStatus] = useState('');
    const [blueprintUrl, setBlueprintUrl] = useState(null);
    const [analysisData, setAnalysisData] = useState(null);
    const [editingProjectId, setEditingProjectId] = useState(null);

    useEffect(() => {
        if (initialData) {
            setProjectName(initialData.projectName || '');
            setAddress(initialData.address || '');
            setClientName(initialData.clientName || '');
            setScopeOfWorkText(initialData.scopeOfWork || '');
            setBlueprintUrl(initialData.blueprintUrl || null);
            setAnalysisData(initialData.analysisResult || null);
            setEditingProjectId(initialData.id || null);

            let itemsToSet;
            if (Array.isArray(initialData.items)) {
                itemsToSet = initialData.items.map(item => ({ ...item, id: uuidv4() }));
            } else if (typeof initialData.items === 'object' && initialData.items !== null) {
                itemsToSet = Object.entries(initialData.items)
                    .filter(([key]) => PRICING_RULES[key] !== undefined)
                    .map(([type, sf]) => ({ id: uuidv4(), type, sf: sf.toString() }));
            }

            setItems(itemsToSet && itemsToSet.length > 0 ? itemsToSet : [{ id: uuidv4(), type: 'Full gut', sf: '' }]);
        } else {
            setProjectName('');
            setAddress('');
            setClientName('');
            setScopeOfWorkText('');
            setItems([{ id: uuidv4(), type: 'Full gut', sf: '' }]);
            setBlueprintUrl(null);
            setAnalysisData(null);
            setEditingProjectId(null);
        }
    }, [initialData]);

    useEffect(() => {
        if (scopeOfWork) {
            setScopeOfWorkText(scopeOfWork);
        }
    }, [scopeOfWork]);

    useEffect(() => {
        let total = 0;
        const fullGutSF = parseFloat(items.find(item => item.type === 'Full gut')?.sf) || 0;
        items.forEach(item => {
            const parsedSF = parseFloat(item.sf) || 0;
            if (parsedSF === 0) return;
            const itemType = item.type;
            let priceForItem = 0;
            const isSpecialCase = ['Structural Wall removal', '2nd Structural Wall removal', 'Living room', 'Bedroom'].includes(itemType);
            if (isSpecialCase && fullGutSF === 0) {
                priceForItem = PRICING_RULES['Full gut'](parsedSF);
            } else {
                const calculatePrice = PRICING_RULES[itemType];
                if (calculatePrice) priceForItem = calculatePrice(parsedSF);
            }
            total += priceForItem;
        });
        setTotalPrice(total);
    }, [items]);

    const handleChange = (id, field, value) => setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
    const handleAddItem = () => setItems([...items, { id: uuidv4(), type: 'Full gut', sf: '' }]);
    const handleRemoveItem = (id) => setItems(items.filter(item => item.id !== id));

    const saveProject = async () => {
        if (!projectName || !address || !clientName) {
            setSaveStatus("Please fill out all project details before saving.");
            return;
        }
        setSaveStatus("Saving...");
        const projectData = {
            projectName, address, clientName, scopeOfWork: scopeOfWorkText, finalPrice: totalPrice,
            items: items.map(({ id, ...rest }) => rest),
            blueprintUrl,
            analysisResult: analysisData,
        };
        try {
            if (editingProjectId) {
                const projectRef = doc(db, 'projects', editingProjectId);
                await setDoc(projectRef, { ...projectData, modifiedBy: user.email, modifiedAt: serverTimestamp() }, { merge: true });
                setSaveStatus("Project updated successfully!");
            } else {
                await addDoc(collection(db, `projects`), { ...projectData, userId: user.uid, userName: user.email, createdAt: serverTimestamp() });
                setSaveStatus("Project saved successfully!");
            }
            setTimeout(() => { setSaveStatus(''); onPageChange('records'); }, 2000);
        } catch (e) {
            setSaveStatus("Error saving project: " + e.message);
        }
    };

    const options = [
        { value: 'Full gut', label: 'Full gut' },
        { value: 'Additional building/ new construction', label: 'Additional building / new construction' },
        { value: 'Structural Wall removal', label: 'Structural Wall removal (Enter Full SF)' },
        { value: '2nd Structural Wall removal', label: '2nd Structural Wall removal (Enter Full SF)' },
        { value: 'Kitchen', label: 'Kitchen' },
        { value: 'Bathroom', label: 'Bathroom' },
        { value: 'Living room', label: 'Living room (Enter Full SF)' },
        { value: 'Garage', label: 'Garage' },
        { value: 'Bedroom', label: 'Bedroom (Enter Full SF)' },
        { value: 'Landscape', label: 'Landscape (Coming Soon)' }
    ];

    return (
        <div className="app-container">
            <div className="calculator-card">
                <header className="header"><span className="user-info">Welcome, {user.email}!</span><button onClick={onLogout} className="logout-btn">Logout</button></header>
                <div className="nav-buttons">
                    <button className="nav-btn-active">Calculator</button>
                    <button onClick={() => onPageChange('records')} className="nav-btn">Records</button>
                    <button onClick={() => onPageChange('analyzer')} className="nav-btn">Blueprint Analyzer</button>
                    <button onClick={() => onPageChange('voiceAnalyzer')} className="nav-btn">Voice Analyzer</button>
                </div>
                <h1 className="title">{editingProjectId ? 'Modify Project' : 'Pricing Calculator'}</h1>
                <div className="project-details">
                    <div className="input-group">
                        <label className="input-label">Project Name</label>
                        <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="input-field" />
                    </div>
                    <div className="input-group">
                        <label className="input-label">Address</label>
                        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" />
                    </div>
                    <div className="input-group">
                        <label className="input-label">Client Name</label>
                        <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-field" />
                    </div>
                    <div className="input-group">
                        <label className="input-label">Scope of Work</label>
                        <textarea
                            value={scopeOfWorkText}
                            onChange={(e) => setScopeOfWorkText(e.target.value)}
                            className="input-field"
                            rows={4}
                        />
                    </div>
                </div>
                <div className="items-container">{items.map((item) => (
                    <div key={item.id} className="item-row">
                        <div className="input-group">
                            <select value={item.type} onChange={(e) => handleChange(item.id, 'type', e.target.value)} className="input-field">
                                {options.map(option => (<option key={option.value} value={option.value}>{option.label}</option>))}
                            </select>
                        </div>
                        <div className="input-group">
                            <input type="number" placeholder="Square Feet" value={item.sf} onChange={(e) => handleChange(item.id, 'sf', e.target.value)} className="input-field" />
                        </div>
                        {items.length > 1 && (<button onClick={() => handleRemoveItem(item.id)} className="remove-btn">Remove</button>)}
                    </div>))}
                </div>
                <button onClick={handleAddItem} className="add-btn">+ Add Item</button>
                <div className="total-display">
                    <span className="total-label">Total Price:</span>
                    <span className="calculator-total-price">${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="save-container">
                    {saveStatus && <p className="save-status">{saveStatus}</p>}
                    <button onClick={saveProject} className="save-btn">{editingProjectId ? 'Update Project' : 'Save Project'}</button>
                </div>
            </div>
        </div>
    );
}

// Records Page Component
function RecordsPage({ user, onLogout, onPageChange }) {
    const [projects, setProjects] = useState([]);
    const [expandedRow, setExpandedRow] = useState(null);
    const [projectToDelete, setProjectToDelete] = useState(null);

    useEffect(() => {
        if (!user) return;
        const ADMIN_EMAILS = ['test@baroncnr.com'];
        const isAdmin = ADMIN_EMAILS.includes(user.email);
        const q = isAdmin ? query(collection(db, 'projects'), orderBy('createdAt', 'desc')) : query(collection(db, 'projects'), where('userName', '==', user.email), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
        return () => unsubscribe();
    }, [user]);

    const handleDeleteClick = (project) => setProjectToDelete(project);
    const confirmDelete = async () => {
        if (!projectToDelete) return;
        try {
            await deleteDoc(doc(db, 'projects', projectToDelete.id));
            setProjectToDelete(null);
        } catch (error) { console.error("Error deleting project:", error); }
    };
    const cancelDelete = () => setProjectToDelete(null);

    return (
        <div className="app-container">
            {projectToDelete && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h2>Are you sure?</h2><p>This will permanently delete the project "{projectToDelete.projectName}".</p>
                        <div className="modal-actions">
                            <button onClick={cancelDelete} className="btn-secondary">No</button>
                            <button onClick={confirmDelete} className="btn-danger">Yes, delete record</button>
                        </div>
                    </div>
                </div>
            )}
            <div className="calculator-card">
                <header className="header">
                    <span className="user-info">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="logout-btn">Logout</button>
                </header>
                <div className="nav-buttons">
                    <button onClick={() => onPageChange('calculator')} className="nav-btn">Calculator</button>
                    <button className="nav-btn-active">Records</button>
                    <button onClick={() => onPageChange('analyzer')} className="nav-btn">Blueprint Analyzer</button>
                    <button onClick={() => onPageChange('voiceAnalyzer')} className="nav-btn">Voice Analyzer</button>
                </div>
                <h1 className="title">Project Records</h1>
                <div className="records-table">
                    <div className="records-header records-row">
                        <span className="header-col">Project Name</span>
                        <span className="header-col">Client Name</span>
                        <span className="header-col">Address</span>
                        <span className="header-col">Final Price</span>
                        <span className="header-col"></span>
                    </div>
                    {projects.map(project => (
                        <div key={project.id}>
                            <div className="records-row" onClick={() => setExpandedRow(expandedRow === project.id ? null : project.id)}>
                                <span className="data-col">{project.projectName}</span>
                                <span className="data-col">{project.clientName}</span>
                                <span className="data-col">{project.address}</span>
                                <span className="data-col total-price">${(project.finalPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <button className="expand-btn">{expandedRow === project.id ? '▲' : '▼'}</button>
                            </div>
                            {expandedRow === project.id && (
                                <div className="item-details">
                                    {project.blueprintUrl && (<div className="details-row blueprint-link-row"><span>Blueprint</span><span><a href={project.blueprintUrl} target="_blank" rel="noopener noreferrer">View Blueprint</a></span></div>)}
                                    {project.userName && (<div className="details-row"><span>User Created</span><span>{project.userName}</span></div>)}
                                    {project.modifiedBy && (<div className="details-row"><span>Last Modified By</span><span>{project.modifiedBy}</span></div>)}
                                    {project.scopeOfWork && (<div className="details-row scope-of-work-row"><span>Scope of Work</span><span>{project.scopeOfWork}</span></div>)}
                                    <div className="details-header details-row"><span>Item</span><span>Square Feet</span></div>
                                    {(project.items || []).map((item, index) => (<div key={index} className="details-row"><span>{item.type}</span><span>{item.sf}</span></div>))}
                                    <div className="details-actions">
                                        <button onClick={() => onPageChange('calculator', project)} className="btn-modify">Modify</button>
                                        <button onClick={() => handleDeleteClick(project)} className="btn-delete">Delete</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Blueprint Analyzer Page Component
function BlueprintAnalyzerPage({ user, onLogout, onPageChange, onAnalysisComplete }) {
    const [blueprintFile, setBlueprintFile] = useState(null);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState('');
    const [uploadedBlueprintUrl, setUploadedBlueprintUrl] = useState(null);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'application/pdf')) {
            setBlueprintFile(file); setError('');
        } else {
            setBlueprintFile(null); setError('Please select a valid image (PNG, JPG) or PDF file.');
        }
    };

    const handleAnalyze = async () => {
        if (!blueprintFile) { setError('Please select a file.'); return; }
        setIsAnalyzing(true); setError(''); setAnalysisResult(null); setUploadedBlueprintUrl(null);
        const functionUrl = process.env.NODE_ENV === 'development' ? 'https://analyze-blueprint-w47bikyqya-uc.a.run.app' : 'https://analyze-blueprint-w47bikyqya-uc.a.run.app';
        const getBase64 = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result); reader.onerror = (error) => reject(error);
        });
        try {
            const fileData = await getBase64(blueprintFile);
            const payload = { fileData, userId: user.uid };
            const response = await fetch(functionUrl, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const text = await response.text();
            let parsed; try { parsed = JSON.parse(text); } catch { parsed = { details: text }; }
            if (!response.ok) throw new Error(parsed.details || 'The server returned an error.');
            setAnalysisResult(parsed.analysisResult || {});
            setUploadedBlueprintUrl(parsed.blueprintUrl || null);
            if (parsed.analysisResult && parsed.analysisResult.ScopeOfWork) {
                onAnalysisComplete(parsed.analysisResult.ScopeOfWork);
            }
        } catch (err) { setError(`Analysis failed: ${err.message}`); } finally { setIsAnalyzing(false); }
    };

    const handleUseInCalculator = () => {
        if (!analysisResult) return;
        const remodelingItems = analysisResult["Remodeling place and size"] || {};
        const filteredItems = Object.fromEntries(Object.entries(remodelingItems).filter(([, value]) => value !== null));
        const dataForCalculator = {
            projectName: analysisResult["Project Name"] || '', address: analysisResult["Project Address"] || '', clientName: analysisResult["Client Name"] || '',
            scopeOfWork: analysisResult["Scope of Work"] || '',
            items: filteredItems, blueprintUrl: uploadedBlueprintUrl, analysisResult: analysisResult
        };
        onPageChange('calculator', dataForCalculator);
    };

    return (
        <div className="app-container">
            <div className="calculator-card">
                <header className="header">
                    <span className="user-info">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="logout-btn">Logout</button>
                </header>
                <div className="nav-buttons">
                    <button onClick={() => onPageChange('calculator')} className="nav-btn">Calculator</button>
                    <button onClick={() => onPageChange('records')} className="nav-btn">Records</button>
                    <button className="nav-btn-active">Blueprint Analyzer</button>
                    <button onClick={() => onPageChange('voiceAnalyzer')} className="nav-btn">Voice Analyzer</button>
                </div>
                <h1 className="title">Blueprint Analyzer</h1>
                <p>Upload a blueprint (PNG, JPG, or PDF) to automatically extract square footage.</p>
                <div className="file-upload-container">
                    <input type="file" onChange={handleFileChange} accept="image/png, image/jpeg, application/pdf" className="input-field file-input" />
                    <button onClick={handleAnalyze} disabled={isAnalyzing || !blueprintFile} className="add-btn">{isAnalyzing ? 'Analyzing...' : 'Analyze Blueprint'}</button>
                </div>
                {error && <p className="error-message">{error}</p>}
                {analysisResult && (
                    <div className="analysis-results">
                        <h3>Analysis Results:</h3>
                        <pre className="result-json">{JSON.stringify(analysisResult, null, 2)}</pre>
                        <button onClick={handleUseInCalculator} className="save-btn">Use in Calculator</button>
                    </div>
                )}
            </div>
        </div>
    );
}

// Voice Analyzer Page Component
function VoiceAnalyzerPage({ user, onLogout, onPageChange, onAnalysisComplete }) {
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [audioChunks, setAudioChunks] = useState([]);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [summary, setSummary] = useState(null);
    const [transcript, setTranscript] = useState(null);
    const [error, setError] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            recorder.ondataavailable = (event) => {
                setAudioChunks((prev) => [...prev, event.data]);
            };
            recorder.start();
            setMediaRecorder(recorder);
            setIsRecording(true);
        } catch (err) {
            setError('Could not start recording. Please ensure you have given microphone permissions.');
        }
    };

    const stopRecording = () => {
        mediaRecorder.stop();
        setIsRecording(false);
    };

    const handleAnalyze = async () => {
        if (audioChunks.length === 0) {
            setError('No audio recorded.');
            return;
        }
        setIsAnalyzing(true);
        setError('');

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
            const base64Audio = reader.result;
            // IMPORTANT: Ensure this is your correct Cloud Function URL
            const functionUrl = 'https://analyze-voice-recording-w47bikyqya-uc.a.run.app';
            
            try {
                const response = await fetch(functionUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // This is the critical line. Ensure it is exactly as written.
                    body: JSON.stringify({ audioData: base64Audio }),
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || 'Analysis failed due to a server error.');
                }
                
                setAnalysisResult(result.analysis);
                
                // Check if 'Summary of other remodeling topics' exists before setting
                const summaryText = result.analysis && result.analysis['Summary of other remodeling topics']
                  ? result.analysis['Summary of other remodeling topics']
                  : 'No additional topics summarized.';
                setSummary(summaryText);

                setTranscript(result.transcript);
                
                if (result.analysis && result.analysis['Scope of Work']) {
                    onAnalysisComplete(result.analysis['Scope of Work']);
                }

            } catch (err) {
                setError(`Analysis failed: ${err.message}`);
            } finally {
                setIsAnalyzing(false);
                setAudioChunks([]);
            }
        };
    };

    return (
        <div className="app-container">
            <div className="calculator-card">
                <header className="header">
                    <span className="user-info">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="logout-btn">Logout</button>
                </header>
                <div className="nav-buttons">
                    <button onClick={() => onPageChange('calculator')} className="nav-btn">Calculator</button>
                    <button onClick={() => onPageChange('records')} className="nav-btn">Records</button>
                    <button onClick={() => onPageChange('analyzer')} className="nav-btn">Blueprint Analyzer</button>
                    <button className="nav-btn-active">Voice Analyzer</button>
                </div>
                <h1 className="title">Voice Recording & Analysis</h1>
                <div className="voice-recorder">
                    <button onClick={isRecording ? stopRecording : startRecording} className={`record-btn ${isRecording ? 'recording' : ''}`}>
                        {isRecording ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button onClick={handleAnalyze} disabled={isAnalyzing || isRecording || audioChunks.length === 0} className="add-btn">
                        {isAnalyzing ? 'Analyzing...' : 'Analyze Recording'}
                    </button>
                </div>
                {error && <p className="error-message">{error}</p>}
                {transcript && <div className="analysis-results"><h3>Transcript:</h3><p>{transcript}</p></div>}
                {analysisResult && <div className="analysis-results"><h3>Analysis Results:</h3><pre className="result-json">{JSON.stringify(analysisResult, null, 2)}</pre></div>}
                {summary && <div className="analysis-results"><h3>Summary:</h3><p>{summary}</p></div>}
            </div>
        </div>
    );
}


// Auth Page Component
function AuthPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [error, setError] = useState('');

    const handleAuthAction = async (e) => {
        e.preventDefault(); setError('');
        if (isSignUp) {
            if (password !== confirmPassword) { setError("Passwords do not match."); return; }
            if (!email.endsWith('@baroncnr.com')) { setError("Sign-up is restricted to @baroncnr.com emails."); return; }
            try { await createUserWithEmailAndPassword(auth, email, password); } catch (err) { setError(err.message); }
        } else {
            try { await signInWithEmailAndPassword(auth, email, password); } catch (err) { setError(err.message); }
        }
    };

    const handlePasswordReset = async () => {
        setError(''); if (!email) { setError("Please enter your email to reset the password."); return; }
        try { await sendPasswordResetEmail(auth, email); setError("Password reset email sent. Please check your inbox."); } catch (err) { setError(err.message); }
    };

    return (
        <div className="app-container">
            <div className="calculator-card auth-card">
                <h1 className="title">{isSignUp ? 'Create an Account' : 'Login'}</h1>
                <form onSubmit={handleAuthAction} className="auth-form">
                    <div className="input-group"><input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input-field" /></div>
                    <div className="input-group"><input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input-field" /></div>
                    {isSignUp && (<div className="input-group"><input type="password" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="input-field" /></div>)}
                    {error && <p className="error-message">{error}</p>}
                    <button type="submit" className="auth-btn">{isSignUp ? 'Sign Up' : 'Login'}</button>
                </form>
                <div className="auth-links">
                    <button className="link-btn" onClick={() => setIsSignUp(!isSignUp)}>{isSignUp ? 'Already have an account? Login' : 'Need an account? Sign Up'}</button>
                    {!isSignUp && (<button className="link-btn" onClick={handlePasswordReset}>Forgot Password?</button>)}
                </div>
            </div>
        </div>
    );
}

// Main App Component
export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState('calculator');
    const [dataForCalculator, setDataForCalculator] = useState(null);
    const [scopeOfWork, setScopeOfWork] = useState('');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleLogout = async () => { await signOut(auth); };

    if (loading) {
        return (<div className="loading-container"><div className="spinner"></div></div>);
    }

    const handlePageChange = (page, data = null) => {
        setCurrentPage(page);
        setDataForCalculator(data);
    };

    const renderPage = () => {
        switch (currentPage) {
            case 'calculator': return <PriceCalculator user={user} onLogout={handleLogout} onPageChange={handlePageChange} initialData={dataForCalculator} scopeOfWork={scopeOfWork} />;
            case 'records': return <RecordsPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />;
            case 'analyzer': return <BlueprintAnalyzerPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} onAnalysisComplete={setScopeOfWork} />;
            case 'voiceAnalyzer': return <VoiceAnalyzerPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} onAnalysisComplete={setScopeOfWork} />;
            default: return <PriceCalculator user={user} onLogout={handleLogout} onPageChange={handlePageChange} initialData={dataForCalculator} scopeOfWork={scopeOfWork} />;
        }
    };

    return (
        <>
            {user ? renderPage() : <AuthPage />}
        </>
    );
}