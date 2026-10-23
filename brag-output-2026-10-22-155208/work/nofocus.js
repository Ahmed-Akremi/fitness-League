(() => { const s = document.createElement('style'); s.textContent = '*:focus, *:focus-visible { outline: none !important; }'; document.head.appendChild(s); return location.pathname })()
