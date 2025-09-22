import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { initializeApp } from 'firebase/app';
import { Document, Page, pdfjs } from 'react-pdf';
import { PDFDocument } from 'pdf-lib'
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './App.css';
import WelcomePage from './WelcomePage';
import LearnMorePage from './LearnMorePage';
import FormattedScopeOfWork from './FormattedScopeOfWork';

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

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',   
  import.meta.url,
).toString();

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

// A reusable component to show expandable content.
function CollapsibleSection({ title, children, rawText }) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!rawText) {
        return null;
    }

    const toggleExpansion = () => setIsExpanded(!isExpanded);

    // The length check should be on the raw string
    const isLongContent = rawText.length > 200;

    return (
        <div className="py-2">
            <h4 className="font-semibold text-lg">{title}</h4>
            <div className="text-base-content/80">
                {isExpanded || !isLongContent ? (
                    children // Show the full, formatted children
                ) : (
                    // Show a simple text snippet for the collapsed view
                    <p className="whitespace-pre-line">{`${rawText.substring(0, 200)}...`}</p>
                )}
            </div>
            {isLongContent && (
                <button onClick={toggleExpansion} className="link link-primary text-sm mt-1">
                    {isExpanded ? 'Show Less' : 'Show More'}
                </button>
            )}
        </div>
    );
}

// This component formats and displays the analysis results nicely.
function AnalysisResultDisplay({ analysisResult }) {
    if (!analysisResult || Object.keys(analysisResult).length === 0) {
        return null;
    }

    // Separate Scope of Work to handle it with the collapsible component
    const { "Scope of Work": scopeOfWork, "Remodeling place and size": remodeling, ...otherDetails } = analysisResult;

    return (
        <div className="mt-6 space-y-4">
            <h3 className="text-xl font-bold">Analysis Results:</h3>
            <div className="bg-base-200 p-4 rounded-box space-y-2">
                {Object.entries(otherDetails).map(([key, value]) => (
                    <div key={key} className="py-1">
                        <h4 className="font-semibold text-lg">{key}</h4>
                        <p className="text-base-content/80">{value || 'N/A'}</p>
                    </div>
                ))}

                {/* Handle the nested remodeling object */}
                {remodeling && typeof remodeling === 'object' && (
                     <div className="py-2">
                        <h4 className="font-semibold text-lg">Remodeling Place and Size</h4>
                        <div className="pl-4">
                            {Object.entries(remodeling).map(([key, value]) => value !== null && (
                                <p key={key} className="text-base-content/80"><strong>{key}:</strong> {value}</p>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Use the collapsible section for the long scope of work */}
                <CollapsibleSection title="Scope of Work" rawText={scopeOfWork}>
                    <p className="whitespace-pre-line text-base-content/80">{scopeOfWork}</p>
                </CollapsibleSection>
            </div>
        </div>
    );
}


// Price Calculator Component
function PriceCalculator({
    user,
    onLogout,
    onPageChange,
    items,
    setItems,
    projectName,
    setProjectName,
    address,
    setAddress,
    clientName,
    setClientName,
    scopeOfWorkText,
    setScopeOfWorkText,
    blueprintUrl,
    analysisData,
    editingProjectId,
    setEditingProjectId,
    onClear,
    initialData
}) {
    const [totalPrice, setTotalPrice] = useState(0);
    const [saveStatus, setSaveStatus] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState('');

    const isFormDirty =
        projectName ||
        address ||
        clientName ||
        scopeOfWorkText ||
        items.length > 1 ||
        (items.length === 1 && (items[0].type || items[0].sf));

    useEffect(() => {
        if (initialData) {
            setProjectName(initialData.projectName || '');
            setAddress(initialData.address || '');
            setClientName(initialData.clientName || '');
            setScopeOfWorkText(initialData.scopeOfWork || '');
            setEditingProjectId(initialData.id || null);

            let itemsToSet;
            if (Array.isArray(initialData.items)) {
                itemsToSet = initialData.items.map(item => ({ ...item, id: uuidv4() }));
            } else if (typeof initialData.items === 'object' && initialData.items !== null) {
                itemsToSet = Object.entries(initialData.items)
                    .filter(([key]) => PRICING_RULES[key] !== undefined)
                    .map(([type, sf]) => ({
                        id: uuidv4(),
                        type,
                        sf: parseFloat(sf) || ''
                    }));
            }

            setItems(itemsToSet && itemsToSet.length > 0 ? itemsToSet : [{ id: uuidv4(), type: '', sf: '' }]);
        }
    }, [initialData, setProjectName, setAddress, setClientName, setScopeOfWorkText, setEditingProjectId, setItems]);


    useEffect(() => {
        let total = 0;
        const fullGutSF = parseFloat(items.find(item => item.type === 'Full gut')?.sf) || 0;
        items.forEach(item => {
            const parsedSF = parseFloat(item.sf) || 0;
            if (parsedSF === 0 && item.type !== 'Landscape') return;
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

    const handleChange = (id, field, value) => {
        if (field === 'sf') {
            // Allow empty string to clear the input, otherwise ensure it's a non-negative number
            if (value === '' || parseFloat(value) >= 0) {
                setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
            }
        } else {
            setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
        }
    };
    const handleAddItem = () => setItems([...items, { id: uuidv4(), type: '', sf: '' }]);
    const handleRemoveItem = (id) => setItems(items.filter(item => item.id !== id));
    const handleGenerateScopeOfWork = async () => {
        setIsGenerating(true);
        setGenerationError('');
        const functionUrl = 'https://generate-scope-of-work-w47bikyqya-uc.a.run.app';

        try {
            const payload = {
                items: items.filter(item => item.type && item.sf),
            };

            const response = await fetch(functionUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to generate scope of work.');
            }

            setScopeOfWorkText(result.scopeOfWork);

        } catch (err) {
            setGenerationError(err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const saveProject = async () => {
        if (!projectName || !address || !clientName) {
            setSaveStatus("Please fill out all project details before saving.");
            return;
        }
        setSaveStatus("Saving...");
        const projectData = {
            projectName, address, clientName, scopeOfWork: scopeOfWorkText, finalPrice: totalPrice,
            items: items.filter(item => item.type).map(({ id, ...rest }) => rest),
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
            setTimeout(() => {
                setSaveStatus('');
                onClear();
                onPageChange('records');
            }, 2000);
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
                    <a role="tab" className="tab" onClick={() => onPageChange('records')}>Records</a>
                    <a role="tab" className="tab tab-active">Calculator</a>
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
                        <input
                            type="number"
                            min="0"
                            placeholder="Square Feet"
                            value={item.sf}
                            onChange={(e) => handleChange(item.id, 'sf', e.target.value)}
                            onWheel={(e) => e.target.blur()}
                            className="input input-bordered grow rounded-box"
                        />
                        {items.length > 1 && (<button onClick={() => handleRemoveItem(item.id)} className="btn btn-error btn-outline">Remove</button>)}
                    </div>))}
                </div>
                <button onClick={handleAddItem} className="btn btn-secondary btn-outline w-full mt-4">+ Add Item</button>

                {/* Smart Button - Only shows if not loading data from analyzers */}
                {!initialData?.scopeOfWork && (
                    <>
                        <button
                            onClick={handleGenerateScopeOfWork}
                            disabled={isGenerating}
                            className="btn btn-secondary btn-outline w-full mt-4"
                        >
                            {isGenerating ? (
                                <span className="loading loading-spinner"></span>
                            ) : (
                                'Generate Scope of Work'
                            )}
                        </button>
                        {generationError && <p className="text-error text-center mt-2">{generationError}</p>}
                    </>
                )}

                <div className="text-right text-3xl font-bold mt-6 text-success">
                    Total Price: ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="flex justify-end mt-4 space-x-2">
                    {saveStatus && <p className="text-sm text-info self-center mb-2">{saveStatus}</p>}
                    {isFormDirty && <button onClick={onClear} className="btn btn-error btn-outline">Clear Form</button>}
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
                    <a role="tab" className="tab tab-active">Records</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('calculator')}>Calculator</a>
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
                                                
                                                {project.scopeOfWork && (
                                                    <CollapsibleSection 
                                                        title="Scope of Work" 
                                                        rawText={project.scopeOfWork} 
                                                    >
                                                        <FormattedScopeOfWork content={project.scopeOfWork} />
                                                    </CollapsibleSection>
                                                )}

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

// --- Function to merge analysis results from chunks ---
const _mergeAnalysisResults = (results) => {
    if (!results || results.length === 0) return {};

    const merged = results[0];

    for (const result of results.slice(1)) {
        if (result["Scope of Work"]) {
            merged["Scope of Work"] = (merged["Scope of Work"] || "") + "\n\n" + result["Scope of Work"];
        }
    }

    return merged;
};


// Blueprint Analyzer Page Component
function BlueprintAnalyzerPage({
    user, onLogout, onPageChange,
    blueprintFile, analysisResult, isAnalyzing, error, progressMessage, progressPercent,
    handleFileChange, handleAnalyze, handleStopAnalysis, handleUseInCalculator
}) {
    const fileInputRef = useRef(null);

    const handleCustomInputClick = () => {
        fileInputRef.current.click();
    };

    return (
        <div className="app-container">
            <div className="card w-full max-w-4xl bg-base-100 shadow-xl p-8 rounded-box">
                <header className="header">
                    <span className="font-bold">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="btn btn-ghost btn-sm">Logout</button>
                </header>
                <div role="tablist" className="tabs tabs-boxed mb-8">
                    <a role="tab" className="tab" onClick={() => onPageChange('records')}>Records</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('calculator')}>Calculator</a>
                    <a role="tab" className="tab tab-active">Blueprint Analyzer</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('voiceAnalyzer')}>Voice Analyzer</a>
                </div>
                <h1 className="title">Blueprint Analyzer</h1>
                <p>Upload a blueprint (PNG, JPG, or PDF) to automatically extract project details.</p>
                <div className="form-control w-full mt-4">
                    {/* The real file input is now hidden */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileChange}
                        accept="image/png, image/jpeg, application/pdf"
                        className="hidden"
                        disabled={isAnalyzing}
                    />
                    
                    {/* This is the custom-styled replacement that the user sees */}
                    <div
                        className={`file-input file-input-bordered w-full rounded-box flex items-center pr-4 ${isAnalyzing ? 'file-input-disabled bg-base-200' : 'cursor-pointer'}`}
                        onClick={!isAnalyzing ? handleCustomInputClick : undefined}
                    >
                        <span className="btn btn-primary no-animation rounded-r-none">
                            Choose File
                        </span>
                        <span className="ml-4 truncate text-base-content/60">
                            {blueprintFile ? blueprintFile.name : 'No file chosen'}
                        </span>
                    </div>

                    <button onClick={handleAnalyze} disabled={isAnalyzing || !blueprintFile} className="btn btn-secondary btn-outline mt-4">
                        {isAnalyzing ? 'Analyzing...' : 'Analyze Blueprint'}
                    </button>
                </div>

                {isAnalyzing && (
                    <div className="mt-4 space-y-2">
                         {progressMessage && (
                            <div className="alert alert-info rounded-box flex flex-col items-center">
                                <div>
                                    <span className="loading loading-spinner"></span>
                                    {progressMessage}
                                </div>
                                <progress className="progress progress-warning w-56 mt-2" value={progressPercent} max="100"></progress>
                            </div>
                        )}
                        <button onClick={handleStopAnalysis} className="btn btn-error btn-outline w-full">
                            Stop Analysis
                        </button>
                    </div>
                )}

                {error && <div className="alert alert-error mt-4 rounded-box">{error}</div>}

                {!isAnalyzing && analysisResult && (
                    <>
                        <AnalysisResultDisplay analysisResult={analysisResult} />
                        <button onClick={handleUseInCalculator} className="btn btn-primary btn-outline mt-4">Use in Calculator</button>
                    </>
                )}
            </div>
        </div>
    );
}



// Voice Analyzer Page Component
function VoiceAnalyzerPage({
    user,
    onLogout,
    onPageChange,
    isAnalyzing,
    error,
    transcript,
    analysisResult,
    handleAnalyze,
    handleUseInCalculator,
    handleStopAnalysis,
}) {
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorder = useRef(null);
    const [audioChunks, setAudioChunks] = useState([]);
    const [audioSampleRate, setAudioSampleRate] = useState(null);

    const [micStatus, setMicStatus] = useState('idle');
    const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);

    const resetState = () => {
        setAudioChunks([]);
        setAudioPreviewUrl(null);
    };

    const drawMicVisualizer = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;

        if (average > 5) {
            setMicStatus('listening');
        } else {
            setMicStatus('low');
        }

        animationFrameRef.current = requestAnimationFrame(drawMicVisualizer);
    };

    const startRecording = async () => {
        resetState();

        try {
            const mime = (window.MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus'))
                ? 'audio/webm;codecs=opus'
                : (window.MediaRecorder?.isTypeSupported?.('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : null);

            if (!mime) {
                handleAnalyze(null, null, 'This browser cannot record WebM/OGG Opus. Please use Chrome/Edge.');
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 48000, noiseSuppression: true, echoCancellation: true, autoGainControl: true }
            });

            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContextRef.current.createMediaStreamSource(stream);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            analyserRef.current.smoothingTimeConstant = 0.6;
            source.connect(analyserRef.current);

            const audioTrack = stream.getAudioTracks()[0];
            const sampleRate = audioTrack.getSettings().sampleRate;
            setAudioSampleRate(sampleRate);

            const recorder = new MediaRecorder(stream, { mimeType: mime });
            mediaRecorder.current = recorder;

            const chunks = [];
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size) chunks.push(e.data);
            };
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mime });
                setAudioChunks([blob]);
                setAudioPreviewUrl(URL.createObjectURL(blob));
            };

            recorder.start();
            setIsRecording(true);
            setMicStatus('listening');
            animationFrameRef.current = requestAnimationFrame(drawMicVisualizer);

        } catch (err) {
            handleAnalyze(null, null, 'Could not start recording. Please ensure you have given microphone permissions.');
        }
    };

    const stopRecording = () => new Promise((resolve) => {
        try {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            setMicStatus('idle');

            if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
                const orig = mediaRecorder.current.onstop;
                mediaRecorder.current.onstop = (e) => { orig && orig(e); resolve(); };
                mediaRecorder.current.stop();
                mediaRecorder.current.stream?.getTracks()?.forEach(t => t.stop());
            } else {
                resolve();
            }
        } finally {
            setIsRecording(false);
        }
    });

    const onAnalyze = async () => {
        if (isRecording) await stopRecording();
        if (audioChunks.length === 0 || audioChunks[0].size < 500) {
            handleAnalyze(null, null, 'No usable audio recorded. Please speak for a few seconds and try again.');
            return;
        }
        handleAnalyze(audioChunks, audioSampleRate);
    };

    return (
        <div className="app-container">
            <div className="card w-full max-w-4xl bg-base-100 shadow-xl p-8 rounded-box">
                <header className="header">
                    <span className="font-bold">Welcome, {user.email}!</span>
                    <button onClick={onLogout} className="btn btn-ghost btn-sm">Logout</button>
                </header>
                <div role="tablist" className="tabs tabs-boxed mb-8">
                    <a role="tab" className="tab" onClick={() => onPageChange('records')}>Records</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('calculator')}>Calculator</a>
                    <a role="tab" className="tab" onClick={() => onPageChange('analyzer')}>Blueprint Analyzer</a>
                    <a role="tab" className="tab tab-active">Voice Analyzer</a>
                    </div>
                <h1 className="title">Voice Recording & Analysis</h1>
                <p className="mb-4 text-center">Record client meetings or personal notes. While recording, an icon will show if your mic level is active or too low. You can preview the audio before sending it for AI analysis.</p>
                <div className="flex flex-col sm:flex-row gap-4 items-center">
                    <button onClick={isRecording ? stopRecording : startRecording} className={`btn ${isRecording ? 'btn-error' : 'btn-primary'} btn-outline grow`}>
                        {isRecording ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button onClick={onAnalyze} disabled={isAnalyzing || isRecording || !audioPreviewUrl} className="btn btn-secondary btn-outline grow">
                        {isAnalyzing && <span className="loading loading-spinner"></span>}
                        {isAnalyzing ? 'Analyzing...' : 'Analyze Recording'}
                    </button>
                </div>

                {isRecording && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                        <span className={`badge ${micStatus === 'listening' ? 'badge-success' : 'badge-error'}`}></span>
                        <span>{micStatus === 'listening' ? 'Mic is active' : 'Mic level is low'}</span>
                    </div>
                )}
                
                {audioPreviewUrl && !isRecording && (
                    <div className="mt-6 flex flex-col items-center gap-4">
                        <h3 className="text-lg font-bold">Recording Preview:</h3>
                        <audio src={audioPreviewUrl} controls className="w-full"></audio>
                        <button onClick={resetState} className="btn btn-error">Discard and record again</button>
                    </div>
                )}
                
                {isAnalyzing && (
                    <div className="mt-4 space-y-2">
                        <button onClick={handleStopAnalysis} className="btn btn-error btn-outline w-full">
                            Stop Analysis
                        </button>
                    </div>
                )}

                {error && <div className="alert alert-error mt-4 rounded-box">{error}</div>}
                
                {transcript && (
                     <div className="mt-6">
                        <CollapsibleSection title="Transcript" rawText={transcript}>
                           <p className="whitespace-pre-line text-base-content/80">{transcript}</p>
                        </CollapsibleSection>
                    </div>
                )}
                
                {analysisResult && (
                    <>
                        <AnalysisResultDisplay analysisResult={analysisResult} />
                        <button onClick={handleUseInCalculator} className="btn btn-primary btn-outline mt-4">
                            Use in Calculator
                        </button>
                    </>
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

// --- MAIN APP COMPONENT ---
export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState('calculator');
    const [dataForCalculator, setDataForCalculator] = useState(null);
    const [appState, setAppState] = useState('welcome');

    // --- State for Calculator Page (Lifted State) ---
    const [calculatorItems, setCalculatorItems] = useState([{ id: uuidv4(), type: '', sf: '' }]);
    const [calculatorProjectName, setCalculatorProjectName] = useState('');
    const [calculatorAddress, setCalculatorAddress] = useState('');
    const [calculatorClientName, setCalculatorClientName] = useState('');
    const [calculatorScopeOfWorkText, setCalculatorScopeOfWorkText] = useState('');
    const [editingProjectId, setEditingProjectId] = useState(null);
    const [calculatorBlueprintUrl, setCalculatorBlueprintUrl] = useState(null);
    const [calculatorAnalysisData, setCalculatorAnalysisData] = useState(null);


    // --- State and logic for Blueprint Analyzer ---
    const [blueprintFile, setBlueprintFile] = useState(null);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisError, setAnalysisError] = useState('');
    const [progressMessage, setProgressMessage] = useState('');
    const [progressPercent, setProgressPercent] = useState(0);
    const [uploadedBlueprintUrl, setUploadedBlueprintUrl] = useState(null);
    const abortController = useRef(null);

    // --- State and logic for Voice Analyzer ---
    const [voiceAnalysisResult, setVoiceAnalysisResult] = useState(null);
    const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);
    const [voiceAnalysisError, setVoiceAnalysisError] = useState('');
    const [transcript, setTranscript] = useState(null);

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

    const handleClearCalculator = () => {
        setCalculatorItems([{ id: uuidv4(), type: '', sf: '' }]);
        setCalculatorProjectName('');
        setCalculatorAddress('');
        setCalculatorClientName('');
        setCalculatorScopeOfWorkText('');
        setEditingProjectId(null);
        setCalculatorBlueprintUrl(null);
        setCalculatorAnalysisData(null);
        setDataForCalculator(null);
    };

    const handleUseInCalculatorFromAnalysis = () => {
        if (!analysisResult) return;

        setCalculatorBlueprintUrl(uploadedBlueprintUrl);
        setCalculatorAnalysisData(analysisResult);

        const remodelingItems = analysisResult["Remodeling place and size"] || {};
        const filteredItems = Object.fromEntries(Object.entries(remodelingItems).filter(([, value]) => value !== null));
        const data = {
            projectName: analysisResult["Project Name"] || '',
            address: analysisResult["Project Address"] || '',
            clientName: analysisResult["Client Name"] || '',
            scopeOfWork: analysisResult["Scope of Work"] || '',
            items: filteredItems,
            blueprintUrl: uploadedBlueprintUrl,
            analysisResult: analysisResult
        };
        handlePageChange('calculator', data);
    };

    const handleUseInCalculatorFromVoiceAnalysis = () => {
        if (!voiceAnalysisResult) return;
        const remodelingItems = voiceAnalysisResult["Remodeling place and size"] || {};
        const filteredItems = Object.fromEntries(Object.entries(remodelingItems).filter(([, value]) => value !== null));
        const dataForCalculator = {
            projectName: voiceAnalysisResult["Project Name"] || '',
            address: voiceAnalysisResult["Project Address"] || '',
            clientName: voiceAnalysisResult["Client Name"] || '',
            scopeOfWork: voiceAnalysisResult["Scope of Work"] || '',
            items: filteredItems,
            analysisResult: voiceAnalysisResult
        };
        handlePageChange('calculator', dataForCalculator);
    };


    const handleAnalyze = async () => {
        if (!blueprintFile || !user) {
            setAnalysisError('Please select a file first.');
            return;
        }

        abortController.current = new AbortController();
        setIsAnalyzing(true);
        setAnalysisError('');
        setProgressMessage('Preparing for analysis...');
        setAnalysisResult(null);
        setUploadedBlueprintUrl(null);
        setProgressPercent(0);

        const analyzeUrl = 'https://analyze-blueprint-w47bikyqya-uc.a.run.app';
        const synthesizeUrl = 'https://synthesize-scope-of-work-w47bikyqya-uc.a.run.app';
        const CHUNK_SIZE = 5;
        const MAX_FILE_SIZE = 10 * 1024 * 1024;

        try {
            const wasChunked = blueprintFile.type === 'application/pdf' && blueprintFile.size > MAX_FILE_SIZE;
            let finalAnalysis;
            let firstPageUrl;

            if (wasChunked) {
                const arrayBuffer = await blueprintFile.arrayBuffer();
                const pdfDoc = await PDFDocument.load(arrayBuffer);
                const totalPages = pdfDoc.getPageCount();
                let allAnalysisResults = [];

                for (let i = 0; i < totalPages; i += CHUNK_SIZE) {
                    const chunkEnd = Math.min(i + CHUNK_SIZE, totalPages);
                    setProgressMessage(`Analyzing pages ${i + 1}-${chunkEnd} of ${totalPages}...`);
                    setProgressPercent(Math.round((chunkEnd / totalPages) * 100));

                    const subPdf = await PDFDocument.create();
                    const copiedPages = await subPdf.copyPages(pdfDoc, Array.from({ length: chunkEnd - i }, (_, k) => i + k));
                    copiedPages.forEach(page => subPdf.addPage(page));

                    const chunkBytes = await subPdf.save();
                    const chunkBlob = new Blob([chunkBytes], { type: 'application/pdf' });

                    const fileData = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.readAsDataURL(chunkBlob);
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = (error) => reject(error);
                    });

                    const payload = { fileData, userId: user.uid };
                    const response = await fetch(analyzeUrl, {
                        method: 'POST',
                        mode: 'cors',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: abortController.current.signal
                    });
                    const parsed = await response.json();

                    if (!response.ok) throw new Error(parsed.error || `Chunk ${i / CHUNK_SIZE + 1} failed.`);

                    allAnalysisResults.push(parsed.analysisResult);
                    if (i === 0) firstPageUrl = parsed.blueprintUrl;
                }

                finalAnalysis = _mergeAnalysisResults(allAnalysisResults);

                if (finalAnalysis['Scope of Work']) {
                    setProgressMessage('Finalizing scope of work...');
                    const synthResponse = await fetch(synthesizeUrl, {
                        method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: finalAnalysis['Scope of Work'] })
                    });
                    const synthResult = await synthResponse.json();
                    if (!synthResponse.ok) throw new Error(synthResult.error || 'Failed to synthesize scope of work.');
                    finalAnalysis['Scope of Work'] = synthResult.synthesizedScope;
                }
            } else {
                setProgressMessage('Analyzing...');
                setProgressPercent(97);
                const fileData = await new Promise((resolve, reject) => {
                    const reader = new FileReader(); reader.readAsDataURL(blueprintFile); reader.onload = () => resolve(reader.result); reader.onerror = (error) => reject(error);
                });
                const payload = { fileData, userId: user.uid };
                const response = await fetch(analyzeUrl, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: abortController.current.signal
                });
                const parsed = await response.json();
                if (!response.ok) throw new Error(parsed.error || 'The server returned an error.');
                finalAnalysis = parsed.analysisResult || {};
                firstPageUrl = parsed.blueprintUrl || null;
            }

            setAnalysisResult(finalAnalysis);
            setUploadedBlueprintUrl(firstPageUrl);
            setProgressMessage('');

        } catch (err) {
            if (err.name === 'AbortError') {
                setAnalysisError('Analysis stopped by user interaction.');
            } else {
                setAnalysisError(err.message);
            }
            setProgressMessage('');
            setProgressPercent(0);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAnalyzeVoice = async (audioChunks, audioSampleRate, error) => {
        if (error) {
            setVoiceAnalysisError(error);
            return;
        }

        abortController.current = new AbortController();
        setIsAnalyzingVoice(true);
        setVoiceAnalysisError('');
        setVoiceAnalysisResult(null);
        setTranscript(null);

        const audioBlob = audioChunks[0];
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
            const base64Audio = reader.result;
            if (!base64Audio) {
                setVoiceAnalysisError('Failed to read the audio data. Please try recording again.');
                setIsAnalyzingVoice(false);
                return;
            }

            const functionUrl = 'https://analyze-voice-recording-w47bikyqya-uc.a.run.app';

            try {
                const response = await fetch(functionUrl, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        audioData: base64Audio,
                        sampleRate: audioSampleRate
                    }),
                    signal: abortController.current.signal,
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || 'Analysis failed due to a server error.');
                }

                setVoiceAnalysisResult(result.analysis);
                setTranscript(result.transcript);

            } catch (err) {
                if (err.name === 'AbortError') {
                    setVoiceAnalysisError('Analysis stopped by user interaction.');
                } else {
                    setVoiceAnalysisError(`Analysis failed: ${err.message}`);
                }
            } finally {
                setIsAnalyzingVoice(false);
            }
        };
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'application/pdf')) {
            setBlueprintFile(file);
            setAnalysisError('');
            setProgressMessage('');
            setAnalysisResult(null);
        } else {
            setBlueprintFile(null);
            setAnalysisError('Please select a valid image (PNG, JPG) or PDF file.');
        }
    };

    const handleStopAnalysis = () => {
        if (abortController.current) {
            abortController.current.abort();
        }
    };


    if (appState === 'welcome') {
        return <WelcomePage onGetStarted={() => setAppState('app')} onLearnMore={() => setAppState('learnMore')} />;
    }

    if (appState === 'learnMore') {
        return <LearnMorePage onBack={() => setAppState('welcome')} />;
    }

    const renderPage = () => {
        switch (currentPage) {
            case 'calculator':
                return <PriceCalculator
                    user={user}
                    onLogout={handleLogout}
                    onPageChange={handlePageChange}
                    items={calculatorItems}
                    setItems={setCalculatorItems}
                    projectName={calculatorProjectName}
                    setProjectName={setCalculatorProjectName}
                    address={calculatorAddress}
                    setAddress={setCalculatorAddress}
                    clientName={calculatorClientName}
                    setClientName={setCalculatorClientName}
                    scopeOfWorkText={calculatorScopeOfWorkText}
                    setScopeOfWorkText={setCalculatorScopeOfWorkText}
                    editingProjectId={editingProjectId}
                    setEditingProjectId={setEditingProjectId}
                    blueprintUrl={calculatorBlueprintUrl}
                    analysisData={calculatorAnalysisData}
                    onClear={handleClearCalculator}
                    initialData={dataForCalculator}
                />;
            case 'records':
                return <RecordsPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />;
            case 'analyzer':
                return <BlueprintAnalyzerPage
                    user={user}
                    onLogout={handleLogout}
                    onPageChange={handlePageChange}
                    blueprintFile={blueprintFile}
                    analysisResult={analysisResult}
                    isAnalyzing={isAnalyzing}
                    error={analysisError}
                    progressMessage={progressMessage}
                    progressPercent={progressPercent}
                    handleFileChange={handleFileChange}
                    handleAnalyze={handleAnalyze}
                    handleStopAnalysis={handleStopAnalysis}
                    handleUseInCalculator={handleUseInCalculatorFromAnalysis}
                />;
            case 'voiceAnalyzer':
                return <VoiceAnalyzerPage
                    user={user}
                    onLogout={handleLogout}
                    onPageChange={handlePageChange}
                    isAnalyzing={isAnalyzingVoice}
                    error={voiceAnalysisError}
                    transcript={transcript}
                    analysisResult={voiceAnalysisResult}
                    handleAnalyze={handleAnalyzeVoice}
                    handleUseInCalculator={handleUseInCalculatorFromVoiceAnalysis}
                    handleStopAnalysis={handleStopAnalysis}
                />;
            default:
                return <PriceCalculator
                    user={user}
                    onLogout={handleLogout}
                    onPageChange={handlePageChange}
                    items={calculatorItems}
                    setItems={setCalculatorItems}
                    projectName={calculatorProjectName}
                    setProjectName={setCalculatorProjectName}
                    address={calculatorAddress}
                    setAddress={setCalculatorAddress}
                    clientName={calculatorClientName}
                    setClientName={setCalculatorClientName}
                    scopeOfWorkText={calculatorScopeOfWorkText}
                    setScopeOfWorkText={setCalculatorScopeOfWorkText}
                    editingProjectId={editingProjectId}
                    setEditingProjectId={setEditingProjectId}
                    blueprintUrl={calculatorBlueprintUrl}
                    analysisData={calculatorAnalysisData}
                    onClear={handleClearCalculator}
                    initialData={dataForCalculator}
                />;
        }
    };

    return (
        <>{user ? renderPage() : <AuthPage />}</>
    );
}