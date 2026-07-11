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
        style: { minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: FONT_STACK, background: '#f8fafc', textAlign: 'center' },
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

// System font stack (no shipped font files, no render-blocking web-font fetch).
// Includes Simplified Chinese faces so zh-CN renders crisply. Also used by the
// error-boundary fallback above.
const FONT_STACK = "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', sans-serif";

const style = document.createElement('style');
style.setAttribute('data-wcci', '1');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { height: 100%; -webkit-text-size-adjust: 100%; }
  body { font-family: ${FONT_STACK}; height: 100%; height: 100dvh; overflow: hidden; overscroll-behavior: none; }
  #root { height: 100%; height: 100dvh; }
  /* Natural Chinese wrapping; never letter-space or uppercase CJK. */
  :lang(zh-CN), [lang="zh-CN"] { letter-spacing: 0; line-break: normal; word-break: normal; overflow-wrap: anywhere; }
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
