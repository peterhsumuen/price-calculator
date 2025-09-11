import React from 'react';

// This helper function splits a line by the bold marker "**" 
// and wraps every other segment in a <strong> tag.
const parseLineWithBold = (line) => {
  const parts = line.split('**');
  return parts.map((part, index) => {
    return index % 2 === 1 ? <strong key={index}>{part}</strong> : part;
  });
};

function FormattedScopeOfWork({ content }) {
  if (!content) {
    return null;
  }

  const lines = content.split('\n').map((line, index) => {
    const trimmedLine = line.trim();

    // Render ### as a main heading
    if (trimmedLine.startsWith('###')) {
      return (
        <h4 key={index} className="text-lg font-bold mt-4 mb-2">
          {trimmedLine.replace(/###/g, '').trim()}
        </h4>
      );
    }
    
    // Render a line like **Demolition** as a subheading
    // This checks if the line ONLY contains text wrapped in **
    if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**') && trimmedLine.indexOf('**', 2) === trimmedLine.length - 2) {
       return (
        <h5 key={index} className="text-md font-bold mt-3 mb-1">
          {trimmedLine.substring(2, trimmedLine.length - 2)}
        </h5>
      );
    }
    
    // Render lines starting with - as list items, parsing for bold text inside
    if (trimmedLine.startsWith('-')) {
        const lineContent = trimmedLine.replace(/^-+\s*/, '');
        return (
            <li key={index} className="ml-4 list-disc">
                {parseLineWithBold(lineContent)}
            </li>
        );
    }
    
    // Render empty lines for spacing between paragraphs
    if (trimmedLine === '') {
        return <div key={index} className="h-2"></div>;
    }

    // Render all other lines as paragraphs, parsing for bold text
    return <p key={index}>{parseLineWithBold(trimmedLine)}</p>;
  });

  return <div>{lines}</div>;
}

export default FormattedScopeOfWork;