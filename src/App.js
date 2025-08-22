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
        <h1 className="title">Pricing Calculator</h1>
        
        {/* Container for the list of items */}
        <div className="items-container">
          {items.map((item, index) => (
            <div key={item.id} className="item-row">
              {/* Dropdown */}
              <div className="input-group">
                <label htmlFor={`type-${item.id}`} className="sr-only">Type</label>
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
            + Add Item
          </button>
        </div>

        {/* Total Price Display */}
        <div className="total-display">
          <span className="total-label">Total Price:</span>
          <span className="total-price">
            ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}
