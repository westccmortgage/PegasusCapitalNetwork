import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Error boundary: a render error must NEVER white-screen and wipe the chat.
// The conversation lives in localStorage, so we offer a one-tap reload that
// restores it instead of silently clearing everything.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { try { console.error('WCCI render error:', error, info); } catch {} }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Inter', sans-serif", background: '#f8fafc', textAlign: 'center' },
      },
        React.createElement('div', { style: { maxWidth: 340 } },
          React.createElement('div', { style: { fontSize: 32, marginBottom: 12 } }, '↻'),
          React.createElement('h2', { style: { fontSize: 18, color: '#0a2463', marginBottom: 8 } }, 'One moment…'),
          React.createElement('p', { style: { fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 18 } },
            'We hit a hiccup, but your conversation is saved. Tap below to pick up right where you left off.'),
          React.createElement('button', {
            onClick: () => window.location.reload(),
            style: { background: 'linear-gradient(135deg, #0a2463, #2563eb)', color: 'white', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
          }, 'Resume my conversation'),
        ),
      );
    }
    return this.props.children;
  }
}

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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
