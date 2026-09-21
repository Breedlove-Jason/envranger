const scenarios = {
  monorepo: {'apps/api/.env': ['DATABASE_URL', 'API_TOKEN'], 'apps/web/.env.local': ['VITE_API_URL']},
  node: {'.env': ['DATABASE_URL', 'PORT', 'LOG_LEVEL']},
  next: {'.env.local': ['DATABASE_URL', 'NEXT_PUBLIC_APP_URL']}
};
function render(name) {
  const routes = scenarios[name];
  document.querySelector('#demo-config').textContent = JSON.stringify({routes}, null, 2);
  const plan = document.querySelector('#demo-plan');
  plan.replaceChildren();
  for (const [file, keys] of Object.entries(routes)) {
    const row = document.createElement('div'); row.className = 'demo-dest';
    const title = document.createElement('b'); title.textContent = file; row.append(title);
    for (const key of keys) {const line = document.createElement('p');line.textContent = `+ ${key}`;row.append(line);}
    plan.append(row);
  }
  for (const button of document.querySelectorAll('[data-scenario]')) button.setAttribute('aria-pressed', String(button.dataset.scenario === name));
}
for (const button of document.querySelectorAll('[data-scenario]')) button.addEventListener('click', () => render(button.dataset.scenario));
render('monorepo');
document.querySelector('#copy-install').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {await navigator.clipboard.writeText(document.querySelector('#install-code').textContent);status.textContent = 'Install commands copied.';}
  catch {status.textContent = 'Select and copy the commands above.';}
});
