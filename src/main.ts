import { initApp } from './app/ui';

initApp().catch((err) => {
  console.error('Failed to start MOSSE Object Tracker app', err);
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    const message = document.createElement('p');
    message.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
    message.style.color = '#ef4444';
    app.appendChild(message);
  }
});
