// Applies a saved light/dark choice before first paint. Loaded as a classic script in <head>.
(function () {
  try {
    var theme = localStorage.getItem('ng-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
