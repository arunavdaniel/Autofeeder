(function () {
  const saved = localStorage.getItem('autofeedly-theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('dark');
  document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark');
    localStorage.setItem('autofeedly-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('.theme-toggle').forEach(item => item.setAttribute('aria-label', dark ? 'Use light mode' : 'Use dark mode'));
  }));
})();
