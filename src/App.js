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
      const isFullGutSelected = items.some(item => item.type === 'Full gut');
      const parsedSF = parseFloat(sf);
      // The spreadsheet says "follow Full gut" for >700 SF, implying cost is included.
      // We'll apply the fixed price only if "Full gut" is NOT selected.
      if (isFullGutSelected) return 0;
      return 45000;
    },
    '2nd Structural Wall removal': (sf) => {
      // The spreadsheet shows a fixed price for this
      return 6000;
    },
    'Kitchen': (sf) => {
      const parsedSF = parseFloat(sf);
      return isNaN(parsedSF) ? 0 : 400 * parsedSF;
    },
    'Bathroom': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      // Use a tiered system based on SF for "lower" and "upper" ranges
      return parsedSF < 50 ? 1000 * parsedSF : 800 * parsedSF;
    },
    'Living room': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      // Two tiers based on SF
      return parsedSF < 700 ? 300 * parsedSF : 250 * parsedSF;
    },
    'Garage': (sf) => {
      const parsedSF = parseFloat(sf);
      return isNaN(parsedSF) ? 0 : 465 * parsedSF;
    },
    'Bedroom': (sf) => {
      const parsedSF = parseFloat(sf);
      if (isNaN(parsedSF)) return 0;
      // Use a tiered system based on SF for "lower" and "upper" ranges
      return parsedSF < 200 ? 300 * parsedSF : 250 * parsedSF;
    },
    'Landscape': (sf) => {
      // The spreadsheet showed N/A and a value error. We'll use a fixed price.
      return 10000;
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
    'Additional building/ new construction',
    'Structural Wall removal',
    '2nd Structural Wall removal',
    'Kitchen',
    'Bathroom',
    'Living room',
    'Garage',
    'Bedroom',
    'Landscape'
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
                <label htmlFor={`type-${item.id}`} className="sr-only">類型</label>
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
                <label htmlFor={`sf-${item.id}`} className="sr-only">平方英尺</label>
                <input
                  id={`sf-${item.id}`}
                  type="number"
                  placeholder="平方英尺"
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
