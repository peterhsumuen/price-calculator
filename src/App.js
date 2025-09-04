import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { initializeApp } from 'firebase/app';
// Make sure to re-link your CSS file if the name changed.
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

// Firebase configuration - NOTE: Using placeholder for security
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
function PriceCalculator({ user, onLogout, onPageChange, initialData }) {
    const [items, setItems] = useState([{ id: uuidv4(), type: '', sf: '' }]);
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

            setItems(itemsToSet && itemsToSet.length > 0 ? itemsToSet : [{ id: uuidv4(), type: '', sf: '' }]);
        } else {
            setProjectName('');
            setAddress('');
            setClientName('');
            setScopeOfWorkText('');
            setItems([{ id: uuidv4(), type: '', sf: '' }]);
            setBlueprintUrl(null);
            setAnalysisData(null);
            setEditingProjectId(null);
        }
    }, [initialData]);

    useEffect(() => {
        let total = 0;
        const fullGutSF = parseFloat(items.find(item => item.type === 'Full gut')?.sf) || 0;
        items.forEach(item => {
            const parsedSF = parseFloat(item.sf) || 0;
            if (parsedSF === 0 && item.type !== 'Landscape') return; // Allow landscape to be 0
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
    const handleAddItem = () => setItems([...items, { id: uuidv4(), type: '', sf: '' }]);
    const handleRemoveItem = (id) => setItems(items.filter(item => item.id !== id));

    const saveProject = async () => {
        if (!projectName || !address || !clientName) {
            setSaveStatus("Please fill out all project details before saving.");
            return;
        }
        setSaveStatus("Saving...");
        const projectData = {
            projectName, address, clientName, scopeOfWork: scopeOfWorkText, finalPrice: totalPrice,
            items: items.filter(item => item.type).map(({ id, ...rest }) => rest), // Filter out empty items
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
            <div className="card w-full max-w-4xl bg-base-100 shadow-xl p-8 rounded-box">
                <header className="header"><span className="font-bold">Welcome, {user.email}!</span><button onClick={onLogout} className="btn btn-ghost btn-sm">Logout</button></header>
                <div role="tablist" className="tabs tabs-boxed mb-8">
                    <a role="tab" className="tab tab-active">Calculator</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('records')}>Records</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('analyzer')}>Blueprint Analyzer</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('voiceAnalyzer')}>Voice Analyzer</a>
                </div>

                <h1 className="title">{editingProjectId ? 'Modify Project' : 'Pricing Calculator'}</h1>
                <div className="project-details">
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text">Project Name</span></label>
                        <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="input input-bordered w-full rounded-box" />
                    </div>
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text">Address</span></label>
                        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="input input-bordered w-full rounded-box" />
                    </div>
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text">Client Name</span></label>
                        <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} className="input input-bordered w-full rounded-box" />
                    </div>
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text">Scope of Work</span></label>
                        <textarea
                            value={scopeOfWorkText}
                            onChange={(e) => setScopeOfWorkText(e.target.value)}
                            className="textarea textarea-bordered rounded-box"
                            rows={4}
                        />
                    </div>
                </div>
                <div className="items-container">{items.map((item) => (
                    <div key={item.id} className="item-row">
                        <select value={item.type} onChange={(e) => handleChange(item.id, 'type', e.target.value)} className="select select-bordered grow rounded-box">
                            <option value="" disabled>Select item type</option>
                            {options.map(option => (<option key={option.value} value={option.value}>{option.label}</option>))}
                        </select>
                        <input type="number" placeholder="Square Feet" value={item.sf} onChange={(e) => handleChange(item.id, 'sf', e.target.value)} className="input input-bordered grow rounded-box" />
                        {items.length > 1 && (<button onClick={() => handleRemoveItem(item.id)} className="btn btn-error btn-outline">Remove</button>)}
                    </div>))}
                </div>
                <button onClick={handleAddItem} className="btn btn-secondary btn-outline w-full mt-4">+ Add Item</button>
                <div className="text-right text-3xl font-bold mt-6 text-success">
                    Total Price: ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-right mt-4">
                    {saveStatus && <p className="text-sm text-info mb-2">{saveStatus}</p>}
                    <button onClick={saveProject} className="btn btn-primary btn-outline">{editingProjectId ? 'Update Project' : 'Save Project'}</button>
                </div>
            </div>
        </div>
    );
}

// Records Page Component
function RecordsPage({ user, onLogout, onPageChange }) {
    const [projects, setProjects] = useState([]);
    const [expandedRow, setExpandedRow] = useState(null);
    const projectToDelete = useRef(null);
    const modalRef = useRef(null);

    useEffect(() => {
        if (!user) return;
        const ADMIN_EMAILS = ['test@baroncnr.com'];
        const isAdmin = ADMIN_EMAILS.includes(user.email);
        const q = isAdmin ? query(collection(db, 'projects'), orderBy('createdAt', 'desc')) : query(collection(db, 'projects'), where('userName', '==', user.email), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
        return () => unsubscribe();
    }, [user]);

    const handleDeleteClick = (project) => {
        projectToDelete.current = project;
        modalRef.current.showModal();
    };

    const confirmDelete = async () => {
        if (!projectToDelete.current) return;
        try {
            await deleteDoc(doc(db, 'projects', projectToDelete.current.id));
        } catch (error) { console.error("Error deleting project:", error); }
    };

    return (
        <div className="app-container">
            <dialog id="delete_modal" className="modal" ref={modalRef}>
                <div className="modal-box rounded-box">
                    <h3 className="font-bold text-lg">Are you sure?</h3>
                    <p className="py-4">This will permanently delete the project "{projectToDelete.current?.projectName}".</p>
                    <div className="modal-action">
                        <form method="dialog">
                            <button className="btn btn-outline mr-2">No</button>
                            <button className="btn btn-error btn-outline" onClick={confirmDelete}>Yes, delete record</button>
                        </form>
                    </div>
                </div>
            </dialog>

            <div className="card w-full max-w-4xl bg-base-100 shadow-xl p-8 rounded-box">
                <header className="header">
                    <span className="font-bold">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="btn btn-ghost btn-sm">Logout</button>
                </header>
                <div role="tablist" className="tabs tabs-boxed mb-8">
                    <a role="tab" className="tab" onClick={() => onPageChange('calculator')}>Calculator</a>
                    <a role="tab" className="tab tab-active">Records</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('analyzer')}>Blueprint Analyzer</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('voiceAnalyzer')}>Voice Analyzer</a>
                </div>
                <h1 className="title">Project Records</h1>
                <div className="overflow-x-auto">
                    <table className="table w-full">
                        <thead>
                            <tr>
                                <th>Project Name</th>
                                <th>Client Name</th>
                                <th>Address</th>
                                <th>Final Price</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {projects.map(project => (
                                <React.Fragment key={project.id}>
                                    <tr className="hover cursor-pointer" onClick={() => setExpandedRow(expandedRow === project.id ? null : project.id)}>
                                        <td>{project.projectName}</td>
                                        <td>{project.clientName}</td>
                                        <td>{project.address}</td>
                                        <td className="font-bold text-secondary">${(project.finalPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td>{expandedRow === project.id ? '▲' : '▼'}</td>
                                    </tr>
                                    {expandedRow === project.id && (
                                        <tr>
                                            <td colSpan="5" className="bg-base-200 p-4 rounded-box">
                                                {project.blueprintUrl && (<div><strong>Blueprint:</strong> <a href={project.blueprintUrl} target="_blank" rel="noopener noreferrer" className="link link-primary">View Blueprint</a></div>)}
                                                {project.userName && (<div><strong>User Created:</strong> {project.userName}</div>)}
                                                {project.modifiedBy && (<div><strong>Last Modified By:</strong> {project.modifiedBy}</div>)}
                                                {project.scopeOfWork && (<div><strong>Scope of Work:</strong> <div className="whitespace-pre-line">{project.scopeOfWork}</div></div>)}
                                                <div className="font-bold mt-2">Items:</div>
                                                <ul>
                                                    {(project.items || []).map((item, index) => (<li key={index}>{item.type}: {item.sf} sq ft</li>))}
                                                </ul>
                                                <div className="text-right mt-4">
                                                    <button onClick={() => onPageChange('calculator', project)} className="btn btn-primary btn-outline btn-sm mr-2">Modify</button>
                                                    <button onClick={() => handleDeleteClick(project)} className="btn btn-error btn-outline btn-sm">Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
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
        const functionUrl = 'https://analyze-blueprint-w47bikyqya-uc.a.run.app';
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
            <div className="card w-full max-w-4xl bg-base-100 shadow-xl p-8 rounded-box">
                <header className="header">
                    <span className="font-bold">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="btn btn-ghost btn-sm">Logout</button>
                </header>
                <div role="tablist" className="tabs tabs-boxed mb-8">
                    <a role="tab" className="tab" onClick={() => onPageChange('calculator')}>Calculator</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('records')}>Records</a>
                    <a role="tab" className="tab tab-active">Blueprint Analyzer</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('voiceAnalyzer')}>Voice Analyzer</a>
                </div>
                <h1 className="title">Blueprint Analyzer</h1>
                <p>Upload a blueprint (PNG, JPG, or PDF) to automatically extract project details.</p>
                <div className="form-control w-full mt-4">
                    <input type="file" onChange={handleFileChange} accept="image/png, image/jpeg, application/pdf" className="file-input file-input-bordered w-full rounded-box" />
                    <button onClick={handleAnalyze} disabled={isAnalyzing || !blueprintFile} className="btn btn-secondary btn-outline mt-4">
                        {isAnalyzing && <span className="loading loading-spinner"></span>}
                        {isAnalyzing ? 'Analyzing...' : 'Analyze Blueprint'}
                    </button>
                </div>
                {error && <div className="alert alert-error mt-4 rounded-box">{error}</div>}
                {analysisResult && (
                    <div className="mt-6">
                        <h3 className="text-xl font-bold">Analysis Results:</h3>
                        <pre className="bg-base-200 p-4 mt-2 rounded-box">{JSON.stringify(analysisResult, null, 2)}</pre>
                        <button onClick={handleUseInCalculator} className="btn btn-primary btn-outline mt-4">Use in Calculator</button>
                    </div>
                )}
            </div>
        </div>
    );
}

// Voice Analyzer Page Component
function VoiceAnalyzerPage({ user, onLogout, onPageChange, onAnalysisComplete }) {
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorder = useRef(null);
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
            mediaRecorder.current = recorder;
            recorder.ondataavailable = (event) => {
                setAudioChunks((prev) => [...prev, event.data]);
            };
            recorder.start();
            setIsRecording(true);
        } catch (err) {
            setError('Could not start recording. Please ensure you have given microphone permissions.');
        }
    };

    const stopRecording = () => {
        mediaRecorder.current.stop();
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
            const functionUrl = 'https://analyze-voice-recording-w47bikyqya-uc.a.run.app';
            
            try {
                const response = await fetch(functionUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ audioData: base64Audio }),
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || 'Analysis failed due to a server error.');
                }
                
                setAnalysisResult(result.analysis);
                
                const summaryText = result.analysis && result.analysis['Summary of other remodeling topics']
                    ? result.analysis['Summary of other remodeling topics']
                    : 'No additional topics summarized.';
                setSummary(summaryText);

                setTranscript(result.transcript);

            } catch (err) {
                setError(`Analysis failed: ${err.message}`);
            } finally {
                setIsAnalyzing(false);
                setAudioChunks([]);
            }
        };
    };

    const handleUseInCalculator = () => {
        if (!analysisResult) return;
        const remodelingItems = analysisResult["Remodeling place and size"] || {};
        // Filter out any keys that have a null value from the analysis
        const filteredItems = Object.fromEntries(Object.entries(remodelingItems).filter(([, value]) => value !== null));
        const dataForCalculator = {
            projectName: analysisResult["Project Name"] || '',
            address: analysisResult["Project Address"] || '',
            clientName: analysisResult["Client Name"] || '',
            scopeOfWork: analysisResult["Scope of Work"] || '',
            items: filteredItems,
            analysisResult: analysisResult
        };
        onPageChange('calculator', dataForCalculator);
    };

    return (
        <div className="app-container">
            <div className="card w-full max-w-4xl bg-base-100 shadow-xl p-8 rounded-box">
                <header className="header">
                    <span className="font-bold">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="btn btn-ghost btn-sm">Logout</button>
                </header>
                <div role="tablist" className="tabs tabs-boxed mb-8">
                    <a role="tab" className="tab" onClick={() => onPageChange('calculator')}>Calculator</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('records')}>Records</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('analyzer')}>Blueprint Analyzer</a>
                    <a role="tab" className="tab tab-active">Voice Analyzer</a>
                </div>
                <h1 className="title">Voice Recording & Analysis</h1>
                <div className="flex gap-4">
                    <button onClick={isRecording ? stopRecording : startRecording} className={`btn ${isRecording ? 'btn-error' : 'btn-primary'} btn-outline grow`}>
                        {isRecording ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button onClick={handleAnalyze} disabled={isAnalyzing || isRecording || audioChunks.length === 0} className="btn btn-secondary btn-outline grow">
                        {isAnalyzing && <span className="loading loading-spinner"></span>}
                        {isAnalyzing ? 'Analyzing...' : 'Analyze Recording'}
                    </button>
                </div>
                {error && <div className="alert alert-error mt-4 rounded-box">{error}</div>}
                {transcript && <div className="mt-6"><h3>Transcript:</h3><p className="bg-base-200 p-2 rounded-box">{transcript}</p></div>}
                {analysisResult && <div className="mt-4"><h3>Analysis Results:</h3><pre className="bg-base-200 p-2 rounded-box">{JSON.stringify(analysisResult, null, 2)}</pre></div>}
                {summary && <div className="mt-4"><h3>Summary:</h3><p className="bg-base-200 p-2 rounded-box">{summary}</p></div>}
                {analysisResult && (
                    <button onClick={handleUseInCalculator} className="btn btn-primary btn-outline mt-4">
                        Use in Calculator
                    </button>
                )}
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
            <div className="card w-full max-w-sm bg-base-100 shadow-xl p-8 rounded-box">
                <form onSubmit={handleAuthAction}>
                    <h1 className="title">{isSignUp ? 'Create Account' : 'Login'}</h1>
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text">Email</span></label>
                        <input type="email" placeholder="email@baroncnr.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="input input-bordered w-full rounded-box" />
                    </div>
                    <div className="form-control w-full mt-4">
                        <label className="label"><span className="label-text">Password</span></label>
                        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input input-bordered w-full rounded-box" />
                    </div>
                    {isSignUp && (
                        <div className="form-control w-full mt-4">
                            <label className="label"><span className="label-text">Confirm Password</span></label>
                            <input type="password" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="input input-bordered w-full rounded-box" />
                        </div>
                    )}
                    {error && <p className="text-error text-center mt-4">{error}</p>}
                    <button type="submit" className="btn btn-primary btn-outline w-full mt-6">{isSignUp ? 'Sign Up' : 'Login'}</button>
                    <div className="text-center mt-4">
                        <a className="link link-hover" onClick={() => setIsSignUp(!isSignUp)}>{isSignUp ? 'Already have an account? Login' : 'Need an account? Sign Up'}</a>
                        {!isSignUp && (<div className="divider">OR</div>)}
                        {!isSignUp && (<a className="link link-hover" onClick={handlePasswordReset}>Forgot Password?</a>)}
                    </div>
                </form>
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
    

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleLogout = async () => { await signOut(auth); };

    if (loading) {
        return (<div className="flex justify-center items-center min-h-screen"><span className="loading loading-spinner loading-lg"></span></div>);
    }

    const handlePageChange = (page, data = null) => {
        setCurrentPage(page);
        setDataForCalculator(data);
    };

    const renderPage = () => {
    switch (currentPage) {
        // REMOVED scopeOfWork={scopeOfWork} from PriceCalculator
        case 'calculator': return <PriceCalculator user={user} onLogout={handleLogout} onPageChange={handlePageChange} initialData={dataForCalculator} />;
        case 'records': return <RecordsPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />;
        // REMOVED onAnalysisComplete={setScopeOfWork} from BlueprintAnalyzerPage
        case 'analyzer': return <BlueprintAnalyzerPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />;
        // REMOVED onAnalysisComplete={setScopeOfWork} from VoiceAnalyzerPage
        case 'voiceAnalyzer': return <VoiceAnalyzerPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />;
        // REMOVED scopeOfWork={scopeOfWork} from the default case
        default: return <PriceCalculator user={user} onLogout={handleLogout} onPageChange={handlePageChange} initialData={dataForCalculator} />;
    }
};

    return (
        <>
            {user ? renderPage() : <AuthPage />}
        </>
    );
}

