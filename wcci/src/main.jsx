import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

const style = document.createElement('style');
style.setAttribute('data-wcci', '1');
style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { height: 100%; -webkit-text-size-adjust: 100%; }
  body { font-family: 'Inter', sans-serif; height: 100%; overflow: hidden; overscroll-behavior: none; }
  #root { height: 100%; }
  @keyframes pulse { 0%,80%,100%{transform:scale(0.5);opacity:0.3} 40%{transform:scale(1);opacity:1} }
  @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
  .fade-up { animation: fadeUp 0.5s ease forwards; }
  .chat-msg { animation: fadeUp 0.3s ease forwards; }
  textarea:focus { outline: none; border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.1) !important; }
  textarea::placeholder { color: #9ca3af; }
  button:active { opacity: 0.85; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 4px; }
  @supports(padding: max(0px)) {
    body { padding-bottom: env(safe-area-inset-bottom, 0px); }
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
