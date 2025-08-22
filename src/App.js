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
import './App.css';

// Firebase configuration
// You MUST replace this with your own Firebase project configuration
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

// Pricing calculator component - no changes here
function PriceCalculator({ user, onLogout }) {
  // State to hold the list of items selected by the user
  const [items, setItems] = useState([
    { id: uuidv4(), type: 'Full gut', sf: '' } // Initial item
  ]);
  // State to hold the final calculated price
  const [totalPrice, setTotalPrice] = useState(0);

  // Define a map of pricing rules based on the provided image
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
      return isNaN(parsedSF) ? 0 : 400 * parsedSF;
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

  // Recalculates the total price whenever the items change
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

  // Handles changes to the dropdown or text box for a specific item
  const handleChange = (id, field, value) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  // Adds a new dropdown and text box pair
  const handleAddItem = () => {
    setItems([...items, { id: uuidv4(), type: 'Full gut', sf: '' }]);
  };

  // Removes an item from the list
  const handleRemoveItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  // Updated options array. The 'value' must match a key in PRICING_RULES.
  // The 'label' is the text the user sees in the dropdown.
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
        <h1 className="title">Pricing Calculator</h1>
        
        {/* Container for the list of items */}
        <div className="items-container">
          {items.map((item) => (
            <div key={item.id} className="item-row">
              {/* Dropdown */}
              <div className="input-group">
                <label htmlFor={`type-${item.id}`} className="sr-only">類型</label>
                <select
                  id={`type-${item.id}`}
                  value={item.type}
                  onChange={(e) => handleChange(item.id, 'type', e.target.value)}
                  className="input-field"
                >
                  {options.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Square Footage Input */}
              <div className="input-group">
                <label htmlFor={`sf-${item.id}`} className="sr-only">平方英尺</label>
                <input
                  id={`sf-${item.id}`}
                  type="number"
                  placeholder="Square Foots"
                  value={item.sf}
                  onChange={(e) => handleChange(item.id, 'sf', e.target.value)}
                  className="input-field"
                />
              </div>

              {/* Remove Button */}
              {items.length > 1 && (
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="remove-btn"
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
        
        {/* Add Item Button */}
        <div className="add-btn-container">
          <button
            onClick={handleAddItem}
            className="add-btn"
          >
            + 新增項目
          </button>
        </div>

        {/* Total Price Display */}
        <div className="total-display">
          <span className="total-label">總價：</span>
          <span className="total-price">
            ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}

// Authentication component
function AuthPage({ onLoginSuccess }) {
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
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-field"
            />
          </div>
          <div className="input-group">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
            />
          </div>
          {isSignUp && (
            <div className="input-group">
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="input-field"
              />
            </div>
          )}
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="auth-btn">{isSignUp ? 'Sign Up' : 'Login'}</button>
        </form>
        <div className="auth-links">
          <button className="link-btn" onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Already have an account? Login' : 'Need an account? Sign Up'}
          </button>
          {!isSignUp && (
            <button className="link-btn" onClick={handlePasswordReset}>
              Forgot Password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Main App component to handle authentication state
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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

  return (
    user ? (
      <PriceCalculator user={user} onLogout={handleLogout} />
    ) : (
      <AuthPage />
    )
  );
}
