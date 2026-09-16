const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  const heading = document.createElement('h1');
  heading.textContent = 'MOSSE Object Tracker';
  app.appendChild(heading);
}
