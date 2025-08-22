import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid'; // A library to generate unique IDs
import './App.css'; // Import the custom CSS file

// Main App component
export default function App() {
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
      // The spreadsheet shows two tiers based on SF
      return parsedSF >= 700 ? 250 * parsedSF : 300 * parsedSF;
    },
    'Additional building/ new construction': (sf) => {
      const parsedSF = parseFloat(sf);
      return isNaN(parsedSF) ? 0 : 600 * parsedSF;
    },
    'Structural Wall removal': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF >= 700 ? 0 : 45000;
    },
    '2nd Structural Wall removal': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF >= 700 ? 0 : 6000;
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
      return parsedSF >= 700 ? 0 : 300 * parsedSF;
    },
    'Garage': (sf) => {
      const parsedSF = parseFloat(sf);
      return isNaN(parsedSF) ? 0 : 465 * parsedSF;
    },
    'Bedroom': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      return parsedSF >= 700 ? 0 : 300 * parsedSF;
    },
    'Landscape': (sf) => {
      // The new rule: Landscape is not working yet, so the cost is 0.
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

  // Options for the dropdown menu
  const options = [
    'Full gut',
    'Additional building / new construction',
    'Structural Wall removal(Enter Full SF)',
    '2nd Structural Wall removal(Enter Full SF)',
    'Kitchen',
    'Bathroom',
    'Living room(Enter Full SF)',
    'Garage',
    'Bedroom(Enter Full SF)',
    'Landscape(Coming Soon)'
  ];

  return (
    <div className="app-container">
      <div className="calculator-card">
        <h1 className="title">Pricing Calculator</h1>
        
        {/* Container for the list of items */}
        <div className="items-container">
          {items.map((item, index) => (
            <div key={item.id} className="item-row">
              {/* Dropdown */}
              <div className="input-group">
                <label htmlFor={`type-${item.id}`} className="sr-only"></label>
                <select
                  id={`type-${item.id}`}
                  value={item.type}
                  onChange={(e) => handleChange(item.id, 'type', e.target.value)}
                  className="input-field"
                >
                  {options.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>

              {/* Square Footage Input */}
              <div className="input-group">
                <label htmlFor={`sf-${item.id}`} className="sr-only">Square Feet</label>
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
                  Remove
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
            + Add Items
          </button>
        </div>

        {/* Total Price Display */}
        <div className="total-display">
          <span className="total-label">Total Price：</span>
          <span className="total-price">
            ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}
