import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3500,
        style: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 },
        success: { iconTheme: { primary: '#7c5cfc', secondary: '#fff' } },
      }}
    />
  </React.StrictMode>
);
