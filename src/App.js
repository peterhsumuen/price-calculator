import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query } from 'firebase/firestore';
import './App.css';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDw0ZTTDzVfB-IiLBlK8LlZlLS2sNdDF0U",
  authDomain: "remodelingbid.firebaseapp.com",
  projectId: "remodelingbid",
  storageBucket: "remodelingbid.firebasestorage.app",
  messagingSenderId: "232389086436",
  appId: "1:232389086436:web:50f47b5a2f9176eea570f1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Price Calculator Component
function PriceCalculator({ user, onLogout, onPageChange, blueprintData }) {
  const [items, setItems] = useState([
    { id: uuidv4(), type: 'Full gut', sf: '' }
  ]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [projectName, setProjectName] = useState('');
  const [address, setAddress] = useState('');
  const [clientName, setClientName] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  const PRICING_RULES = {
    'Full gut': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF >= 700 ? 250 * parsedSF : 300 * parsedSF;
    },
    'Additional building/ new construction': (sf) => {
      const parsedSF = parseFloat(sf);
      return isNaN(parsedSF) ? 0 : 600 * parsedSF;
    },
    'Structural Wall removal': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF <= 700 ? 45000 : 0;
    },
    '2nd Structural Wall removal': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF <= 700 ? 6000 : 0;
    },
    'Kitchen': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return (500 * parsedSF) + 20000;
    },
    'Bathroom': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return (500 * parsedSF) + 20000;
    },
    'Living room': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF <= 700 ? 300 * parsedSF : 0;
    },
    'Garage': (sf) => {
      const parsedSF = parseFloat(sf);
      return isNaN(parsedSF) ? 0 : 465 * parsedSF;
    },
    'Bedroom': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF > 700 ? 0 : 300 * parsedSF;
    },
    'Landscape': (sf) => {
      return 0;
    },
  };

  useEffect(() => {
    if (blueprintData) {
      const newItems = Object.entries(blueprintData)
        .filter(([key]) => PRICING_RULES[key] !== undefined)
        .map(([type, sf]) => ({
          id: uuidv4(),
          type,
          sf: sf.toString()
        }));
      setItems(newItems.length > 0 ? newItems : [{ id: uuidv4(), type: 'Full gut', sf: '' }]);
    }
  }, [blueprintData]);

  useEffect(() => {
    let total = 0;
    items.forEach(item => {
      const calculatePrice = PRICING_RULES[item.type];
      if (calculatePrice) {
        total += calculatePrice(item.sf);
      }
    });
    setTotalPrice(total);
  }, [items]);

  const handleChange = (id, field, value) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleAddItem = () => {
    setItems([...items, { id: uuidv4(), type: 'Full gut', sf: '' }]);
  };

  const handleRemoveItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  const saveProject = async () => {
    if (!projectName || !address || !clientName) {
      setSaveStatus("Please fill out all project details before saving.");
      return;
    }
    setSaveStatus("Saving...");
    try {
      await addDoc(collection(db, `projects`), {
        userId: user.uid,
        userName: user.email,
        projectName,
        address,
        clientName,
        finalPrice: totalPrice,
        items: items.map(item => ({ type: item.type, sf: item.sf }))
      });
      setSaveStatus("Project saved successfully!");
      setTimeout(() => setSaveStatus(''), 3000);
      setProjectName('');
      setAddress('');
      setClientName('');
      setItems([{ id: uuidv4(), type: 'Full gut', sf: '' }]);
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
        <header className="header">
          <span className="user-info">Welcome, {user.email}!</span>
          <button onClick={onLogout} className="logout-btn">Logout</button>
        </header>

        <div className="nav-buttons">
          <button className="nav-btn-active">Calculator</button>
          <button onClick={() => onPageChange('records')} className="nav-btn">Records</button>
          <button onClick={() => onPageChange('analyzer')} className="nav-btn">Blueprint Analyzer</button>
        </div>

        <h1 className="title">Pricing Calculator</h1>

        <div className="project-details">
          <div className="input-group">
            <input type="text" placeholder="Project Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="input-field" />
          </div>
          <div className="input-group">
            <input type="text" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" />
          </div>
          <div className="input-group">
            <input type="text" placeholder="Client Name" value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-field" />
          </div>
        </div>

        <div className="items-container">
          {items.map((item) => (
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
            </div>
          ))}
        </div>

        <div className="add-btn-container">
          <button onClick={handleAddItem} className="add-btn">+ Add Item</button>
        </div>

        <div className="total-display">
          <span className="total-label">Total Price:</span>
          <span className="calculator-total-price">${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="save-container">
          {saveStatus && <p className="save-status">{saveStatus}</p>}
          <button onClick={saveProject} className="save-btn">Save Project</button>
        </div>
      </div>
    </div>
  );
}

// Records Page Component
function RecordsPage({ user, onLogout, onPageChange }) {
  const [projects, setProjects] = useState([]);
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'projects'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProjects(projectList);
    });
    return () => unsubscribe();
  }, [user]);

  return (
    <div className="app-container">
      <div className="calculator-card">
        <header className="header">
          <span className="user-info">Welcome, {user.email}!</span>
          <button onClick={onLogout} className="logout-btn">Logout</button>
        </header>

        <div className="nav-buttons">
          <button onClick={() => onPageChange('calculator')} className="nav-btn">Calculator</button>
          <button className="nav-btn-active">Records</button>
          <button onClick={() => onPageChange('analyzer')} className="nav-btn">Blueprint Analyzer</button>
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
                  <div className="details-header details-row">
                    <span>Item</span>
                    <span>Square Feet</span>
                  </div>
                  {(project.items || []).map((item, index) => (
                    <div key={index} className="details-row">
                      <span>{item.type}</span>
                      <span>{item.sf}</span>
                    </div>
                  ))}
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
function BlueprintAnalyzerPage({ user, onLogout, onPageChange }) {
  const [blueprintFile, setBlueprintFile] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('');
  const [address, setAddress] = useState('');
  const [clientName, setClientName] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'application/pdf')) {
      setBlueprintFile(file);
      setError('');
    } else {
      setBlueprintFile(null);
      setError('Please select a valid image (PNG, JPG) or PDF file.');
    }
  };

  const handleAnalyze = async () => {
    if (!blueprintFile || !projectName || !address || !clientName) {
      setError('Please fill out all project details and select a file.');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setAnalysisResult(null);

    const functionUrl =
      process.env.NODE_ENV === 'development'
        ? 'https://analyze-blueprint-w47bikyqya-uc.a.run.app'
        : 'https://analyze-blueprint-w47bikyqya-uc.a.run.app';

    const getBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

    try {
      const fileData = await getBase64(blueprintFile);
      const payload = {
        fileData,
        projectName,
        address,
        clientName,
        userId: user.uid
      };

      const response = await fetch(functionUrl, {
        method: 'POST',
        mode: 'cors', // IMPORTANT for browsers
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Robust error handling: try to parse JSON; if not JSON, surface text
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { details: text }; }

      if (!response.ok) {
        throw new Error(parsed.details || 'The server returned an error.');
      }

      // --- Normalize keys from server/model to match PRICING_RULES ---
      const keyMap = {
        'Full gut': 'Full gut',
        'Additional building': 'Additional building/ new construction',
        'Structural Wall removeal': 'Structural Wall removal',      // server/model typo → UI key
        '2nd Structural Wall removeal': '2nd Structural Wall removal',
        'Kitchen': 'Kitchen',
        'Bathroom': 'Bathroom',
        'Living room': 'Living room',
        'Bedroom': 'Bedroom',
        'Garage': 'Garage',
      };

      const normalized = {};
      const raw = parsed.analysisResult || {};
      Object.entries(raw).forEach(([k, v]) => {
        const mapped = keyMap[k];
        if (mapped) normalized[mapped] = v;
      });

      setAnalysisResult(normalized);

    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
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
        </div>

        <h1 className="title">Blueprint Analyzer</h1>
        <p>Upload a blueprint (PNG, JPG, or PDF) to automatically extract square footage.</p>

        <div className="project-details">
            <div className="input-group">
                <input type="text" placeholder="Project Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="input-field" />
            </div>
            <div className="input-group">
                <input type="text" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" />
            </div>
            <div className="input-group">
                <input type="text" placeholder="Client Name" value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-field" />
            </div>
        </div>

        <div className="file-upload-container">
          <input
            type="file"
            onChange={handleFileChange}
            accept="image/png, image/jpeg, application/pdf"
            className="input-field file-input"
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !blueprintFile || !projectName || !address || !clientName}
            className="add-btn"
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Blueprint'}
          </button>
        </div>

        {error && <p className="error-message">{error}</p>}

        {analysisResult && (
          <div className="analysis-results">
            <h3>Analysis Results:</h3>
            <pre className="result-json">{JSON.stringify(analysisResult, null, 2)}</pre>
            <button onClick={() => onPageChange('calculator', analysisResult)} className="save-btn">
              Use in Calculator
            </button>
          </div>
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
    e.preventDefault();
    setError('');

    if (isSignUp) {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (!email.endsWith('@baroncnr.com')) {
        setError("Sign-up is restricted to @baroncnr.com emails.");
        return;
      }
      try {
        await createUserWithEmailAndPassword(auth, email, password);
      } catch (err) {
        setError(err.message);
      }
    } else {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    if (!email) {
      setError("Please enter your email to reset the password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setError("Password reset email sent. Please check your inbox.");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="app-container">
      <div className="calculator-card auth-card">
        <h1 className="title">{isSignUp ? 'Create an Account' : 'Login'}</h1>
        <form onSubmit={handleAuthAction} className="auth-form">
          <div className="input-group">
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input-field" />
          </div>
          <div className="input-group">
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input-field" />
          </div>
          {isSignUp && (
            <div className="input-group">
              <input type="password" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="input-field" />
            </div>
          )}
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="auth-btn">
            {isSignUp ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="button-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="button-icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
            )}
            {isSignUp ? 'Sign Up' : 'Login'}
          </button>
        </form>
        <div className="auth-links">
          <button className="link-btn" onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Already have an account? Login' : 'Need an account? Sign Up'}
          </button>
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
  const [blueprintData, setBlueprintData] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  const handlePageChange = (page, data = null) => {
    setCurrentPage(page);
    if (page === 'calculator' && data) {
      setBlueprintData(data);
    } else {
      setBlueprintData(null);
    }
  };

  return (
    user ? (
      currentPage === 'calculator' ? (
        <PriceCalculator user={user} onLogout={handleLogout} onPageChange={handlePageChange} blueprintData={blueprintData} />
      ) : currentPage === 'records' ? (
        <RecordsPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />
      ) : (
        <BlueprintAnalyzerPage user={user} onLogout={handleLogout} onPageChange={handlePageChange} />
      )
    ) : (
      <AuthPage />
    )
  );
}
