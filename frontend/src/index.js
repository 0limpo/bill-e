import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initGA } from './analytics';
import './i18n'; // Initialize i18n

// Initialize Google Analytics 4
initGA();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
