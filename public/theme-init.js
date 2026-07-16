// Applies the saved (or system) theme before hydration to avoid a flash.
(function () {
  try {
    var t = localStorage.getItem("theme");
    var d =
      t === "dark" ||
      (!t && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", d);
  } catch (e) {}
})();
